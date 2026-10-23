/**
 * Minimal protobuf schemas + encode/decode for the novel cloud protocol.
 *
 * Only the fields this plugin actually uses are declared, so the schemas are
 * self-contained (no cross-file imports). Field numbers match the upstream
 * eufy-clean .proto definitions exactly; unknown fields are skipped on decode.
 * Messages are length-delimited on the wire (encodeDelimited/decodeDelimited),
 * matching the eufy app.
 */
/** CleanType enum values (matches the proto). */
export declare const CLEAN_TYPE: {
    readonly SWEEP_ONLY: 0;
    readonly MOP_ONLY: 1;
    readonly SWEEP_AND_MOP: 2;
    readonly SWEEP_THEN_MOP: 3;
};
/** MopMode.Level HIGH, used when enabling mopping. */
export declare const MOP_LEVEL_HIGH = 2;
/** Encode a ModeCtrlRequest to a base64 (delimited) string for dp 152. */
export declare function encodeModeCtrl(method: number, autoCleanTimes?: number): string;
export interface DecodedWorkStatus {
    state?: string;
    chargingDone?: boolean;
    cleaningPaused?: boolean;
}
/** Decode dp 153 to the work-status fields we care about. */
export declare function decodeWorkStatus(base64Value: string): DecodedWorkStatus;
/** Encode a CleanParamRequest for dp 154 (set cleaning type, optionally mop level). */
export declare function encodeCleanParam(cleanType: number, mopLevel?: number): string;
/** Decode dp 154 and return the current CleanType enum name (e.g. "SWEEP_AND_MOP"), or undefined. */
export declare function decodeCleanType(base64Value: string): string | undefined;
/** Decode dp 177 and return the first active warn/error code (0 if none). */
export declare function decodeErrorCode(base64Value: string): number;
