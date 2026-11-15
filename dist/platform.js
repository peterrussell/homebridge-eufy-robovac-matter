"use strict";
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
Object.defineProperty(exports, "__esModule", { value: true });
exports.EufyRobovacMatterPlatform = void 0;
const tuya_local_backend_1 = require("./backends/tuya-local-backend");
const eufy_cloud_backend_1 = require("./backends/eufy-cloud-backend");
const matter_vacuum_1 = require("./matter-vacuum");
const settings_1 = require("./settings");
class EufyRobovacMatterPlatform {
    log;
    config;
    api;
    staleAccessories = [];
    constructor(log, config, api) {
        this.log = log;
        this.config = config;
        this.api = api;
        this.api.on('didFinishLaunching', () => {
            void this.publishVacuums();
        });
    }
    configureAccessory(accessory) {
        // This platform only exposes Matter devices; remember any leftover HAP
        // accessory so we can remove it after launch.
        this.staleAccessories.push(accessory);
    }
    async publishVacuums() {
        if (this.staleAccessories.length > 0) {
            this.log.info(`Removing ${this.staleAccessories.length} stale HAP accessory(ies) from a previous version.`);
            this.api.unregisterPlatformAccessories(settings_1.PLUGIN_NAME, settings_1.PLATFORM_NAME, this.staleAccessories);
            this.staleAccessories.length = 0;
        }
        if (!this.api.matter || !this.api.isMatterEnabled()) {
            this.log.warn('Matter is not enabled for this bridge. This plugin only exposes Matter devices, so nothing will be published. '
                + 'Enable Matter for the Homebridge (child) bridge running this plugin, then pair it in your Matter app (Apple Home, Alexa, ...).');
            return;
        }
        const devices = this.buildDevices();
        if (devices.length === 0) {
            this.log.warn('No devices configured. Add at least one RoboVac to the plugin config.');
            return;
        }
        for (const device of devices) {
            try {
                await (0, matter_vacuum_1.registerEufyMatterVacuum)(this.api, this.log, { name: device.name, serial: device.serial }, device.backend);
            }
            catch (error) {
                const message = error instanceof Error ? error.message : String(error);
                this.log.error(`[${device.name}] Failed to publish Matter vacuum: ${message}`);
            }
        }
    }
    /** Validate config and construct the appropriate backend for each device. */
    buildDevices() {
        const raw = Array.isArray(this.config.devices) ? this.config.devices : [];
        const devices = [];
        for (const entry of raw) {
            const name = typeof entry.name === 'string' && entry.name.trim() !== '' ? entry.name.trim() : 'Eufy RoboVac';
            const deviceId = typeof entry.deviceId === 'string' ? entry.deviceId.trim() : '';
            const localKey = typeof entry.localKey === 'string' ? entry.localKey.trim() : '';
            const deviceIp = typeof entry.deviceIp === 'string' && entry.deviceIp.trim() !== '' ? entry.deviceIp.trim() : undefined;
            const protocolVersion = typeof entry.protocolVersion === 'string' && entry.protocolVersion.trim() !== '' ? entry.protocolVersion.trim() : undefined;
            const email = typeof entry.email === 'string' ? entry.email.trim() : '';
            const password = typeof entry.password === 'string' ? entry.password : '';
            const mop = entry.mop === true;
            const rooms = Array.isArray(entry.rooms)
                ? entry.rooms
                    .map((r) => ({ id: typeof r.id === 'number' ? r.id : parseInt(String(r.id), 10), name: typeof r.name === 'string' && r.name.trim() ? r.name.trim() : `Room ${r.id}` }))
                    .filter((r) => Number.isFinite(r.id))
                : undefined;
            const mapId = typeof entry.mapId === 'number' ? entry.mapId : undefined;
            const requestedBackend = typeof entry.backend === 'string' ? entry.backend.trim().toLowerCase() : 'auto';
            // Decide backend: explicit `backend`, else infer from the fields present.
            const useCloud = requestedBackend === 'cloud' || (requestedBackend === 'auto' && !localKey && !!email && !!password);
            if (useCloud) {
                if (!email || !password || !deviceId) {
                    this.log.warn(`Skipping "${name}": cloud backend needs email, password and deviceId.`);
                    continue;
                }
                devices.push({
                    name,
                    serial: deviceId,
                    backend: new eufy_cloud_backend_1.EufyCloudBackend({ name, email, password, deviceId, mop, rooms, mapId, storagePath: this.api.user.storagePath() }, this.log),
                });
                continue;
            }
            if (!deviceId || !localKey) {
                this.log.warn(`Skipping "${name}": local backend needs both deviceId and localKey (or configure email/password for cloud).`);
                continue;
            }
            devices.push({
                name,
                serial: deviceId,
                backend: new tuya_local_backend_1.TuyaLocalBackend({ name, deviceId, localKey, deviceIp, protocolVersion }, this.log),
            });
        }
        return devices;
    }
}
exports.EufyRobovacMatterPlatform = EufyRobovacMatterPlatform;
//# sourceMappingURL=platform.js.map