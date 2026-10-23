"use strict";
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
Object.defineProperty(exports, "__esModule", { value: true });
exports.CLEAN_MODE_TAG_MOP = exports.CLEAN_MODE_TAG_VACUUM = exports.CLEAN_MODE_TAG_DEEP_CLEAN = exports.CLEAN_SPEEDS = void 0;
exports.CLEAN_SPEEDS = ['quiet', 'standard', 'turbo', 'max'];
// Matter RvcCleanMode mode tags.
exports.CLEAN_MODE_TAG_DEEP_CLEAN = 0x4000;
exports.CLEAN_MODE_TAG_VACUUM = 0x4001;
exports.CLEAN_MODE_TAG_MOP = 0x4002;
//# sourceMappingURL=backend.js.map