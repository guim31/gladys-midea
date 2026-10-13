// -----------------------------------------------------------------------------
// Air conditioner (appliance 0xAC) commands and responses, ported from
// msmart-ng `device/AC/command.py` (MIT), cross-checked with midea-local
// `devices/ac/message.py` (MIT). Only what the integration uses: state,
// capabilities, energy (group 4) and humidity (group 5).
// -----------------------------------------------------------------------------

import { FRAME_TYPE, buildFrame, parseFrame } from './frame.js';

export const RESPONSE_ID = {
  PROPERTIES_ACK: 0xb0,
  PROPERTIES: 0xb1,
  CAPABILITIES: 0xb5,
  STATE: 0xc0,
  GROUP_DATA: 0xc1,
};

/** Operational modes as the unit encodes them. */
export const MODE = { AUTO: 1, COOL: 2, DRY: 3, HEAT: 4, FAN_ONLY: 5, SMART_DRY: 6 };

/** Fan speeds as the unit encodes them (a percentage, 102 = auto). */
export const FAN = { SILENT: 20, LOW: 40, MEDIUM: 60, HIGH: 80, MAX: 100, AUTO: 102 };

/** Louver swing bits. */
export const SWING = { OFF: 0x0, HORIZONTAL: 0x3, VERTICAL: 0xc, BOTH: 0xf };

const CONTROL_SOURCE = 0x2; // "app" control

/** Query the basic state (answer: STATE 0xC0). */
export function getStateCommand(options) {
  return buildFrame(
    FRAME_TYPE.QUERY,
    [0x41, 0x81, 0x00, 0xff, 0x03, 0xff, 0x00, 0x02, ...new Array(12).fill(0), 0x03],
    options,
  );
}

/** Query the capabilities (answer: CAPABILITIES 0xB5), or the second page. */
export function getCapabilitiesCommand(additional = false, options) {
  return buildFrame(
    FRAME_TYPE.QUERY,
    additional ? [0xb5, 0x01, 0x01, 0x01] : [0xb5, 0x01, 0x00],
    options,
  );
}

/** Query a group of extra data (4: energy, 5: humidity). */
export function getGroupDataCommand(group, options) {
  const body = new Array(20).fill(0);
  body[0] = 0x41;
  body[1] = 0x21;
  body[2] = 0x01;
  body[3] = 0x40 | group;
  return buildFrame(FRAME_TYPE.QUERY, body, options);
}

/**
 * Set the whole basic state at once: the unit has no "set one field"
 * command, every control frame carries every setting.
 * @param {object} state
 * @param {boolean} state.power
 * @param {number} state.mode MODE
 * @param {number} state.targetTemperature °C, by halves
 * @param {number} state.fanSpeed FAN or a percentage
 * @param {number} state.swing SWING bits
 * @param {boolean} [state.eco]
 * @param {boolean} [state.turbo]
 * @param {boolean} [state.sleep]
 * @param {boolean} [state.fahrenheit] the unit's own display unit
 * @param {boolean} [state.beep]
 * @param {number} [state.targetHumidity]
 * @param {boolean} [state.freezeProtection]
 * @param {boolean} [state.followMe]
 * @param {boolean} [state.purifier]
 * @param {boolean} [state.auxHeat]
 * @param {boolean} [state.independentAuxHeat]
 * @param {object} [options] buildFrame options
 */
export function setStateCommand(state, options) {
  const beep = state.beep === false ? 0 : 0x40;
  const power = state.power ? 0x1 : 0;
  const integral = Math.trunc(state.targetTemperature);
  const half = state.targetTemperature - integral > 0;
  let temperature;
  let temperatureAlt;
  if (integral >= 17 && integral <= 30) {
    temperature = (integral - 16) & 0xf;
    temperatureAlt = 0;
  } else {
    // Outside 17-30 °C the unit takes the alternate field.
    temperature = 0;
    temperatureAlt = (integral - 12) & 0x1f;
  }
  temperature |= half ? 0x10 : 0;
  const mode = (state.mode & 0x7) << 5;
  return buildFrame(
    FRAME_TYPE.CONTROL,
    [
      0x40,
      CONTROL_SOURCE | beep | power,
      temperature | mode,
      state.fanSpeed & 0xff,
      0x7f,
      0x7f,
      0x00,
      0x30 | (state.swing & 0x3f),
      (state.followMe ? 0x80 : 0) | (state.turbo ? 0x20 : 0),
      (state.eco ? 0x80 : 0) | (state.purifier ? 0x20 : 0) | (state.auxHeat ? 0x08 : 0),
      (state.sleep ? 0x01 : 0) | (state.turbo ? 0x02 : 0) | (state.fahrenheit ? 0x04 : 0),
      0x00,
      0x00,
      0x00,
      0x00,
      0x00,
      0x00,
      0x00,
      temperatureAlt,
      (state.targetHumidity ?? 40) & 0x7f,
      0x00,
      state.freezeProtection ? 0x80 : 0,
      state.independentAuxHeat ? 0x08 : 0,
      0x00,
    ],
    options,
  );
}

/** A temperature byte with its extra tenth digit (null when 0xFF: no sensor). */
function parseTemperature(raw, decimals, fahrenheit) {
  if (raw === 0xff) {
    return null;
  }
  const temperature = (raw - 50) / 2;
  if (!fahrenheit && decimals) {
    return round1(Math.trunc(temperature) + (temperature >= 0 ? decimals : -decimals));
  }
  if (decimals >= 0.5) {
    return Math.trunc(temperature) + (temperature >= 0 ? 0.5 : -0.5);
  }
  return temperature;
}

const round1 = (value) => Math.round(value * 10) / 10;

/** The STATE (0xC0) payload: every basic setting and the two sensors. */
export function parseState(body) {
  const state = {
    power: Boolean(body[1] & 0x1),
    targetTemperature: (body[2] & 0xf) + 16 + (body[2] & 0x10 ? 0.5 : 0),
    mode: (body[2] >> 5) & 0x7,
    fanSpeed: body[3] & 0x7f,
    swing: body[7] & 0xf,
    turbo: Boolean(body[8] & 0x20) || Boolean(body[10] & 0x2),
    independentAuxHeat: Boolean(body[8] & 0x40),
    followMe: Boolean(body[8] & 0x80),
    eco: Boolean(body[9] & 0x10),
    purifier: Boolean(body[9] & 0x20),
    auxHeat: Boolean(body[9] & 0x08),
    sleep: Boolean(body[10] & 0x1),
    fahrenheit: Boolean(body[10] & 0x4),
    filterAlert: Boolean(body[13] & 0x20),
    displayOn: body[14] !== 0x70,
    errorCode: body[16] ?? 0,
    targetHumidity: null,
    freezeProtection: null,
  };
  state.indoorTemperature = parseTemperature(body[11], (body[15] & 0xf) / 10, state.fahrenheit);
  state.outdoorTemperature = parseTemperature(body[12], (body[15] >> 4) / 10, state.fahrenheit);
  const alternate = body[13] & 0x1f;
  if (alternate !== 0) {
    state.targetTemperature = alternate + 12 + (body[2] & 0x10 ? 0.5 : 0);
  }
  if (body.length >= 20) {
    state.targetHumidity = body[19] & 0x7f;
  }
  if (body.length >= 22) {
    state.freezeProtection = Boolean(body[21] & 0x80);
  }
  return state;
}

// Capability ids (little-endian 16 bits) the integration reads.
const CAP = {
  FAN_SPEED_CONTROL: 0x0210,
  PRESET_ECO: 0x0212,
  MODES: 0x0214,
  SWING_MODES: 0x0215,
  ENERGY: 0x0216,
  FILTER_REMIND: 0x0217,
  PRESET_TURBO: 0x021a,
  HUMIDITY: 0x021f,
  TEMPERATURES: 0x0225,
};

const anyOf = (values) => (value) => values.includes(value);

const READERS = {
  [CAP.FAN_SPEED_CONTROL]: {
    fan_silent: anyOf([6, 9]),
    fan_low: anyOf([3, 4, 5, 6, 7, 9]),
    fan_medium: anyOf([5, 6, 7]),
    fan_high: anyOf([3, 4, 5, 6, 7, 9]),
    fan_auto: anyOf([4, 5, 6, 9]),
    fan_custom: anyOf([1]),
  },
  [CAP.PRESET_ECO]: { eco: anyOf([1, 2]) },
  [CAP.MODES]: {
    heat_mode: anyOf([1, 2, 4, 6, 7, 9, 10, 11, 12, 13]),
    cool_mode: anyOf([0, 1, 3, 4, 5, 6, 7, 8, 9, 11, 13, 14, 15]),
    dry_mode: anyOf([0, 1, 5, 6, 9, 11, 13, 14, 15]),
    auto_mode: anyOf([0, 1, 2, 7, 8, 9, 13, 14]),
  },
  [CAP.SWING_MODES]: {
    swing_horizontal: anyOf([1, 3]),
    swing_vertical: anyOf([0, 1]),
  },
  [CAP.ENERGY]: { energy_stats: anyOf([2, 3, 4, 5]) },
  [CAP.FILTER_REMIND]: { filter_notice: anyOf([1, 2, 4]) },
  [CAP.PRESET_TURBO]: { turbo_heat: anyOf([1, 3]), turbo_cool: anyOf([0, 1]) },
  [CAP.HUMIDITY]: { humidity_auto_set: anyOf([1, 2]), humidity_manual_set: anyOf([2, 3]) },
};

/**
 * The CAPABILITIES (0xB5) payload: raw flags, and whether a second page
 * (`getCapabilitiesCommand(true)`) holds more.
 * @returns {{ raw: Record<string, boolean|number>, more: boolean }}
 */
export function parseCapabilities(body) {
  const raw = {};
  const count = body[1];
  let caps = body.subarray(2);
  for (let index = 0; index < count; index += 1) {
    if (caps.length < 3) {
      break;
    }
    const size = caps[2];
    if (size === 0) {
      caps = caps.subarray(3);
      continue;
    }
    const id = caps.readUInt16LE(0);
    const value = caps.subarray(3, 3 + size);
    const readers = READERS[id];
    if (readers && value.length > 0) {
      for (const [name, read] of Object.entries(readers)) {
        raw[name] = read(value[0]);
      }
    } else if (id === CAP.TEMPERATURES && size >= 6) {
      raw.cool_min_temperature = caps[3] * 0.5;
      raw.cool_max_temperature = caps[4] * 0.5;
      raw.auto_min_temperature = caps[5] * 0.5;
      raw.auto_max_temperature = caps[6] * 0.5;
      raw.heat_min_temperature = caps[7] * 0.5;
      raw.heat_max_temperature = caps[8] * 0.5;
      raw.decimals = (size > 6 ? caps[9] : caps[2]) !== 0;
    }
    caps = caps.subarray(3 + size);
  }
  return { raw, more: caps.length > 1 ? Boolean(caps[caps.length - 2]) : false };
}

/**
 * What the integration needs from the raw capabilities, with the defaults
 * of a unit that never answered the query (msmart-ng's defaults).
 * @param {Record<string, boolean|number>|null} raw
 */
export function summarizeCapabilities(raw) {
  const caps = raw ?? {};
  const has = (name) => caps[name] === true;
  const anyFan = Object.keys(caps).some((name) => name.startsWith('fan_'));
  const fan = (name) => (anyFan ? has(`fan_${name}`) || has('fan_custom') : name !== 'silent');
  const modes = [MODE.FAN_ONLY];
  if (raw === null || raw === undefined) {
    modes.push(MODE.DRY, MODE.COOL, MODE.HEAT, MODE.AUTO);
  } else {
    if (has('dry_mode')) modes.push(MODE.DRY);
    if (has('cool_mode')) modes.push(MODE.COOL);
    if (has('heat_mode')) modes.push(MODE.HEAT);
    if (has('auto_mode')) modes.push(MODE.AUTO);
  }
  const temperature = (bound, fallback, pick) => {
    const values = ['cool', 'auto', 'heat']
      .map((mode) => caps[`${mode}_${bound}_temperature`])
      .filter((value) => typeof value === 'number' && value > 0);
    return values.length > 0 ? pick(...values) : fallback;
  };
  return {
    known: raw !== null && raw !== undefined,
    modes,
    fanSpeeds: {
      silent: fan('silent'),
      low: fan('low'),
      medium: fan('medium'),
      high: fan('high'),
      auto: fan('auto'),
      max: has('fan_custom'),
    },
    // A unit that does not answer the query: both swings offered, as msmart-ng.
    swingVertical: raw ? has('swing_vertical') : true,
    swingHorizontal: raw ? has('swing_horizontal') : true,
    eco: raw ? has('eco') : true,
    turbo: raw ? has('turbo_heat') || has('turbo_cool') : true,
    energy: has('energy_stats'),
    filter: has('filter_notice'),
    humidity: has('humidity_auto_set') || has('humidity_manual_set'),
    minTemperature: temperature('min', 16, Math.min),
    maxTemperature: temperature('max', 30, Math.max),
    halfDegrees: raw ? caps.decimals !== false : true,
  };
}

const bcd = (byte) => 10 * (byte >> 4) + (byte & 0xf);

/**
 * Group 4: energy. The units disagree on the encoding: BCD (msmart-ng's
 * default) or binary. All zero means "no meter".
 * @returns {{ totalEnergy: number|null, power: number|null }} kWh and W
 */
export function parseEnergy(body, format = 'bcd') {
  if (body.length < 19) {
    return { totalEnergy: null, power: null };
  }
  const e = body.subarray(4, 8);
  const p = body.subarray(16, 19);
  const totalBcd = 10000 * bcd(e[0]) + 100 * bcd(e[1]) + bcd(e[2]) + 0.01 * bcd(e[3]);
  const powerBcd = 1000 * bcd(p[0]) + 10 * bcd(p[1]) + 0.1 * bcd(p[2]);
  const current = body.subarray(12, 16);
  const currentBcd =
    10000 * bcd(current[0]) + 100 * bcd(current[1]) + bcd(current[2]) + 0.01 * bcd(current[3]);
  if (!totalBcd && !powerBcd && !currentBcd) {
    return { totalEnergy: null, power: null };
  }
  if (format === 'binary') {
    return {
      totalEnergy: round2(e.readUInt32BE(0) / 10),
      power: round1(((p[0] << 16) + (p[1] << 8) + p[2]) / 10),
    };
  }
  return { totalEnergy: round2(totalBcd), power: round1(powerBcd) };
}

const round2 = (value) => Math.round(value * 100) / 100;

/** Group 5: indoor humidity (%), null when the unit has no sensor. */
export function parseHumidity(body) {
  return body.length > 4 && body[4] !== 0 ? body[4] : null;
}

/**
 * Decode any frame the unit sends: `{ kind, ... }` with kind `state`,
 * `capabilities`, `energy`, `humidity` or `other`.
 * @param {Buffer} frame
 * @param {object} [options]
 * @param {string} [options.energyFormat]
 */
export function decodeResponse(frame, { energyFormat = 'bcd' } = {}) {
  const id = frame.length > 10 ? frame[10] : null;
  const properties = id === RESPONSE_ID.PROPERTIES || id === RESPONSE_ID.PROPERTIES_ACK;
  const { frameType, body } = parseFrame(frame, undefined, { checkCrc: !properties });
  if (id === RESPONSE_ID.STATE) {
    return { kind: 'state', state: parseState(body) };
  }
  if (id === RESPONSE_ID.CAPABILITIES && frameType === FRAME_TYPE.QUERY) {
    return { kind: 'capabilities', ...parseCapabilities(body) };
  }
  if (id === RESPONSE_ID.GROUP_DATA) {
    const group = frame[13] & 0xf;
    if (group === 4) {
      return { kind: 'energy', ...parseEnergy(body, energyFormat) };
    }
    if (group === 5) {
      return { kind: 'humidity', humidity: parseHumidity(body) };
    }
  }
  return { kind: 'other', id };
}
