/**
 * Eufy cloud backend: controls newer "novel"-protocol RoboVacs (e.g. the L60)
 * via the eufy/Tuya cloud. Logs in with eufy account credentials, polls the
 * device's protobuf-encoded DPS for state, and sends protobuf ModeCtrlRequest
 * commands. Self-contained port of the relevant eufy-clean logic.
 */
import type { Logger } from '../robovac-api';
import { type CleanModeOption, type VacuumBackend, type VacuumState } from './backend';
export interface EufyCloudConfig {
    name: string;
    email: string;
    password: string;
    deviceId: string;
    /** Mop-capable model (e.g. L60 Hybrid): expose Vacuum/Mop/Vacuum & Mop clean modes. */
    mop?: boolean;
}
export declare class EufyCloudBackend implements VacuumBackend {
    private readonly config;
    private readonly log;
    readonly kind = "cloud (eufy)";
    readonly cleanModes: CleanModeOption[];
    private readonly session;
    private readonly listeners;
    private pollTimer?;
    constructor(config: EufyCloudConfig, log: Logger);
    start(): Promise<void>;
    stop(): Promise<void>;
    onState(listener: (state: VacuumState) => void): void;
    private emit;
    refresh(): Promise<VacuumState>;
    private toState;
    private currentCleanMode;
    private stateToActivity;
    private send;
    startCleaning(): Promise<void>;
    pause(): Promise<void>;
    resume(): Promise<void>;
    goHome(): Promise<void>;
    setCleanMode(index: number): Promise<void>;
    findRobot(): Promise<void>;
}
