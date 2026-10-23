/**
 * Publishes a Eufy RoboVac as a native Matter Robotic Vacuum Cleaner using the
 * Homebridge 2.x `api.matter` API, and translates between the Matter RVC
 * clusters and the backend-agnostic `VacuumState` / commands provided by a
 * `VacuumBackend` (local Tuya or eufy cloud).
 */
import type { API, Logging } from 'homebridge';
import { type VacuumBackend } from './backends/backend';
export interface MatterVacuumInfo {
    name: string;
    serial: string;
    model?: string;
}
export declare function registerEufyMatterVacuum(api: API, log: Logging, info: MatterVacuumInfo, backend: VacuumBackend): Promise<string | undefined>;
