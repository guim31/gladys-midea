// -----------------------------------------------------------------------------
// The heat pump view of the `climate` widget (src/widgets.js picks the view
// from the kind of the unit).
//
// What it adds to the Gladys device box: zone 1's setpoint, the tank and the
// outdoor temperatures side by side; what runs right now (each zone, the hot
// water, the compressor, defrosting, backup heater), the power draw and the
// efficiency since the counters started (COP); one-tap buttons for zone 1
// (on/off, setpoint down/up) and a form for the rest (mode, hot water, eco;
// silent mode when there is room).
//
// Budget (8 components): three tiles, one status list, four buttons. No
// button style marks a state: `primary` is invisible in dark mode (#3153).
// -----------------------------------------------------------------------------

import { WIDGET_COLORS } from '@gladysassistant/integration-sdk';
import { errorDisplay } from './midea/c3.js';
import {
  HP_KEYS,
  HP_NAMES,
  OPERATING_STATE,
  THERMOSTAT_MODE,
  heatPumpIds,
  heatPumpModes,
  heatPumpValues,
  zoneMode,
} from './heatpump.js';

export const HP_ACTIONS = {
  ZONE_POWER: 'zone_power',
  DOWN: 'setpoint_down',
  UP: 'setpoint_up',
  SETTINGS: 'settings',
};

export const HP_TEXT = {
  setpoint: { en: 'Setpoint', fr: 'Consigne', de: 'Sollwert', es: 'Consigna' },
  tank: { en: 'Tank', fr: 'Ballon', de: 'Speicher', es: 'Depósito' },
  outdoor: { en: 'Outdoor', fr: 'Extérieur', de: 'Außen', es: 'Exterior' },
  outlet: { en: 'Water out', fr: 'Départ eau', de: 'Vorlauf', es: 'Salida agua' },
  zone: { en: 'Zone', fr: 'Zone', de: 'Zone', es: 'Zona' },
  hotWater: { en: 'Hot water', fr: 'Eau chaude', de: 'Warmwasser', es: 'Agua caliente' },
  compressor: { en: 'Compressor', fr: 'Compresseur', de: 'Verdichter', es: 'Compresor' },
  power: { en: 'Power draw', fr: 'Puissance', de: 'Leistung', es: 'Potencia' },
  cop: { en: 'COP (total)', fr: 'COP (total)', de: 'COP (gesamt)', es: 'COP (total)' },
  error: { en: 'Error code', fr: 'Code erreur', de: 'Fehlercode', es: 'Código de error' },
  on: { en: 'On', fr: 'Marche', de: 'Ein', es: 'Encendido' },
  off: { en: 'Off', fr: 'Arrêt', de: 'Aus', es: 'Apagado' },
  idle: { en: 'idle', fr: 'repos', de: 'Ruhe', es: 'reposo' },
  heating: { en: 'heating', fr: 'chauffe', de: 'heizt', es: 'calentando' },
  cooling: { en: 'cooling', fr: 'froid', de: 'kühlt', es: 'enfriando' },
  defrost: { en: 'Defrosting', fr: 'Dégivrage', de: 'Abtauen', es: 'Desescarche' },
  backup: { en: 'backup heater', fr: 'appoint', de: 'Zuheizer', es: 'apoyo' },
  unreachable: {
    en: 'not answering',
    fr: 'ne répond pas',
    de: 'antwortet nicht',
    es: 'no responde',
  },
  turnOn: { en: 'Zone 1 on', fr: 'Allumer zone 1', de: 'Zone 1 ein', es: 'Encender zona 1' },
  turnOff: { en: 'Zone 1 off', fr: 'Éteindre zone 1', de: 'Zone 1 aus', es: 'Apagar zona 1' },
  settings: { en: 'Settings', fr: 'Réglages', de: 'Einstellungen', es: 'Ajustes' },
  zoneOn: { en: 'Zone 1 on', fr: 'Zone 1 allumée', de: 'Zone 1 ein', es: 'Zona 1 encendida' },
  zoneOff: { en: 'Zone 1 off', fr: 'Zone 1 éteinte', de: 'Zone 1 aus', es: 'Zona 1 apagada' },
  setpointSet: { en: 'Setpoint: ', fr: 'Consigne : ', de: 'Sollwert: ', es: 'Consigna: ' },
  applied: {
    en: 'Settings applied',
    fr: 'Réglages appliqués',
    de: 'Einstellungen übernommen',
    es: 'Ajustes aplicados',
  },
};

const LANGUAGES = Object.keys(HP_NAMES);
const t = (text, language) => text[language] ?? text.en;
// A form field label must be a multi-language object (the core's rule).
const everyLanguage = (render) =>
  Object.fromEntries(LANGUAGES.map((language) => [language, render(language)]));
const MODE_NAME = {
  [THERMOSTAT_MODE.OFF]: 'mode-off',
  [THERMOSTAT_MODE.HEATING]: 'mode-heating',
  [THERMOSTAT_MODE.COOLING]: 'mode-cooling',
  [THERMOSTAT_MODE.AUTO]: 'mode-auto',
};
const modeName = (mode, language) => HP_NAMES[language][MODE_NAME[mode]] ?? '-';
const decimal = (value, digits, language) => {
  const text = value.toFixed(digits);
  return language === 'en' ? text : text.replace('.', ',');
};

/** "45 °C" written the way the language writes decimals. */
export const formatDegrees = (value, language) =>
  `${language === 'en' ? String(value) : String(value).replace('.', ',')} °C`;

/** The efficiency since the counters started: heat produced over electricity used. */
export function seasonalCop(energy) {
  const used = energy?.totalEnergy;
  const produced = energy?.producedEnergy;
  return used > 0 && produced > 0 ? produced / used : null;
}

/** The status rows of a heat pump, in the widget's language. */
function statusItems(record, lang) {
  const { caps, state, unit } = record;
  const values = heatPumpValues(record, lang);
  const items = [];
  if (record.reachable !== true) {
    items.push({
      label: 'Midea',
      icon: 'wifi-off',
      value: `${record.host} · ${t(HP_TEXT.unreachable, lang)}`,
      color: WIDGET_COLORS.WARNING,
    });
  }
  const running = {
    [OPERATING_STATE.IDLE]: HP_TEXT.idle,
    [OPERATING_STATE.HEATING]: HP_TEXT.heating,
    [OPERATING_STATE.COOLING]: HP_TEXT.cooling,
  };
  [HP_KEYS.ZONE1_STATE, HP_KEYS.ZONE2_STATE]
    .slice(0, caps.doubleZone ? 2 : 1)
    .forEach((key, zone) => {
      const mode = zoneMode(state, zone);
      const operation = values[key];
      const active = operation === OPERATING_STATE.HEATING || operation === OPERATING_STATE.COOLING;
      items.push({
        label: `${t(HP_TEXT.zone, lang)} ${zone + 1}`,
        icon: 'thermometer',
        value:
          operation === undefined || mode === THERMOSTAT_MODE.OFF
            ? modeName(mode, lang)
            : `${modeName(mode, lang)} · ${t(running[operation], lang)}`,
        color: active ? WIDGET_COLORS.SUCCESS : WIDGET_COLORS.NEUTRAL,
      });
    });
  if (caps.dhw) {
    const heating = values[HP_KEYS.DHW_HEATING] === 1;
    items.push({
      label: t(HP_TEXT.hotWater, lang),
      icon: 'droplet',
      value: state.dhwPower
        ? `${t(HP_TEXT.on, lang)} · ${formatDegrees(state.dhwTarget, lang)}${heating ? ` · ${t(HP_TEXT.heating, lang)}` : ''}`
        : t(HP_TEXT.off, lang),
      color: heating ? WIDGET_COLORS.SUCCESS : WIDGET_COLORS.NEUTRAL,
    });
  }
  if (unit) {
    const parts = [
      unit.defrost
        ? t(HP_TEXT.defrost, lang)
        : t(unit.compressorFrequency > 0 ? HP_TEXT.on : HP_TEXT.off, lang),
    ];
    if (unit.backupHeater) {
      parts.push(t(HP_TEXT.backup, lang));
    }
    items.push({
      label: t(HP_TEXT.compressor, lang),
      icon: 'activity',
      value: parts.join(' · '),
      color: unit.defrost || unit.backupHeater ? WIDGET_COLORS.WARNING : WIDGET_COLORS.NEUTRAL,
    });
    if (typeof unit.power === 'number') {
      items.push({
        label: t(HP_TEXT.power, lang),
        icon: 'zap',
        value: `${unit.power} W`,
        color: WIDGET_COLORS.NEUTRAL,
      });
    }
  }
  const cop = seasonalCop(record.energy);
  if (cop !== null) {
    items.push({
      label: t(HP_TEXT.cop, lang),
      icon: 'trending-up',
      value: decimal(cop, 2, lang),
      color: WIDGET_COLORS.NEUTRAL,
    });
  }
  if (state.errorCode) {
    items.push({
      label: t(HP_TEXT.error, lang),
      icon: 'alert-triangle',
      value: errorDisplay(state.errorCode),
      color: WIDGET_COLORS.DANGER,
    });
  }
  return items;
}

/** The content of the widget for a heat pump. */
export function heatPumpContent(hub, record, language) {
  const lang = HP_NAMES[language] ? language : 'en';
  const { caps, state } = record;
  const ids = heatPumpIds(hub.gladys, record.id);
  const tile = (key, label, icon) => ({
    type: 'value',
    device_feature: ids.feature(key),
    label: t(label, lang),
    icon,
  });
  const components = [tile(HP_KEYS.ZONE1_TARGET, HP_TEXT.setpoint, 'target')];
  // Three tiles at most: with the status and the four buttons, the 8 of the budget.
  if (caps.dhw) {
    components.push(tile(HP_KEYS.TANK_TEMPERATURE, HP_TEXT.tank, 'droplet'));
  }
  if (caps.unit) {
    components.push(tile(HP_KEYS.OUTDOOR_TEMPERATURE, HP_TEXT.outdoor, 'cloud'));
  }
  if (caps.unit && components.length < 3) {
    components.push(tile(HP_KEYS.WATER_OUTLET, HP_TEXT.outlet, 'thermometer'));
  }
  if (state) {
    components.push({ type: 'status', items: statusItems(record, lang) });
  }

  const on = state ? state.zone1Power === true : false;
  const step = caps.zones[0].step;
  const stepText = lang === 'en' ? String(step) : String(step).replace('.', ',');
  const fields = [
    {
      key: 'mode',
      type: 'select',
      required: true,
      label: everyLanguage((language) => HP_NAMES[language]['zone1-mode']),
      default: String(state ? (zoneMode(state, 0) ?? THERMOSTAT_MODE.OFF) : THERMOSTAT_MODE.OFF),
      options: heatPumpModes(caps).map((value) => ({
        value: String(value),
        label: everyLanguage((language) => modeName(value, language)),
      })),
    },
  ];
  if (caps.dhw) {
    fields.push(
      {
        key: 'dhw',
        type: 'boolean',
        label: everyLanguage((language) => HP_NAMES[language]['dhw-power']),
        default: state?.dhwPower === true,
      },
      {
        key: 'dhw_target',
        type: 'number',
        label: everyLanguage((language) => HP_NAMES[language]['dhw-target-temperature']),
        min: caps.dhwMin,
        max: caps.dhwMax,
        ...(state ? { default: state.dhwTarget } : {}),
      },
    );
  }
  fields.push({
    key: 'eco',
    type: 'boolean',
    label: everyLanguage((language) => HP_NAMES[language].eco),
    default: state?.eco === true,
  });
  // The core takes four fields at most: silent mode joins the form only
  // without hot water, and stays on the device box anyway.
  if (fields.length < 4) {
    fields.push({
      key: 'silent',
      type: 'boolean',
      label: everyLanguage((language) => HP_NAMES[language].silent),
      default: state?.silent === true,
    });
  }
  components.push(
    {
      type: 'button',
      label: t(on ? HP_TEXT.turnOff : HP_TEXT.turnOn, lang),
      icon: 'power',
      style: 'secondary',
      // The tap toggles the state the unit has then, not the one shown.
      action: { key: HP_ACTIONS.ZONE_POWER },
    },
    {
      type: 'button',
      label: `−${stepText} °C`,
      icon: 'minus',
      style: 'secondary',
      action: { key: HP_ACTIONS.DOWN },
    },
    {
      type: 'button',
      label: `+${stepText} °C`,
      icon: 'plus',
      style: 'secondary',
      action: { key: HP_ACTIONS.UP },
    },
    {
      type: 'button',
      label: t(HP_TEXT.settings, lang),
      icon: 'sliders',
      style: 'secondary',
      action: { key: HP_ACTIONS.SETTINGS, fields },
    },
  );
  return { ttl_seconds: 60, components };
}

const given = (value) => value !== undefined && value !== null && value !== '';
const flag = (value) => (value === true || value === 'true' || value === 1 ? 1 : 0);

/** A tap on one of the heat pump buttons. */
export async function heatPumpAction(hub, record, { actionKey, values, device }) {
  const state = await hub.currentState(record);
  if (actionKey === HP_ACTIONS.ZONE_POWER) {
    const on = state.zone1Power !== true;
    // Switching on takes the unit's current operating mode, heating if it has none.
    const mode = zoneMode({ ...state, zone1Power: true }, 0) ?? THERMOSTAT_MODE.HEATING;
    await hub.applyHeatPumpSettings(device, [
      [HP_KEYS.ZONE1_MODE, on ? mode : THERMOSTAT_MODE.OFF],
    ]);
    return { message: on ? HP_TEXT.zoneOn : HP_TEXT.zoneOff };
  }
  if (actionKey === HP_ACTIONS.DOWN || actionKey === HP_ACTIONS.UP) {
    const step = record.caps.zones[0].step;
    const current = record.caps.zones[0].water ? state.zoneTargets[0] : state.roomTarget;
    await hub.applyHeatPumpSettings(device, [
      [HP_KEYS.ZONE1_TARGET, current + (actionKey === HP_ACTIONS.UP ? step : -step)],
    ]);
    const target = record.caps.zones[0].water
      ? record.state.zoneTargets[0]
      : record.state.roomTarget;
    return {
      message: Object.fromEntries(
        Object.entries(HP_TEXT.setpointSet).map(([language, prefix]) => [
          language,
          `${prefix}${formatDegrees(target, language)}`,
        ]),
      ),
    };
  }
  if (actionKey === HP_ACTIONS.SETTINGS) {
    if (!values || values.mode === undefined) {
      // A core older than 5.2 drops the form and relays the tap without values.
      throw new Error('This action needs Gladys 5.2 or later');
    }
    const changes = [[HP_KEYS.ZONE1_MODE, Number(values.mode)]];
    if (record.caps.dhw && given(values.dhw)) {
      changes.push([HP_KEYS.DHW_POWER, flag(values.dhw)]);
    }
    if (record.caps.dhw && given(values.dhw_target)) {
      changes.push([HP_KEYS.DHW_TARGET, Number(values.dhw_target)]);
    }
    if (given(values.eco) && flag(values.eco) !== flag(state.eco)) {
      changes.push([HP_KEYS.ECO, flag(values.eco)]);
    }
    if (given(values.silent) && flag(values.silent) !== flag(state.silent)) {
      changes.push([HP_KEYS.SILENT, flag(values.silent)]);
    }
    await hub.applyHeatPumpSettings(device, changes);
    return { message: HP_TEXT.applied };
  }
  throw new Error(`Unknown action ${actionKey}`);
}
