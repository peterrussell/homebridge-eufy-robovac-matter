/**
 * Eufy account login → a logged-in Tuya cloud client.
 *
 * Ported from martijnpoppen/eufy-clean (MIT): authenticate to the eufy cloud
 * (v2 app endpoint, falling back to v1), take the returned user_id, and use it
 * for the Tuya enhanced (uid) login. Uses Node's built-in `fetch`.
 */

import crypto from 'crypto';
import fs from 'fs';

import type { Logger } from '../robovac-api';
import { EUFY_DOMAIN_CONFIGS, TUYA_APP } from './constants';
import { TuyaCloud, type TuyaSession } from './tuya-cloud';

export class EufyCloudSession {
    private readonly openudid = crypto.randomBytes(16).toString('hex');
    private tuya?: TuyaCloud;

    constructor(
        private readonly username: string,
        private readonly password: string,
        private readonly log: Logger,
        /** File to persist the Tuya session so restarts don't re-login (daily-rate-limited). */
        private readonly sessionFile?: string,
    ) {}

    async login(): Promise<void> {
        if (this.tuya) {
            return;
        }

        // 1. Resume a saved session if we have one — this performs NO network
        //    login, so restarts don't count against Tuya's daily login limit.
        const cached = this.loadSession();
        if (cached) {
            this.tuya = new TuyaCloud({ ...TUYA_APP, region: cached.region, session: cached });
            this.log.info('Resumed saved Tuya cloud session (no login needed)');
            return;
        }

        // 2. No cached session — perform a full login and save it.
        const session = await this.eufyLogin();
        const uid = session?.user_id;
        if (!uid) {
            throw new Error('eufy login failed (no user_id returned)');
        }

        const tuya = new TuyaCloud({ ...TUYA_APP, region: 'EU' });
        try {
            await tuya.loginEx(uid, 'EU');
            this.log.info('Tuya cloud login successful (EU)');
        } catch (euError) {
            this.log.debug('Tuya cloud EU login failed, trying US:', euError);
            await tuya.loginEx(uid, 'US');
            this.log.info('Tuya cloud login successful (US)');
        }
        this.tuya = tuya;
        this.saveSession(tuya.exportSession());
    }

    /** Drop the current session (e.g. after it's rejected) so the next login re-authenticates. */
    invalidate(): void {
        this.tuya = undefined;
        if (this.sessionFile) {
            try {
                fs.rmSync(this.sessionFile, { force: true });
            } catch {
                /* ignore */
            }
        }
    }

    private loadSession(): TuyaSession | null {
        if (!this.sessionFile) {
            return null;
        }
        try {
            const s = JSON.parse(fs.readFileSync(this.sessionFile, 'utf8')) as TuyaSession;
            if (s?.sid && s?.deviceID && s?.endpoint && s?.region) {
                return s;
            }
        } catch {
            /* no usable cache */
        }
        return null;
    }

    private saveSession(s: TuyaSession | null): void {
        if (!this.sessionFile || !s) {
            return;
        }
        try {
            fs.writeFileSync(this.sessionFile, JSON.stringify(s), { mode: 0o600 });
        } catch (e) {
            this.log.debug('Could not persist Tuya session:', e);
        }
    }

    private async eufyLogin(): Promise<{ access_token?: string; user_id?: string } | null> {
        for (const cfg of EUFY_DOMAIN_CONFIGS) {
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
                const data = await res.json() as { access_token?: string; user_id?: string };
                if (data?.access_token && data?.user_id) {
                    this.log.info(`eufy login successful (${cfg.label})`);
                    return data;
                }
                this.log.debug(`eufy login via ${cfg.label} returned no token/user_id`);
            } catch (error) {
                this.log.debug(`eufy login via ${cfg.label} failed:`, error);
            }
        }
        return null;
    }

    getTuya(): TuyaCloud {
        if (!this.tuya) {
            throw new Error('Not logged in to the eufy/Tuya cloud');
        }
        return this.tuya;
    }

    get loggedIn(): boolean {
        return !!this.tuya;
    }
}
