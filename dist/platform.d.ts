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
    /**
     * Persist seeded default rooms into config.json for a device that has no
     * `rooms` key yet. Re-reads the file so a concurrent edit is respected, and
     * only ever writes when `rooms` is still absent — so a user who has since
     * set or cleared the list is never overwritten. Best-effort: a failure just
     * means the defaults live in memory for this run and are retried next time.
     */
    private seedDefaultRooms;
}
