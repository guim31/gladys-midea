// -----------------------------------------------------------------------------
// Dehumidifiers (appliance 0xA1), ported from midea-local `devices/a1`
// (MIT). The frames are the air conditioner's kind (src/midea/frame.js: a
// message id and a CRC-8 end the body); only the bodies differ.
//
// Query 0x41 answers the whole state; set 0x48 carries every setting at once,
// like the air conditioner: the current state is needed before any command.
// -----------------------------------------------------------------------------

import { APPLIANCE, FRAME_TYPE, buildFrame, parseFrame } from './frame.js';

/** Modes as the unit encodes them (midea-local's default table). */
export const A1_MODE = { MANUAL: 1, CONTINUOUS: 2, AUTO: 3, CLOTHES_DRY: 4, SHOES_DRY: 5 };

/** Fan speeds as the unit encodes them. */
export const A1_FAN = { LOWEST: 1, LOW: 40, MEDIUM: 60, HIGH: 80, AUTO: 102 };

// Below 35 % the unit reports "no setpoint": midea-local clamps it there.
export const MIN_TARGET_HUMIDITY = 35;
const MIN_FAN_SPEED = 5;

const options = (extra) => ({ appliance: APPLIANCE.DEHUMIDIFIER, ...extra });

/** Query the whole state. */
export function getA1StateCommand(extra) {
  return buildFrame(
    FRAME_TYPE.QUERY,
    [0x41, 0x81, 0x00, 0xff, ...new Array(16).fill(0)],
    options(extra),
  );
}

/**
 * Set every setting at once.
 * @param {object} state a parseA1State() result, changed
 * @param {object} [extra] buildFrame options (id, protocol)
 * @param {boolean} [extra.beep]
 */
export function setA1StateCommand(state, { beep = false, ...extra } = {}) {
  return buildFrame(
    FRAME_TYPE.CONTROL,
    [
      0x48,
      (state.power ? 0x01 : 0) | (beep ? 0x40 : 0) | 0x02,
      state.mode & 0xff,
      state.fanSpeed & 0xff,
      0x00,
      0x00,
      0x00,
      state.targetHumidity & 0xff,
      state.childLock ? 0x80 : 0,
      (state.anion ? 0x40 : 0) | (state.pump ? 0x08 : 0) | (state.pumpEnabled ? 0x10 : 0),
      state.swing ? 0x08 : 0,
      0x00,
      0x00,
      state.waterLevelSet & 0xff,
      ...new Array(7).fill(0),
    ],
    options(extra),
  );
}

/** The state body (query, set or notification answer). */
export function parseA1State(body) {
  if (body.length < 20) {
    throw new Error(`dehumidifier state too short (${body.length} bytes)`);
  }
  const fanSpeed = body[3] & 0x7f;
  const tank = body[10] & 0x7f;
  const waterLevelSet = body[15];
  return {
    power: (body[1] & 0x01) !== 0,
    mode: body[2] & 0x0f,
    fanSpeed: fanSpeed < MIN_FAN_SPEED ? A1_FAN.LOWEST : fanSpeed,
    targetHumidity: Math.max(body[7], MIN_TARGET_HUMIDITY),
    childLock: (body[8] & 0x80) !== 0,
    anion: (body[9] & 0x40) !== 0,
    pump: (body[9] & 0x08) !== 0,
    // Whether the unit has a pump: echoed in every set frame (midea-local).
    pumpEnabled: (body[9] & 0x10) !== 0,
    filterAlert: (body[9] & 0x80) !== 0,
    tank,
    waterLevelSet,
    // midea-local's rule: full once the tank reaches the level set.
    tankFull: tank > 0 ? tank >= waterLevelSet : false,
    humidity: body[16],
    temperature: (body[17] - 50) / 2,
    swing: (body[19] & 0x20) !== 0,
  };
}

/**
 * Decode a frame of the unit: `{ kind: 'state', state }` or `{ kind: 'other' }`.
 * The new-protocol bodies (0xB0, 0xB1, 0xB5: the light only) are not read.
 * @param {Buffer} frame
 */
export function decodeA1Response(frame) {
  const { frameType, body } = parseFrame(frame, APPLIANCE.DEHUMIDIFIER);
  const bodyType = body[0];
  const general = [FRAME_TYPE.QUERY, FRAME_TYPE.CONTROL, FRAME_TYPE.REPORT].includes(frameType)
    ? ![0xb0, 0xb1, 0xb5].includes(bodyType)
    : frameType === 0x05 && bodyType === 0xa0;
  if (general) {
    return { kind: 'state', state: parseA1State(body) };
  }
  return { kind: 'other', bodyType };
}

/** Whether a frame is the dehumidifier's state (not a new-protocol body). */
export const isA1State = (frame) =>
  frame[2] === APPLIANCE.DEHUMIDIFIER && ![0xb0, 0xb1, 0xb5].includes(frame[10]);
