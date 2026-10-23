/**
 * Publishes a Eufy RoboVac as a native Matter Robotic Vacuum Cleaner using the
 * Homebridge 2.x `api.matter` API, and translates between the Matter RVC
 * clusters and the backend-agnostic `VacuumState` / commands provided by a
 * `VacuumBackend` (local Tuya or eufy cloud).
 */

import type { API, Logging, MatterAccessory } from 'homebridge';

import { CLEAN_SPEEDS, type VacuumBackend, type VacuumCleanSpeed, type VacuumState } from './backends/backend';
import { PLATFORM_NAME, PLUGIN_NAME } from './settings';

export interface MatterVacuumInfo {
    name: string;
    serial: string;
    model?: string;
}

// --- Matter RVC Run Mode -----------------------------------------------------
const RUN_MODE_IDLE = 0;
const RUN_MODE_CLEANING = 1;
const MODE_TAG_IDLE = 0x4000;
const MODE_TAG_CLEANING = 0x4001;

// --- Matter RVC Clean Mode (indices match CLEAN_SPEEDS order) ----------------
const MODE_TAG_VACUUM = 0x4001;
const CLEAN_MODE_LABELS = ['Quiet', 'Standard', 'Turbo', 'Max'];

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

// Generic RVC "Stuck" error state used to surface any device error to Matter.
const ERR_STUCK = 65;

function activityToMatter(activity: VacuumState['activity']): { operationalState: number; runMode: number } {
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

function powerSourceAttributes(state: VacuumState): Record<string, unknown> {
    const hasLevel = state.batteryLevel >= 0;
    const level = state.batteryLevel;
    return {
        batPercentRemaining: hasLevel ? level * 2 : null, // Matter encodes 0-200 (double the percent)
        batChargeLevel: !hasLevel ? 0 : level <= 10 ? 2 : level <= 20 ? 1 : 0,
        batChargeState:
            state.activity === 'docked' && hasLevel && level >= 100
                ? BAT_CHARGE_IS_AT_FULL
                : state.charging
                    ? BAT_CHARGE_IS_CHARGING
                    : BAT_CHARGE_IS_NOT_CHARGING,
    };
}

function cleanModeFromSpeed(speed: VacuumCleanSpeed | null): number {
    const idx = speed ? CLEAN_SPEEDS.indexOf(speed) : -1;
    return idx >= 0 ? idx : CLEAN_SPEEDS.indexOf('standard');
}

export async function registerEufyMatterVacuum(
    api: API,
    log: Logging,
    info: MatterVacuumInfo,
    backend: VacuumBackend,
): Promise<string | undefined> {
    const matter = api.matter;
    if (!matter || !api.isMatterEnabled()) {
        log.warn(`[${info.name}] Matter is not enabled on this bridge - skipping. Enable Matter for this (child) bridge.`);
        return undefined;
    }

    const uuid = matter.uuid.generate(`${PLUGIN_NAME}:${info.serial}`);

    const pushState = (state: VacuumState): void => {
        const { operationalState, runMode } = activityToMatter(state.activity);
        const operationalError =
            state.activity === 'error' ? { errorStateId: ERR_STUCK, errorStateLabel: state.error ?? 'Error' } : { errorStateId: 0 };

        const updates: Array<[string, Record<string, unknown>]> = [
            ['rvcRunMode', { currentMode: runMode }],
            ['rvcOperationalState', { operationalState, operationalError }],
            ['powerSource', powerSourceAttributes(state)],
            ['rvcCleanMode', { currentMode: cleanModeFromSpeed(state.cleanSpeed) }],
        ];
        for (const [cluster, attributes] of updates) {
            matter.updateAccessoryState(uuid, cluster, attributes).catch((error: unknown) => {
                log.debug(`[${info.name}] failed to update Matter cluster ${cluster}:`, error);
            });
        }
    };

    backend.onState(pushState);

    const execute = async (description: string, command: () => Promise<void>): Promise<void> => {
        try {
            log.info(`[${info.name}] ${description}`);
            await command();
        } catch (error: unknown) {
            const message = error instanceof Error ? error.message : String(error);
            log.error(`[${info.name}] ${description} failed: ${message}`);
            throw new matter.status.Failure(message);
        }
    };

    const accessory: MatterAccessory = {
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
                currentMode: CLEAN_SPEEDS.indexOf('standard'),
                supportedModes: CLEAN_MODE_LABELS.map((label, mode) => ({ label, mode, modeTags: [{ value: MODE_TAG_VACUUM }] })),
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
                changeToMode: async (args: { newMode: number }) => {
                    if (args.newMode === RUN_MODE_CLEANING) {
                        await execute('Start cleaning', () => backend.startCleaning());
                        await matter.updateAccessoryState(uuid, 'rvcRunMode', { currentMode: RUN_MODE_CLEANING });
                        await matter.updateAccessoryState(uuid, 'rvcOperationalState', { operationalState: OP_STATE_RUNNING });
                        return;
                    }
                    if (args.newMode === RUN_MODE_IDLE) {
                        await execute('Return to dock', () => backend.goHome());
                        await matter.updateAccessoryState(uuid, 'rvcRunMode', { currentMode: RUN_MODE_IDLE });
                        await matter.updateAccessoryState(uuid, 'rvcOperationalState', { operationalState: OP_STATE_SEEKING_CHARGER });
                        return;
                    }
                    throw new matter.status.ConstraintError(`Unsupported run mode: ${args.newMode}`);
                },
            },
            rvcCleanMode: {
                changeToMode: async (args: { newMode: number }) => {
                    const speed = CLEAN_SPEEDS[args.newMode];
                    if (!speed) {
                        throw new matter.status.ConstraintError(`Unsupported clean mode: ${args.newMode}`);
                    }
                    await execute(`Set suction to ${speed}`, () => backend.setCleanSpeed(speed));
                    await matter.updateAccessoryState(uuid, 'rvcCleanMode', { currentMode: args.newMode });
                },
            },
            rvcOperationalState: {
                pause: async () => {
                    await execute('Pause cleaning', () => backend.pause());
                    await matter.updateAccessoryState(uuid, 'rvcOperationalState', { operationalState: OP_STATE_PAUSED });
                },
                resume: async () => {
                    await execute('Resume cleaning', () => backend.resume());
                    await matter.updateAccessoryState(uuid, 'rvcRunMode', { currentMode: RUN_MODE_CLEANING });
                    await matter.updateAccessoryState(uuid, 'rvcOperationalState', { operationalState: OP_STATE_RUNNING });
                },
                goHome: async () => {
                    await execute('Return to dock', () => backend.goHome());
                    await matter.updateAccessoryState(uuid, 'rvcRunMode', { currentMode: RUN_MODE_IDLE });
                    await matter.updateAccessoryState(uuid, 'rvcOperationalState', { operationalState: OP_STATE_SEEKING_CHARGER });
                },
            },
        },
    };

    await matter.registerPlatformAccessories(PLUGIN_NAME, PLATFORM_NAME, [accessory]);
    log.info(`[${info.name}] Published native Matter robot vacuum (serial ${info.serial}, backend: ${backend.kind}).`);

    await backend.start();
    backend.refresh().then(pushState).catch((error: unknown) => {
        log.debug(`[${info.name}] initial state fetch failed:`, error);
    });

    api.on('shutdown', () => {
        backend.stop().catch(() => undefined);
    });

    return uuid;
}
