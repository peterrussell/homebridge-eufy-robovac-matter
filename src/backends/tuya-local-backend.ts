/**
 * Local Tuya backend: controls older/legacy Eufy RoboVacs directly over the
 * Tuya LAN protocol (via `RoboVac`), with no cloud involvement. Translates the
 * device's Tuya DPS status into the normalized `VacuumState`.
 */

import {
    CleanSpeed,
    ErrorCode,
    RoboVac,
    StatusDps,
    WorkStatus,
    getErrorCodeFriendlyName,
    type Logger,
    type RobovacStatus,
} from '../robovac-api';
import { CACHING_DURATION_MS, STATUS_POLL_INTERVAL_MS } from '../settings';
import type { VacuumBackend, VacuumCleanSpeed, VacuumState } from './backend';

export interface TuyaLocalConfig {
    name: string;
    deviceId: string;
    localKey: string;
    deviceIp?: string;
    protocolVersion?: string;
}

const SPEED_TO_CLEAN_SPEED: Record<VacuumCleanSpeed, CleanSpeed> = {
    quiet: CleanSpeed.NO_SUCTION,
    standard: CleanSpeed.STANDARD,
    turbo: CleanSpeed.BOOST_IQ,
    max: CleanSpeed.MAX,
};

function cleanSpeedFromDevice(speed: string | undefined): VacuumCleanSpeed | null {
    switch (speed) {
        case CleanSpeed.NO_SUCTION:
            return 'quiet';
        case CleanSpeed.STANDARD:
            return 'standard';
        case CleanSpeed.BOOST_IQ:
            return 'turbo';
        case CleanSpeed.MAX:
            return 'max';
        default:
            return null;
    }
}

function isRealError(errorCode: string | undefined): boolean {
    return errorCode !== undefined && errorCode !== ErrorCode.NO_ERROR && errorCode !== 'default - invalid';
}

export class TuyaLocalBackend implements VacuumBackend {
    readonly kind = 'local (Tuya LAN)';

    private readonly roboVac: RoboVac;
    private readonly listeners: Array<(state: VacuumState) => void> = [];
    private pollTimer?: NodeJS.Timeout;

    constructor(private readonly config: TuyaLocalConfig, private readonly log: Logger) {
        this.roboVac = new RoboVac(
            { deviceId: config.deviceId, localKey: config.localKey, deviceIp: config.deviceIp, protocolVersion: config.protocolVersion },
            (status: RobovacStatus) => this.emit(this.toState(status.dps)),
            CACHING_DURATION_MS,
            log,
        );
    }

    async start(): Promise<void> {
        // RoboVac connects itself in its constructor; prime state and start polling.
        this.refresh().catch((error) => this.log.debug(`[${this.config.name}] initial status failed:`, error));
        this.pollTimer = setInterval(() => {
            this.refresh().catch((error) => this.log.debug(`[${this.config.name}] status poll failed:`, error));
        }, STATUS_POLL_INTERVAL_MS);
        this.pollTimer.unref();
    }

    async stop(): Promise<void> {
        if (this.pollTimer) {
            clearInterval(this.pollTimer);
        }
        await this.roboVac.disconnect().catch(() => undefined);
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
        const status = await this.roboVac.getStatus();
        const state = this.toState(status.dps);
        this.emit(state);
        return state;
    }

    private toState(dps: RobovacStatus['dps']): VacuumState {
        const errorCode = dps[StatusDps.ERROR_CODE];
        const error = isRealError(errorCode) ? getErrorCodeFriendlyName(errorCode) : null;
        const workStatus = dps[StatusDps.WORK_STATUS] as WorkStatus;
        const goingHome = dps[StatusDps.GO_HOME] === true;
        const level = dps[StatusDps.BATTERY_LEVEL];

        let activity: VacuumState['activity'];
        if (error) {
            activity = 'error';
        } else {
            switch (workStatus) {
                case WorkStatus.RUNNING:
                    activity = 'cleaning';
                    break;
                case WorkStatus.STAND_BY:
                case WorkStatus.SLEEPING:
                    activity = goingHome ? 'returning' : 'paused';
                    break;
                case WorkStatus.RECHARGE_NEEDED:
                    activity = 'returning';
                    break;
                case WorkStatus.CHARGING:
                    activity = 'charging';
                    break;
                case WorkStatus.CHARGING_COMPLETED:
                    activity = 'docked';
                    break;
                default:
                    activity = goingHome ? 'returning' : dps[StatusDps.RUNNING] ? 'cleaning' : 'stopped';
            }
        }

        return {
            activity,
            batteryLevel: typeof level === 'number' && level >= 0 ? level : -1,
            charging: workStatus === WorkStatus.CHARGING || workStatus === WorkStatus.CHARGING_COMPLETED,
            error,
            cleanSpeed: cleanSpeedFromDevice(dps[StatusDps.CLEAN_SPEED]),
        };
    }

    async startCleaning(): Promise<void> {
        await this.roboVac.setPlayPause(true);
    }

    async pause(): Promise<void> {
        await this.roboVac.setPlayPause(false);
    }

    async resume(): Promise<void> {
        await this.roboVac.setPlayPause(true);
    }

    async goHome(): Promise<void> {
        await this.roboVac.setGoHome(true);
    }

    async setCleanSpeed(speed: VacuumCleanSpeed): Promise<void> {
        await this.roboVac.setCleanSpeed(SPEED_TO_CLEAN_SPEED[speed]);
    }
}
