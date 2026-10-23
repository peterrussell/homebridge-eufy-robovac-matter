/**
 * Local control of a Eufy RoboVac over the Tuya LAN protocol.
 *
 * This is a port of the control layer from @hov3rcraft/homebridge-eufy-robovac
 * (TuyAPI + the RoboVac DPS codes). The HomeKit/accessory code of the original
 * is replaced by the Matter layer in `matter-vacuum.ts`; this file only talks
 * to the device. The only functional change from the original is that the
 * custom ConsoleLogger dependency has been replaced with a small `Logger`
 * interface so the Homebridge `Logging` object can be passed straight in.
 */

import TuyAPI from 'tuyapi';

/** Minimal logger shape; Homebridge's `Logging` satisfies this. */
export interface Logger {
    info(message: string, ...parameters: unknown[]): void;
    warn(message: string, ...parameters: unknown[]): void;
    error(message: string, ...parameters: unknown[]): void;
    debug(message: string, ...parameters: unknown[]): void;
}

export enum StatusDps {
    DEFAULT = '1',
    RUNNING = '2',
    DIRECTION = '3',
    WORK_MODE = '5',
    WORK_STATUS = '15',
    GO_HOME = '101',
    CLEAN_SPEED = '102',
    FIND_ROBOT = '103',
    BATTERY_LEVEL = '104',
    ERROR_CODE = '106',
}

export const statusDpsFriendlyNames = new Map<string, string>([
    [StatusDps.DEFAULT, 'Default Property (ignore)'],
    [StatusDps.RUNNING, 'Running'],
    [StatusDps.DIRECTION, 'Direction'],
    [StatusDps.WORK_MODE, 'Work Mode'],
    [StatusDps.WORK_STATUS, 'Work Status'],
    [StatusDps.GO_HOME, 'Go Home'],
    [StatusDps.CLEAN_SPEED, 'Clean Speed'],
    [StatusDps.FIND_ROBOT, 'Find Robot'],
    [StatusDps.BATTERY_LEVEL, 'Battery Level'],
    [StatusDps.ERROR_CODE, 'Error Code'],
]);

export interface StatusResponse {
    devId: string;
    dps: {
        [StatusDps.DEFAULT]?: boolean;
        [StatusDps.RUNNING]?: boolean;
        [StatusDps.DIRECTION]?: string;
        [StatusDps.WORK_MODE]?: string;
        [StatusDps.WORK_STATUS]?: string;
        [StatusDps.GO_HOME]?: boolean;
        [StatusDps.CLEAN_SPEED]?: string;
        [StatusDps.FIND_ROBOT]?: boolean;
        [StatusDps.BATTERY_LEVEL]?: number;
        [StatusDps.ERROR_CODE]?: string;
    };
}

export interface RobovacStatus {
    devId: string;
    dps: {
        [StatusDps.DEFAULT]: boolean;
        [StatusDps.RUNNING]: boolean;
        [StatusDps.DIRECTION]: string;
        [StatusDps.WORK_MODE]: string;
        [StatusDps.WORK_STATUS]: string;
        [StatusDps.GO_HOME]: boolean;
        [StatusDps.CLEAN_SPEED]: string;
        [StatusDps.FIND_ROBOT]: boolean;
        [StatusDps.BATTERY_LEVEL]: number;
        [StatusDps.ERROR_CODE]: string;
    };
}

export function formatStatusResponse(statusResponse: StatusResponse): string {
    let formattedStatus = '-- Status Start --\n';
    for (const dps of Object.values(StatusDps)) {
        if (dps in statusResponse.dps) {
            formattedStatus += `- ${statusDpsFriendlyNames.get(dps)}: ${(statusResponse.dps as Record<string, unknown>)[dps]}\n`;
        }
    }
    formattedStatus += '-- Status End --';
    return formattedStatus;
}

export enum Direction {
    FORWARD = 'forward',
    BACKWARD = 'backward',
    LEFT = 'left',
    RIGHT = 'right',
}

export enum WorkMode {
    AUTO = 'auto',
    SMALL_ROOM = 'SmallRoom',
    SPOT = 'Spot',
    EDGE = 'Edge',
    NO_SWEEP = 'Nosweep',
}

export enum WorkStatus {
    // Cleaning
    RUNNING = 'Running',
    // Not in the dock, paused
    STAND_BY = 'standby',
    // Not in the dock - goes into this state after being paused for a while
    SLEEPING = 'Sleeping',
    // In the dock, charging
    CHARGING = 'Charging',
    // In the dock, full charged
    CHARGING_COMPLETED = 'completed',
    // Going home because battery is depleted or home was pressed
    RECHARGE_NEEDED = 'Recharge',
}

export enum CleanSpeed {
    STANDARD = 'Standard',
    BOOST_IQ = 'Boost_IQ',
    MAX = 'Max',
    NO_SUCTION = 'No_suction',
}

export enum ErrorCode {
    NO_ERROR = 'no_error',
    STUCK_5_MIN = 'Stuck_5_min',
    CRASH_BAR_STUCK = 'Crash_bar_stuck',
    SENSOR_DIRTY = 'sensor_dirty',
    NOT_ENOUGH_POWER = 'N_enough_pow',
    WHEEL_STUCK = 'Wheel_stuck',
    S_BRUSH_STUCK = 'S_brush_stuck',
    FAN_STUCK = 'Fan_stuck',
    R_BRUSH_STUCK = 'R_brush_stuck',
}

export const errorCodeFriendlyNames = new Map<string, string>([
    [ErrorCode.NO_ERROR, 'No Error'],
    [ErrorCode.STUCK_5_MIN, 'Stuck (5 Minutes)'],
    [ErrorCode.CRASH_BAR_STUCK, 'Crash Bar Stuck'],
    [ErrorCode.SENSOR_DIRTY, 'Sensor Dirty'],
    [ErrorCode.NOT_ENOUGH_POWER, 'Not Enough Power'],
    [ErrorCode.WHEEL_STUCK, 'Wheel Stuck'],
    [ErrorCode.S_BRUSH_STUCK, 'Brush Stuck'],
    [ErrorCode.FAN_STUCK, 'Fan Stuck'],
    [ErrorCode.R_BRUSH_STUCK, 'Brush Stuck'],
]);

export function getErrorCodeFriendlyName(errorCode: string): string {
    return errorCodeFriendlyNames.get(errorCode) ?? errorCode;
}

export class RoboVac {
    api: TuyAPI;
    directConnect: boolean;
    lastStatus: RobovacStatus;
    lastStatusUpdate: Date;
    lastStatusValid: boolean;
    cachingDuration: number;
    ongoingStatusUpdate: Promise<RobovacStatus> | null;
    log: Logger;

    constructor(
        config: { deviceId: string; localKey: string; deviceIp?: string },
        dataReceivedCallback: (status: RobovacStatus) => void,
        cachingDuration: number,
        log: Logger,
    ) {
        this.cachingDuration = cachingDuration;
        this.log = log;

        this.directConnect = config.deviceIp != null && config.deviceIp !== '';

        this.api = new TuyAPI({
            id: config.deviceId,
            key: config.localKey,
            ip: this.directConnect ? config.deviceIp : undefined,
            version: '3.3',
            issueRefreshOnConnect: true,
        });

        // Add event listeners
        this.api.on('connected', () => {
            log.info('Connected to device!');
        });

        this.api.on('disconnected', () => {
            log.info('Disconnected from device.');
        });

        this.api.on('error', (error: unknown) => {
            log.error('Error!', error);
            this.disconnect();
        });

        this.api.on('dp-refresh', (data) => {
            this.logStatus('Received dps refresh data from device:', data);
            if (data.dps) {
                Object.assign(this.lastStatus.dps, data.dps);
                this.lastStatusUpdate = new Date();
                dataReceivedCallback(this.lastStatus);
            }
        });

        this.api.on('data', (data) => {
            this.logStatus('Received data from device:', data);
            if (data.dps) {
                Object.assign(this.lastStatus.dps, data.dps);
                this.lastStatusUpdate = new Date();
                this.lastStatusValid = true;
                dataReceivedCallback(this.lastStatus);
            }
        });

        // init with default values
        this.lastStatus = {
            devId: 'default - invalid',
            dps: {
                [StatusDps.DEFAULT]: false,
                [StatusDps.RUNNING]: false,
                [StatusDps.DIRECTION]: Direction.FORWARD,
                [StatusDps.WORK_MODE]: WorkMode.NO_SWEEP,
                [StatusDps.WORK_STATUS]: WorkStatus.CHARGING,
                [StatusDps.GO_HOME]: false,
                [StatusDps.CLEAN_SPEED]: CleanSpeed.NO_SUCTION,
                [StatusDps.FIND_ROBOT]: false,
                [StatusDps.BATTERY_LEVEL]: -1,
                [StatusDps.ERROR_CODE]: 'default - invalid',
            },
        };
        this.lastStatusUpdate = new Date(0);
        this.lastStatusValid = false;
        this.ongoingStatusUpdate = null;

        this.connect().catch((e) => {
            this.log.error('Error during initial connect:', e);
        });
    }

    private logStatus(prefix: string, data: { dps?: unknown }): void {
        try {
            this.log.debug(prefix, '\n' + formatStatusResponse(data as unknown as StatusResponse));
        } catch {
            this.log.debug(prefix, data);
        }
    }

    async connect(): Promise<void> {
        if (!this.directConnect) {
            // Find device on network if there is no ip specified in config
            await this.api.find();
        }

        // Connect to device
        await this.api.connect();
    }

    async disconnect(): Promise<void> {
        this.ongoingStatusUpdate = null;
        this.lastStatusValid = false;
        if (this.api.isConnected()) {
            await this.api.disconnect();
        }
    }

    getStatusCached(): RobovacStatus | null {
        return this.lastStatusValid ? this.lastStatus : null;
    }

    async getStatus(): Promise<RobovacStatus> {
        if (!this.lastStatusValid || Math.abs(new Date().getTime() - this.lastStatusUpdate.getTime()) > this.cachingDuration) {
            return this.getStatusFromDeviceSynchronized();
        } else {
            this.log.debug('Status request within max status update age');
            return this.lastStatus;
        }
    }

    async getStatusFromDeviceSynchronized(): Promise<RobovacStatus> {
        if (this.ongoingStatusUpdate != null) {
            this.log.debug('Duplicate status update request detected');
            return this.ongoingStatusUpdate;
        }

        this.ongoingStatusUpdate = this.getStatusFromDevice();
        return this.ongoingStatusUpdate;
    }

    async getStatusFromDevice(): Promise<RobovacStatus> {
        this.log.info('Fetching status update...');
        try {
            if (!this.api.isConnected()) {
                await this.connect();
            }

            const schema = await this.api.get({ schema: true });
            this.lastStatus = schema as unknown as RobovacStatus;
            this.lastStatusUpdate = new Date();
            this.lastStatusValid = true;
            this.ongoingStatusUpdate = null;
            this.log.debug('Status update retrieved.');
            return this.lastStatus;
        } catch (e) {
            this.log.error('An error occurred (during GET status update)!', e);
            try {
                await this.disconnect();
            } catch {
                // ignore secondary disconnect failures
            }
            throw e;
        }
    }

    async set(dps: StatusDps, newValue: string | number | boolean): Promise<void> {
        this.log.debug('Setting', statusDpsFriendlyNames.get(dps), 'to', newValue, '...');
        try {
            if (!this.api.isConnected()) {
                await this.connect();
            }

            await this.api.set({ dps: parseInt(dps, 10), set: newValue });
            this.log.info('Setting', statusDpsFriendlyNames.get(dps), 'to', newValue, 'successful.');
        } catch (e) {
            this.log.error('An error occurred! (during SET of', statusDpsFriendlyNames.get(dps), 'to', newValue, '): ', e);
            try {
                await this.disconnect();
            } catch {
                // ignore secondary disconnect failures
            }
            throw e;
        }
    }

    async getRunning(): Promise<boolean> {
        const robovacStatus = await this.getStatus();
        return robovacStatus.dps[StatusDps.RUNNING];
    }

    async getWorkStatus(): Promise<WorkStatus> {
        const robovacStatus = await this.getStatus();
        return robovacStatus.dps[StatusDps.WORK_STATUS] as WorkStatus;
    }

    async getCleanSpeed(): Promise<CleanSpeed> {
        const robovacStatus = await this.getStatus();
        return robovacStatus.dps[StatusDps.CLEAN_SPEED] as CleanSpeed;
    }

    async getBatteryLevel(): Promise<number> {
        const robovacStatus = await this.getStatus();
        return robovacStatus.dps[StatusDps.BATTERY_LEVEL];
    }

    async getErrorCode(): Promise<string> {
        const robovacStatus = await this.getStatus();
        return robovacStatus.dps[StatusDps.ERROR_CODE];
    }

    async setPlayPause(newValue: boolean): Promise<void> {
        return this.set(StatusDps.RUNNING, newValue);
    }

    async setWorkMode(newValue: string): Promise<void> {
        return this.set(StatusDps.WORK_MODE, newValue);
    }

    async setGoHome(newValue: boolean): Promise<void> {
        return this.set(StatusDps.GO_HOME, newValue);
    }

    async setCleanSpeed(newValue: string): Promise<void> {
        return this.set(StatusDps.CLEAN_SPEED, newValue);
    }

    async setFindRobot(newValue: boolean): Promise<void> {
        return this.set(StatusDps.FIND_ROBOT, newValue);
    }
}
