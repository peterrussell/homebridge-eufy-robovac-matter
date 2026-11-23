/**
 * Eufy cloud backend: controls newer "novel"-protocol RoboVacs (e.g. the L60)
 * via the eufy/Tuya cloud. Logs in with eufy account credentials, polls the
 * device's protobuf-encoded DPS for state, and sends protobuf ModeCtrlRequest
 * commands. Self-contained port of the relevant eufy-clean logic.
 */

import crypto from 'crypto';
import path from 'path';

import type { Logger } from '../robovac-api';
import { CLOUD_POLL_INTERVAL_MS } from '../settings';
import { CONTROL_METHOD, NOVEL_CLEAN_SPEEDS, NOVEL_DPS, friendlyError } from '../eufy/constants';
import { EufyCloudSession } from '../eufy/eufy-login';
import { CLEAN_TYPE, MOP_LEVEL_HIGH, decodeCleanType, decodeErrorCode, decodeWorkStatus, encodeCleanParam, encodeModeCtrl, encodeRoomClean } from '../eufy/protos';
import { CLEAN_MODE_TAG_MOP, CLEAN_MODE_TAG_VACUUM, type CleanModeOption, type ServiceAreaDef, type VacuumBackend, type VacuumState } from './backend';

export interface EufyCloudConfig {
    name: string;
    email: string;
    password: string;
    deviceId: string;
    /** Mop-capable model (e.g. L60 Hybrid): expose Vacuum/Mop/Vacuum & Mop clean modes. */
    mop?: boolean;
    /** User-defined rooms for Service Area (id must match the robot's map room id). */
    rooms?: Array<{ id: number; name: string }>;
    /** Map id the rooms belong to (optional). */
    mapId?: number;
    /** Directory for persisting the Tuya session across restarts (Homebridge storage path). */
    storagePath?: string;
}

function buildServiceArea(config: EufyCloudConfig): ServiceAreaDef | null {
    if (!config.rooms || config.rooms.length === 0) {
        return null;
    }
    const mapId = config.mapId ?? null;
    const areas = config.rooms.map((r) => ({ areaId: r.id, mapId, name: r.name }));
    return { areas, maps: config.mapId !== undefined ? [{ mapId: config.mapId, name: 'Map' }] : [] };
}

// Suction clean modes (vacuum-only), index-aligned with NOVEL_CLEAN_SPEEDS.
const SUCTION_MODES: CleanModeOption[] = ['Quiet', 'Standard', 'Turbo', 'Max'].map((label) => ({ label, tags: [CLEAN_MODE_TAG_VACUUM] }));
// Cleaning-type modes (mop-capable), index 0/1/2.
const MOP_MODES: CleanModeOption[] = [
    { label: 'Vacuum', tags: [CLEAN_MODE_TAG_VACUUM] },
    { label: 'Mop', tags: [CLEAN_MODE_TAG_MOP] },
    { label: 'Vacuum & Mop', tags: [CLEAN_MODE_TAG_VACUUM, CLEAN_MODE_TAG_MOP] },
];
const MODE_INDEX_TO_CLEAN_TYPE = [CLEAN_TYPE.SWEEP_ONLY, CLEAN_TYPE.MOP_ONLY, CLEAN_TYPE.SWEEP_AND_MOP];

function suctionIndex(val: unknown): number | null {
    if (val === null || val === undefined) {
        return null;
    }
    if (typeof val === 'number' || (typeof val === 'string' && /^\d+$/.test(val))) {
        const i = parseInt(String(val), 10);
        return i >= 0 && i < NOVEL_CLEAN_SPEEDS.length ? i : null;
    }
    let lower = String(val).toLowerCase();
    if (lower === 'max_plus') {
        lower = 'max';
    }
    const idx = NOVEL_CLEAN_SPEEDS.findIndex((s) => s.toLowerCase() === lower);
    return idx >= 0 ? idx : null;
}

export class EufyCloudBackend implements VacuumBackend {
    readonly kind = 'cloud (eufy)';
    readonly cleanModes: CleanModeOption[];

    private readonly session: EufyCloudSession;
    private readonly serviceArea: ServiceAreaDef | null;
    private selectedRoomIds: number[] = [];
    private readonly listeners: Array<(state: VacuumState) => void> = [];
    private pollTimer?: NodeJS.Timeout;

    constructor(private readonly config: EufyCloudConfig, private readonly log: Logger) {
        // Cache the session per account (shared by same-account robots) to minimise logins.
        const sessionFile = config.storagePath
            ? path.join(config.storagePath, `eufy-robovac-matter-session-${crypto.createHash('md5').update(config.email).digest('hex')}.json`)
            : undefined;
        this.session = new EufyCloudSession(config.email, config.password, log, sessionFile);
        this.cleanModes = config.mop ? MOP_MODES : SUCTION_MODES;
        this.serviceArea = buildServiceArea(config);
    }

    /**
     * Run a Tuya cloud call, logging in if needed. On a stale-session failure it
     * re-authenticates once and retries — but never on the daily login-limit
     * error, which re-logging in would only make worse.
     */
    private async callTuya<T>(fn: (tuya: ReturnType<EufyCloudSession['getTuya']>) => Promise<T>): Promise<T> {
        if (!this.session.loggedIn) {
            await this.session.login();
        }
        try {
            return await fn(this.session.getTuya());
        } catch (error) {
            const message = error instanceof Error ? error.message : String(error);
            if (/USER_SESSION_LIMIT|too many|FREQUENCY/i.test(message)) {
                throw error; // rate limited — do not try to log in again
            }
            this.log.debug(`[${this.config.name}] cloud call failed, re-authenticating once: ${message}`);
            this.session.invalidate();
            await this.session.login();
            return await fn(this.session.getTuya());
        }
    }

    getServiceArea(): ServiceAreaDef | null {
        return this.serviceArea;
    }

    async selectAreas(areaIds: number[]): Promise<void> {
        const valid = new Set((this.serviceArea?.areas ?? []).map((a) => a.areaId));
        this.selectedRoomIds = areaIds.filter((id) => valid.has(id));
        this.log.info(
            `[${this.config.name}] Selected ${this.selectedRoomIds.length > 0 ? `rooms ${this.selectedRoomIds.join(', ')}` : 'all areas'} for the next clean.`,
        );
    }

    async start(): Promise<void> {
        await this.session.login();
        this.refresh().catch((error) => this.log.debug(`[${this.config.name}] initial cloud status failed:`, error));
        this.pollTimer = setInterval(() => {
            this.refresh().catch((error) => this.log.debug(`[${this.config.name}] cloud status poll failed:`, error));
        }, CLOUD_POLL_INTERVAL_MS);
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
        const dps = await this.callTuya((tuya) => tuya.getDeviceDps(this.config.deviceId));
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
        let errorCode: number | undefined;
        const errorRaw = dps[NOVEL_DPS.ERROR_CODE];
        if (typeof errorRaw === 'string' && errorRaw) {
            try {
                const code = decodeErrorCode(errorRaw);
                if (code && code !== 0) {
                    errorCode = code;
                    error = friendlyError(code);
                }
            } catch (e) {
                this.log.debug(`[${this.config.name}] could not decode error dp:`, e);
            }
        } else if (typeof errorRaw === 'number' && errorRaw > 0) {
            errorCode = errorRaw;
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
            errorCode,
            cleanMode: this.currentCleanMode(dps),
        };
    }

    private currentCleanMode(dps: Record<string, unknown>): number | null {
        if (this.config.mop) {
            const raw = dps[NOVEL_DPS.CLEANING_PARAMETERS];
            if (typeof raw !== 'string' || !raw) {
                return null;
            }
            try {
                switch (decodeCleanType(raw)) {
                    case 'SWEEP_ONLY':
                        return 0;
                    case 'MOP_ONLY':
                        return 1;
                    case 'SWEEP_AND_MOP':
                    case 'SWEEP_THEN_MOP':
                        return 2;
                    default:
                        return null;
                }
            } catch (e) {
                this.log.debug(`[${this.config.name}] could not decode clean params:`, e);
                return null;
            }
        }
        return suctionIndex(dps[NOVEL_DPS.CLEAN_SPEED]);
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
        await this.callTuya((tuya) => tuya.sendCommand(this.config.deviceId, dps));
    }

    async startCleaning(): Promise<void> {
        if (this.serviceArea && this.selectedRoomIds.length > 0) {
            await this.send({
                [NOVEL_DPS.PLAY_PAUSE]: encodeRoomClean(CONTROL_METHOD.START_SELECT_ROOMS_CLEAN, this.selectedRoomIds, this.config.mapId),
            });
            return;
        }
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

    async setCleanMode(index: number): Promise<void> {
        if (this.config.mop) {
            const cleanType = MODE_INDEX_TO_CLEAN_TYPE[index];
            if (cleanType === undefined) {
                return;
            }
            const mopLevel = cleanType === CLEAN_TYPE.SWEEP_ONLY ? undefined : MOP_LEVEL_HIGH;
            await this.send({ [NOVEL_DPS.CLEANING_PARAMETERS]: encodeCleanParam(cleanType, mopLevel) });
            return;
        }
        if (index < 0 || index >= NOVEL_CLEAN_SPEEDS.length) {
            return;
        }
        await this.send({ [NOVEL_DPS.CLEAN_SPEED]: index });
    }

    async findRobot(): Promise<void> {
        // Best effort: toggling the find-robot DP makes the robot chirp to locate it.
        await this.send({ [NOVEL_DPS.FIND_ROBOT]: true });
    }
}
