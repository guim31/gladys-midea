// -----------------------------------------------------------------------------
// The Gladys device of a Midea air conditioner: its features (from the
// capabilities the unit announces), the values of its states, and the
// translation of a Gladys command into the unit's settings.
//
// Feature keys are part of the external ids: never rename one.
// -----------------------------------------------------------------------------

import { DEVICE_POLL_FREQUENCIES } from '@gladysassistant/integration-sdk';
import { FAN, MODE, SWING } from './midea/ac.js';

export const DEVICE_TYPE = 'ac';

export const FEATURE_KEYS = {
  POWER: 'power',
  MODE: 'mode',
  TARGET_TEMPERATURE: 'target-temperature',
  FAN_SPEED: 'fan-speed',
  SWING_VERTICAL: 'swing-vertical',
  SWING_HORIZONTAL: 'swing-horizontal',
  INDOOR_TEMPERATURE: 'indoor-temperature',
  OUTDOOR_TEMPERATURE: 'outdoor-temperature',
  HUMIDITY: 'humidity',
  ECO: 'eco',
  TURBO: 'turbo',
  SLEEP: 'sleep',
  POWER_DRAW: 'power-draw',
  ENERGY_INDEX: 'energy-index',
};

// Gladys' AC_MODE values (server/utils/constants.js).
export const AC_MODE = { AUTO: 0, COOLING: 1, HEATING: 2, DRYING: 3, FAN: 4 };
// Gladys' AC_FAN_SPEED values.
export const AC_FAN_SPEED = { AUTO: 0, LOW: 1, MID: 3, HIGH: 5, QUIET: 6, TURBO: 7 };
// Gladys' AC_SWING_VERTICAL / AC_SWING_HORIZONTAL: off and swing only.
export const AC_SWING = { OFF: 0, SWING: 1 };

const MODE_TO_GLADYS = {
  [MODE.AUTO]: AC_MODE.AUTO,
  [MODE.COOL]: AC_MODE.COOLING,
  [MODE.HEAT]: AC_MODE.HEATING,
  [MODE.DRY]: AC_MODE.DRYING,
  [MODE.SMART_DRY]: AC_MODE.DRYING,
  [MODE.FAN_ONLY]: AC_MODE.FAN,
};
const MODE_FROM_GLADYS = {
  [AC_MODE.AUTO]: MODE.AUTO,
  [AC_MODE.COOLING]: MODE.COOL,
  [AC_MODE.HEATING]: MODE.HEAT,
  [AC_MODE.DRYING]: MODE.DRY,
  [AC_MODE.FAN]: MODE.FAN_ONLY,
};
const FAN_FROM_GLADYS = {
  [AC_FAN_SPEED.AUTO]: FAN.AUTO,
  [AC_FAN_SPEED.QUIET]: FAN.SILENT,
  [AC_FAN_SPEED.LOW]: FAN.LOW,
  [AC_FAN_SPEED.MID]: FAN.MEDIUM,
  [AC_FAN_SPEED.HIGH]: FAN.HIGH,
  [AC_FAN_SPEED.TURBO]: FAN.MAX,
};

/** The Gladys fan speed of a unit speed (a percentage; above 100: auto). */
export function fanToGladys(speed) {
  if (speed > 100) return AC_FAN_SPEED.AUTO;
  if (speed <= 30) return AC_FAN_SPEED.QUIET;
  if (speed <= 50) return AC_FAN_SPEED.LOW;
  if (speed <= 70) return AC_FAN_SPEED.MID;
  if (speed <= 90) return AC_FAN_SPEED.HIGH;
  return AC_FAN_SPEED.TURBO;
}

export const modeToGladys = (mode) => MODE_TO_GLADYS[mode] ?? null;
export const modeFromGladys = (value) => MODE_FROM_GLADYS[value] ?? null;
export const fanFromGladys = (value) => FAN_FROM_GLADYS[value] ?? null;

// Names, one table per language. German says "du", Spanish "usted".
export const NAMES = {
  en: {
    device: 'Air conditioner',
    power: 'On/off',
    mode: 'Mode',
    'target-temperature': 'Target temperature',
    'fan-speed': 'Fan speed',
    'swing-vertical': 'Vertical swing',
    'swing-horizontal': 'Horizontal swing',
    'indoor-temperature': 'Indoor temperature',
    'outdoor-temperature': 'Outdoor temperature',
    humidity: 'Indoor humidity',
    eco: 'Eco mode',
    turbo: 'Turbo',
    sleep: 'Sleep mode',
    'power-draw': 'Power draw',
    'energy-index': 'Energy consumed',
    'mode-auto': 'Auto',
    'mode-cooling': 'Cool',
    'mode-heating': 'Heat',
    'mode-drying': 'Dry',
    'mode-fan': 'Fan only',
    'fan-auto': 'Auto',
    'fan-quiet': 'Silent',
    'fan-low': 'Low',
    'fan-mid': 'Medium',
    'fan-high': 'High',
    'fan-turbo': 'Maximum',
    'swing-off': 'Fixed',
    'swing-on': 'Swing',
  },
  fr: {
    device: 'Climatiseur',
    power: 'Marche/arrêt',
    mode: 'Mode',
    'target-temperature': 'Température de consigne',
    'fan-speed': 'Vitesse de ventilation',
    'swing-vertical': 'Balayage vertical',
    'swing-horizontal': 'Balayage horizontal',
    'indoor-temperature': 'Température intérieure',
    'outdoor-temperature': 'Température extérieure',
    humidity: 'Humidité intérieure',
    eco: 'Mode éco',
    turbo: 'Turbo',
    sleep: 'Mode nuit',
    'power-draw': 'Puissance consommée',
    'energy-index': 'Énergie consommée',
    'mode-auto': 'Auto',
    'mode-cooling': 'Froid',
    'mode-heating': 'Chaud',
    'mode-drying': 'Déshumidification',
    'mode-fan': 'Ventilation',
    'fan-auto': 'Auto',
    'fan-quiet': 'Silencieux',
    'fan-low': 'Basse',
    'fan-mid': 'Moyenne',
    'fan-high': 'Haute',
    'fan-turbo': 'Maximale',
    'swing-off': 'Fixe',
    'swing-on': 'Balayage',
  },
  de: {
    device: 'Klimaanlage',
    power: 'Ein/Aus',
    mode: 'Modus',
    'target-temperature': 'Solltemperatur',
    'fan-speed': 'Lüfterstufe',
    'swing-vertical': 'Vertikales Schwenken',
    'swing-horizontal': 'Horizontales Schwenken',
    'indoor-temperature': 'Innentemperatur',
    'outdoor-temperature': 'Außentemperatur',
    humidity: 'Luftfeuchtigkeit innen',
    eco: 'Eco-Modus',
    turbo: 'Turbo',
    sleep: 'Nachtmodus',
    'power-draw': 'Leistungsaufnahme',
    'energy-index': 'Verbrauchte Energie',
    'mode-auto': 'Automatisch',
    'mode-cooling': 'Kühlen',
    'mode-heating': 'Heizen',
    'mode-drying': 'Entfeuchten',
    'mode-fan': 'Nur Lüften',
    'fan-auto': 'Automatisch',
    'fan-quiet': 'Leise',
    'fan-low': 'Niedrig',
    'fan-mid': 'Mittel',
    'fan-high': 'Hoch',
    'fan-turbo': 'Maximal',
    'swing-off': 'Fest',
    'swing-on': 'Schwenken',
  },
  es: {
    device: 'Aire acondicionado',
    power: 'Encendido/apagado',
    mode: 'Modo',
    'target-temperature': 'Temperatura de consigna',
    'fan-speed': 'Velocidad del ventilador',
    'swing-vertical': 'Oscilación vertical',
    'swing-horizontal': 'Oscilación horizontal',
    'indoor-temperature': 'Temperatura interior',
    'outdoor-temperature': 'Temperatura exterior',
    humidity: 'Humedad interior',
    eco: 'Modo eco',
    turbo: 'Turbo',
    sleep: 'Modo noche',
    'power-draw': 'Potencia consumida',
    'energy-index': 'Energía consumida',
    'mode-auto': 'Automático',
    'mode-cooling': 'Frío',
    'mode-heating': 'Calor',
    'mode-drying': 'Deshumidificación',
    'mode-fan': 'Solo ventilación',
    'fan-auto': 'Automática',
    'fan-quiet': 'Silenciosa',
    'fan-low': 'Baja',
    'fan-mid': 'Media',
    'fan-high': 'Alta',
    'fan-turbo': 'Máxima',
    'swing-off': 'Fija',
    'swing-on': 'Oscilación',
  },
};

const MODE_NAME = {
  [AC_MODE.AUTO]: 'mode-auto',
  [AC_MODE.COOLING]: 'mode-cooling',
  [AC_MODE.HEATING]: 'mode-heating',
  [AC_MODE.DRYING]: 'mode-drying',
  [AC_MODE.FAN]: 'mode-fan',
};
const FAN_NAME = {
  [AC_FAN_SPEED.AUTO]: 'fan-auto',
  [AC_FAN_SPEED.QUIET]: 'fan-quiet',
  [AC_FAN_SPEED.LOW]: 'fan-low',
  [AC_FAN_SPEED.MID]: 'fan-mid',
  [AC_FAN_SPEED.HIGH]: 'fan-high',
  [AC_FAN_SPEED.TURBO]: 'fan-turbo',
};

export const modeName = (value, language) => NAMES[language][MODE_NAME[value]] ?? null;
export const fanName = (value, language) => NAMES[language][FAN_NAME[value]] ?? null;

/** The Gladys modes a unit offers, in display order. */
export function supportedModes(caps) {
  const order = [AC_MODE.AUTO, AC_MODE.COOLING, AC_MODE.HEATING, AC_MODE.DRYING, AC_MODE.FAN];
  return order.filter((mode) => caps.modes.includes(MODE_FROM_GLADYS[mode]));
}

/** The Gladys fan speeds a unit offers, in display order. */
export function supportedFanSpeeds(caps) {
  const speeds = [];
  if (caps.fanSpeeds.auto) speeds.push(AC_FAN_SPEED.AUTO);
  if (caps.fanSpeeds.silent) speeds.push(AC_FAN_SPEED.QUIET);
  if (caps.fanSpeeds.low) speeds.push(AC_FAN_SPEED.LOW);
  if (caps.fanSpeeds.medium) speeds.push(AC_FAN_SPEED.MID);
  if (caps.fanSpeeds.high) speeds.push(AC_FAN_SPEED.HIGH);
  if (caps.fanSpeeds.max) speeds.push(AC_FAN_SPEED.TURBO);
  return speeds;
}

const options = (values, nameOf, language) =>
  values.map((value, index) => ({ value, label: nameOf(value, language), sort_order: index }));

/**
 * The features of a unit: `{ key, category, type, ... }` without ids.
 * @param {object} record the hub record (caps, hasOutdoor)
 * @param {string} language
 */
export function featureSpecs(record, language) {
  const names = NAMES[language];
  const { caps } = record;
  const control = (key, category, type, extra) => ({
    key,
    name: names[key],
    category,
    type,
    read_only: false,
    has_feedback: true,
    min: 0,
    max: 1,
    ...extra,
  });
  const sensor = (key, category, type, extra) => ({
    key,
    name: names[key],
    category,
    type,
    read_only: true,
    has_feedback: false,
    ...extra,
  });
  const swingOptions = options(
    [AC_SWING.OFF, AC_SWING.SWING],
    (value) => names[value === AC_SWING.OFF ? 'swing-off' : 'swing-on'],
    language,
  );
  const specs = [
    control(FEATURE_KEYS.POWER, 'air-conditioning', 'binary'),
    control(FEATURE_KEYS.MODE, 'air-conditioning', 'mode', {
      max: 4,
      supported_options: options(supportedModes(caps), modeName, language),
    }),
    control(FEATURE_KEYS.TARGET_TEMPERATURE, 'air-conditioning', 'target-temperature', {
      unit: 'celsius',
      min: caps.minTemperature,
      max: caps.maxTemperature,
      step: caps.halfDegrees ? 0.5 : 1,
    }),
    control(FEATURE_KEYS.FAN_SPEED, 'air-conditioning', 'fan-speed', {
      max: 7,
      supported_options: options(supportedFanSpeeds(caps), fanName, language),
    }),
  ];
  if (caps.swingVertical) {
    specs.push(
      control(FEATURE_KEYS.SWING_VERTICAL, 'air-conditioning', 'swing-vertical', {
        supported_options: swingOptions,
      }),
    );
  }
  if (caps.swingHorizontal) {
    specs.push(
      control(FEATURE_KEYS.SWING_HORIZONTAL, 'air-conditioning', 'swing-horizontal', {
        supported_options: swingOptions,
      }),
    );
  }
  specs.push(
    sensor(FEATURE_KEYS.INDOOR_TEMPERATURE, 'temperature-sensor', 'decimal', {
      unit: 'celsius',
      min: -20,
      max: 60,
    }),
  );
  if (record.hasOutdoor) {
    specs.push(
      sensor(FEATURE_KEYS.OUTDOOR_TEMPERATURE, 'temperature-sensor', 'decimal', {
        unit: 'celsius',
        min: -40,
        max: 70,
      }),
    );
  }
  if (caps.humidity) {
    specs.push(
      sensor(FEATURE_KEYS.HUMIDITY, 'humidity-sensor', 'decimal', {
        unit: 'percent',
        min: 0,
        max: 100,
      }),
    );
  }
  if (caps.eco) {
    specs.push(control(FEATURE_KEYS.ECO, 'switch', 'binary'));
  }
  if (caps.turbo) {
    specs.push(control(FEATURE_KEYS.TURBO, 'switch', 'binary'));
  }
  specs.push(control(FEATURE_KEYS.SLEEP, 'switch', 'binary'));
  if (caps.energy) {
    specs.push(
      sensor(FEATURE_KEYS.POWER_DRAW, 'energy-sensor', 'power', {
        unit: 'watt',
        min: 0,
        max: 10000,
      }),
      sensor(FEATURE_KEYS.ENERGY_INDEX, 'energy-sensor', 'index', {
        unit: 'kilowatt-hour',
        min: 0,
        max: 1000000,
      }),
    );
  }
  return specs;
}

export const deviceIds = (gladys, deviceId) => gladys.externalIds(DEVICE_TYPE, String(deviceId));

/** The last 4 hex digits of the SSID ("net_ac_63BA") tell twin units apart. */
export function deviceName(record, language) {
  const suffix = /_([0-9A-Fa-f]{4})$/.exec(record.ssid ?? '')?.[1];
  return suffix ? `${NAMES[language].device} ${suffix.toUpperCase()}` : NAMES[language].device;
}

/**
 * The discovery payload of a unit.
 * @param {object} gladys
 * @param {object} record
 * @param {string} language
 */
export function buildDevice(gladys, record, language) {
  const ids = deviceIds(gladys, record.id);
  return {
    name: deviceName(record, language),
    external_id: ids.device,
    model: record.model ? `Midea ${record.model}` : 'Midea',
    // The container reads the units by its own timer (src/hub.js); the core's
    // poll, once a minute, is only a fallback (GladysAssistant/Gladys#3198).
    should_poll: true,
    poll_frequency: DEVICE_POLL_FREQUENCIES.EVERY_MINUTES,
    params: [
      { name: 'IP_ADDRESS', value: record.host },
      { name: 'PROTOCOL', value: `V${record.version}` },
    ],
    features: featureSpecs(record, language).map(({ key, ...feature }) => ({
      ...feature,
      external_id: ids.feature(key),
    })),
  };
}

/**
 * The value of every feature from the last readings, by feature key
 * (undefined when unknown).
 */
export function deviceValues(record) {
  const state = record.state;
  if (!state) {
    return {};
  }
  const bool = (value) => (value ? 1 : 0);
  return {
    [FEATURE_KEYS.POWER]: bool(state.power),
    [FEATURE_KEYS.MODE]: modeToGladys(state.mode) ?? undefined,
    [FEATURE_KEYS.TARGET_TEMPERATURE]: state.targetTemperature,
    [FEATURE_KEYS.FAN_SPEED]: fanToGladys(state.fanSpeed),
    [FEATURE_KEYS.SWING_VERTICAL]: state.swing & SWING.VERTICAL ? AC_SWING.SWING : AC_SWING.OFF,
    [FEATURE_KEYS.SWING_HORIZONTAL]: state.swing & SWING.HORIZONTAL ? AC_SWING.SWING : AC_SWING.OFF,
    [FEATURE_KEYS.INDOOR_TEMPERATURE]: state.indoorTemperature ?? undefined,
    [FEATURE_KEYS.OUTDOOR_TEMPERATURE]: state.outdoorTemperature ?? undefined,
    [FEATURE_KEYS.HUMIDITY]: record.humidity ?? undefined,
    [FEATURE_KEYS.ECO]: bool(state.eco),
    [FEATURE_KEYS.TURBO]: bool(state.turbo),
    [FEATURE_KEYS.SLEEP]: bool(state.sleep),
    [FEATURE_KEYS.POWER_DRAW]: record.energy?.power ?? undefined,
    [FEATURE_KEYS.ENERGY_INDEX]: record.energy?.totalEnergy ?? undefined,
  };
}

/** Round a setpoint to what the unit takes, within its range. */
export function clampSetpoint(caps, value) {
  const step = caps.halfDegrees ? 0.5 : 1;
  const rounded = Math.round(value / step) * step;
  return Math.min(caps.maxTemperature, Math.max(caps.minTemperature, rounded));
}

/**
 * The unit settings after a Gladys command, from the current ones.
 * @param {object} record
 * @param {string} key feature key
 * @param {number} value Gladys value
 * @returns {object} the new settings (setStateCommand input)
 * @throws on an unknown feature or a value the unit cannot take
 */
export function applyCommand(record, key, value) {
  const next = { ...record.state };
  const number = Number(value);
  if (!Number.isFinite(number)) {
    throw new Error(`Invalid value ${value} for ${key}`);
  }
  switch (key) {
    case FEATURE_KEYS.POWER:
      next.power = number === 1;
      break;
    case FEATURE_KEYS.MODE: {
      const mode = modeFromGladys(number);
      if (mode === null || !record.caps.modes.includes(mode)) {
        throw new Error(`This unit has no mode ${value}`);
      }
      next.mode = mode;
      break;
    }
    case FEATURE_KEYS.TARGET_TEMPERATURE:
      next.targetTemperature = clampSetpoint(record.caps, number);
      break;
    case FEATURE_KEYS.FAN_SPEED: {
      const speed = fanFromGladys(number);
      if (speed === null || !supportedFanSpeeds(record.caps).includes(number)) {
        throw new Error(`This unit has no fan speed ${value}`);
      }
      next.fanSpeed = speed;
      break;
    }
    case FEATURE_KEYS.SWING_VERTICAL:
    case FEATURE_KEYS.SWING_HORIZONTAL: {
      if (number !== AC_SWING.OFF && number !== AC_SWING.SWING) {
        throw new Error('This unit only swings or stays fixed');
      }
      const bits = key === FEATURE_KEYS.SWING_VERTICAL ? SWING.VERTICAL : SWING.HORIZONTAL;
      next.swing = number === AC_SWING.SWING ? next.swing | bits : next.swing & ~bits;
      break;
    }
    case FEATURE_KEYS.ECO:
      next.eco = number === 1;
      if (next.eco) next.turbo = false;
      break;
    case FEATURE_KEYS.TURBO:
      next.turbo = number === 1;
      if (next.turbo) next.eco = false;
      break;
    case FEATURE_KEYS.SLEEP:
      next.sleep = number === 1;
      break;
    default:
      throw new Error(`The feature ${key} cannot be controlled`);
  }
  return next;
}
