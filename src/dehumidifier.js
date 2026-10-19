// -----------------------------------------------------------------------------
// The Gladys device of a Midea dehumidifier (appliance 0xA1: Midea, Comfee,
// Inventor... set up in the SmartHome / MSmartHome app): its features, the
// values of its states, and the translation of a Gladys command into the
// unit's settings.
//
// Gladys has no dehumidifier category: like the Tuya integration's
// dehumidifier, the mode, the fan speed and the target humidity are
// `text/select` features (string values, labels in the configured language),
// the rest uses the generic categories (switch, humidity, temperature, level,
// child lock).
//
// Feature keys and option values are part of what users store: never rename.
// -----------------------------------------------------------------------------

import { DEVICE_POLL_FREQUENCIES } from '@gladysassistant/integration-sdk';
import { A1_FAN, A1_MODE, MIN_TARGET_HUMIDITY } from './midea/a1.js';

export const DEHUMIDIFIER_TYPE = 'dehumidifier';

export const DH_KEYS = {
  POWER: 'power',
  MODE: 'mode',
  FAN_SPEED: 'fan-speed',
  TARGET_HUMIDITY: 'target-humidity',
  HUMIDITY: 'humidity',
  TEMPERATURE: 'temperature',
  TANK_LEVEL: 'tank-level',
  TANK_FULL: 'tank-full',
  CHILD_LOCK: 'child-lock',
  IONIZER: 'ionizer',
  SWING: 'swing',
  PUMP: 'pump',
};

// The option values Gladys stores: the names midea-local gives the codes.
const MODES = [
  ['manual', A1_MODE.MANUAL],
  ['continuous', A1_MODE.CONTINUOUS],
  ['auto', A1_MODE.AUTO],
  ['clothes-dry', A1_MODE.CLOTHES_DRY],
  ['shoes-dry', A1_MODE.SHOES_DRY],
];
const FAN_SPEEDS = [
  ['lowest', A1_FAN.LOWEST],
  ['low', A1_FAN.LOW],
  ['medium', A1_FAN.MEDIUM],
  ['high', A1_FAN.HIGH],
  ['auto', A1_FAN.AUTO],
];
// The Midea apps offer 35 to 85 % by steps of 5.
export const HUMIDITY_STEPS = Array.from(
  { length: 11 },
  (_, index) => MIN_TARGET_HUMIDITY + 5 * index,
);

// Names, one table per language. German says "du", Spanish "usted".
export const DH_NAMES = {
  en: {
    device: 'Dehumidifier',
    power: 'On/off',
    mode: 'Mode',
    'fan-speed': 'Fan speed',
    'target-humidity': 'Target humidity',
    humidity: 'Humidity',
    temperature: 'Temperature',
    'tank-level': 'Water tank level',
    'tank-full': 'Water tank full',
    'child-lock': 'Child lock',
    ionizer: 'Ionizer',
    swing: 'Swing',
    pump: 'Drain pump',
    manual: 'Setpoint',
    continuous: 'Continuous',
    auto: 'Auto',
    'clothes-dry': 'Clothes drying',
    'shoes-dry': 'Shoes drying',
    lowest: 'Lowest',
    low: 'Low',
    medium: 'Medium',
    high: 'High',
  },
  fr: {
    device: 'Déshumidificateur',
    power: 'Marche/arrêt',
    mode: 'Mode',
    'fan-speed': 'Vitesse de ventilation',
    'target-humidity': 'Humidité cible',
    humidity: 'Humidité',
    temperature: 'Température',
    'tank-level': 'Niveau du réservoir',
    'tank-full': 'Réservoir plein',
    'child-lock': 'Sécurité enfant',
    ionizer: 'Ioniseur',
    swing: 'Oscillation',
    pump: 'Pompe de vidange',
    manual: 'Consigne',
    continuous: 'Continu',
    auto: 'Auto',
    'clothes-dry': 'Séchage du linge',
    'shoes-dry': 'Séchage des chaussures',
    lowest: 'Très basse',
    low: 'Basse',
    medium: 'Moyenne',
    high: 'Haute',
  },
  de: {
    device: 'Luftentfeuchter',
    power: 'Ein/Aus',
    mode: 'Modus',
    'fan-speed': 'Lüfterstufe',
    'target-humidity': 'Zielfeuchte',
    humidity: 'Luftfeuchtigkeit',
    temperature: 'Temperatur',
    'tank-level': 'Füllstand des Wassertanks',
    'tank-full': 'Wassertank voll',
    'child-lock': 'Kindersicherung',
    ionizer: 'Ionisator',
    swing: 'Schwenken',
    pump: 'Ablaufpumpe',
    manual: 'Sollwert',
    continuous: 'Dauerbetrieb',
    auto: 'Automatisch',
    'clothes-dry': 'Wäschetrocknung',
    'shoes-dry': 'Schuhtrocknung',
    lowest: 'Sehr niedrig',
    low: 'Niedrig',
    medium: 'Mittel',
    high: 'Hoch',
  },
  es: {
    device: 'Deshumidificador',
    power: 'Encendido/apagado',
    mode: 'Modo',
    'fan-speed': 'Velocidad del ventilador',
    'target-humidity': 'Humedad objetivo',
    humidity: 'Humedad',
    temperature: 'Temperatura',
    'tank-level': 'Nivel del depósito',
    'tank-full': 'Depósito lleno',
    'child-lock': 'Bloqueo infantil',
    ionizer: 'Ionizador',
    swing: 'Oscilación',
    pump: 'Bomba de desagüe',
    manual: 'Consigna',
    continuous: 'Continuo',
    auto: 'Automático',
    'clothes-dry': 'Secado de ropa',
    'shoes-dry': 'Secado de calzado',
    lowest: 'Muy baja',
    low: 'Baja',
    medium: 'Media',
    high: 'Alta',
  },
};

/** What the integration needs from a first state, saved with the unit. */
export function summarizeDehumidifier(state) {
  return state ? { known: true, pump: state.pumpEnabled === true } : null;
}

/**
 * The features of a dehumidifier: `{ key, category, type, ... }` without ids.
 * @param {object} record the hub record (caps)
 * @param {string} language
 */
export function dehumidifierFeatureSpecs(record, language) {
  const names = DH_NAMES[language];
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
  const select = (key, values) =>
    control(key, 'text', 'select', {
      min: 0,
      max: 0,
      supported_options: values.map(([value, label], index) => ({
        value,
        label,
        sort_order: index,
      })),
    });
  const specs = [
    control(DH_KEYS.POWER, 'switch', 'binary'),
    select(
      DH_KEYS.MODE,
      MODES.map(([value]) => [value, names[value]]),
    ),
    select(
      DH_KEYS.FAN_SPEED,
      FAN_SPEEDS.map(([value]) => [value, names[value]]),
    ),
    select(
      DH_KEYS.TARGET_HUMIDITY,
      HUMIDITY_STEPS.map((step) => [String(step), `${step} %`]),
    ),
    sensor(DH_KEYS.HUMIDITY, 'humidity-sensor', 'decimal', { unit: 'percent', min: 0, max: 100 }),
    sensor(DH_KEYS.TEMPERATURE, 'temperature-sensor', 'decimal', {
      unit: 'celsius',
      min: -20,
      max: 60,
    }),
    sensor(DH_KEYS.TANK_LEVEL, 'level-sensor', 'liquid-level-percent', {
      unit: 'percent',
      min: 0,
      max: 100,
    }),
    sensor(DH_KEYS.TANK_FULL, 'input', 'binary', { min: 0, max: 1 }),
    control(DH_KEYS.CHILD_LOCK, 'child-lock', 'binary'),
    control(DH_KEYS.IONIZER, 'switch', 'binary'),
    control(DH_KEYS.SWING, 'switch', 'binary'),
  ];
  if (record.caps?.pump) {
    specs.push(control(DH_KEYS.PUMP, 'switch', 'binary'));
  }
  return specs;
}

export const dehumidifierIds = (gladys, deviceId) =>
  gladys.externalIds(DEHUMIDIFIER_TYPE, String(deviceId));

/** The last 4 hex digits of the SSID ("net_a1_1A2B") tell twin units apart. */
export function dehumidifierName(record, language) {
  const suffix = /_([0-9A-Fa-f]{4})$/.exec(record.ssid ?? '')?.[1];
  const name = DH_NAMES[language].device;
  return suffix ? `${name} ${suffix.toUpperCase()}` : name;
}

/** The discovery payload of a dehumidifier. */
export function buildDehumidifier(gladys, record, language) {
  const ids = dehumidifierIds(gladys, record.id);
  return {
    name: dehumidifierName(record, language),
    external_id: ids.device,
    model: record.model ? `Midea ${record.model}` : 'Midea',
    // Same polling as the air conditioners (src/devices.js).
    should_poll: true,
    poll_frequency: DEVICE_POLL_FREQUENCIES.EVERY_MINUTES,
    params: [
      { name: 'IP_ADDRESS', value: record.host },
      { name: 'PROTOCOL', value: `V${record.version}` },
    ],
    features: dehumidifierFeatureSpecs(record, language).map(({ key, ...feature }) => ({
      ...feature,
      external_id: ids.feature(key),
    })),
  };
}

const nameOf = (table, code) => table.find(([, value]) => value === code)?.[0];
// A speed the table does not list (a unit's own percentage) shows as the
// nearest one.
const nearestFan = (speed) =>
  speed > 100
    ? 'auto'
    : FAN_SPEEDS.filter(([name]) => name !== 'auto').reduce((best, entry) =>
        Math.abs(entry[1] - speed) < Math.abs(best[1] - speed) ? entry : best,
      )[0];
// The select shows the step nearest the unit's setpoint.
const nearestHumidity = (value) =>
  String(
    HUMIDITY_STEPS.reduce((best, step) =>
      Math.abs(step - value) < Math.abs(best - value) ? step : best,
    ),
  );

/** The value of every feature from the last reading, by feature key. */
export function dehumidifierValues(record) {
  const state = record.state;
  if (!state) {
    return {};
  }
  const bool = (value) => (value ? 1 : 0);
  return {
    [DH_KEYS.POWER]: bool(state.power),
    [DH_KEYS.MODE]: nameOf(MODES, state.mode),
    [DH_KEYS.FAN_SPEED]: nameOf(FAN_SPEEDS, state.fanSpeed) ?? nearestFan(state.fanSpeed),
    [DH_KEYS.TARGET_HUMIDITY]: nearestHumidity(state.targetHumidity),
    [DH_KEYS.HUMIDITY]: state.humidity,
    [DH_KEYS.TEMPERATURE]: state.temperature,
    [DH_KEYS.TANK_LEVEL]: Math.min(100, state.tank),
    [DH_KEYS.TANK_FULL]: bool(state.tankFull),
    [DH_KEYS.CHILD_LOCK]: bool(state.childLock),
    [DH_KEYS.IONIZER]: bool(state.anion),
    [DH_KEYS.SWING]: bool(state.swing),
    [DH_KEYS.PUMP]: bool(state.pump),
  };
}

/**
 * The unit settings after a Gladys command, from the current ones.
 * @param {object} record
 * @param {string} key feature key
 * @param {number|string} value Gladys value (a string for the selects)
 * @returns {object} the new settings (setA1StateCommand input)
 * @throws on an unknown feature or a value the unit cannot take
 */
export function dehumidifierCommand(record, key, value) {
  const next = { ...record.state };
  const flag = () => {
    const number = Number(value);
    if (number !== 0 && number !== 1) {
      throw new Error(`Invalid value ${value} for ${key}`);
    }
    return number === 1;
  };
  switch (key) {
    case DH_KEYS.POWER:
      next.power = flag();
      break;
    case DH_KEYS.MODE: {
      const mode = MODES.find(([name]) => name === String(value))?.[1];
      if (mode === undefined) {
        throw new Error(`This dehumidifier has no mode ${value}`);
      }
      next.mode = mode;
      break;
    }
    case DH_KEYS.FAN_SPEED: {
      const speed = FAN_SPEEDS.find(([name]) => name === String(value))?.[1];
      if (speed === undefined) {
        throw new Error(`This dehumidifier has no fan speed ${value}`);
      }
      next.fanSpeed = speed;
      break;
    }
    case DH_KEYS.TARGET_HUMIDITY: {
      const target = Number(String(value).replace('%', '').trim());
      if (!Number.isFinite(target)) {
        throw new Error(`Invalid value ${value} for ${key}`);
      }
      next.targetHumidity = Math.min(85, Math.max(MIN_TARGET_HUMIDITY, Math.round(target)));
      break;
    }
    case DH_KEYS.CHILD_LOCK:
      next.childLock = flag();
      break;
    case DH_KEYS.IONIZER:
      next.anion = flag();
      break;
    case DH_KEYS.SWING:
      next.swing = flag();
      break;
    case DH_KEYS.PUMP:
      if (!record.caps?.pump) {
        throw new Error('This dehumidifier has no drain pump');
      }
      next.pump = flag();
      break;
    default:
      throw new Error(`The feature ${key} cannot be controlled`);
  }
  return next;
}
