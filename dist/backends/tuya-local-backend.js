"use strict";
/**
 * Local Tuya backend: controls older/legacy Eufy RoboVacs directly over the
 * Tuya LAN protocol (via `RoboVac`), with no cloud involvement. Translates the
 * device's Tuya DPS status into the normalized `VacuumState`.
 */
Object.defineProperty(exports, "__esModule", { value: true });
exports.TuyaLocalBackend = void 0;
const robovac_api_1 = require("../robovac-api");
const settings_1 = require("../settings");
const backend_1 = require("./backend");
// Clean modes for legacy devices are suction levels (all tagged Vacuum).
const LOCAL_SPEEDS = [robovac_api_1.CleanSpeed.NO_SUCTION, robovac_api_1.CleanSpeed.STANDARD, robovac_api_1.CleanSpeed.BOOST_IQ, robovac_api_1.CleanSpeed.MAX];
const LOCAL_SPEED_LABELS = ['Quiet', 'Standard', 'Turbo', 'Max'];
function cleanModeFromDevice(speed) {
    const idx = LOCAL_SPEEDS.indexOf(speed);
    return idx >= 0 ? idx : null;
}
function isRealError(errorCode) {
    return errorCode !== undefined && errorCode !== robovac_api_1.ErrorCode.NO_ERROR && errorCode !== 'default - invalid';
}
class TuyaLocalBackend {
    config;
    log;
    kind = 'local (Tuya LAN)';
    cleanModes = LOCAL_SPEED_LABELS.map((label) => ({ label, tags: [backend_1.CLEAN_MODE_TAG_VACUUM] }));
    roboVac;
    listeners = [];
    pollTimer;
    constructor(config, log) {
        this.config = config;
        this.log = log;
        this.roboVac = new robovac_api_1.RoboVac({ deviceId: config.deviceId, localKey: config.localKey, deviceIp: config.deviceIp, protocolVersion: config.protocolVersion }, (status) => this.emit(this.toState(status.dps)), settings_1.CACHING_DURATION_MS, log);
    }
    async start() {
        // RoboVac connects itself in its constructor; prime state and start polling.
        this.refresh().catch((error) => this.log.debug(`[${this.config.name}] initial status failed:`, error));
        this.pollTimer = setInterval(() => {
            this.refresh().catch((error) => this.log.debug(`[${this.config.name}] status poll failed:`, error));
        }, settings_1.STATUS_POLL_INTERVAL_MS);
        this.pollTimer.unref();
    }
    async stop() {
        if (this.pollTimer) {
            clearInterval(this.pollTimer);
        }
        await this.roboVac.disconnect().catch(() => undefined);
    }
    onState(listener) {
        this.listeners.push(listener);
    }
    emit(state) {
        for (const listener of this.listeners) {
            listener(state);
        }
    }
    async refresh() {
        const status = await this.roboVac.getStatus();
        const state = this.toState(status.dps);
        this.emit(state);
        return state;
    }
    toState(dps) {
        const errorCode = dps[robovac_api_1.StatusDps.ERROR_CODE];
        const error = isRealError(errorCode) ? (0, robovac_api_1.getErrorCodeFriendlyName)(errorCode) : null;
        const workStatus = dps[robovac_api_1.StatusDps.WORK_STATUS];
        const goingHome = dps[robovac_api_1.StatusDps.GO_HOME] === true;
        const level = dps[robovac_api_1.StatusDps.BATTERY_LEVEL];
        let activity;
        if (error) {
            activity = 'error';
        }
        else {
            switch (workStatus) {
                case robovac_api_1.WorkStatus.RUNNING:
                    activity = 'cleaning';
                    break;
                case robovac_api_1.WorkStatus.STAND_BY:
                case robovac_api_1.WorkStatus.SLEEPING:
                    activity = goingHome ? 'returning' : 'paused';
                    break;
                case robovac_api_1.WorkStatus.RECHARGE_NEEDED:
                    activity = 'returning';
                    break;
                case robovac_api_1.WorkStatus.CHARGING:
                    activity = 'charging';
                    break;
                case robovac_api_1.WorkStatus.CHARGING_COMPLETED:
                    activity = 'docked';
                    break;
                default:
                    activity = goingHome ? 'returning' : dps[robovac_api_1.StatusDps.RUNNING] ? 'cleaning' : 'stopped';
            }
        }
        return {
            activity,
            batteryLevel: typeof level === 'number' && level >= 0 ? level : -1,
            charging: workStatus === robovac_api_1.WorkStatus.CHARGING || workStatus === robovac_api_1.WorkStatus.CHARGING_COMPLETED,
            error,
            cleanMode: cleanModeFromDevice(dps[robovac_api_1.StatusDps.CLEAN_SPEED]),
        };
    }
    async startCleaning() {
        await this.roboVac.setPlayPause(true);
    }
    async pause() {
        await this.roboVac.setPlayPause(false);
    }
    async resume() {
        await this.roboVac.setPlayPause(true);
    }
    async goHome() {
        await this.roboVac.setGoHome(true);
    }
    async setCleanMode(index) {
        const speed = LOCAL_SPEEDS[index];
        if (speed) {
            await this.roboVac.setCleanSpeed(speed);
        }
    }
    async findRobot() {
        await this.roboVac.setFindRobot(true);
    }
}
exports.TuyaLocalBackend = TuyaLocalBackend;
//# sourceMappingURL=tuya-local-backend.js.map