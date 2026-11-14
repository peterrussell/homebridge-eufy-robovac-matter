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
const fs_1 = __importDefault(require("fs"));
const constants_1 = require("./constants");
const tuya_cloud_1 = require("./tuya-cloud");
class EufyCloudSession {
    username;
    password;
    log;
    sessionFile;
    openudid = crypto_1.default.randomBytes(16).toString('hex');
    tuya;
    constructor(username, password, log, 
    /** File to persist the Tuya session so restarts don't re-login (daily-rate-limited). */
    sessionFile) {
        this.username = username;
        this.password = password;
        this.log = log;
        this.sessionFile = sessionFile;
    }
    async login() {
        if (this.tuya) {
            return;
        }
        // 1. Resume a saved session if we have one — this performs NO network
        //    login, so restarts don't count against Tuya's daily login limit.
        const cached = this.loadSession();
        if (cached) {
            this.tuya = new tuya_cloud_1.TuyaCloud({ ...constants_1.TUYA_APP, region: cached.region, session: cached });
            this.log.info('Resumed saved Tuya cloud session (no login needed)');
            return;
        }
        // 2. No cached session — perform a full login and save it.
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
        this.saveSession(tuya.exportSession());
    }
    /** Drop the current session (e.g. after it's rejected) so the next login re-authenticates. */
    invalidate() {
        this.tuya = undefined;
        if (this.sessionFile) {
            try {
                fs_1.default.rmSync(this.sessionFile, { force: true });
            }
            catch {
                /* ignore */
            }
        }
    }
    loadSession() {
        if (!this.sessionFile) {
            return null;
        }
        try {
            const s = JSON.parse(fs_1.default.readFileSync(this.sessionFile, 'utf8'));
            if (s?.sid && s?.deviceID && s?.endpoint && s?.region) {
                return s;
            }
        }
        catch {
            /* no usable cache */
        }
        return null;
    }
    saveSession(s) {
        if (!this.sessionFile || !s) {
            return;
        }
        try {
            fs_1.default.writeFileSync(this.sessionFile, JSON.stringify(s), { mode: 0o600 });
        }
        catch (e) {
            this.log.debug('Could not persist Tuya session:', e);
        }
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