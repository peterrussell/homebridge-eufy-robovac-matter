/**
 * Minimal Tuya mobile-cloud client, ported from the TuyaCloud helper in
 * martijnpoppen/eufy-clean (itself derived from TuyAPI's cloud module, MIT).
 *
 * Ported to use Node's built-in `fetch` and `crypto` instead of got / node-rsa /
 * uuid / randomatic, to avoid extra runtime dependencies. Implements the HMAC
 * (apiEtVersion) request signing and the enhanced uid-based login (loginEx)
 * used by eufy accounts, plus device list + command publish.
 */

import crypto from 'crypto';

export interface TuyaCloudOptions {
    key: string;
    secret: string;
    secret2: string;
    certSign: string;
    apiEtVersion: string;
    ttid: string;
    region: string;
    /** Restore a previously-saved session instead of logging in. */
    session?: TuyaSession;
}

/** A resumable Tuya session (avoids a fresh login, which is daily-rate-limited). */
export interface TuyaSession {
    sid: string;
    deviceID: string;
    endpoint: string;
    region: string;
}

const REGION_ENDPOINTS: Record<string, string> = {
    US: 'https://a1.tuyaus.com/api.json',
    AZ: 'https://a1.tuyaus.com/api.json',
    EU: 'https://a1.tuyaeu.com/api.json',
    AY: 'https://a1.tuyacn.com/api.json',
    IN: 'https://a1.tuyain.com/api.json',
};

// Fixed AES-128-CBC key/iv used by the eufy app for the enhanced login.
const AES_KEY = Buffer.from([36, 78, 109, 138, 86, 172, 135, 145, 36, 67, 45, 139, 108, 188, 162, 196]);
const AES_IV = Buffer.from([119, 36, 86, 242, 167, 102, 76, 243, 57, 44, 53, 151, 233, 62, 87, 71]);

const VALUES_TO_SIGN = new Set([
    'a', 'v', 'lat', 'lon', 'lang', 'deviceId', 'imei', 'imsi', 'appVersion', 'ttid', 'isH5',
    'h5Token', 'os', 'clientId', 'postData', 'time', 'requestId', 'n4h5', 'sid', 'sp', 'et',
]);

function md5(data: string): string {
    return crypto.createHash('md5').update(data).digest('hex');
}

function b64url(buf: Buffer): string {
    return buf.toString('base64').replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/, '');
}

/** Big-endian byte buffer for a non-negative BigInteger. */
function bigToBuffer(value: bigint): Buffer {
    let hex = value.toString(16);
    if (hex.length % 2) {
        hex = '0' + hex;
    }
    return Buffer.from(hex, 'hex');
}

function randomDeviceId(): string {
    const chars = 'abcdefghijklmnopqrstuvwxyz0123456789';
    let out = '';
    for (let i = 0; i < 44; i++) {
        out += chars[crypto.randomInt(chars.length)];
    }
    return out;
}

function isEmpty(value: unknown): boolean {
    if (value === undefined || value === null || value === '') {
        return true;
    }
    if (typeof value === 'number') {
        return value === 0;
    }
    return false;
}

export class TuyaCloud {
    private readonly key: string;
    private readonly secret: string;
    private readonly keyHmac: string;
    private readonly apiEtVersion: string;
    private readonly ttid: string;
    private readonly deviceID: string;
    private region: string;
    private endpoint: string;
    sid?: string;

    constructor(options: TuyaCloudOptions) {
        this.key = options.key;
        this.secret = options.secret;
        this.keyHmac = `${options.certSign}_${options.secret2}_${options.secret}`;
        this.apiEtVersion = options.apiEtVersion;
        this.ttid = options.ttid;
        if (options.session) {
            // Resume a saved session; no login needed.
            this.deviceID = options.session.deviceID;
            this.sid = options.session.sid;
            this.endpoint = options.session.endpoint;
            this.region = options.session.region;
        } else {
            this.deviceID = randomDeviceId();
            this.region = options.region in REGION_ENDPOINTS ? options.region : 'EU';
            this.endpoint = REGION_ENDPOINTS[this.region] ?? REGION_ENDPOINTS.EU;
        }
    }

    /** Export the current session for persistence, or null if not logged in. */
    exportSession(): TuyaSession | null {
        return this.sid ? { sid: this.sid, deviceID: this.deviceID, endpoint: this.endpoint, region: this.region } : null;
    }

    private mobileHash(data: string): string {
        const h = md5(data);
        return h.slice(8, 16) + h.slice(0, 8) + h.slice(24, 32) + h.slice(16, 24);
    }

    async request(options: {
        action: string;
        data?: Record<string, unknown>;
        gid?: string;
        version?: string;
        requiresSID?: boolean;
    }): Promise<any> {
        const requiresSID = options.requiresSID !== false;
        if (!this.sid && requiresSID) {
            throw new Error('Must call login() first.');
        }

        const pairs: Record<string, string | number> = {
            a: options.action,
            deviceId: this.deviceID,
            sdkVersion: '3.0.0cAnker',
            os: 'Android',
            lang: 'en',
            appVersion: '2.3.2',
            v: options.version || '1.0',
            clientId: this.key,
            time: Math.round(Date.now() / 1000),
        };
        if (options.data) {
            pairs.postData = JSON.stringify(options.data);
        }
        if (options.gid) {
            pairs.gid = options.gid;
        }
        if (this.apiEtVersion) {
            pairs.et = this.apiEtVersion;
            pairs.ttid = this.ttid;
            pairs.appVersion = '3.8.5';
            pairs.appRnVersion = '5.11';
            pairs.platform = 'Android';
            pairs.requestId = crypto.randomUUID();
        }
        if (requiresSID && this.sid) {
            pairs.sid = this.sid;
        }

        // Build the string to sign from the sorted, signable, non-empty pairs.
        const sortedKeys = Object.keys(pairs).sort();
        let strToSign = '';
        for (const key of sortedKeys) {
            if (!VALUES_TO_SIGN.has(key) || isEmpty(pairs[key])) {
                continue;
            }
            const part = key === 'postData' ? this.mobileHash(String(pairs[key])) : String(pairs[key]);
            strToSign += (strToSign ? '||' : '') + key + '=' + part;
        }
        pairs.sign = crypto.createHmac('sha256', this.keyHmac).update(strToSign).digest('hex');

        const url = new URL(this.endpoint);
        for (const [k, v] of Object.entries(pairs)) {
            url.searchParams.append(k, String(v));
        }

        const res = await fetch(url, { method: 'GET', signal: AbortSignal.timeout(15000) });
        const body = await res.json() as { success?: boolean; result?: any; errorCode?: string; errorMsg?: string };
        if (body.success === false) {
            throw new Error(`Tuya cloud error ${body.errorCode}: ${body.errorMsg}`);
        }
        return body.result;
    }

    async loginEx(uid: string, region: string): Promise<void> {
        this.region = region in REGION_ENDPOINTS ? region : 'EU';
        this.endpoint = REGION_ENDPOINTS[this.region] ?? REGION_ENDPOINTS.EU;

        const ehUid = 'eh-' + uid;
        const token = await this.request({
            action: 'tuya.m.user.uid.token.create',
            data: { countryCode: this.region, uid: ehUid },
            requiresSID: false,
        }) as { publicKey: string; exponent: string | number; token: string };

        // AES-128-CBC encrypt the (zero-left-padded) uid, then md5, then RSA.
        const cipher = crypto.createCipheriv('aes-128-cbc', AES_KEY, AES_IV);
        const paddingSize = 16 * Math.ceil(ehUid.length / 16);
        const filledUid = ehUid.padStart(paddingSize, '0');
        const encrypted = cipher.update(filledUid, 'utf8', 'hex'); // deliberately no final(), matches the app
        const encryptedPass = this.rsaNoPadEncrypt(md5(encrypted.toUpperCase()), token.publicKey, token.exponent);

        const result = await this.request({
            action: 'tuya.m.user.uid.password.login',
            data: {
                countryCode: this.region,
                uid: ehUid,
                createGroup: true,
                passwd: encryptedPass,
                ifencrypt: 1,
                options: { group: 1 },
                token: token.token,
            },
            requiresSID: false,
        }) as { sid: string; domain?: { mobileApiUrl?: string; regionCode?: string } };

        if (result.domain?.mobileApiUrl && !this.endpoint.startsWith(result.domain.mobileApiUrl)) {
            this.endpoint = result.domain.mobileApiUrl + '/api.json';
            this.region = result.domain.regionCode ?? this.region;
        }
        this.sid = result.sid;
    }

    private rsaNoPadEncrypt(dataStr: string, modulus: string, exponent: string | number): string {
        // Tuya returns the modulus and exponent as decimal (base-10) strings.
        const n = bigToBuffer(BigInt(modulus));
        const e = bigToBuffer(BigInt(exponent));
        const keyObj = crypto.createPublicKey({ key: { kty: 'RSA', n: b64url(n), e: b64url(e) }, format: 'jwk' } as crypto.JsonWebKeyInput);
        const data = Buffer.from(dataStr, 'utf8');
        const padded = Buffer.concat([Buffer.alloc(Math.max(0, n.length - data.length)), data]);
        return crypto.publicEncrypt({ key: keyObj, padding: crypto.constants.RSA_NO_PADDING }, padded).toString('hex');
    }

    private async findDevice(deviceId: string): Promise<any | undefined> {
        const groups = await this.request({ action: 'tuya.m.location.list' }) as Array<{ groupId: string }>;
        for (const group of groups) {
            const devices = await this.request({ action: 'tuya.m.my.group.device.list', gid: group.groupId }) as any[];
            const found = (devices || []).find((d) => d.devId === deviceId);
            if (found) {
                return found;
            }
        }
        // Fallback to shared devices only if not found in any owned group.
        const shared = await this.request({ action: 'tuya.m.my.shared.device.list' }) as any[];
        return (shared || []).find((d) => d.devId === deviceId);
    }

    /** Return the device's current dps map, or undefined if not found. */
    async getDeviceDps(deviceId: string): Promise<Record<string, unknown> | undefined> {
        const device = await this.findDevice(deviceId);
        return device?.dps;
    }

    async sendCommand(deviceId: string, dps: Record<string, string | number | boolean>): Promise<void> {
        await this.request({
            action: 'tuya.m.device.dp.publish',
            data: { dps, devId: deviceId, gwId: deviceId },
        });
    }
}
