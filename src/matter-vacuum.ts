/**
 * Publishes a Eufy RoboVac as a native Matter Robotic Vacuum Cleaner using the
 * Homebridge 2.x `api.matter` API, and translates between the Matter RVC
 * clusters (RvcRunMode / RvcCleanMode / RvcOperationalState / PowerSource) and
 * the device's Tuya DPS state exposed by `RoboVac`.
 */

import type { API, Logging, MatterAccessory } from 'homebridge';

import {
    CleanSpeed,
    ErrorCode,
    RoboVac,
    StatusDps,
    WorkStatus,
    getErrorCodeFriendlyName,
    type RobovacStatus,
} from './robovac-api';
import {
    CACHING_DURATION_MS,
    LOW_BATTERY_THRESHOLD,
    PLATFORM_NAME,
    PLUGIN_NAME,
    STATUS_POLL_INTERVAL_MS,
    WARNING_BATTERY_THRESHOLD,
} from './settings';

export interface EufyDeviceConfig {
    name: string;
    deviceId: string;
    localKey: string;
    deviceIp?: string;
}

// --- Matter RVC Run Mode -----------------------------------------------------
const RUN_MODE_IDLE = 0;
const RUN_MODE_CLEANING = 1;
// Mode tags (Matter spec): Idle = 0x4000, Cleaning = 0x4001.
const MODE_TAG_IDLE = 0x4000;
const MODE_TAG_CLEANING = 0x4001;

// --- Matter RVC Clean Mode ---------------------------------------------------
// Mode tag: Vacuum = 0x4001.
const MODE_TAG_VACUUM = 0x4001;
const CLEAN_MODE_STANDARD = 0;
const CLEAN_MODE_TURBO = 1;
const CLEAN_MODE_MAX = 2;

const CLEAN_MODE_TO_SPEED: Record<number, CleanSpeed> = {
    [CLEAN_MODE_STANDARD]: CleanSpeed.STANDARD,
    [CLEAN_MODE_TURBO]: CleanSpeed.BOOST_IQ,
    [CLEAN_MODE_MAX]: CleanSpeed.MAX,
};

function cleanSpeedToMode(speed: string): number {
    switch (speed) {
        case CleanSpeed.BOOST_IQ:
            return CLEAN_MODE_TURBO;
        case CleanSpeed.MAX:
            return CLEAN_MODE_MAX;
        default:
            // Standard and No_suction both fall back to the Standard tile.
            return CLEAN_MODE_STANDARD;
    }
}

// --- Matter RVC Operational State -------------------------------------------
const OP_STATE_STOPPED = 0;
const OP_STATE_RUNNING = 1;
const OP_STATE_PAUSED = 2;
const OP_STATE_ERROR = 3;
const OP_STATE_SEEKING_CHARGER = 64;
const OP_STATE_CHARGING = 65;
const OP_STATE_DOCKED = 66;

// --- Matter RVC Operational Error states ------------------------------------
const ERR_NO_ERROR = 0;
const ERR_UNABLE_TO_START = 1;
const ERR_STUCK = 65;

// --- Matter PowerSource BatChargeState --------------------------------------
const BAT_CHARGE_IS_CHARGING = 1;
const BAT_CHARGE_IS_AT_FULL = 2;
const BAT_CHARGE_IS_NOT_CHARGING = 3;

function isRealError(errorCode: string | undefined): boolean {
    return errorCode !== undefined && errorCode !== ErrorCode.NO_ERROR && errorCode !== 'default - invalid';
}

function mapErrorStateId(errorCode: string): number {
    switch (errorCode) {
        case ErrorCode.NOT_ENOUGH_POWER:
            return ERR_UNABLE_TO_START;
        default:
            return ERR_STUCK;
    }
}

interface DerivedState {
    operationalState: number;
    operationalError: { errorStateId: number; errorStateLabel?: string };
    runMode: number;
}

/** Translate the device's Tuya status into Matter run-mode + operational-state. */
function deriveOperationalState(dps: RobovacStatus['dps']): DerivedState {
    const errorCode = dps[StatusDps.ERROR_CODE];
    if (isRealError(errorCode)) {
        return {
            operationalState: OP_STATE_ERROR,
            operationalError: {
                errorStateId: mapErrorStateId(errorCode),
                errorStateLabel: getErrorCodeFriendlyName(errorCode),
            },
            runMode: RUN_MODE_IDLE,
        };
    }

    const noError = { errorStateId: ERR_NO_ERROR };
    const workStatus = dps[StatusDps.WORK_STATUS] as WorkStatus;
    const goingHome = dps[StatusDps.GO_HOME] === true;

    switch (workStatus) {
        case WorkStatus.RUNNING:
            return { operationalState: OP_STATE_RUNNING, operationalError: noError, runMode: RUN_MODE_CLEANING };
        case WorkStatus.STAND_BY:
        case WorkStatus.SLEEPING:
            // Not docked and not moving: paused mid-session, unless it is on its way home.
            return goingHome
                ? { operationalState: OP_STATE_SEEKING_CHARGER, operationalError: noError, runMode: RUN_MODE_IDLE }
                : { operationalState: OP_STATE_PAUSED, operationalError: noError, runMode: RUN_MODE_CLEANING };
        case WorkStatus.RECHARGE_NEEDED:
            return { operationalState: OP_STATE_SEEKING_CHARGER, operationalError: noError, runMode: RUN_MODE_IDLE };
        case WorkStatus.CHARGING:
            return { operationalState: OP_STATE_CHARGING, operationalError: noError, runMode: RUN_MODE_IDLE };
        case WorkStatus.CHARGING_COMPLETED:
            return { operationalState: OP_STATE_DOCKED, operationalError: noError, runMode: RUN_MODE_IDLE };
        default:
            if (goingHome) {
                return { operationalState: OP_STATE_SEEKING_CHARGER, operationalError: noError, runMode: RUN_MODE_IDLE };
            }
            return dps[StatusDps.RUNNING]
                ? { operationalState: OP_STATE_RUNNING, operationalError: noError, runMode: RUN_MODE_CLEANING }
                : { operationalState: OP_STATE_STOPPED, operationalError: noError, runMode: RUN_MODE_IDLE };
    }
}

function derivePowerSource(dps: RobovacStatus['dps']): Record<string, unknown> {
    const level = dps[StatusDps.BATTERY_LEVEL];
    const workStatus = dps[StatusDps.WORK_STATUS] as WorkStatus;

    let batChargeState = BAT_CHARGE_IS_NOT_CHARGING;
    if (workStatus === WorkStatus.CHARGING) {
        batChargeState = BAT_CHARGE_IS_CHARGING;
    } else if (workStatus === WorkStatus.CHARGING_COMPLETED) {
        batChargeState = BAT_CHARGE_IS_AT_FULL;
    }

    const hasLevel = typeof level === 'number' && level >= 0;
    const batChargeLevel = !hasLevel ? 0 : level <= LOW_BATTERY_THRESHOLD ? 2 : level <= WARNING_BATTERY_THRESHOLD ? 1 : 0;

    return {
        // Matter encodes battery percent as 0-200 (double the percentage).
        batPercentRemaining: hasLevel ? level * 2 : null,
        batChargeLevel,
        batChargeState,
    };
}

export async function registerEufyMatterVacuum(api: API, log: Logging, config: EufyDeviceConfig): Promise<string | undefined> {
    const matter = api.matter;
    if (!matter || !api.isMatterEnabled()) {
        log.warn(`[${config.name}] Matter is not enabled on this bridge - skipping the native Matter vacuum. Enable Matter for this (child) bridge.`);
        return undefined;
    }

    const uuid = matter.uuid.generate(`${PLUGIN_NAME}:${config.deviceId}`);

    // Created up front so it is in scope for the handlers; the data callback is
    // wired below once pushState is defined.
    let roboVac: RoboVac;

    const pushState = (dps: RobovacStatus['dps']): void => {
        const derived = deriveOperationalState(dps);
        const updates: Array<[string, Record<string, unknown>]> = [
            ['rvcRunMode', { currentMode: derived.runMode }],
            ['rvcOperationalState', { operationalState: derived.operationalState, operationalError: derived.operationalError }],
            ['powerSource', derivePowerSource(dps)],
        ];

        const speed = dps[StatusDps.CLEAN_SPEED];
        if (typeof speed === 'string' && speed !== '') {
            updates.push(['rvcCleanMode', { currentMode: cleanSpeedToMode(speed) }]);
        }

        for (const [cluster, attributes] of updates) {
            matter.updateAccessoryState(uuid, cluster, attributes).catch((error: unknown) => {
                log.debug(`[${config.name}] Failed to update Matter cluster ${cluster}:`, error);
            });
        }
    };

    roboVac = new RoboVac(
        { deviceId: config.deviceId, localKey: config.localKey, deviceIp: config.deviceIp },
        (status: RobovacStatus) => pushState(status.dps),
        CACHING_DURATION_MS,
        log,
    );

    // Run a command and report Matter-protocol failures back to the controller.
    const execute = async (description: string, command: () => Promise<void>): Promise<void> => {
        try {
            log.info(`[${config.name}] ${description}`);
            await command();
        } catch (error: unknown) {
            const message = error instanceof Error ? error.message : String(error);
            log.error(`[${config.name}] ${description} failed: ${message}`);
            throw new matter.status.Failure(message);
        }
    };

    const initial = deriveOperationalState(roboVac.lastStatus.dps);

    const accessory: MatterAccessory = {
        UUID: uuid,
        displayName: config.name,
        deviceType: matter.deviceTypes.RoboticVacuumCleaner,
        serialNumber: config.deviceId,
        manufacturer: 'Eufy',
        model: 'RoboVac',
        context: { deviceId: config.deviceId },
        clusters: {
            rvcRunMode: {
                currentMode: initial.runMode,
                supportedModes: [
                    { label: 'Idle', mode: RUN_MODE_IDLE, modeTags: [{ value: MODE_TAG_IDLE }] },
                    { label: 'Cleaning', mode: RUN_MODE_CLEANING, modeTags: [{ value: MODE_TAG_CLEANING }] },
                ],
            },
            rvcCleanMode: {
                currentMode: CLEAN_MODE_STANDARD,
                supportedModes: [
                    { label: 'Standard', mode: CLEAN_MODE_STANDARD, modeTags: [{ value: MODE_TAG_VACUUM }] },
                    { label: 'Turbo', mode: CLEAN_MODE_TURBO, modeTags: [{ value: MODE_TAG_VACUUM }] },
                    { label: 'Max', mode: CLEAN_MODE_MAX, modeTags: [{ value: MODE_TAG_VACUUM }] },
                ],
            },
            rvcOperationalState: {
                phaseList: null,
                currentPhase: null,
                operationalState: initial.operationalState,
                operationalError: initial.operationalError,
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
                ...derivePowerSource(roboVac.lastStatus.dps),
            },
        },
        handlers: {
            rvcRunMode: {
                changeToMode: async (args: { newMode: number }) => {
                    if (args.newMode === RUN_MODE_CLEANING) {
                        await execute('Start cleaning', () => roboVac.setPlayPause(true));
                        await matter.updateAccessoryState(uuid, 'rvcRunMode', { currentMode: RUN_MODE_CLEANING });
                        await matter.updateAccessoryState(uuid, 'rvcOperationalState', { operationalState: OP_STATE_RUNNING });
                        return;
                    }
                    if (args.newMode === RUN_MODE_IDLE) {
                        // "Idle" from the Home app returns the robot to its dock (matches the original plugin's off behaviour).
                        await execute('Return to dock', () => roboVac.setGoHome(true));
                        await matter.updateAccessoryState(uuid, 'rvcRunMode', { currentMode: RUN_MODE_IDLE });
                        await matter.updateAccessoryState(uuid, 'rvcOperationalState', { operationalState: OP_STATE_SEEKING_CHARGER });
                        return;
                    }
                    throw new matter.status.ConstraintError(`Unsupported run mode: ${args.newMode}`);
                },
            },
            rvcCleanMode: {
                changeToMode: async (args: { newMode: number }) => {
                    const speed = CLEAN_MODE_TO_SPEED[args.newMode];
                    if (speed === undefined) {
                        throw new matter.status.ConstraintError(`Unsupported clean mode: ${args.newMode}`);
                    }
                    await execute(`Set suction to ${speed}`, () => roboVac.setCleanSpeed(speed));
                    await matter.updateAccessoryState(uuid, 'rvcCleanMode', { currentMode: args.newMode });
                },
            },
            rvcOperationalState: {
                pause: async () => {
                    await execute('Pause cleaning', () => roboVac.setPlayPause(false));
                    await matter.updateAccessoryState(uuid, 'rvcOperationalState', { operationalState: OP_STATE_PAUSED });
                },
                resume: async () => {
                    await execute('Resume cleaning', () => roboVac.setPlayPause(true));
                    await matter.updateAccessoryState(uuid, 'rvcRunMode', { currentMode: RUN_MODE_CLEANING });
                    await matter.updateAccessoryState(uuid, 'rvcOperationalState', { operationalState: OP_STATE_RUNNING });
                },
                goHome: async () => {
                    await execute('Return to dock', () => roboVac.setGoHome(true));
                    await matter.updateAccessoryState(uuid, 'rvcRunMode', { currentMode: RUN_MODE_IDLE });
                    await matter.updateAccessoryState(uuid, 'rvcOperationalState', { operationalState: OP_STATE_SEEKING_CHARGER });
                },
            },
        },
    };

    await matter.registerPlatformAccessories(PLUGIN_NAME, PLATFORM_NAME, [accessory]);
    log.info(`[${config.name}] Published native Matter robot vacuum (serial ${config.deviceId}).`);

    // Prime real state, then poll so Home stays in sync even without push events.
    roboVac.getStatus().then((status) => pushState(status.dps)).catch((error: unknown) => {
        log.debug(`[${config.name}] Initial status fetch failed:`, error);
    });

    const pollTimer = setInterval(() => {
        roboVac.getStatus().then((status) => pushState(status.dps)).catch((error: unknown) => {
            log.debug(`[${config.name}] Status poll failed:`, error);
        });
    }, STATUS_POLL_INTERVAL_MS);
    pollTimer.unref();

    api.on('shutdown', () => {
        clearInterval(pollTimer);
        roboVac.disconnect().catch(() => {
            // best-effort cleanup
        });
    });

    return uuid;
}
