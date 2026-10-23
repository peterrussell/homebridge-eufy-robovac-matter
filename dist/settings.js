"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
exports.WARNING_BATTERY_THRESHOLD = exports.LOW_BATTERY_THRESHOLD = exports.STATUS_POLL_INTERVAL_MS = exports.CACHING_DURATION_MS = exports.PLATFORM_NAME = exports.PLUGIN_NAME = void 0;
/**
 * Plugin identifiers. PLATFORM_NAME must match the `platform` value in the
 * Homebridge config and the `pluginAlias` in config.schema.json.
 */
exports.PLUGIN_NAME = 'homebridge-eufy-clean-robovac-matter';
exports.PLATFORM_NAME = 'EufyRobovacMatter';
/** How long a cached status is considered fresh before a new fetch (ms). */
exports.CACHING_DURATION_MS = 60_000;
/** How often we actively poll the vacuum for a fresh status (ms). */
exports.STATUS_POLL_INTERVAL_MS = 30_000;
/** Battery percentage at or below which the battery is reported as low. */
exports.LOW_BATTERY_THRESHOLD = 10;
/** Battery percentage at or below which the charge level is reported as "warning". */
exports.WARNING_BATTERY_THRESHOLD = 20;
//# sourceMappingURL=settings.js.map