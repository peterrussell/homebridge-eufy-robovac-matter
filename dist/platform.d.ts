/**
 * Homebridge dynamic platform. On launch it publishes one native Matter
 * Robotic Vacuum Cleaner per configured Eufy RoboVac via `api.matter`, choosing
 * a control backend per device:
 *   - local Tuya LAN  (deviceId + localKey)       -> TuyaLocalBackend
 *   - eufy/Tuya cloud (eufy email + password)      -> EufyCloudBackend
 *
 * The robot vacuums are Matter accessories, not HAP accessories, so there are
 * no cached `PlatformAccessory` objects to restore; `configureAccessory` only
 * cleans up stale HAP accessories from earlier versions.
 */
import type { API, DynamicPlatformPlugin, Logging, PlatformAccessory, PlatformConfig } from 'homebridge';
export declare class EufyRobovacMatterPlatform implements DynamicPlatformPlugin {
    private readonly log;
    private readonly config;
    private readonly api;
    private readonly staleAccessories;
    constructor(log: Logging, config: PlatformConfig, api: API);
    configureAccessory(accessory: PlatformAccessory): void;
    private publishVacuums;
    /** Validate config and construct the appropriate backend for each device. */
    private buildDevices;
}
