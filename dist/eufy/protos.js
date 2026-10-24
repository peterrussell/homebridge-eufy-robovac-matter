"use strict";
/**
 * Minimal protobuf schemas + encode/decode for the novel cloud protocol.
 *
 * Only the fields this plugin actually uses are declared, so the schemas are
 * self-contained (no cross-file imports). Field numbers match the upstream
 * eufy-clean .proto definitions exactly; unknown fields are skipped on decode.
 * Messages are length-delimited on the wire (encodeDelimited/decodeDelimited),
 * matching the eufy app.
 */
var __importDefault = (this && this.__importDefault) || function (mod) {
    return (mod && mod.__esModule) ? mod : { "default": mod };
};
Object.defineProperty(exports, "__esModule", { value: true });
exports.MOP_LEVEL_HIGH = exports.CLEAN_TYPE = void 0;
exports.encodeModeCtrl = encodeModeCtrl;
exports.encodeRoomClean = encodeRoomClean;
exports.decodeWorkStatus = decodeWorkStatus;
exports.encodeCleanParam = encodeCleanParam;
exports.decodeCleanType = decodeCleanType;
exports.decodeErrorCode = decodeErrorCode;
const protobufjs_1 = __importDefault(require("protobufjs"));
// Movement commands: ModeCtrlRequest { method, seq, auto_clean }.
// auto_clean is declared as a plain field (wire-compatible with the upstream
// oneof) and only set for START_AUTO_CLEAN.
const CONTROL_PROTO = `
syntax = "proto3";
package proto.cloud;
message AutoClean { uint32 clean_times = 1; bool force_mapping = 2; }
message SelectRoomsClean {
  message Room { uint32 id = 1; uint32 order = 2; }
  repeated Room rooms = 1;
  uint32 clean_times = 2;
  uint32 map_id = 3;
  uint32 releases = 4;
}
message ModeCtrlRequest {
  enum Method {
    START_AUTO_CLEAN = 0;
    START_SELECT_ROOMS_CLEAN = 1;
    START_GOHOME = 6;
    STOP_TASK = 12;
    PAUSE_TASK = 13;
    RESUME_TASK = 14;
  }
  Method method = 1;
  uint32 seq = 2;
  AutoClean auto_clean = 3;
  SelectRoomsClean select_rooms_clean = 4;
}
`;
// WorkStatus: top-level state plus the substates we use to disambiguate.
const WORK_STATUS_PROTO = `
syntax = "proto3";
package proto.cloud;
message WorkStatus {
  enum State {
    STANDBY = 0; SLEEP = 1; FAULT = 2; CHARGING = 3; FAST_MAPPING = 4;
    CLEANING = 5; REMOTE_CTRL = 6; GO_HOME = 7; CRUISIING = 8;
  }
  State state = 2;
  message Charging { enum State { DOING = 0; DONE = 1; ABNORMAL = 2; } State state = 1; }
  Charging charging = 3;
  message Cleaning { enum RunState { DOING = 0; PAUSED = 1; } RunState state = 1; }
  Cleaning cleaning = 6;
  message GoHome { enum RunState { DOING = 0; PAUSED = 1; } RunState state = 1; }
  GoHome go_home = 8;
}
`;
const ERROR_CODE_PROTO = `
syntax = "proto3";
package proto.cloud;
message ErrorCode { repeated uint32 error = 2; repeated uint32 warn = 3; }
`;
// Clean parameters (dp 154): cleaning type (sweep/mop/both) + mop level + suction.
// Field numbers match the upstream clean_param.proto; omitted fields are skipped.
const CLEAN_PARAM_PROTO = `
syntax = "proto3";
package proto.cloud;
message Fan { enum Suction { QUIET = 0; STANDARD = 1; TURBO = 2; MAX = 3; MAX_PLUS = 4; } Suction suction = 1; }
message MopMode { enum Level { LOW = 0; MIDDLE = 1; HIGH = 2; } Level level = 1; }
message CleanType { enum Value { SWEEP_ONLY = 0; MOP_ONLY = 1; SWEEP_AND_MOP = 2; SWEEP_THEN_MOP = 3; } Value value = 1; }
message CleanExtent { enum Value { NORMAL = 0; NARROW = 1; QUICK = 2; } Value value = 1; }
message CleanParam {
  CleanType clean_type = 1;
  CleanExtent clean_extent = 3;
  MopMode mop_mode = 4;
  Fan fan = 6;
  uint32 clean_times = 7;
}
message CleanParamRequest { CleanParam clean_param = 1; CleanParam area_clean_param = 2; }
message CleanParamResponse { CleanParam clean_param = 1; CleanParam area_clean_param = 3; CleanParam running_clean_param = 4; }
`;
const root = new protobufjs_1.default.Root();
protobufjs_1.default.parse(CONTROL_PROTO, root, { keepCase: true });
protobufjs_1.default.parse(WORK_STATUS_PROTO, root, { keepCase: true });
protobufjs_1.default.parse(ERROR_CODE_PROTO, root, { keepCase: true });
protobufjs_1.default.parse(CLEAN_PARAM_PROTO, root, { keepCase: true });
const ModeCtrlRequest = root.lookupType('proto.cloud.ModeCtrlRequest');
const WorkStatus = root.lookupType('proto.cloud.WorkStatus');
const ErrorCodeMsg = root.lookupType('proto.cloud.ErrorCode');
const CleanParamRequest = root.lookupType('proto.cloud.CleanParamRequest');
const CleanParamResponse = root.lookupType('proto.cloud.CleanParamResponse');
const toObjectOpts = { longs: String, enums: String, bytes: String };
/** CleanType enum values (matches the proto). */
exports.CLEAN_TYPE = { SWEEP_ONLY: 0, MOP_ONLY: 1, SWEEP_AND_MOP: 2, SWEEP_THEN_MOP: 3 };
/** MopMode.Level HIGH, used when enabling mopping. */
exports.MOP_LEVEL_HIGH = 2;
/** Encode a ModeCtrlRequest to a base64 (delimited) string for dp 152. */
function encodeModeCtrl(method, autoCleanTimes) {
    const payload = { method };
    if (autoCleanTimes !== undefined) {
        payload.auto_clean = { clean_times: autoCleanTimes };
    }
    const message = ModeCtrlRequest.create(payload);
    return Buffer.from(ModeCtrlRequest.encodeDelimited(message).finish()).toString('base64');
}
/** Encode a START_SELECT_ROOMS_CLEAN ModeCtrlRequest for the given room IDs. */
function encodeRoomClean(method, roomIds, mapId) {
    const selectRoomsClean = {
        rooms: roomIds.map((id, order) => ({ id, order })),
        clean_times: 1,
    };
    if (mapId !== undefined) {
        selectRoomsClean.map_id = mapId;
    }
    const message = ModeCtrlRequest.create({ method, select_rooms_clean: selectRoomsClean });
    return Buffer.from(ModeCtrlRequest.encodeDelimited(message).finish()).toString('base64');
}
/** Decode dp 153 to the work-status fields we care about. */
function decodeWorkStatus(base64Value) {
    const buffer = Buffer.from(base64Value, 'base64');
    const decoded = WorkStatus.toObject(WorkStatus.decodeDelimited(buffer), toObjectOpts);
    return {
        state: decoded.state,
        chargingDone: decoded.charging?.state === 'DONE',
        cleaningPaused: decoded.cleaning?.state === 'PAUSED',
    };
}
/** Encode a CleanParamRequest for dp 154 (set cleaning type, optionally mop level). */
function encodeCleanParam(cleanType, mopLevel) {
    const cleanParam = { clean_type: { value: cleanType } };
    if (mopLevel !== undefined) {
        cleanParam.mop_mode = { level: mopLevel };
    }
    const message = CleanParamRequest.create({ clean_param: cleanParam });
    return Buffer.from(CleanParamRequest.encodeDelimited(message).finish()).toString('base64');
}
/** Decode dp 154 and return the current CleanType enum name (e.g. "SWEEP_AND_MOP"), or undefined. */
function decodeCleanType(base64Value) {
    const buffer = Buffer.from(base64Value, 'base64');
    const decoded = CleanParamResponse.toObject(CleanParamResponse.decodeDelimited(buffer), {
        ...toObjectOpts,
        defaults: true,
    });
    return decoded.clean_param?.clean_type?.value;
}
/** Decode dp 177 and return the first active warn/error code (0 if none). */
function decodeErrorCode(base64Value) {
    const buffer = Buffer.from(base64Value, 'base64');
    const decoded = ErrorCodeMsg.toObject(ErrorCodeMsg.decodeDelimited(buffer), toObjectOpts);
    const first = (arr) => {
        if (!arr || arr.length === 0) {
            return 0;
        }
        const n = typeof arr[0] === 'string' ? parseInt(arr[0], 10) : arr[0];
        return Number.isFinite(n) ? n : 0;
    };
    return first(decoded.warn) || first(decoded.error);
}
//# sourceMappingURL=protos.js.map