// -----------------------------------------------------------------------------
// Air-to-water heat pumps (appliance 0xC3: "Heat Pump Wi-Fi Controller",
// e.g. 171H120F), ported from midea-local `devices/c3/message.py` (MIT).
// Only what the integration uses: the basic state (zones, hot water,
// setpoints and their limits), the unit parameters (water and outdoor
// temperatures, power draw), the energy notification, eco and silent mode.
//
// These frames are not the air conditioner's: no message id and no CRC-8,
// the body starts with a "body type" byte, and the header carries the
// message protocol version the unit gives in its appliance answer (0xA0).
//
// AA | length | C3 | 5 zero bytes | protocol | message type |
// body type | data | checksum
// -----------------------------------------------------------------------------

import { APPLIANCE, checksum } from './frame.js';

export const MESSAGE_TYPE = {
  SET: 0x02,
  QUERY: 0x03,
  NOTIFY1: 0x04,
  NOTIFY2: 0x05,
  QUERY_APPLIANCE: 0xa0,
};

export const BODY_TYPE = {
  BASIC: 0x01,
  ENERGY: 0x04,
  SILENCE: 0x05,
  ECO: 0x07,
  UNIT: 0x10,
};

/** Operating modes as the unit encodes them. */
export const C3_MODE = { AUTO: 1, COOL: 2, HEAT: 3 };

/** Silent levels (MessageSetSilent). */
export const SILENT_LEVEL = { OFF: 0x0, SILENT: 0x1, SUPER_SILENT: 0x3 };

// A probe the unit does not have (0x7F), a curve not in use (0xFF).
const PROBE_ABSENT = 0x7f;

/**
 * Build a C3 frame.
 * @param {number} messageType MESSAGE_TYPE
 * @param {number[]|Buffer} body body type first
 * @param {object} [options]
 * @param {number} [options.protocol] message protocol version (appliance answer)
 */
export function buildC3Frame(messageType, body, { protocol = 0 } = {}) {
  const header = Buffer.alloc(10);
  header[0] = 0xaa;
  header[1] = 10 + body.length;
  header[2] = APPLIANCE.HEAT_PUMP;
  header[8] = protocol;
  header[9] = messageType;
  const frame = Buffer.concat([header, Buffer.from(body)]);
  return Buffer.concat([frame, Buffer.from([checksum(frame.subarray(1))])]);
}

/** The appliance query: its answer gives the message protocol version. */
export function getApplianceCommand() {
  return buildC3Frame(MESSAGE_TYPE.QUERY_APPLIANCE, new Array(19).fill(0));
}

/** Query one body type (BASIC, UNIT, ECO, SILENCE). */
export function getQueryCommand(bodyType, options) {
  return buildC3Frame(MESSAGE_TYPE.QUERY, [bodyType], options);
}

/**
 * Set the zones, hot water, mode and setpoints at once: like the air
 * conditioner, the unit has no partial command.
 * @param {object} state a parseBasic() result, changed
 * @param {object} [options] buildC3Frame options
 */
export function setBasicCommand(state, options) {
  return buildC3Frame(
    MESSAGE_TYPE.SET,
    [
      BODY_TYPE.BASIC,
      (state.zone1Power ? 0x01 : 0) | (state.zone2Power ? 0x02 : 0) | (state.dhwPower ? 0x04 : 0),
      state.mode & 0xff,
      Math.trunc(state.zoneTargets[0]) & 0xff,
      Math.trunc(state.zoneTargets[1]) & 0xff,
      Math.trunc(state.dhwTarget) & 0xff,
      Math.trunc(state.roomTarget * 2) & 0xff,
      (state.zone1Curve ? 0x01 : 0) |
        (state.zone2Curve ? 0x02 : 0) |
        (state.tbh ? 0x04 : 0) |
        (state.fastDhw ? 0x08 : 0),
    ],
    options,
  );
}

export function setEcoCommand(on, options) {
  return buildC3Frame(MESSAGE_TYPE.SET, [BODY_TYPE.ECO, on ? 0x01 : 0, 0, 0, 0, 0, 0], options);
}

export function setSilentCommand(level, options) {
  return buildC3Frame(
    MESSAGE_TYPE.SET,
    [BODY_TYPE.SILENCE, level & 0xff, ...new Array(8).fill(0)],
    options,
  );
}

// Error codes as the unit's controller shows them (midea-local's table, from
// the Midea Modbus documentation V4.7).
const ERROR_CODES = {
  1: 'E0',
  2: 'E1',
  3: 'E2',
  4: 'E3',
  5: 'E4',
  6: 'E5',
  7: 'E6',
  8: 'E7',
  9: 'E8',
  10: 'E9',
  11: 'EA',
  12: 'Eb',
  13: 'Ec',
  14: 'Ed',
  15: 'EE',
  20: 'P0',
  21: 'P1',
  23: 'P3',
  24: 'P4',
  25: 'P5',
  26: 'P6',
  31: 'Pb',
  33: 'Pd',
  38: 'PP',
  39: 'H0',
  40: 'H1',
  41: 'H2',
  42: 'H3',
  43: 'H4',
  44: 'H5',
  45: 'H6',
  46: 'H7',
  47: 'H8',
  48: 'H9',
  49: 'HA',
  50: 'Hb',
  52: 'Hd',
  53: 'HE',
  54: 'HF',
  55: 'HH',
  57: 'HP',
  65: 'C7',
  112: 'bH',
  116: 'F1',
  134: 'L0',
  135: 'L1',
  136: 'L2',
  138: 'L4',
  139: 'L5',
  141: 'L7',
  142: 'L8',
  143: 'L9',
};

/** The code the controller shows for an error number (0: none, null). */
export function errorDisplay(code) {
  if (!code) {
    return null;
  }
  return ERROR_CODES[code] ?? `#${code}`;
}

const bit = (byte, mask) => (byte & mask) !== 0;
const u16 = (data, at) => (data[at] << 8) + data[at + 1];
const u32 = (data, at) => ((data[at] << 24) >>> 0) + (data[at + 1] << 16) + u16(data, at + 2);

/** The basic state (body type 0x01): every setting and its limits. */
export function parseBasic(data) {
  if (data.length < 23) {
    throw new Error(`heat pump state too short (${data.length} bytes)`);
  }
  return {
    zone1Power: bit(data[0], 0x01),
    zone2Power: bit(data[0], 0x02),
    dhwPower: bit(data[0], 0x04),
    zone1Curve: bit(data[0], 0x08),
    zone2Curve: bit(data[0], 0x10),
    tbh: bit(data[0], 0x20),
    fastDhw: bit(data[0], 0x40),
    // What the installation has.
    heat: bit(data[1], 0x01),
    cool: bit(data[1], 0x02),
    dhw: bit(data[1], 0x04),
    doubleZone: bit(data[1], 0x08),
    // true: the zone follows a water temperature, false: a room temperature.
    zoneWaterTemperature: [bit(data[1], 0x10), bit(data[1], 0x20)],
    silent: bit(data[2], 0x02),
    eco: bit(data[2], 0x08),
    mode: data[3],
    modeAuto: data[4],
    zoneTargets: [data[5], data[6]],
    dhwTarget: data[7],
    roomTarget: data[8] / 2,
    zoneHeating: [
      { max: data[9], min: data[10] },
      { max: data[13], min: data[14] },
    ],
    zoneCooling: [
      { max: data[11], min: data[12] },
      { max: data[15], min: data[16] },
    ],
    room: { max: data[17] / 2, min: data[18] / 2 },
    dhwRange: { max: data[19], min: data[20] },
    tankTemperature: data[21],
    errorCode: data[22],
  };
}

const temperature = (raw) => (raw === PROBE_ABSENT ? null : raw > 127 ? raw - 256 : raw);

/**
 * The unit parameters (query 0x10): sensors of the outdoor and hydraulic units.
 * The water flow comes in hundredths of m³/h (midea_ac_lan, checked against
 * a wired controller), the water pressure in kPa. The two 32-bit counters
 * have no unit midea-local vouches for: read for scripts/probe.mjs only.
 */
export function parseUnit(data) {
  if (data.length < 86) {
    throw new Error(`heat pump parameters too short (${data.length} bytes)`);
  }
  return {
    compressorFrequency: data[0],
    outdoorTemperature: temperature(data[7]),
    waterInletTemperature: temperature(data[9]),
    waterOutletTemperature: temperature(data[10]),
    heating: bit(data[30], 0x10),
    cooling: bit(data[30], 0x08),
    heatingWater: bit(data[30], 0x20),
    defrost: bit(data[31], 0x80),
    // Load outputs: backup heaters IBH1, IBH2 and the tank heater TBH.
    backupHeater: bit(data[32], 0x07),
    waterFlow: u16(data, 54) / 100,
    waterPressure: u16(data, 61),
    power: u16(data, 82),
    totalElectricity: u32(data, 66),
    totalThermal: u32(data, 70),
  };
}

/** The notification the unit pushes (notify1 0x05): same sensors, other layout. */
export function parseUnitNotification(data) {
  if (data.length < 60) {
    throw new Error(`heat pump notification too short (${data.length} bytes)`);
  }
  return {
    compressorFrequency: data[0],
    outdoorTemperature: temperature(data[3]),
    waterInletTemperature: temperature(data[5]),
    waterOutletTemperature: temperature(data[6]),
    waterFlow: u16(data, 25) / 100,
    waterPressure: u16(data, 29),
    power: u16(data, 48),
    // Hours: only this notification carries the counter (midea-local).
    compressorRunTime: u16(data, 56),
  };
}

/** The energy notification (notify1 0x04): counters in kWh. */
export function parseEnergy(data) {
  if (data.length < 10) {
    throw new Error(`heat pump energy too short (${data.length} bytes)`);
  }
  return {
    heating: bit(data[0], 0x01),
    cooling: bit(data[0], 0x02),
    heatingWater: bit(data[0], 0x04),
    backupHeater: bit(data[0], 0x18),
    totalEnergy: u32(data, 1),
    producedEnergy: u32(data, 5),
    outdoorTemperature: data[9] > 127 ? data[9] - 256 : data[9],
  };
}

/**
 * Check a C3 frame and decode it: `{ kind, messageType, protocol, ... }`,
 * kind `appliance`, `basic`, `unit`, `energy`, `eco`, `silence` or `other`.
 * @param {Buffer} frame
 */
export function decodeC3Response(frame) {
  if (frame.length < 11 || frame[0] !== 0xaa) {
    throw new Error(`invalid frame: ${frame.toString('hex')}`);
  }
  if (checksum(frame.subarray(1, frame.length - 1)) !== frame[frame.length - 1]) {
    throw new Error(`frame checksum mismatch: ${frame.toString('hex')}`);
  }
  if (frame[2] !== APPLIANCE.HEAT_PUMP) {
    throw new Error(`frame of appliance 0x${frame[2].toString(16)}, expected 0xc3`);
  }
  const messageType = frame[9];
  const protocol = frame[8];
  const base = { messageType, protocol };
  if (messageType === MESSAGE_TYPE.QUERY_APPLIANCE) {
    return { kind: 'appliance', ...base };
  }
  const body = frame.subarray(10, frame.length - 1);
  const bodyType = body[0];
  const data = body.subarray(1);
  if (
    messageType === MESSAGE_TYPE.NOTIFY2 ||
    (bodyType === BODY_TYPE.BASIC &&
      [MESSAGE_TYPE.SET, MESSAGE_TYPE.QUERY, MESSAGE_TYPE.NOTIFY1].includes(messageType))
  ) {
    return { kind: 'basic', ...base, state: parseBasic(data) };
  }
  if (messageType === MESSAGE_TYPE.NOTIFY1 && bodyType === BODY_TYPE.ENERGY) {
    return { kind: 'energy', ...base, energy: parseEnergy(data) };
  }
  if (messageType === MESSAGE_TYPE.NOTIFY1 && bodyType === BODY_TYPE.SILENCE) {
    return { kind: 'unit', ...base, unit: parseUnitNotification(data) };
  }
  if (bodyType === BODY_TYPE.SILENCE) {
    const byte = data[0] ?? 0;
    // Level 1 (silent) or 3 (super silent): bit 0, plus bit 3 shifted to bit 1.
    const level = byte & 0x01 ? (byte & 0x01) + ((byte & 0x08) >> 2) : SILENT_LEVEL.OFF;
    return { kind: 'silence', ...base, silent: level !== SILENT_LEVEL.OFF, silentLevel: level };
  }
  if (bodyType === BODY_TYPE.ECO) {
    return { kind: 'eco', ...base, eco: bit(data[0] ?? 0, 0x01) };
  }
  if (bodyType === BODY_TYPE.UNIT) {
    return { kind: 'unit', ...base, unit: parseUnit(data) };
  }
  return { kind: 'other', ...base, bodyType };
}

/** Whether a frame is the answer to a query or set of `bodyType`. */
export const answersBody = (bodyType) => (frame) =>
  frame[2] === APPLIANCE.HEAT_PUMP &&
  [MESSAGE_TYPE.SET, MESSAGE_TYPE.QUERY].includes(frame[9]) &&
  frame[10] === bodyType;

export const isApplianceAnswer = (frame) =>
  frame[2] === APPLIANCE.HEAT_PUMP && frame[9] === MESSAGE_TYPE.QUERY_APPLIANCE;
