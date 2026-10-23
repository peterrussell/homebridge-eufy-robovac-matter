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
export type VacuumActivity = 'cleaning' | 'paused' | 'returning' | 'charging' | 'docked' | 'stopped' | 'error';
/** Normalized suction level, backend-agnostic. */
export type VacuumCleanSpeed = 'quiet' | 'standard' | 'turbo' | 'max';
export declare const CLEAN_SPEEDS: VacuumCleanSpeed[];
export declare const CLEAN_MODE_TAG_DEEP_CLEAN = 16384;
export declare const CLEAN_MODE_TAG_VACUUM = 16385;
export declare const CLEAN_MODE_TAG_MOP = 16386;
/**
 * One entry in a backend's clean-mode list. Depending on the model this is a
 * suction level (vacuum-only devices) or a cleaning type (mop-capable devices);
 * the Matter RvcCleanMode cluster is built from whatever the backend provides.
 */
export interface CleanModeOption {
    label: string;
    tags: number[];
}
export interface VacuumState {
    activity: VacuumActivity;
    /** 0-100, or -1 when unknown. */
    batteryLevel: number;
    charging: boolean;
    /** Friendly error message, or null when there is no error. */
    error: string | null;
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
}
