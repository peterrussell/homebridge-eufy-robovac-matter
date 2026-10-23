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

export interface VacuumState {
    activity: VacuumActivity;
    /** 0-100, or -1 when unknown. */
    batteryLevel: number;
    charging: boolean;
    /** Friendly error message, or null when there is no error. */
    error: string | null;
    /** Current suction level, or null when unknown. */
    cleanSpeed: VacuumCleanSpeed | null;
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

    startCleaning(): Promise<void>;
    pause(): Promise<void>;
    resume(): Promise<void>;
    goHome(): Promise<void>;
    setCleanSpeed(speed: VacuumCleanSpeed): Promise<void>;
}
