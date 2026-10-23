/**
 * Local Tuya backend: controls older/legacy Eufy RoboVacs directly over the
 * Tuya LAN protocol (via `RoboVac`), with no cloud involvement. Translates the
 * device's Tuya DPS status into the normalized `VacuumState`.
 */
import { type Logger } from '../robovac-api';
import { type CleanModeOption, type VacuumBackend, type VacuumState } from './backend';
export interface TuyaLocalConfig {
    name: string;
    deviceId: string;
    localKey: string;
    deviceIp?: string;
    protocolVersion?: string;
}
export declare class TuyaLocalBackend implements VacuumBackend {
    private readonly config;
    private readonly log;
    readonly kind = "local (Tuya LAN)";
    readonly cleanModes: CleanModeOption[];
    private readonly roboVac;
    private readonly listeners;
    private pollTimer?;
    constructor(config: TuyaLocalConfig, log: Logger);
    start(): Promise<void>;
    stop(): Promise<void>;
    onState(listener: (state: VacuumState) => void): void;
    private emit;
    refresh(): Promise<VacuumState>;
    private toState;
    startCleaning(): Promise<void>;
    pause(): Promise<void>;
    resume(): Promise<void>;
    goHome(): Promise<void>;
    setCleanMode(index: number): Promise<void>;
    findRobot(): Promise<void>;
}
