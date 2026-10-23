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
export declare enum StatusDps {
    DEFAULT = "1",
    RUNNING = "2",
    DIRECTION = "3",
    WORK_MODE = "5",
    WORK_STATUS = "15",
    GO_HOME = "101",
    CLEAN_SPEED = "102",
    FIND_ROBOT = "103",
    BATTERY_LEVEL = "104",
    ERROR_CODE = "106"
}
export declare const statusDpsFriendlyNames: Map<string, string>;
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
export declare function formatStatusResponse(statusResponse: StatusResponse): string;
export declare enum Direction {
    FORWARD = "forward",
    BACKWARD = "backward",
    LEFT = "left",
    RIGHT = "right"
}
export declare enum WorkMode {
    AUTO = "auto",
    SMALL_ROOM = "SmallRoom",
    SPOT = "Spot",
    EDGE = "Edge",
    NO_SWEEP = "Nosweep"
}
export declare enum WorkStatus {
    RUNNING = "Running",
    STAND_BY = "standby",
    SLEEPING = "Sleeping",
    CHARGING = "Charging",
    CHARGING_COMPLETED = "completed",
    RECHARGE_NEEDED = "Recharge"
}
export declare enum CleanSpeed {
    STANDARD = "Standard",
    BOOST_IQ = "Boost_IQ",
    MAX = "Max",
    NO_SUCTION = "No_suction"
}
export declare enum ErrorCode {
    NO_ERROR = "no_error",
    STUCK_5_MIN = "Stuck_5_min",
    CRASH_BAR_STUCK = "Crash_bar_stuck",
    SENSOR_DIRTY = "sensor_dirty",
    NOT_ENOUGH_POWER = "N_enough_pow",
    WHEEL_STUCK = "Wheel_stuck",
    S_BRUSH_STUCK = "S_brush_stuck",
    FAN_STUCK = "Fan_stuck",
    R_BRUSH_STUCK = "R_brush_stuck"
}
export declare const errorCodeFriendlyNames: Map<string, string>;
export declare function getErrorCodeFriendlyName(errorCode: string): string;
export declare class RoboVac {
    api: TuyAPI;
    directConnect: boolean;
    lastStatus: RobovacStatus;
    lastStatusUpdate: Date;
    lastStatusValid: boolean;
    cachingDuration: number;
    ongoingStatusUpdate: Promise<RobovacStatus> | null;
    log: Logger;
    constructor(config: {
        deviceId: string;
        localKey: string;
        deviceIp?: string;
        protocolVersion?: string;
    }, dataReceivedCallback: (status: RobovacStatus) => void, cachingDuration: number, log: Logger);
    private logStatus;
    connect(): Promise<void>;
    disconnect(): Promise<void>;
    getStatusCached(): RobovacStatus | null;
    getStatus(): Promise<RobovacStatus>;
    getStatusFromDeviceSynchronized(): Promise<RobovacStatus>;
    getStatusFromDevice(): Promise<RobovacStatus>;
    set(dps: StatusDps, newValue: string | number | boolean): Promise<void>;
    getRunning(): Promise<boolean>;
    getWorkStatus(): Promise<WorkStatus>;
    getCleanSpeed(): Promise<CleanSpeed>;
    getBatteryLevel(): Promise<number>;
    getErrorCode(): Promise<string>;
    setPlayPause(newValue: boolean): Promise<void>;
    setWorkMode(newValue: string): Promise<void>;
    setGoHome(newValue: boolean): Promise<void>;
    setCleanSpeed(newValue: string): Promise<void>;
    setFindRobot(newValue: boolean): Promise<void>;
}
