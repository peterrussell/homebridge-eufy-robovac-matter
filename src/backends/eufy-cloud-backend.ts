/**
 * Eufy cloud backend: controls newer "novel"-protocol RoboVacs (e.g. the L60)
 * via the eufy/Tuya cloud. Logs in with eufy account credentials, polls the
 * device's protobuf-encoded DPS for state, and sends protobuf ModeCtrlRequest
 * commands. Self-contained port of the relevant eufy-clean logic.
 */

import type { Logger } from '../robovac-api';
import { STATUS_POLL_INTERVAL_MS } from '../settings';
import { CONTROL_METHOD, NOVEL_CLEAN_SPEEDS, NOVEL_DPS, friendlyError } from '../eufy/constants';
import { EufyCloudSession } from '../eufy/eufy-login';
import { decodeErrorCode, decodeWorkStatus, encodeModeCtrl } from '../eufy/protos';
import type { VacuumBackend, VacuumCleanSpeed, VacuumState } from './backend';

export interface EufyCloudConfig {
    name: string;
    email: string;
    password: string;
    deviceId: string;
}

function normalizeSpeed(val: unknown): VacuumCleanSpeed | null {
    if (val === null || val === undefined) {
        return null;
    }
    if (typeof val === 'number' || (typeof val === 'string' && /^\d+$/.test(val))) {
        const name = NOVEL_CLEAN_SPEEDS[parseInt(String(val), 10)];
        return name ? (name.toLowerCase() as VacuumCleanSpeed) : null;
    }
    const lower = String(val).toLowerCase();
    if (lower === 'max_plus') {
        return 'max';
    }
    if (lower === 'quiet' || lower === 'standard' || lower === 'turbo' || lower === 'max') {
        return lower;
    }
    return null;
}

export class EufyCloudBackend implements VacuumBackend {
    readonly kind = 'cloud (eufy)';

    private readonly session: EufyCloudSession;
    private readonly listeners: Array<(state: VacuumState) => void> = [];
    private pollTimer?: NodeJS.Timeout;

    constructor(private readonly config: EufyCloudConfig, private readonly log: Logger) {
        this.session = new EufyCloudSession(config.email, config.password, log);
    }

    async start(): Promise<void> {
        await this.session.login();
        this.refresh().catch((error) => this.log.debug(`[${this.config.name}] initial cloud status failed:`, error));
        this.pollTimer = setInterval(() => {
            this.refresh().catch((error) => this.log.debug(`[${this.config.name}] cloud status poll failed:`, error));
        }, STATUS_POLL_INTERVAL_MS);
        this.pollTimer.unref();
    }

    async stop(): Promise<void> {
        if (this.pollTimer) {
            clearInterval(this.pollTimer);
        }
    }

    onState(listener: (state: VacuumState) => void): void {
        this.listeners.push(listener);
    }

    private emit(state: VacuumState): void {
        for (const listener of this.listeners) {
            listener(state);
        }
    }

    async refresh(): Promise<VacuumState> {
        if (!this.session.loggedIn) {
            await this.session.login();
        }
        const dps = await this.session.getTuya().getDeviceDps(this.config.deviceId);
        if (!dps) {
            throw new Error(`device ${this.config.deviceId} not found in the eufy cloud account`);
        }
        const state = this.toState(dps);
        this.emit(state);
        return state;
    }

    private toState(dps: Record<string, unknown>): VacuumState {
        const batteryRaw = dps[NOVEL_DPS.BATTERY_LEVEL];
        const batteryLevel = typeof batteryRaw === 'number' ? batteryRaw : typeof batteryRaw === 'string' ? parseInt(batteryRaw, 10) : -1;

        // Error (dp 177, protobuf).
        let error: string | null = null;
        const errorRaw = dps[NOVEL_DPS.ERROR_CODE];
        if (typeof errorRaw === 'string' && errorRaw) {
            try {
                const code = decodeErrorCode(errorRaw);
                if (code && code !== 0) {
                    error = friendlyError(code);
                }
            } catch (e) {
                this.log.debug(`[${this.config.name}] could not decode error dp:`, e);
            }
        } else if (typeof errorRaw === 'number' && errorRaw > 0) {
            error = friendlyError(errorRaw);
        }

        // Work status (dp 153, protobuf).
        let activity: VacuumState['activity'] = 'stopped';
        const workRaw = dps[NOVEL_DPS.WORK_STATUS];
        if (typeof workRaw === 'string' && workRaw) {
            try {
                const ws = decodeWorkStatus(workRaw);
                activity = this.stateToActivity(ws.state, !!ws.cleaningPaused, !!ws.chargingDone, batteryLevel);
            } catch (e) {
                this.log.debug(`[${this.config.name}] could not decode work-status dp:`, e);
            }
        }
        if (error) {
            activity = 'error';
        }

        return {
            activity,
            batteryLevel: Number.isFinite(batteryLevel) && batteryLevel >= 0 ? batteryLevel : -1,
            charging: activity === 'charging' || activity === 'docked',
            error,
            cleanSpeed: normalizeSpeed(dps[NOVEL_DPS.CLEAN_SPEED]),
        };
    }

    private stateToActivity(
        state: string | undefined,
        cleaningPaused: boolean,
        chargingDone: boolean,
        battery: number,
    ): VacuumState['activity'] {
        switch (state) {
            case 'CLEANING':
                return cleaningPaused ? 'paused' : 'cleaning';
            case 'GO_HOME':
                return 'returning';
            case 'CHARGING':
                return chargingDone || battery >= 100 ? 'docked' : 'charging';
            case 'FAULT':
                return 'error';
            case 'SLEEP':
                return 'docked';
            case 'STANDBY':
                return 'paused';
            case 'FAST_MAPPING':
            case 'REMOTE_CTRL':
            case 'CRUISIING':
                return 'cleaning';
            default:
                return 'stopped';
        }
    }

    private async send(dps: Record<string, string | number | boolean>): Promise<void> {
        if (!this.session.loggedIn) {
            await this.session.login();
        }
        await this.session.getTuya().sendCommand(this.config.deviceId, dps);
    }

    async startCleaning(): Promise<void> {
        await this.send({ [NOVEL_DPS.PLAY_PAUSE]: encodeModeCtrl(CONTROL_METHOD.START_AUTO_CLEAN, 1) });
    }

    async pause(): Promise<void> {
        await this.send({ [NOVEL_DPS.PLAY_PAUSE]: encodeModeCtrl(CONTROL_METHOD.PAUSE_TASK) });
    }

    async resume(): Promise<void> {
        await this.send({ [NOVEL_DPS.PLAY_PAUSE]: encodeModeCtrl(CONTROL_METHOD.RESUME_TASK) });
    }

    async goHome(): Promise<void> {
        await this.send({ [NOVEL_DPS.PLAY_PAUSE]: encodeModeCtrl(CONTROL_METHOD.START_GOHOME) });
    }

    async setCleanSpeed(speed: VacuumCleanSpeed): Promise<void> {
        const index = NOVEL_CLEAN_SPEEDS.findIndex((s) => s.toLowerCase() === speed);
        if (index < 0) {
            return;
        }
        await this.send({ [NOVEL_DPS.CLEAN_SPEED]: index });
    }
}
