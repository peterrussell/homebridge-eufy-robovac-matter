/**
 * Homebridge dynamic platform. On launch it publishes one native Matter
 * Robotic Vacuum Cleaner per configured Eufy RoboVac via `api.matter`.
 *
 * The robot vacuums are Matter accessories, not HAP accessories, so there are
 * no cached `PlatformAccessory` objects to restore; `configureAccessory` only
 * cleans up any stale HAP accessories from earlier versions.
 */

import type { API, DynamicPlatformPlugin, Logging, PlatformAccessory, PlatformConfig } from 'homebridge';

import { registerEufyMatterVacuum, type EufyDeviceConfig } from './matter-vacuum';
import { PLATFORM_NAME, PLUGIN_NAME } from './settings';

export class EufyRobovacMatterPlatform implements DynamicPlatformPlugin {
    private readonly staleAccessories: PlatformAccessory[] = [];

    constructor(
        private readonly log: Logging,
        private readonly config: PlatformConfig,
        private readonly api: API,
    ) {
        this.api.on('didFinishLaunching', () => {
            void this.publishVacuums();
        });
    }

    configureAccessory(accessory: PlatformAccessory): void {
        // Nothing to restore - this platform only exposes Matter devices.
        // Remember any leftover HAP accessory so we can remove it after launch.
        this.staleAccessories.push(accessory);
    }

    private async publishVacuums(): Promise<void> {
        if (this.staleAccessories.length > 0) {
            this.log.info(`Removing ${this.staleAccessories.length} stale HAP accessory(ies) from a previous version.`);
            this.api.unregisterPlatformAccessories(PLUGIN_NAME, PLATFORM_NAME, this.staleAccessories);
            this.staleAccessories.length = 0;
        }

        if (!this.api.matter || !this.api.isMatterEnabled()) {
            this.log.warn(
                'Matter is not enabled for this bridge. This plugin only exposes Matter devices, so nothing will be published. '
                + 'Enable Matter for the Homebridge (child) bridge running this plugin, then pair it in your Matter app (Apple Home, Alexa, ...).',
            );
            return;
        }

        const devices = this.parseDevices();
        if (devices.length === 0) {
            this.log.warn('No devices configured. Add at least one RoboVac (name + deviceId + localKey) to the plugin config.');
            return;
        }

        for (const device of devices) {
            try {
                await registerEufyMatterVacuum(this.api, this.log, device);
            } catch (error: unknown) {
                const message = error instanceof Error ? error.message : String(error);
                this.log.error(`[${device.name}] Failed to publish Matter vacuum: ${message}`);
            }
        }
    }

    /** Validate and normalise the `devices` array from the plugin config. */
    private parseDevices(): EufyDeviceConfig[] {
        const raw = Array.isArray(this.config.devices) ? this.config.devices : [];
        const devices: EufyDeviceConfig[] = [];

        for (const entry of raw as Array<Record<string, unknown>>) {
            const deviceId = typeof entry.deviceId === 'string' ? entry.deviceId.trim() : '';
            const localKey = typeof entry.localKey === 'string' ? entry.localKey.trim() : '';
            const name = typeof entry.name === 'string' && entry.name.trim() !== '' ? entry.name.trim() : 'Eufy RoboVac';
            const deviceIp = typeof entry.deviceIp === 'string' && entry.deviceIp.trim() !== '' ? entry.deviceIp.trim() : undefined;

            if (!deviceId || !localKey) {
                this.log.warn(`Skipping device "${name}": both deviceId and localKey are required.`);
                continue;
            }

            devices.push({ name, deviceId, localKey, deviceIp });
        }

        return devices;
    }
}
