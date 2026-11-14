/**
 * Eufy account login → a logged-in Tuya cloud client.
 *
 * Ported from martijnpoppen/eufy-clean (MIT): authenticate to the eufy cloud
 * (v2 app endpoint, falling back to v1), take the returned user_id, and use it
 * for the Tuya enhanced (uid) login. Uses Node's built-in `fetch`.
 */
import type { Logger } from '../robovac-api';
import { TuyaCloud } from './tuya-cloud';
export declare class EufyCloudSession {
    private readonly username;
    private readonly password;
    private readonly log;
    /** File to persist the Tuya session so restarts don't re-login (daily-rate-limited). */
    private readonly sessionFile?;
    private readonly openudid;
    private tuya?;
    constructor(username: string, password: string, log: Logger, 
    /** File to persist the Tuya session so restarts don't re-login (daily-rate-limited). */
    sessionFile?: string | undefined);
    login(): Promise<void>;
    /** Drop the current session (e.g. after it's rejected) so the next login re-authenticates. */
    invalidate(): void;
    private loadSession;
    private saveSession;
    private eufyLogin;
    getTuya(): TuyaCloud;
    get loggedIn(): boolean;
}
