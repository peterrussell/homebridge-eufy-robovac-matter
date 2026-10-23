"use strict";
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
var __importDefault = (this && this.__importDefault) || function (mod) {
    return (mod && mod.__esModule) ? mod : { "default": mod };
};
Object.defineProperty(exports, "__esModule", { value: true });
exports.RoboVac = exports.errorCodeFriendlyNames = exports.ErrorCode = exports.CleanSpeed = exports.WorkStatus = exports.WorkMode = exports.Direction = exports.statusDpsFriendlyNames = exports.StatusDps = void 0;
exports.formatStatusResponse = formatStatusResponse;
exports.getErrorCodeFriendlyName = getErrorCodeFriendlyName;
const tuyapi_1 = __importDefault(require("tuyapi"));
var StatusDps;
(function (StatusDps) {
    StatusDps["DEFAULT"] = "1";
    StatusDps["RUNNING"] = "2";
    StatusDps["DIRECTION"] = "3";
    StatusDps["WORK_MODE"] = "5";
    StatusDps["WORK_STATUS"] = "15";
    StatusDps["GO_HOME"] = "101";
    StatusDps["CLEAN_SPEED"] = "102";
    StatusDps["FIND_ROBOT"] = "103";
    StatusDps["BATTERY_LEVEL"] = "104";
    StatusDps["ERROR_CODE"] = "106";
})(StatusDps || (exports.StatusDps = StatusDps = {}));
exports.statusDpsFriendlyNames = new Map([
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
function formatStatusResponse(statusResponse) {
    let formattedStatus = '-- Status Start --\n';
    for (const dps of Object.values(StatusDps)) {
        if (dps in statusResponse.dps) {
            formattedStatus += `- ${exports.statusDpsFriendlyNames.get(dps)}: ${statusResponse.dps[dps]}\n`;
        }
    }
    formattedStatus += '-- Status End --';
    return formattedStatus;
}
var Direction;
(function (Direction) {
    Direction["FORWARD"] = "forward";
    Direction["BACKWARD"] = "backward";
    Direction["LEFT"] = "left";
    Direction["RIGHT"] = "right";
})(Direction || (exports.Direction = Direction = {}));
var WorkMode;
(function (WorkMode) {
    WorkMode["AUTO"] = "auto";
    WorkMode["SMALL_ROOM"] = "SmallRoom";
    WorkMode["SPOT"] = "Spot";
    WorkMode["EDGE"] = "Edge";
    WorkMode["NO_SWEEP"] = "Nosweep";
})(WorkMode || (exports.WorkMode = WorkMode = {}));
var WorkStatus;
(function (WorkStatus) {
    // Cleaning
    WorkStatus["RUNNING"] = "Running";
    // Not in the dock, paused
    WorkStatus["STAND_BY"] = "standby";
    // Not in the dock - goes into this state after being paused for a while
    WorkStatus["SLEEPING"] = "Sleeping";
    // In the dock, charging
    WorkStatus["CHARGING"] = "Charging";
    // In the dock, full charged
    WorkStatus["CHARGING_COMPLETED"] = "completed";
    // Going home because battery is depleted or home was pressed
    WorkStatus["RECHARGE_NEEDED"] = "Recharge";
})(WorkStatus || (exports.WorkStatus = WorkStatus = {}));
var CleanSpeed;
(function (CleanSpeed) {
    CleanSpeed["STANDARD"] = "Standard";
    CleanSpeed["BOOST_IQ"] = "Boost_IQ";
    CleanSpeed["MAX"] = "Max";
    CleanSpeed["NO_SUCTION"] = "No_suction";
})(CleanSpeed || (exports.CleanSpeed = CleanSpeed = {}));
var ErrorCode;
(function (ErrorCode) {
    ErrorCode["NO_ERROR"] = "no_error";
    ErrorCode["STUCK_5_MIN"] = "Stuck_5_min";
    ErrorCode["CRASH_BAR_STUCK"] = "Crash_bar_stuck";
    ErrorCode["SENSOR_DIRTY"] = "sensor_dirty";
    ErrorCode["NOT_ENOUGH_POWER"] = "N_enough_pow";
    ErrorCode["WHEEL_STUCK"] = "Wheel_stuck";
    ErrorCode["S_BRUSH_STUCK"] = "S_brush_stuck";
    ErrorCode["FAN_STUCK"] = "Fan_stuck";
    ErrorCode["R_BRUSH_STUCK"] = "R_brush_stuck";
})(ErrorCode || (exports.ErrorCode = ErrorCode = {}));
exports.errorCodeFriendlyNames = new Map([
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
function getErrorCodeFriendlyName(errorCode) {
    return exports.errorCodeFriendlyNames.get(errorCode) ?? errorCode;
}
class RoboVac {
    api;
    directConnect;
    lastStatus;
    lastStatusUpdate;
    lastStatusValid;
    cachingDuration;
    ongoingStatusUpdate;
    log;
    constructor(config, dataReceivedCallback, cachingDuration, log) {
        this.cachingDuration = cachingDuration;
        this.log = log;
        this.directConnect = config.deviceIp != null && config.deviceIp !== '';
        const version = config.protocolVersion && config.protocolVersion !== '' ? config.protocolVersion : '3.3';
        log.debug(`Using Tuya protocol version ${version} for device ${config.deviceId}`);
        this.api = new tuyapi_1.default({
            id: config.deviceId,
            key: config.localKey,
            ip: this.directConnect ? config.deviceIp : undefined,
            version,
            issueRefreshOnConnect: true,
        });
        // Add event listeners
        this.api.on('connected', () => {
            log.info('Connected to device!');
        });
        this.api.on('disconnected', () => {
            log.info('Disconnected from device.');
        });
        this.api.on('error', (error) => {
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
    logStatus(prefix, data) {
        try {
            this.log.debug(prefix, '\n' + formatStatusResponse(data));
        }
        catch {
            this.log.debug(prefix, data);
        }
    }
    async connect() {
        if (!this.directConnect) {
            // Find device on network if there is no ip specified in config
            await this.api.find();
        }
        // Connect to device
        await this.api.connect();
    }
    async disconnect() {
        this.ongoingStatusUpdate = null;
        this.lastStatusValid = false;
        if (this.api.isConnected()) {
            await this.api.disconnect();
        }
    }
    getStatusCached() {
        return this.lastStatusValid ? this.lastStatus : null;
    }
    async getStatus() {
        if (!this.lastStatusValid || Math.abs(new Date().getTime() - this.lastStatusUpdate.getTime()) > this.cachingDuration) {
            return this.getStatusFromDeviceSynchronized();
        }
        else {
            this.log.debug('Status request within max status update age');
            return this.lastStatus;
        }
    }
    async getStatusFromDeviceSynchronized() {
        if (this.ongoingStatusUpdate != null) {
            this.log.debug('Duplicate status update request detected');
            return this.ongoingStatusUpdate;
        }
        this.ongoingStatusUpdate = this.getStatusFromDevice();
        return this.ongoingStatusUpdate;
    }
    async getStatusFromDevice() {
        this.log.info('Fetching status update...');
        try {
            if (!this.api.isConnected()) {
                await this.connect();
            }
            const schema = await this.api.get({ schema: true });
            this.lastStatus = schema;
            this.lastStatusUpdate = new Date();
            this.lastStatusValid = true;
            this.ongoingStatusUpdate = null;
            this.log.debug('Status update retrieved.');
            return this.lastStatus;
        }
        catch (e) {
            this.log.error('An error occurred (during GET status update)!', e);
            try {
                await this.disconnect();
            }
            catch {
                // ignore secondary disconnect failures
            }
            throw e;
        }
    }
    async set(dps, newValue) {
        this.log.debug('Setting', exports.statusDpsFriendlyNames.get(dps), 'to', newValue, '...');
        try {
            if (!this.api.isConnected()) {
                await this.connect();
            }
            await this.api.set({ dps: parseInt(dps, 10), set: newValue });
            this.log.info('Setting', exports.statusDpsFriendlyNames.get(dps), 'to', newValue, 'successful.');
        }
        catch (e) {
            this.log.error('An error occurred! (during SET of', exports.statusDpsFriendlyNames.get(dps), 'to', newValue, '): ', e);
            try {
                await this.disconnect();
            }
            catch {
                // ignore secondary disconnect failures
            }
            throw e;
        }
    }
    async getRunning() {
        const robovacStatus = await this.getStatus();
        return robovacStatus.dps[StatusDps.RUNNING];
    }
    async getWorkStatus() {
        const robovacStatus = await this.getStatus();
        return robovacStatus.dps[StatusDps.WORK_STATUS];
    }
    async getCleanSpeed() {
        const robovacStatus = await this.getStatus();
        return robovacStatus.dps[StatusDps.CLEAN_SPEED];
    }
    async getBatteryLevel() {
        const robovacStatus = await this.getStatus();
        return robovacStatus.dps[StatusDps.BATTERY_LEVEL];
    }
    async getErrorCode() {
        const robovacStatus = await this.getStatus();
        return robovacStatus.dps[StatusDps.ERROR_CODE];
    }
    async setPlayPause(newValue) {
        return this.set(StatusDps.RUNNING, newValue);
    }
    async setWorkMode(newValue) {
        return this.set(StatusDps.WORK_MODE, newValue);
    }
    async setGoHome(newValue) {
        return this.set(StatusDps.GO_HOME, newValue);
    }
    async setCleanSpeed(newValue) {
        return this.set(StatusDps.CLEAN_SPEED, newValue);
    }
    async setFindRobot(newValue) {
        return this.set(StatusDps.FIND_ROBOT, newValue);
    }
}
exports.RoboVac = RoboVac;
//# sourceMappingURL=robovac-api.js.map