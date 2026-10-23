/**
 * Minimal protobuf schemas + encode/decode for the novel cloud protocol.
 *
 * Only the fields this plugin actually uses are declared, so the schemas are
 * self-contained (no cross-file imports). Field numbers match the upstream
 * eufy-clean .proto definitions exactly; unknown fields are skipped on decode.
 * Messages are length-delimited on the wire (encodeDelimited/decodeDelimited),
 * matching the eufy app.
 */

import protobuf from 'protobufjs';

// Movement commands: ModeCtrlRequest { method, seq, auto_clean }.
// auto_clean is declared as a plain field (wire-compatible with the upstream
// oneof) and only set for START_AUTO_CLEAN.
const CONTROL_PROTO = `
syntax = "proto3";
package proto.cloud;
message AutoClean { uint32 clean_times = 1; bool force_mapping = 2; }
message ModeCtrlRequest {
  enum Method {
    START_AUTO_CLEAN = 0;
    START_GOHOME = 6;
    STOP_TASK = 12;
    PAUSE_TASK = 13;
    RESUME_TASK = 14;
  }
  Method method = 1;
  uint32 seq = 2;
  AutoClean auto_clean = 3;
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

const root = new protobuf.Root();
protobuf.parse(CONTROL_PROTO, root, { keepCase: true });
protobuf.parse(WORK_STATUS_PROTO, root, { keepCase: true });
protobuf.parse(ERROR_CODE_PROTO, root, { keepCase: true });

const ModeCtrlRequest = root.lookupType('proto.cloud.ModeCtrlRequest');
const WorkStatus = root.lookupType('proto.cloud.WorkStatus');
const ErrorCodeMsg = root.lookupType('proto.cloud.ErrorCode');

const toObjectOpts = { longs: String, enums: String, bytes: String } as const;

/** Encode a ModeCtrlRequest to a base64 (delimited) string for dp 152. */
export function encodeModeCtrl(method: number, autoCleanTimes?: number): string {
    const payload: Record<string, unknown> = { method };
    if (autoCleanTimes !== undefined) {
        payload.auto_clean = { clean_times: autoCleanTimes };
    }
    const message = ModeCtrlRequest.create(payload);
    return Buffer.from(ModeCtrlRequest.encodeDelimited(message).finish()).toString('base64');
}

export interface DecodedWorkStatus {
    state?: string;
    chargingDone?: boolean;
    cleaningPaused?: boolean;
}

/** Decode dp 153 to the work-status fields we care about. */
export function decodeWorkStatus(base64Value: string): DecodedWorkStatus {
    const buffer = Buffer.from(base64Value, 'base64');
    const decoded = WorkStatus.toObject(WorkStatus.decodeDelimited(buffer), toObjectOpts) as {
        state?: string;
        charging?: { state?: string };
        cleaning?: { state?: string };
    };
    return {
        state: decoded.state,
        chargingDone: decoded.charging?.state === 'DONE',
        cleaningPaused: decoded.cleaning?.state === 'PAUSED',
    };
}

/** Decode dp 177 and return the first active warn/error code (0 if none). */
export function decodeErrorCode(base64Value: string): number {
    const buffer = Buffer.from(base64Value, 'base64');
    const decoded = ErrorCodeMsg.toObject(ErrorCodeMsg.decodeDelimited(buffer), toObjectOpts) as {
        error?: Array<number | string>;
        warn?: Array<number | string>;
    };
    const first = (arr?: Array<number | string>): number => {
        if (!arr || arr.length === 0) {
            return 0;
        }
        const n = typeof arr[0] === 'string' ? parseInt(arr[0], 10) : arr[0];
        return Number.isFinite(n) ? n : 0;
    };
    return first(decoded.warn) || first(decoded.error);
}
