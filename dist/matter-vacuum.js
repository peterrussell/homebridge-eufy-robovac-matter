"use strict";
/**
 * Publishes a Eufy RoboVac as a native Matter Robotic Vacuum Cleaner using the
 * Homebridge 2.x `api.matter` API, and translates between the Matter RVC
 * clusters and the backend-agnostic `VacuumState` / commands provided by a
 * `VacuumBackend` (local Tuya or eufy cloud).
 */
Object.defineProperty(exports, "__esModule", { value: true });
exports.registerEufyMatterVacuum = registerEufyMatterVacuum;
const settings_1 = require("./settings");
// --- Matter RVC Run Mode -----------------------------------------------------
const RUN_MODE_IDLE = 0;
const RUN_MODE_CLEANING = 1;
const MODE_TAG_IDLE = 0x4000;
const MODE_TAG_CLEANING = 0x4001;
// --- Matter RVC Operational State -------------------------------------------
const OP_STATE_STOPPED = 0;
const OP_STATE_RUNNING = 1;
const OP_STATE_PAUSED = 2;
const OP_STATE_ERROR = 3;
const OP_STATE_SEEKING_CHARGER = 64;
const OP_STATE_CHARGING = 65;
const OP_STATE_DOCKED = 66;
// --- Matter PowerSource BatChargeState --------------------------------------
const BAT_CHARGE_IS_CHARGING = 1;
const BAT_CHARGE_IS_AT_FULL = 2;
const BAT_CHARGE_IS_NOT_CHARGING = 3;
// Matter RVC OperationalState ErrorStateEnum values we emit. Only standard ids
// are allowed here: ids 128-191 are manufacturer-specific and matter.js rejects
// them, and ErrorStateLabel/Details may ONLY be set alongside an id in that
// 128-191 range - so for standard ids we must NOT attach a label.
const MATTER_ERR_UNABLE_TO_COMPLETE = 2; // generic fallback (base OperationalState enum)
const MATTER_ERR_FAILED_TO_FIND_DOCK = 64;
const MATTER_ERR_STUCK = 65;
const MATTER_ERR_DUST_BIN_MISSING = 66;
const MATTER_ERR_DUST_BIN_FULL = 67;
const MATTER_ERR_WATER_TANK_EMPTY = 68;
const MATTER_ERR_WATER_TANK_MISSING = 69;
const MATTER_ERR_MOP_PAD_MISSING = 71;
// Map eufy novel error codes (see EUFY_ERROR_CODES) to the closest standard
// Matter RVC error state. Anything not listed falls back to a generic error.
const EUFY_TO_MATTER_ERROR = {
    1: MATTER_ERR_STUCK, // crash buffer stuck
    2: MATTER_ERR_STUCK, // wheel stuck
    3: MATTER_ERR_STUCK, // side brush stuck
    4: MATTER_ERR_STUCK, // rolling brush stuck
    5: MATTER_ERR_STUCK, // host trapped
    6: MATTER_ERR_STUCK, // machine trapped
    7: MATTER_ERR_STUCK, // wheel overhanging
    13: MATTER_ERR_STUCK, // host tilted
    14: MATTER_ERR_DUST_BIN_MISSING, // no dust box
    18: MATTER_ERR_STUCK, // laser cover stuck
    19: MATTER_ERR_STUCK, // laser sensor stuck
    20: MATTER_ERR_STUCK, // laser blocked
    21: MATTER_ERR_FAILED_TO_FIND_DOCK, // dock failed
    40: MATTER_ERR_MOP_PAD_MISSING, // mop cloth dislodged
    51: MATTER_ERR_STUCK, // camera blocked
    52: MATTER_ERR_FAILED_TO_FIND_DOCK, // unable to leave station
    70: MATTER_ERR_DUST_BIN_FULL, // clean dust collector
    72: MATTER_ERR_WATER_TANK_EMPTY, // low water
    74: MATTER_ERR_WATER_TANK_EMPTY, // clean water low
    75: MATTER_ERR_WATER_TANK_MISSING, // water tank absent
    102: MATTER_ERR_STUCK, // wheel module abnormal
    103: MATTER_ERR_STUCK, // side brush abnormal
    105: MATTER_ERR_STUCK, // roller brush motor abnormal
};
/** Pick a spec-valid Matter RVC error id for a device error (never 128-191). */
function matterErrorId(errorCode) {
    return (errorCode !== undefined && EUFY_TO_MATTER_ERROR[errorCode]) || MATTER_ERR_UNABLE_TO_COMPLETE;
}
function activityToMatter(activity) {
    switch (activity) {
        case 'cleaning':
            return { operationalState: OP_STATE_RUNNING, runMode: RUN_MODE_CLEANING };
        case 'paused':
            return { operationalState: OP_STATE_PAUSED, runMode: RUN_MODE_CLEANING };
        case 'returning':
            return { operationalState: OP_STATE_SEEKING_CHARGER, runMode: RUN_MODE_IDLE };
        case 'charging':
            return { operationalState: OP_STATE_CHARGING, runMode: RUN_MODE_IDLE };
        case 'docked':
            return { operationalState: OP_STATE_DOCKED, runMode: RUN_MODE_IDLE };
        case 'error':
            return { operationalState: OP_STATE_ERROR, runMode: RUN_MODE_IDLE };
        default:
            return { operationalState: OP_STATE_STOPPED, runMode: RUN_MODE_IDLE };
    }
}
function powerSourceAttributes(state) {
    const hasLevel = state.batteryLevel >= 0;
    const level = state.batteryLevel;
    return {
        batPercentRemaining: hasLevel ? level * 2 : null, // Matter encodes 0-200 (double the percent)
        batChargeLevel: !hasLevel ? 0 : level <= 10 ? 2 : level <= 20 ? 1 : 0,
        batChargeState: state.activity === 'docked' && hasLevel && level >= 100
            ? BAT_CHARGE_IS_AT_FULL
            : state.charging
                ? BAT_CHARGE_IS_CHARGING
                : BAT_CHARGE_IS_NOT_CHARGING,
    };
}
async function registerEufyMatterVacuum(api, log, info, backend) {
    const matter = api.matter;
    if (!matter || !api.isMatterEnabled()) {
        log.warn(`[${info.name}] Matter is not enabled on this bridge - skipping. Enable Matter for this (child) bridge.`);
        return undefined;
    }
    const uuid = matter.uuid.generate(`${settings_1.PLUGIN_NAME}:${info.serial}`);
    let lastLoggedError = null;
    const pushState = (state) => {
        const { operationalState, runMode } = activityToMatter(state.activity);
        // Surface the (now label-less) device error in the log, once per change.
        const currentError = state.activity === 'error' ? state.error ?? 'unknown error' : null;
        if (currentError !== lastLoggedError) {
            if (currentError) {
                log.warn(`[${info.name}] device reports error: ${currentError}`);
            }
            else if (lastLoggedError) {
                log.info(`[${info.name}] device error cleared.`);
            }
            lastLoggedError = currentError;
        }
        // Matter forbids ErrorStateLabel unless the id is manufacturer-specific
        // (128-191), which matter.js rejects anyway - so emit a standard id only,
        // with no label. The human-readable detail is logged by the backend.
        const operationalError = state.activity === 'error' ? { errorStateId: matterErrorId(state.errorCode) } : { errorStateId: 0 };
        const updates = [
            ['rvcRunMode', { currentMode: runMode }],
            ['rvcOperationalState', { operationalState, operationalError }],
            ['powerSource', powerSourceAttributes(state)],
        ];
        if (state.cleanMode != null) {
            updates.push(['rvcCleanMode', { currentMode: state.cleanMode }]);
        }
        for (const [cluster, attributes] of updates) {
            matter.updateAccessoryState(uuid, cluster, attributes).catch((error) => {
                log.debug(`[${info.name}] failed to update Matter cluster ${cluster}:`, error);
            });
        }
    };
    backend.onState(pushState);
    // Leading-edge per-action throttle: if the same command is triggered more
    // than once within this window (e.g. a double-tapped "locate"), only the
    // first reaches the device; the rest are ignored.
    const COMMAND_THROTTLE_MS = 1000;
    const lastCommandAt = new Map();
    const execute = async (key, description, command) => {
        const now = Date.now();
        if (now - (lastCommandAt.get(key) ?? 0) < COMMAND_THROTTLE_MS) {
            log.debug(`[${info.name}] ${description} ignored (repeated within ${COMMAND_THROTTLE_MS}ms)`);
            return;
        }
        lastCommandAt.set(key, now);
        try {
            log.info(`[${info.name}] ${description}`);
            await command();
        }
        catch (error) {
            const message = error instanceof Error ? error.message : String(error);
            log.error(`[${info.name}] ${description} failed: ${message}`);
            throw new matter.status.Failure(message);
        }
    };
    // Service Area (rooms/zones) is only exposed when the backend provides one.
    const serviceArea = backend.getServiceArea?.() ?? null;
    const accessory = {
        UUID: uuid,
        displayName: info.name,
        deviceType: matter.deviceTypes.RoboticVacuumCleaner,
        serialNumber: info.serial,
        manufacturer: 'Eufy',
        model: info.model || 'RoboVac',
        context: { serial: info.serial },
        clusters: {
            rvcRunMode: {
                currentMode: RUN_MODE_IDLE,
                supportedModes: [
                    { label: 'Idle', mode: RUN_MODE_IDLE, modeTags: [{ value: MODE_TAG_IDLE }] },
                    { label: 'Cleaning', mode: RUN_MODE_CLEANING, modeTags: [{ value: MODE_TAG_CLEANING }] },
                ],
            },
            rvcCleanMode: {
                currentMode: 0,
                supportedModes: backend.cleanModes.map((m, mode) => ({ label: m.label, mode, modeTags: m.tags.map((value) => ({ value })) })),
            },
            rvcOperationalState: {
                phaseList: null,
                currentPhase: null,
                operationalState: OP_STATE_DOCKED,
                operationalError: { errorStateId: 0 },
                operationalStateList: [
                    { operationalStateId: OP_STATE_STOPPED },
                    { operationalStateId: OP_STATE_RUNNING },
                    { operationalStateId: OP_STATE_PAUSED },
                    { operationalStateId: OP_STATE_ERROR },
                    { operationalStateId: OP_STATE_SEEKING_CHARGER },
                    { operationalStateId: OP_STATE_CHARGING },
                    { operationalStateId: OP_STATE_DOCKED },
                ],
            },
            powerSource: {
                status: 1,
                order: 0,
                description: 'Battery',
                batPresent: true,
                batQuantity: 1,
                batPercentRemaining: null,
                batChargeLevel: 0,
                batChargeState: BAT_CHARGE_IS_NOT_CHARGING,
            },
        },
        handlers: {
            rvcRunMode: {
                changeToMode: async (args) => {
                    if (args.newMode === RUN_MODE_CLEANING) {
                        await execute('run:clean', 'Start cleaning', () => backend.startCleaning());
                        await matter.updateAccessoryState(uuid, 'rvcRunMode', { currentMode: RUN_MODE_CLEANING });
                        await matter.updateAccessoryState(uuid, 'rvcOperationalState', { operationalState: OP_STATE_RUNNING });
                        return;
                    }
                    if (args.newMode === RUN_MODE_IDLE) {
                        await execute('gohome', 'Return to dock', () => backend.goHome());
                        await matter.updateAccessoryState(uuid, 'rvcRunMode', { currentMode: RUN_MODE_IDLE });
                        await matter.updateAccessoryState(uuid, 'rvcOperationalState', { operationalState: OP_STATE_SEEKING_CHARGER });
                        return;
                    }
                    throw new matter.status.ConstraintError(`Unsupported run mode: ${args.newMode}`);
                },
            },
            rvcCleanMode: {
                changeToMode: async (args) => {
                    const mode = backend.cleanModes[args.newMode];
                    if (!mode) {
                        throw new matter.status.ConstraintError(`Unsupported clean mode: ${args.newMode}`);
                    }
                    await execute(`clean:${args.newMode}`, `Set clean mode to ${mode.label}`, () => backend.setCleanMode(args.newMode));
                    await matter.updateAccessoryState(uuid, 'rvcCleanMode', { currentMode: args.newMode });
                },
            },
            identify: {
                // Only acts when the backend supports locating the robot; otherwise a no-op.
                identify: async () => {
                    if (!backend.findRobot) {
                        return;
                    }
                    await execute('identify', 'Locate robot', () => backend.findRobot());
                },
            },
            rvcOperationalState: {
                pause: async () => {
                    await execute('pause', 'Pause cleaning', () => backend.pause());
                    await matter.updateAccessoryState(uuid, 'rvcOperationalState', { operationalState: OP_STATE_PAUSED });
                },
                resume: async () => {
                    await execute('resume', 'Resume cleaning', () => backend.resume());
                    await matter.updateAccessoryState(uuid, 'rvcRunMode', { currentMode: RUN_MODE_CLEANING });
                    await matter.updateAccessoryState(uuid, 'rvcOperationalState', { operationalState: OP_STATE_RUNNING });
                },
                goHome: async () => {
                    await execute('gohome', 'Return to dock', () => backend.goHome());
                    await matter.updateAccessoryState(uuid, 'rvcRunMode', { currentMode: RUN_MODE_IDLE });
                    await matter.updateAccessoryState(uuid, 'rvcOperationalState', { operationalState: OP_STATE_SEEKING_CHARGER });
                },
            },
        },
    };
    if (serviceArea) {
        accessory.clusters.serviceArea = {
            supportedAreas: serviceArea.areas.map((a) => ({
                areaId: a.areaId,
                mapId: a.mapId,
                areaInfo: { locationInfo: { locationName: a.name, floorNumber: null, areaType: null }, landmarkInfo: null },
            })),
            supportedMaps: serviceArea.maps,
            selectedAreas: [],
            currentArea: null,
        };
        accessory.handlers.serviceArea = {
            selectAreas: async (args) => {
                const newAreas = args?.newAreas ?? [];
                try {
                    await backend.selectAreas?.(newAreas);
                    await matter.updateAccessoryState(uuid, 'serviceArea', { selectedAreas: newAreas });
                }
                catch (error) {
                    throw new matter.status.Failure(error instanceof Error ? error.message : String(error));
                }
            },
        };
    }
    await matter.registerPlatformAccessories(settings_1.PLUGIN_NAME, settings_1.PLATFORM_NAME, [accessory]);
    log.info(`[${info.name}] Published native Matter robot vacuum (serial ${info.serial}, backend: ${backend.kind}).`);
    await backend.start();
    backend.refresh().then(pushState).catch((error) => {
        log.debug(`[${info.name}] initial state fetch failed:`, error);
    });
    api.on('shutdown', () => {
        backend.stop().catch(() => undefined);
    });
    return uuid;
}
//# sourceMappingURL=matter-vacuum.js.map