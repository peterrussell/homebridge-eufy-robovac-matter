/**
 * Constants for the eufy/Tuya "novel" cloud protocol, ported from
 * martijnpoppen/eufy-clean (MIT). Only the subset needed to control a robot
 * vacuum (play/pause/resume/dock, suction, battery, work-status, errors).
 */
/** Novel-API DPS codes (protobuf-encoded except where noted). */
export declare const NOVEL_DPS: {
    readonly PLAY_PAUSE: "152";
    readonly WORK_STATUS: "153";
    readonly CLEANING_PARAMETERS: "154";
    readonly CLEAN_SPEED: "158";
    readonly FIND_ROBOT: "160";
    readonly BATTERY_LEVEL: "163";
    readonly GO_HOME: "173";
    readonly ERROR_CODE: "177";
};
/** Novel suction levels, in device index order (dp 158 integer index). */
export declare const NOVEL_CLEAN_SPEEDS: string[];
/** ModeCtrlRequest.Method values we use. */
export declare const CONTROL_METHOD: {
    readonly START_AUTO_CLEAN: 0;
    readonly START_GOHOME: 6;
    readonly STOP_TASK: 12;
    readonly PAUSE_TASK: 13;
    readonly RESUME_TASK: 14;
};
/** Tuya mobile-app credentials used by the eufy Android app (public). */
export declare const TUYA_APP: {
    key: string;
    secret: string;
    secret2: string;
    certSign: string;
    apiEtVersion: string;
    ttid: string;
};
/** Eufy login endpoints (v2 app first, v1 clean app as fallback). */
export declare const EUFY_DOMAIN_CONFIGS: {
    label: string;
    url: string;
    client_id: string;
    client_secret: string;
    category: string;
}[];
/** Friendly names for novel error/warn codes. */
export declare const EUFY_ERROR_CODES: Record<number, string>;
export declare function friendlyError(code: number): string;
