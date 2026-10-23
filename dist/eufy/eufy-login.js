"use strict";
/**
 * Eufy account login → a logged-in Tuya cloud client.
 *
 * Ported from martijnpoppen/eufy-clean (MIT): authenticate to the eufy cloud
 * (v2 app endpoint, falling back to v1), take the returned user_id, and use it
 * for the Tuya enhanced (uid) login. Uses Node's built-in `fetch`.
 */
var __importDefault = (this && this.__importDefault) || function (mod) {
    return (mod && mod.__esModule) ? mod : { "default": mod };
};
Object.defineProperty(exports, "__esModule", { value: true });
exports.EufyCloudSession = void 0;
const crypto_1 = __importDefault(require("crypto"));
const constants_1 = require("./constants");
const tuya_cloud_1 = require("./tuya-cloud");
class EufyCloudSession {
    username;
    password;
    log;
    openudid = crypto_1.default.randomBytes(16).toString('hex');
    tuya;
    constructor(username, password, log) {
        this.username = username;
        this.password = password;
        this.log = log;
    }
    async login() {
        const session = await this.eufyLogin();
        const uid = session?.user_id;
        if (!uid) {
            throw new Error('eufy login failed (no user_id returned)');
        }
        const tuya = new tuya_cloud_1.TuyaCloud({ ...constants_1.TUYA_APP, region: 'EU' });
        try {
            await tuya.loginEx(uid, 'EU');
            this.log.info('Tuya cloud login successful (EU)');
        }
        catch (euError) {
            this.log.debug('Tuya cloud EU login failed, trying US:', euError);
            await tuya.loginEx(uid, 'US');
            this.log.info('Tuya cloud login successful (US)');
        }
        this.tuya = tuya;
    }
    async eufyLogin() {
        for (const cfg of constants_1.EUFY_DOMAIN_CONFIGS) {
            try {
                const res = await fetch(cfg.url, {
                    method: 'POST',
                    headers: {
                        category: cfg.category,
                        Accept: '*/*',
                        openudid: this.openudid,
                        'Content-Type': 'application/json',
                        clientType: '1',
                        language: 'nl',
                        'User-Agent': 'EufyHome-Android-3.1.3-753',
                        timezone: 'Europe/Berlin',
                        country: 'NL',
                    },
                    body: JSON.stringify({
                        email: this.username,
                        password: this.password,
                        client_id: cfg.client_id,
                        client_secret: cfg.client_secret,
                    }),
                    signal: AbortSignal.timeout(15000),
                });
                const data = await res.json();
                if (data?.access_token && data?.user_id) {
                    this.log.info(`eufy login successful (${cfg.label})`);
                    return data;
                }
                this.log.debug(`eufy login via ${cfg.label} returned no token/user_id`);
            }
            catch (error) {
                this.log.debug(`eufy login via ${cfg.label} failed:`, error);
            }
        }
        return null;
    }
    getTuya() {
        if (!this.tuya) {
            throw new Error('Not logged in to the eufy/Tuya cloud');
        }
        return this.tuya;
    }
    get loggedIn() {
        return !!this.tuya;
    }
}
exports.EufyCloudSession = EufyCloudSession;
//# sourceMappingURL=eufy-login.js.map