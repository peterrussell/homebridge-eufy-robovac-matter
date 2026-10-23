"use strict";
/**
 * Constants for the eufy/Tuya "novel" cloud protocol, ported from
 * martijnpoppen/eufy-clean (MIT). Only the subset needed to control a robot
 * vacuum (play/pause/resume/dock, suction, battery, work-status, errors).
 */
Object.defineProperty(exports, "__esModule", { value: true });
exports.EUFY_ERROR_CODES = exports.EUFY_DOMAIN_CONFIGS = exports.TUYA_APP = exports.CONTROL_METHOD = exports.NOVEL_CLEAN_SPEEDS = exports.NOVEL_DPS = void 0;
exports.friendlyError = friendlyError;
/** Novel-API DPS codes (protobuf-encoded except where noted). */
exports.NOVEL_DPS = {
    PLAY_PAUSE: '152', // protobuf ModeCtrlRequest (also used for goHome/stop/resume)
    WORK_STATUS: '153', // protobuf WorkStatus
    CLEANING_PARAMETERS: '154',
    CLEAN_SPEED: '158', // string name or numeric index
    FIND_ROBOT: '160',
    BATTERY_LEVEL: '163', // plain integer 0-100
    GO_HOME: '173',
    ERROR_CODE: '177', // protobuf ErrorCode
};
/** Novel suction levels, in device index order (dp 158 integer index). */
exports.NOVEL_CLEAN_SPEEDS = ['Quiet', 'Standard', 'Turbo', 'Max'];
/** ModeCtrlRequest.Method values we use. */
exports.CONTROL_METHOD = {
    START_AUTO_CLEAN: 0,
    START_GOHOME: 6,
    STOP_TASK: 12,
    PAUSE_TASK: 13,
    RESUME_TASK: 14,
};
/** Tuya mobile-app credentials used by the eufy Android app (public). */
exports.TUYA_APP = {
    key: 'yx5v9uc3ef9wg3v9atje',
    secret: 's8x78u7xwymasd9kqa7a73pjhxqsedaj',
    secret2: 'cepev5pfnhua4dkqkdpmnrdxx378mpjr',
    certSign: 'A',
    apiEtVersion: '0.0.1',
    ttid: 'android',
};
/** Eufy login endpoints (v2 app first, v1 clean app as fallback). */
exports.EUFY_DOMAIN_CONFIGS = [
    {
        label: 'v2 (Eufy app)',
        url: 'https://home-api.eufylife.com/v1/user/v2/email/login',
        client_id: 'eufy-app',
        client_secret: '8FHf22gaTKu7MZXqz5zytw',
        category: 'Health',
    },
    {
        label: 'v1 (Eufy Clean app)',
        url: 'https://home-api.eufylife.com/v1/user/email/login',
        client_id: 'eufyhome-app',
        client_secret: 'GQCpr9dSp3uQpsOMgJ4xQ',
        category: 'Home',
    },
];
/** Friendly names for novel error/warn codes. */
exports.EUFY_ERROR_CODES = {
    0: 'none',
    1: 'crash buffer stuck',
    2: 'wheel stuck',
    3: 'side brush stuck',
    4: 'rolling brush stuck',
    5: 'host trapped clear obstacle',
    6: 'machine trapped',
    7: 'wheel overhanging',
    8: 'power low shutdown',
    13: 'host tilted',
    14: 'no dust box',
    17: 'forbidden area detected',
    18: 'laser cover stuck',
    19: 'laser sensor stuck',
    20: 'laser blocked',
    21: 'dock failed',
    40: 'mop cloth dislodged',
    50: 'machine on carpet',
    51: 'camera blocked',
    52: 'unable to leave station',
    70: 'clean dust collector',
    72: 'robovac low water',
    73: 'dirty tank full',
    74: 'clean water low',
    75: 'water tank absent',
    101: 'battery abnormal',
    102: 'wheel module abnormal',
    103: 'side brush abnormal',
    104: 'fan abnormal',
    105: 'roller brush motor abnormal',
    106: 'host pump abnormal',
};
function friendlyError(code) {
    return exports.EUFY_ERROR_CODES[code] ?? `error ${code}`;
}
//# sourceMappingURL=constants.js.map