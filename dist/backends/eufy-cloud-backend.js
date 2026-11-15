"use strict";
/**
 * Eufy cloud backend: controls newer "novel"-protocol RoboVacs (e.g. the L60)
 * via the eufy/Tuya cloud. Logs in with eufy account credentials, polls the
 * device's protobuf-encoded DPS for state, and sends protobuf ModeCtrlRequest
 * commands. Self-contained port of the relevant eufy-clean logic.
 */
var __importDefault = (this && this.__importDefault) || function (mod) {
    return (mod && mod.__esModule) ? mod : { "default": mod };
};
Object.defineProperty(exports, "__esModule", { value: true });
exports.EufyCloudBackend = void 0;
const crypto_1 = __importDefault(require("crypto"));
const path_1 = __importDefault(require("path"));
const settings_1 = require("../settings");
const constants_1 = require("../eufy/constants");
const eufy_login_1 = require("../eufy/eufy-login");
const protos_1 = require("../eufy/protos");
const backend_1 = require("./backend");
function buildServiceArea(config) {
    if (!config.rooms || config.rooms.length === 0) {
        return null;
    }
    const mapId = config.mapId ?? null;
    const areas = config.rooms.map((r) => ({ areaId: r.id, mapId, name: r.name }));
    return { areas, maps: config.mapId !== undefined ? [{ mapId: config.mapId, name: 'Map' }] : [] };
}
// Suction clean modes (vacuum-only), index-aligned with NOVEL_CLEAN_SPEEDS.
const SUCTION_MODES = ['Quiet', 'Standard', 'Turbo', 'Max'].map((label) => ({ label, tags: [backend_1.CLEAN_MODE_TAG_VACUUM] }));
// Cleaning-type modes (mop-capable), index 0/1/2.
const MOP_MODES = [
    { label: 'Vacuum', tags: [backend_1.CLEAN_MODE_TAG_VACUUM] },
    { label: 'Mop', tags: [backend_1.CLEAN_MODE_TAG_MOP] },
    { label: 'Vacuum & Mop', tags: [backend_1.CLEAN_MODE_TAG_VACUUM, backend_1.CLEAN_MODE_TAG_MOP] },
];
const MODE_INDEX_TO_CLEAN_TYPE = [protos_1.CLEAN_TYPE.SWEEP_ONLY, protos_1.CLEAN_TYPE.MOP_ONLY, protos_1.CLEAN_TYPE.SWEEP_AND_MOP];
function suctionIndex(val) {
    if (val === null || val === undefined) {
        return null;
    }
    if (typeof val === 'number' || (typeof val === 'string' && /^\d+$/.test(val))) {
        const i = parseInt(String(val), 10);
        return i >= 0 && i < constants_1.NOVEL_CLEAN_SPEEDS.length ? i : null;
    }
    let lower = String(val).toLowerCase();
    if (lower === 'max_plus') {
        lower = 'max';
    }
    const idx = constants_1.NOVEL_CLEAN_SPEEDS.findIndex((s) => s.toLowerCase() === lower);
    return idx >= 0 ? idx : null;
}
class EufyCloudBackend {
    config;
    log;
    kind = 'cloud (eufy)';
    cleanModes;
    session;
    serviceArea;
    selectedRoomIds = [];
    listeners = [];
    pollTimer;
    constructor(config, log) {
        this.config = config;
        this.log = log;
        // Cache the session per account (shared by same-account robots) to minimise logins.
        const sessionFile = config.storagePath
            ? path_1.default.join(config.storagePath, `eufy-robovac-matter-session-${crypto_1.default.createHash('md5').update(config.email).digest('hex')}.json`)
            : undefined;
        this.session = new eufy_login_1.EufyCloudSession(config.email, config.password, log, sessionFile);
        this.cleanModes = config.mop ? MOP_MODES : SUCTION_MODES;
        this.serviceArea = buildServiceArea(config);
    }
    /**
     * Run a Tuya cloud call, logging in if needed. On a stale-session failure it
     * re-authenticates once and retries — but never on the daily login-limit
     * error, which re-logging in would only make worse.
     */
    async callTuya(fn) {
        if (!this.session.loggedIn) {
            await this.session.login();
        }
        try {
            return await fn(this.session.getTuya());
        }
        catch (error) {
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
    getServiceArea() {
        return this.serviceArea;
    }
    async selectAreas(areaIds) {
        const valid = new Set((this.serviceArea?.areas ?? []).map((a) => a.areaId));
        this.selectedRoomIds = areaIds.filter((id) => valid.has(id));
        this.log.info(`[${this.config.name}] Selected ${this.selectedRoomIds.length > 0 ? `rooms ${this.selectedRoomIds.join(', ')}` : 'all areas'} for the next clean.`);
    }
    async start() {
        await this.session.login();
        this.refresh().catch((error) => this.log.debug(`[${this.config.name}] initial cloud status failed:`, error));
        this.pollTimer = setInterval(() => {
            this.refresh().catch((error) => this.log.debug(`[${this.config.name}] cloud status poll failed:`, error));
        }, settings_1.CLOUD_POLL_INTERVAL_MS);
        this.pollTimer.unref();
    }
    async stop() {
        if (this.pollTimer) {
            clearInterval(this.pollTimer);
        }
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
        const dps = await this.callTuya((tuya) => tuya.getDeviceDps(this.config.deviceId));
        if (!dps) {
            throw new Error(`device ${this.config.deviceId} not found in the eufy cloud account`);
        }
        const state = this.toState(dps);
        this.emit(state);
        return state;
    }
    toState(dps) {
        const batteryRaw = dps[constants_1.NOVEL_DPS.BATTERY_LEVEL];
        const batteryLevel = typeof batteryRaw === 'number' ? batteryRaw : typeof batteryRaw === 'string' ? parseInt(batteryRaw, 10) : -1;
        // Error (dp 177, protobuf).
        let error = null;
        const errorRaw = dps[constants_1.NOVEL_DPS.ERROR_CODE];
        if (typeof errorRaw === 'string' && errorRaw) {
            try {
                const code = (0, protos_1.decodeErrorCode)(errorRaw);
                if (code && code !== 0) {
                    error = (0, constants_1.friendlyError)(code);
                }
            }
            catch (e) {
                this.log.debug(`[${this.config.name}] could not decode error dp:`, e);
            }
        }
        else if (typeof errorRaw === 'number' && errorRaw > 0) {
            error = (0, constants_1.friendlyError)(errorRaw);
        }
        // Work status (dp 153, protobuf).
        let activity = 'stopped';
        const workRaw = dps[constants_1.NOVEL_DPS.WORK_STATUS];
        if (typeof workRaw === 'string' && workRaw) {
            try {
                const ws = (0, protos_1.decodeWorkStatus)(workRaw);
                activity = this.stateToActivity(ws.state, !!ws.cleaningPaused, !!ws.chargingDone, batteryLevel);
            }
            catch (e) {
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
            cleanMode: this.currentCleanMode(dps),
        };
    }
    currentCleanMode(dps) {
        if (this.config.mop) {
            const raw = dps[constants_1.NOVEL_DPS.CLEANING_PARAMETERS];
            if (typeof raw !== 'string' || !raw) {
                return null;
            }
            try {
                switch ((0, protos_1.decodeCleanType)(raw)) {
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
            }
            catch (e) {
                this.log.debug(`[${this.config.name}] could not decode clean params:`, e);
                return null;
            }
        }
        return suctionIndex(dps[constants_1.NOVEL_DPS.CLEAN_SPEED]);
    }
    stateToActivity(state, cleaningPaused, chargingDone, battery) {
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
    async send(dps) {
        await this.callTuya((tuya) => tuya.sendCommand(this.config.deviceId, dps));
    }
    async startCleaning() {
        if (this.serviceArea && this.selectedRoomIds.length > 0) {
            await this.send({
                [constants_1.NOVEL_DPS.PLAY_PAUSE]: (0, protos_1.encodeRoomClean)(constants_1.CONTROL_METHOD.START_SELECT_ROOMS_CLEAN, this.selectedRoomIds, this.config.mapId),
            });
            return;
        }
        await this.send({ [constants_1.NOVEL_DPS.PLAY_PAUSE]: (0, protos_1.encodeModeCtrl)(constants_1.CONTROL_METHOD.START_AUTO_CLEAN, 1) });
    }
    async pause() {
        await this.send({ [constants_1.NOVEL_DPS.PLAY_PAUSE]: (0, protos_1.encodeModeCtrl)(constants_1.CONTROL_METHOD.PAUSE_TASK) });
    }
    async resume() {
        await this.send({ [constants_1.NOVEL_DPS.PLAY_PAUSE]: (0, protos_1.encodeModeCtrl)(constants_1.CONTROL_METHOD.RESUME_TASK) });
    }
    async goHome() {
        await this.send({ [constants_1.NOVEL_DPS.PLAY_PAUSE]: (0, protos_1.encodeModeCtrl)(constants_1.CONTROL_METHOD.START_GOHOME) });
    }
    async setCleanMode(index) {
        if (this.config.mop) {
            const cleanType = MODE_INDEX_TO_CLEAN_TYPE[index];
            if (cleanType === undefined) {
                return;
            }
            const mopLevel = cleanType === protos_1.CLEAN_TYPE.SWEEP_ONLY ? undefined : protos_1.MOP_LEVEL_HIGH;
            await this.send({ [constants_1.NOVEL_DPS.CLEANING_PARAMETERS]: (0, protos_1.encodeCleanParam)(cleanType, mopLevel) });
            return;
        }
        if (index < 0 || index >= constants_1.NOVEL_CLEAN_SPEEDS.length) {
            return;
        }
        await this.send({ [constants_1.NOVEL_DPS.CLEAN_SPEED]: index });
    }
    async findRobot() {
        // Best effort: toggling the find-robot DP makes the robot chirp to locate it.
        await this.send({ [constants_1.NOVEL_DPS.FIND_ROBOT]: true });
    }
}
exports.EufyCloudBackend = EufyCloudBackend;
//# sourceMappingURL=eufy-cloud-backend.js.map