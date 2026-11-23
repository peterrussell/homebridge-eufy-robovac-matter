/**
 * Backend abstraction. The Matter layer (`matter-vacuum.ts`) talks only to this
 * normalized interface, so the same Matter Robotic Vacuum Cleaner device can be
 * driven by either:
 *   - the local Tuya protocol (older/legacy RoboVacs), or
 *   - the eufy/Tuya cloud "novel" protocol (newer models such as the L60).
 *
 * Each backend translates its device-specific state into `VacuumState` and
 * accepts the normalized commands below.
 */

/** Normalized operating state, backend-agnostic. */
export type VacuumActivity =
    | 'cleaning'
    | 'paused'
    | 'returning' // on the way back to the dock
    | 'charging'
    | 'docked'
    | 'stopped'
    | 'error';

/** Normalized suction level, backend-agnostic. */
export type VacuumCleanSpeed = 'quiet' | 'standard' | 'turbo' | 'max';

export const CLEAN_SPEEDS: VacuumCleanSpeed[] = ['quiet', 'standard', 'turbo', 'max'];

// Matter RvcCleanMode mode tags.
export const CLEAN_MODE_TAG_DEEP_CLEAN = 0x4000;
export const CLEAN_MODE_TAG_VACUUM = 0x4001;
export const CLEAN_MODE_TAG_MOP = 0x4002;

/**
 * One entry in a backend's clean-mode list. Depending on the model this is a
 * suction level (vacuum-only devices) or a cleaning type (mop-capable devices);
 * the Matter RvcCleanMode cluster is built from whatever the backend provides.
 */
export interface CleanModeOption {
    label: string;
    tags: number[];
}

/** A selectable area (room/zone) for the Matter Service Area cluster. */
export interface ServiceAreaRoom {
    areaId: number;
    mapId: number | null;
    name: string;
}

/** Service Area definition: the selectable areas and the maps they belong to. */
export interface ServiceAreaDef {
    areas: ServiceAreaRoom[];
    maps: Array<{ mapId: number; name: string }>;
}

export interface VacuumState {
    activity: VacuumActivity;
    /** 0-100, or -1 when unknown. */
    batteryLevel: number;
    charging: boolean;
    /** Friendly error message, or null when there is no error. */
    error: string | null;
    /** Raw device error code (backend-specific), or undefined when unknown. Used to pick a Matter error state. */
    errorCode?: number;
    /** Index into the backend's cleanModes, or null when unknown. */
    cleanMode: number | null;
}

export interface VacuumBackend {
    /** Short label naming the backend kind (for logs). */
    readonly kind: string;

    /** Connect / log in, and begin delivering state via the onState listener. */
    start(): Promise<void>;
    /** Tear down connections and timers. */
    stop(): Promise<void>;

    /** Fetch and return the current state (also delivered to onState listeners). */
    refresh(): Promise<VacuumState>;
    /** Register a listener invoked whenever fresh state is available. */
    onState(listener: (state: VacuumState) => void): void;

    /** The clean modes this device exposes (suction levels, or cleaning types). */
    readonly cleanModes: CleanModeOption[];

    startCleaning(): Promise<void>;
    pause(): Promise<void>;
    resume(): Promise<void>;
    goHome(): Promise<void>;
    /** Select a clean mode by its index into `cleanModes`. */
    setCleanMode(index: number): Promise<void>;

    /**
     * Optional capabilities. A backend only implements these when its device
     * supports them; the Matter layer wires the matching cluster/handler only
     * when the method is present, so models without a feature degrade cleanly.
     */
    findRobot?(): Promise<void>;

    /** Service Area definition (rooms/zones), or null when not configured. */
    getServiceArea?(): ServiceAreaDef | null;
    /** Remember which areas the user selected (used by the next startCleaning). */
    selectAreas?(areaIds: number[]): Promise<void>;
}
