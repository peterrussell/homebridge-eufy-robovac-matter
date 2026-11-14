/**
 * Minimal Tuya mobile-cloud client, ported from the TuyaCloud helper in
 * martijnpoppen/eufy-clean (itself derived from TuyAPI's cloud module, MIT).
 *
 * Ported to use Node's built-in `fetch` and `crypto` instead of got / node-rsa /
 * uuid / randomatic, to avoid extra runtime dependencies. Implements the HMAC
 * (apiEtVersion) request signing and the enhanced uid-based login (loginEx)
 * used by eufy accounts, plus device list + command publish.
 */
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
export declare class TuyaCloud {
    private readonly key;
    private readonly secret;
    private readonly keyHmac;
    private readonly apiEtVersion;
    private readonly ttid;
    private readonly deviceID;
    private region;
    private endpoint;
    sid?: string;
    constructor(options: TuyaCloudOptions);
    /** Export the current session for persistence, or null if not logged in. */
    exportSession(): TuyaSession | null;
    private mobileHash;
    request(options: {
        action: string;
        data?: Record<string, unknown>;
        gid?: string;
        version?: string;
        requiresSID?: boolean;
    }): Promise<any>;
    loginEx(uid: string, region: string): Promise<void>;
    private rsaNoPadEncrypt;
    private findDevice;
    /** Return the device's current dps map, or undefined if not found. */
    getDeviceDps(deviceId: string): Promise<Record<string, unknown> | undefined>;
    sendCommand(deviceId: string, dps: Record<string, string | number | boolean>): Promise<void>;
}
