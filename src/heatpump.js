// -----------------------------------------------------------------------------
// The Gladys device of a Midea air-to-water heat pump (appliance 0xC3): its
// features (from what the installation announces in its basic state), the
// values of its states, and the translation of a Gladys command into the
// unit's settings.
//
// Each heating zone is a thermostat: its mode carries the zone's on/off
// (THERMOSTAT_MODE.OFF), the unit's single operating mode otherwise. The
// domestic hot water is a water heater. The setpoints are kept within the
// limits the unit itself announces; the hot water boosters (tank heater,
// fast hot water, disinfection) are left to the unit and its controller.
//
// Feature keys are part of the external ids: never rename one.
// -----------------------------------------------------------------------------

import { DEVICE_POLL_FREQUENCIES } from '@gladysassistant/integration-sdk';
import { C3_MODE, SILENT_LEVEL, errorDisplay } from './midea/c3.js';

export const HEAT_PUMP_TYPE = 'heat-pump';

export const HP_KEYS = {
  ZONE1_MODE: 'zone1-mode',
  ZONE1_TARGET: 'zone1-target-temperature',
  ZONE1_STATE: 'zone1-operating-state',
  ZONE1_CURVE: 'zone1-curve',
  ZONE2_MODE: 'zone2-mode',
  ZONE2_TARGET: 'zone2-target-temperature',
  ZONE2_STATE: 'zone2-operating-state',
  ZONE2_CURVE: 'zone2-curve',
  DHW_POWER: 'dhw-power',
  DHW_TARGET: 'dhw-target-temperature',
  DHW_HEATING: 'dhw-heating',
  TANK_TEMPERATURE: 'tank-temperature',
  OUTDOOR_TEMPERATURE: 'outdoor-temperature',
  WATER_INLET: 'water-inlet-temperature',
  WATER_OUTLET: 'water-outlet-temperature',
  WATER_FLOW: 'water-flow',
  WATER_PRESSURE: 'water-pressure',
  ECO: 'eco',
  SILENT: 'silent',
  SUPER_SILENT: 'super-silent',
  COMPRESSOR: 'compressor',
  COMPRESSOR_RUN_TIME: 'compressor-run-time',
  DEFROST: 'defrost',
  BACKUP_HEATER: 'backup-heater',
  ERROR: 'error-code',
  POWER_DRAW: 'power-draw',
  ENERGY_INDEX: 'energy-index',
  HEAT_PRODUCED: 'heat-produced',
};

const ZONES = [
  {
    mode: HP_KEYS.ZONE1_MODE,
    target: HP_KEYS.ZONE1_TARGET,
    state: HP_KEYS.ZONE1_STATE,
    curve: HP_KEYS.ZONE1_CURVE,
    power: 'zone1Power',
    curveFlag: 'zone1Curve',
  },
  {
    mode: HP_KEYS.ZONE2_MODE,
    target: HP_KEYS.ZONE2_TARGET,
    state: HP_KEYS.ZONE2_STATE,
    curve: HP_KEYS.ZONE2_CURVE,
    power: 'zone2Power',
    curveFlag: 'zone2Curve',
  },
];

// Gladys' THERMOSTAT_OPERATING_STATE values.
export const OPERATING_STATE = { IDLE: 0, HEATING: 1, COOLING: 2 };

// Gladys' THERMOSTAT_MODE values (server/utils/constants.js).
export const THERMOSTAT_MODE = { OFF: 0, HEATING: 1, COOLING: 2, AUTO: 3 };

const MODE_TO_GLADYS = {
  [C3_MODE.HEAT]: THERMOSTAT_MODE.HEATING,
  [C3_MODE.COOL]: THERMOSTAT_MODE.COOLING,
  [C3_MODE.AUTO]: THERMOSTAT_MODE.AUTO,
};
const MODE_FROM_GLADYS = {
  [THERMOSTAT_MODE.HEATING]: C3_MODE.HEAT,
  [THERMOSTAT_MODE.COOLING]: C3_MODE.COOL,
  [THERMOSTAT_MODE.AUTO]: C3_MODE.AUTO,
};

// Names, one table per language. German says "du", Spanish "usted".
export const HP_NAMES = {
  en: {
    device: 'Heat pump',
    'zone1-operating-state': 'Zone 1 operation',
    'zone1-curve': 'Zone 1 weather curve',
    'zone2-operating-state': 'Zone 2 operation',
    'zone2-curve': 'Zone 2 weather curve',
    'dhw-heating': 'Hot water heating',
    'water-flow': 'Water flow',
    'water-pressure': 'Water pressure',
    'super-silent': 'Super silent mode',
    compressor: 'Compressor',
    'compressor-run-time': 'Compressor run time',
    defrost: 'Defrosting',
    'backup-heater': 'Backup electric heater',
    'error-code': 'Error code',
    'heat-produced': 'Heat produced (kWh)',
    'no-error': 'No error',
    'zone1-mode': 'Zone 1 mode',
    'zone1-target-temperature': 'Zone 1 setpoint',
    'zone2-mode': 'Zone 2 mode',
    'zone2-target-temperature': 'Zone 2 setpoint',
    'dhw-power': 'Hot water',
    'dhw-target-temperature': 'Hot water setpoint',
    'tank-temperature': 'Hot water tank temperature',
    'outdoor-temperature': 'Outdoor temperature',
    'water-inlet-temperature': 'Water inlet temperature',
    'water-outlet-temperature': 'Water outlet temperature',
    eco: 'Eco mode',
    silent: 'Silent mode',
    'power-draw': 'Power draw',
    'energy-index': 'Energy consumed',
    'mode-off': 'Off',
    'mode-heating': 'Heat',
    'mode-cooling': 'Cool',
    'mode-auto': 'Auto',
  },
  fr: {
    device: 'Pompe à chaleur',
    'zone1-operating-state': 'Fonctionnement zone 1',
    'zone1-curve': "Loi d'eau zone 1",
    'zone2-operating-state': 'Fonctionnement zone 2',
    'zone2-curve': "Loi d'eau zone 2",
    'dhw-heating': "Chauffe de l'eau chaude",
    'water-flow': "Débit d'eau",
    'water-pressure': "Pression d'eau",
    'super-silent': 'Mode super silencieux',
    compressor: 'Compresseur',
    'compressor-run-time': 'Heures du compresseur',
    defrost: 'Dégivrage',
    'backup-heater': 'Appoint électrique',
    'error-code': 'Code erreur',
    'heat-produced': 'Chaleur produite (kWh)',
    'no-error': 'Aucune erreur',
    'zone1-mode': 'Mode zone 1',
    'zone1-target-temperature': 'Consigne zone 1',
    'zone2-mode': 'Mode zone 2',
    'zone2-target-temperature': 'Consigne zone 2',
    'dhw-power': 'Eau chaude',
    'dhw-target-temperature': "Consigne d'eau chaude",
    'tank-temperature': 'Température du ballon',
    'outdoor-temperature': 'Température extérieure',
    'water-inlet-temperature': "Température d'entrée d'eau",
    'water-outlet-temperature': "Température de sortie d'eau",
    eco: 'Mode éco',
    silent: 'Mode silencieux',
    'power-draw': 'Puissance consommée',
    'energy-index': 'Énergie consommée',
    'mode-off': 'Arrêt',
    'mode-heating': 'Chaud',
    'mode-cooling': 'Froid',
    'mode-auto': 'Auto',
  },
  de: {
    device: 'Wärmepumpe',
    'zone1-operating-state': 'Betrieb Zone 1',
    'zone1-curve': 'Heizkurve Zone 1',
    'zone2-operating-state': 'Betrieb Zone 2',
    'zone2-curve': 'Heizkurve Zone 2',
    'dhw-heating': 'Warmwasserbereitung',
    'water-flow': 'Wasserdurchfluss',
    'water-pressure': 'Wasserdruck',
    'super-silent': 'Extra leiser Modus',
    compressor: 'Verdichter',
    'compressor-run-time': 'Verdichter-Betriebsstunden',
    defrost: 'Abtauen',
    'backup-heater': 'Elektrischer Zuheizer',
    'error-code': 'Fehlercode',
    'heat-produced': 'Erzeugte Wärme (kWh)',
    'no-error': 'Kein Fehler',
    'zone1-mode': 'Modus Zone 1',
    'zone1-target-temperature': 'Sollwert Zone 1',
    'zone2-mode': 'Modus Zone 2',
    'zone2-target-temperature': 'Sollwert Zone 2',
    'dhw-power': 'Warmwasser',
    'dhw-target-temperature': 'Warmwasser-Sollwert',
    'tank-temperature': 'Speichertemperatur',
    'outdoor-temperature': 'Außentemperatur',
    'water-inlet-temperature': 'Wassereintrittstemperatur',
    'water-outlet-temperature': 'Wasseraustrittstemperatur',
    eco: 'Eco-Modus',
    silent: 'Leiser Modus',
    'power-draw': 'Leistungsaufnahme',
    'energy-index': 'Verbrauchte Energie',
    'mode-off': 'Aus',
    'mode-heating': 'Heizen',
    'mode-cooling': 'Kühlen',
    'mode-auto': 'Automatisch',
  },
  es: {
    device: 'Bomba de calor',
    'zone1-operating-state': 'Funcionamiento zona 1',
    'zone1-curve': 'Curva climática zona 1',
    'zone2-operating-state': 'Funcionamiento zona 2',
    'zone2-curve': 'Curva climática zona 2',
    'dhw-heating': 'Calentamiento del agua',
    'water-flow': 'Caudal de agua',
    'water-pressure': 'Presión del agua',
    'super-silent': 'Modo súper silencioso',
    compressor: 'Compresor',
    'compressor-run-time': 'Horas del compresor',
    defrost: 'Desescarche',
    'backup-heater': 'Apoyo eléctrico',
    'error-code': 'Código de error',
    'heat-produced': 'Calor producido (kWh)',
    'no-error': 'Sin errores',
    'zone1-mode': 'Modo zona 1',
    'zone1-target-temperature': 'Consigna zona 1',
    'zone2-mode': 'Modo zona 2',
    'zone2-target-temperature': 'Consigna zona 2',
    'dhw-power': 'Agua caliente',
    'dhw-target-temperature': 'Consigna de agua caliente',
    'tank-temperature': 'Temperatura del depósito',
    'outdoor-temperature': 'Temperatura exterior',
    'water-inlet-temperature': 'Temperatura de entrada de agua',
    'water-outlet-temperature': 'Temperatura de salida de agua',
    eco: 'Modo eco',
    silent: 'Modo silencioso',
    'power-draw': 'Potencia consumida',
    'energy-index': 'Energía consumida',
    'mode-off': 'Apagado',
    'mode-heating': 'Calor',
    'mode-cooling': 'Frío',
    'mode-auto': 'Automático',
  },
};

const MODE_NAME = {
  [THERMOSTAT_MODE.OFF]: 'mode-off',
  [THERMOSTAT_MODE.HEATING]: 'mode-heating',
  [THERMOSTAT_MODE.COOLING]: 'mode-cooling',
  [THERMOSTAT_MODE.AUTO]: 'mode-auto',
};

/** A [min, max] range the unit announced, or null when it makes no sense. */
const range = (min, max) => (min > 0 && max >= min ? { min, max } : null);
const union = (ranges) => {
  const valid = ranges.filter(Boolean);
  return valid.length === 0
    ? null
    : {
        min: Math.min(...valid.map((item) => item.min)),
        max: Math.max(...valid.map((item) => item.max)),
      };
};

/**
 * What the integration needs from a basic state: the installation (zones,
 * hot water, heating and cooling) and the setpoint limits. Saved, so the
 * features stay the same until the unit says otherwise.
 * @param {object|null} basic parseBasic()
 * @param {object} [extra]
 * @param {boolean} [extra.unit] the unit answers the parameters query
 * @param {boolean} [extra.silenceLevel] the unit answers the silence query
 */
export function summarizeHeatPump(basic, { unit = false, silenceLevel = false } = {}) {
  if (!basic) {
    return null;
  }
  const heat = basic.heat || (!basic.heat && !basic.cool);
  const cool = basic.cool;
  const zones = [0, 1].map((zone) => {
    const water = basic.zoneWaterTemperature[zone];
    const limits = water
      ? union([
          heat ? range(basic.zoneHeating[zone].min, basic.zoneHeating[zone].max) : null,
          cool ? range(basic.zoneCooling[zone].min, basic.zoneCooling[zone].max) : null,
        ])
      : range(basic.room.min, basic.room.max);
    return {
      water,
      step: water ? 1 : 0.5,
      min: limits?.min ?? (water ? 20 : 5),
      max: limits?.max ?? (water ? 60 : 30),
    };
  });
  return {
    known: true,
    heat,
    cool,
    dhw: basic.dhw,
    doubleZone: basic.doubleZone,
    zones,
    dhwMin: range(basic.dhwRange.min, basic.dhwRange.max)?.min ?? 20,
    dhwMax: range(basic.dhwRange.min, basic.dhwRange.max)?.max ?? 60,
    unit,
    silenceLevel,
  };
}

/** The Gladys modes of a zone, in display order. */
export function heatPumpModes(caps) {
  const modes = [THERMOSTAT_MODE.OFF];
  if (caps.heat) modes.push(THERMOSTAT_MODE.HEATING);
  if (caps.cool) modes.push(THERMOSTAT_MODE.COOLING);
  if (caps.heat && caps.cool) modes.push(THERMOSTAT_MODE.AUTO);
  return modes;
}

/**
 * The features of a heat pump: `{ key, category, type, ... }` without ids.
 * @param {object} record the hub record (caps, hasEnergy, hasRunTime)
 * @param {string} language
 */
export function heatPumpFeatureSpecs(record, language) {
  const names = HP_NAMES[language];
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
  const temperatureSensor = (key) =>
    sensor(key, 'temperature-sensor', 'decimal', { unit: 'celsius', min: -40, max: 100 });
  const modeOptions = heatPumpModes(caps).map((value, index) => ({
    value,
    label: names[MODE_NAME[value]],
    sort_order: index,
  }));
  const flag = (key) => sensor(key, 'input', 'binary', { min: 0, max: 1 });
  const specs = [];
  ZONES.slice(0, caps.doubleZone ? 2 : 1).forEach((zone, index) => {
    const limits = caps.zones[index];
    specs.push(
      control(zone.mode, 'thermostat', 'mode', { max: 3, supported_options: modeOptions }),
      control(zone.target, 'thermostat', 'target-temperature', {
        unit: 'celsius',
        min: limits.min,
        max: limits.max,
        step: limits.step,
      }),
    );
    if (caps.unit) {
      specs.push(sensor(zone.state, 'thermostat', 'operating-state', { min: 0, max: 2 }));
    }
    specs.push(control(zone.curve, 'switch', 'binary'));
  });
  if (caps.dhw) {
    specs.push(
      control(HP_KEYS.DHW_POWER, 'water-heater', 'binary'),
      control(HP_KEYS.DHW_TARGET, 'water-heater', 'target-temperature', {
        unit: 'celsius',
        min: caps.dhwMin,
        max: caps.dhwMax,
        step: 1,
      }),
      temperatureSensor(HP_KEYS.TANK_TEMPERATURE),
    );
    if (caps.unit) {
      specs.push(sensor(HP_KEYS.DHW_HEATING, 'water-heater', 'heating', { min: 0, max: 1 }));
    }
  }
  if (caps.unit) {
    specs.push(
      temperatureSensor(HP_KEYS.OUTDOOR_TEMPERATURE),
      temperatureSensor(HP_KEYS.WATER_INLET),
      temperatureSensor(HP_KEYS.WATER_OUTLET),
      // The flow of the heating loop: Gladys has no other flow type than the
      // water valve's.
      sensor(HP_KEYS.WATER_FLOW, 'water-valve', 'flow', {
        unit: 'cubic-meter-per-hour',
        min: 0,
        max: 100,
      }),
      sensor(HP_KEYS.WATER_PRESSURE, 'pressure-sensor', 'integer', {
        unit: 'kPa',
        min: 0,
        max: 1000,
      }),
    );
  }
  specs.push(control(HP_KEYS.ECO, 'switch', 'binary'), control(HP_KEYS.SILENT, 'switch', 'binary'));
  if (caps.silenceLevel) {
    specs.push(control(HP_KEYS.SUPER_SILENT, 'switch', 'binary'));
  }
  if (caps.unit) {
    specs.push(flag(HP_KEYS.COMPRESSOR), flag(HP_KEYS.DEFROST), flag(HP_KEYS.BACKUP_HEATER));
  }
  if (record.hasRunTime) {
    specs.push(
      sensor(HP_KEYS.COMPRESSOR_RUN_TIME, 'duration', 'integer', {
        unit: 'hours',
        min: 0,
        max: 1000000,
      }),
    );
  }
  // A text: the code the controller shows (E8, P1...), as the manual lists it.
  specs.push(sensor(HP_KEYS.ERROR, 'text', 'text', { min: 0, max: 0 }));
  if (caps.unit) {
    specs.push(
      sensor(HP_KEYS.POWER_DRAW, 'energy-sensor', 'power', { unit: 'watt', min: 0, max: 30000 }),
    );
  }
  if (record.hasEnergy) {
    specs.push(
      sensor(HP_KEYS.ENERGY_INDEX, 'energy-sensor', 'index', {
        unit: 'kilowatt-hour',
        min: 0,
        max: 10000000,
      }),
      // A plain counter: as an energy index, Gladys would count this heat as
      // electricity in its energy views. The unit is in the name.
      sensor(HP_KEYS.HEAT_PRODUCED, 'counter-sensor', 'integer', { min: 0, max: 10000000 }),
    );
  }
  return specs;
}

export const heatPumpIds = (gladys, deviceId) =>
  gladys.externalIds(HEAT_PUMP_TYPE, String(deviceId));

/** The last 4 hex digits of the SSID ("net_c3_0003") tell twin units apart. */
export function heatPumpName(record, language) {
  const suffix = /_([0-9A-Fa-f]{4})$/.exec(record.ssid ?? '')?.[1];
  const name = HP_NAMES[language].device;
  return suffix ? `${name} ${suffix.toUpperCase()}` : name;
}

/** The discovery payload of a heat pump. */
export function buildHeatPump(gladys, record, language) {
  const ids = heatPumpIds(gladys, record.id);
  return {
    name: heatPumpName(record, language),
    external_id: ids.device,
    model: record.model ? `Midea ${record.model}` : 'Midea',
    // Same polling as the air conditioners (src/devices.js).
    should_poll: true,
    poll_frequency: DEVICE_POLL_FREQUENCIES.EVERY_MINUTES,
    params: [
      { name: 'IP_ADDRESS', value: record.host },
      { name: 'PROTOCOL', value: `V${record.version}` },
    ],
    features: heatPumpFeatureSpecs(record, language).map(({ key, ...feature }) => ({
      ...feature,
      external_id: ids.feature(key),
    })),
  };
}

/** The Gladys mode of a zone. */
export function zoneMode(state, zone) {
  if (!state[ZONES[zone].power]) {
    return THERMOSTAT_MODE.OFF;
  }
  return MODE_TO_GLADYS[state.mode] ?? null;
}

/** The setpoint of a zone: its water temperature, or the room temperature. */
export const zoneTarget = (record, state, zone) =>
  record.caps.zones[zone].water ? state.zoneTargets[zone] : state.roomTarget;

/** The operating state of a zone: idle when it is off or the unit runs elsewhere. */
function zoneOperatingState(record, state, zone) {
  if (!state[ZONES[zone].power]) {
    return OPERATING_STATE.IDLE;
  }
  const running = record.unit ?? record.energy;
  if (running?.heating) return OPERATING_STATE.HEATING;
  if (running?.cooling) return OPERATING_STATE.COOLING;
  return OPERATING_STATE.IDLE;
}

/** The value of every feature from the last readings, by feature key. */
export function heatPumpValues(record, language = 'en') {
  const state = record.state;
  if (!state) {
    return {};
  }
  const bool = (value) => (value ? 1 : 0);
  const known = (value) => (value === undefined || value === null ? undefined : value);
  const unit = record.unit;
  const silentLevel = record.silentLevel ?? (state.silent ? SILENT_LEVEL.SILENT : SILENT_LEVEL.OFF);
  const values = {
    [HP_KEYS.DHW_HEATING]: unit ? bool(unit.heatingWater) : undefined,
    [HP_KEYS.WATER_FLOW]: known(unit?.waterFlow),
    [HP_KEYS.WATER_PRESSURE]: known(unit?.waterPressure),
    [HP_KEYS.SUPER_SILENT]: bool(state.silent && silentLevel === SILENT_LEVEL.SUPER_SILENT),
    [HP_KEYS.COMPRESSOR]: unit ? bool(unit.compressorFrequency > 0) : undefined,
    [HP_KEYS.COMPRESSOR_RUN_TIME]: known(unit?.compressorRunTime),
    [HP_KEYS.DEFROST]: unit ? bool(unit.defrost) : undefined,
    [HP_KEYS.BACKUP_HEATER]: unit
      ? bool(unit.backupHeater || record.energy?.backupHeater)
      : undefined,
    [HP_KEYS.ERROR]: errorDisplay(state.errorCode) ?? HP_NAMES[language]['no-error'],
    [HP_KEYS.HEAT_PRODUCED]: known(record.energy?.producedEnergy),
    [HP_KEYS.DHW_POWER]: bool(state.dhwPower),
    [HP_KEYS.DHW_TARGET]: state.dhwTarget,
    [HP_KEYS.TANK_TEMPERATURE]: state.tankTemperature,
    [HP_KEYS.OUTDOOR_TEMPERATURE]: unit?.outdoorTemperature ?? undefined,
    [HP_KEYS.WATER_INLET]: unit?.waterInletTemperature ?? undefined,
    [HP_KEYS.WATER_OUTLET]: unit?.waterOutletTemperature ?? undefined,
    [HP_KEYS.ECO]: bool(state.eco),
    [HP_KEYS.SILENT]: bool(state.silent),
    [HP_KEYS.POWER_DRAW]: unit?.power ?? undefined,
    [HP_KEYS.ENERGY_INDEX]: record.energy?.totalEnergy ?? undefined,
  };
  ZONES.forEach((zone, index) => {
    values[zone.mode] = zoneMode(state, index) ?? undefined;
    values[zone.target] = zoneTarget(record, state, index);
    values[zone.state] = unit ? zoneOperatingState(record, state, index) : undefined;
    values[zone.curve] = bool(state[zone.curveFlag]);
  });
  return values;
}

const clamp = (value, min, max, step) =>
  Math.min(max, Math.max(min, Math.round(value / step) * step));

/** The setpoint limits of a zone in the current mode (the unit's own). */
function zoneLimits(record, state, zone) {
  const caps = record.caps.zones[zone];
  if (!caps.water) {
    return caps;
  }
  const own = state.mode === C3_MODE.COOL ? state.zoneCooling?.[zone] : state.zoneHeating?.[zone];
  return own && own.min > 0 && own.max >= own.min ? { ...caps, ...own } : caps;
}

/**
 * The unit command after a Gladys command, from the current state.
 * @param {object} record
 * @param {string} key feature key
 * @param {number} value Gladys value
 * @returns {{ basic: object } | { eco: boolean } | { silentLevel: number }}
 * @throws on an unknown feature or a value the unit cannot take
 */
export function heatPumpCommand(record, key, value) {
  const next = {
    ...record.state,
    zoneTargets: [...record.state.zoneTargets],
  };
  const number = Number(value);
  if (!Number.isFinite(number)) {
    throw new Error(`Invalid value ${value} for ${key}`);
  }
  const zone = ZONES.findIndex(
    (item) => item.mode === key || item.target === key || item.curve === key,
  );
  if (zone === 1 && !record.caps.doubleZone) {
    throw new Error('This heat pump has a single zone');
  }
  if (zone >= 0 && ZONES[zone].mode === key) {
    if (!heatPumpModes(record.caps).includes(number)) {
      throw new Error(`This heat pump has no mode ${value}`);
    }
    next[ZONES[zone].power] = number !== THERMOSTAT_MODE.OFF;
    if (number !== THERMOSTAT_MODE.OFF) {
      next.mode = MODE_FROM_GLADYS[number];
    }
    return { basic: next };
  }
  if (zone >= 0 && ZONES[zone].curve === key) {
    next[ZONES[zone].curveFlag] = number === 1;
    return { basic: next };
  }
  if (zone >= 0) {
    const limits = zoneLimits(record, next, zone);
    const target = clamp(number, limits.min, limits.max, record.caps.zones[zone].step);
    if (record.caps.zones[zone].water) {
      next.zoneTargets[zone] = target;
    } else {
      next.roomTarget = target;
    }
    return { basic: next };
  }
  switch (key) {
    case HP_KEYS.DHW_POWER:
    case HP_KEYS.DHW_TARGET:
      if (!record.caps.dhw) {
        throw new Error('This heat pump has no hot water');
      }
      if (key === HP_KEYS.DHW_POWER) {
        next.dhwPower = number === 1;
      } else {
        next.dhwTarget = clamp(number, record.caps.dhwMin, record.caps.dhwMax, 1);
      }
      return { basic: next };
    case HP_KEYS.ECO:
      return { eco: number === 1 };
    case HP_KEYS.SILENT:
    case HP_KEYS.SUPER_SILENT: {
      const current =
        record.silentLevel ?? (record.state.silent ? SILENT_LEVEL.SILENT : SILENT_LEVEL.OFF);
      let level;
      if (key === HP_KEYS.SILENT) {
        // Switching silent mode on keeps super silent if it was chosen.
        level = number !== 1 ? SILENT_LEVEL.OFF : Math.max(current, SILENT_LEVEL.SILENT);
      } else {
        // Leaving super silent falls back to plain silent mode.
        level = number === 1 ? SILENT_LEVEL.SUPER_SILENT : Math.min(current, SILENT_LEVEL.SILENT);
      }
      return { silentLevel: level };
    }
    default:
      throw new Error(`The feature ${key} cannot be controlled`);
  }
}
