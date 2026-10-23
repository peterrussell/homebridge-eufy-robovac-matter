/**
 * Eufy account login → a logged-in Tuya cloud client.
 *
 * Ported from martijnpoppen/eufy-clean (MIT): authenticate to the eufy cloud
 * (v2 app endpoint, falling back to v1), take the returned user_id, and use it
 * for the Tuya enhanced (uid) login. Uses Node's built-in `fetch`.
 */

import crypto from 'crypto';

import type { Logger } from '../robovac-api';
import { EUFY_DOMAIN_CONFIGS, TUYA_APP } from './constants';
import { TuyaCloud } from './tuya-cloud';

export class EufyCloudSession {
    private readonly openudid = crypto.randomBytes(16).toString('hex');
    private tuya?: TuyaCloud;

    constructor(
        private readonly username: string,
        private readonly password: string,
        private readonly log: Logger,
    ) {}

    async login(): Promise<void> {
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
