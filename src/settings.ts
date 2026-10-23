/**
 * Plugin identifiers. PLATFORM_NAME must match the `platform` value in the
 * Homebridge config and the `pluginAlias` in config.schema.json.
 */
export const PLUGIN_NAME = 'homebridge-eufy-robovac-matter';
export const PLATFORM_NAME = 'EufyRobovacMatter';

/** How long a cached status is considered fresh before a new fetch (ms). */
export const CACHING_DURATION_MS = 60_000;
/** How often we actively poll the vacuum for a fresh status (ms). */
export const STATUS_POLL_INTERVAL_MS = 30_000;
/** Battery percentage at or below which the battery is reported as low. */
export const LOW_BATTERY_THRESHOLD = 10;
/** Battery percentage at or below which the charge level is reported as "warning". */
export const WARNING_BATTERY_THRESHOLD = 20;
