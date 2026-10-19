// -----------------------------------------------------------------------------
// Dashboard widget (manifest `widgets`): `climate`, one air conditioner.
//
// What it adds to the Gladys device box: the room and the setpoint side by
// side, the mode, the fan, the filter and the error code of the unit at a
// glance, and one-tap buttons: on/off, setpoint down/up, and a small form
// (Gladys 5.2+, #3168) to change mode and fan speed together.
//
// Budget (8 components, 2 texts, 6 tiles, 1 status, 4 buttons): three live
// tiles at most, one status list, four buttons. No button style marks
// a state: `primary` is invisible in dark mode (#3153).
// -----------------------------------------------------------------------------

import { WIDGET_COLORS } from '@gladysassistant/integration-sdk';
import {
  FEATURE_KEYS,
  NAMES,
  clampSetpoint,
  deviceIds,
  fanName,
  fanToGladys,
  modeName,
  modeToGladys,
  supportedFanSpeeds,
  supportedModes,
} from './devices.js';
import { WIDGET_KEY, isHeatPump } from './hub.js';

export const ACTIONS = {
  POWER: 'power',
  DOWN: 'setpoint_down',
  UP: 'setpoint_up',
  SETTINGS: 'settings',
};

export const TEXT = {
  pick: {
    en: 'Choose an air conditioner in the settings of this widget.',
    fr: 'Choisissez un climatiseur dans les réglages de ce widget.',
    de: 'Wähle in den Einstellungen dieses Widgets eine Klimaanlage aus.',
    es: 'Elija un aire acondicionado en la configuración de este widget.',
  },
  unknown: {
    en: 'This air conditioner is not known yet: run a search in the integration.',
    fr: 'Ce climatiseur est inconnu : lancez une recherche dans l’intégration.',
    de: 'Diese Klimaanlage ist noch unbekannt: Starte eine Suche in der Integration.',
    es: 'Este aire acondicionado aún no es conocido: inicie una búsqueda en la integración.',
  },
  heatPump: {
    en: 'This widget is for air conditioners: add the heat pump with its device box.',
    fr: 'Ce widget est fait pour les climatiseurs : ajoutez la pompe à chaleur par sa boîte d’appareil.',
    de: 'Dieses Widget ist für Klimaanlagen: Füge die Wärmepumpe über ihre Gerätebox hinzu.',
    es: 'Este widget es para aires acondicionados: añada la bomba de calor con su caja de dispositivo.',
  },
  room: { en: 'Room', fr: 'Pièce', de: 'Raum', es: 'Estancia' },
  setpoint: { en: 'Setpoint', fr: 'Consigne', de: 'Sollwert', es: 'Consigna' },
  outdoor: { en: 'Outdoor', fr: 'Extérieur', de: 'Außen', es: 'Exterior' },
  humidity: { en: 'Humidity', fr: 'Humidité', de: 'Feuchte', es: 'Humedad' },
  fan: { en: 'Fan', fr: 'Ventilation', de: 'Lüfter', es: 'Ventilador' },
  filter: { en: 'Filter', fr: 'Filtre', de: 'Filter', es: 'Filtro' },
  filterOk: { en: 'Clean', fr: 'Propre', de: 'Sauber', es: 'Limpio' },
  filterDirty: { en: 'To clean', fr: 'À nettoyer', de: 'Reinigen', es: 'Por limpiar' },
  error: { en: 'Error code', fr: 'Code erreur', de: 'Fehlercode', es: 'Código de error' },
  off: { en: 'Off', fr: 'Éteint', de: 'Aus', es: 'Apagado' },
  turnOn: { en: 'Turn on', fr: 'Allumer', de: 'Einschalten', es: 'Encender' },
  turnOff: { en: 'Turn off', fr: 'Éteindre', de: 'Ausschalten', es: 'Apagar' },
  settings: {
    en: 'Mode and fan',
    fr: 'Mode et ventilation',
    de: 'Modus und Lüfter',
    es: 'Modo y ventilador',
  },
  unreachable: {
    en: 'not answering',
    fr: 'ne répond pas',
    de: 'antwortet nicht',
    es: 'no responde',
  },
  switchedOn: { en: 'Turned on', fr: 'Allumé', de: 'Eingeschaltet', es: 'Encendido' },
  switchedOff: { en: 'Turned off', fr: 'Éteint', de: 'Ausgeschaltet', es: 'Apagado' },
  setpointSet: { en: 'Setpoint: ', fr: 'Consigne : ', de: 'Sollwert: ', es: 'Consigna: ' },
  applied: {
    en: 'Settings applied',
    fr: 'Réglages appliqués',
    de: 'Einstellungen übernommen',
    es: 'Ajustes aplicados',
  },
};

const t = (text, language) => text[language] ?? text.en;

// A form field label must be a multi-language object (the core's rule).
const everyLanguage = (render) =>
  Object.fromEntries(Object.keys(NAMES).map((language) => [language, render(language)]));

/** "24.5 °C" written the way the language writes decimals. */
export function formatTemperature(value, language) {
  const number = language === 'en' ? String(value) : String(value).replace('.', ',');
  return `${number} °C`;
}

function message(text, language) {
  return {
    ttl_seconds: 300,
    components: [{ type: 'text', variant: 'body', text: t(text, language) }],
  };
}

async function get(hub, { settings, language = 'en' }) {
  const record = settings?.device ? hub.resolveDevice(settings.device) : null;
  if (record && isHeatPump(record)) {
    return message(TEXT.heatPump, language);
  }
  if (!record?.capsQueried) {
    return message(settings?.device ? TEXT.unknown : TEXT.pick, language);
  }
  const lang = NAMES[language] ? language : 'en';
  const { caps, state } = record;
  const ids = deviceIds(hub.gladys, record.id);
  const step = caps.halfDegrees ? 0.5 : 1;

  const components = [];
  const tile = (key, label, icon) => ({
    type: 'value',
    device_feature: ids.feature(key),
    label: t(label, lang),
    icon,
  });
  components.push(tile(FEATURE_KEYS.INDOOR_TEMPERATURE, TEXT.room, 'thermometer'));
  components.push(tile(FEATURE_KEYS.TARGET_TEMPERATURE, TEXT.setpoint, 'target'));
  // Three tiles at most: with the status and the four buttons, the 8 of the budget.
  if (record.hasOutdoor) {
    components.push(tile(FEATURE_KEYS.OUTDOOR_TEMPERATURE, TEXT.outdoor, 'cloud'));
  } else if (caps.humidity) {
    components.push(tile(FEATURE_KEYS.HUMIDITY, TEXT.humidity, 'droplet'));
  }

  const on = state?.power === true;
  const items = [
    {
      label: NAMES[lang].mode,
      icon: 'power',
      value: state ? (on ? modeName(modeToGladys(state.mode), lang) : t(TEXT.off, lang)) : '-',
      color: on ? WIDGET_COLORS.SUCCESS : WIDGET_COLORS.NEUTRAL,
    },
    {
      label: t(TEXT.fan, lang),
      icon: 'wind',
      value: state ? fanName(fanToGladys(state.fanSpeed), lang) : '-',
      color: WIDGET_COLORS.NEUTRAL,
    },
  ];
  if (caps.filter || record.filterAlert === true) {
    items.push({
      label: t(TEXT.filter, lang),
      icon: 'filter',
      value: t(record.filterAlert ? TEXT.filterDirty : TEXT.filterOk, lang),
      color: record.filterAlert ? WIDGET_COLORS.WARNING : WIDGET_COLORS.NEUTRAL,
    });
  }
  if (record.reachable !== true) {
    items.unshift({
      label: 'Midea',
      icon: 'wifi-off',
      value: `${record.host} · ${t(TEXT.unreachable, lang)}`,
      color: WIDGET_COLORS.WARNING,
    });
  }
  if (record.errorCode) {
    items.push({
      label: t(TEXT.error, lang),
      icon: 'alert-triangle',
      value: record.errorCode,
      color: WIDGET_COLORS.DANGER,
    });
  }
  components.push({ type: 'status', items });

  const stepText = language === 'en' ? String(step) : String(step).replace('.', ',');
  components.push(
    {
      type: 'button',
      label: t(on ? TEXT.turnOff : TEXT.turnOn, lang),
      icon: 'power',
      style: 'secondary',
      // The tap toggles the state the unit has then, not the one shown.
      action: { key: ACTIONS.POWER },
    },
    {
      type: 'button',
      label: `−${stepText} °C`,
      icon: 'minus',
      style: 'secondary',
      action: { key: ACTIONS.DOWN },
    },
    {
      type: 'button',
      label: `+${stepText} °C`,
      icon: 'plus',
      style: 'secondary',
      action: { key: ACTIONS.UP },
    },
    {
      type: 'button',
      label: t(TEXT.settings, lang),
      icon: 'sliders',
      style: 'secondary',
      action: {
        key: ACTIONS.SETTINGS,
        fields: [
          {
            key: 'mode',
            type: 'select',
            required: true,
            label: everyLanguage((language) => NAMES[language].mode),
            default: String(state ? (modeToGladys(state.mode) ?? 1) : 1),
            options: supportedModes(caps).map((value) => ({
              value: String(value),
              label: everyLanguage((language) => modeName(value, language)),
            })),
          },
          {
            key: 'fan_speed',
            type: 'select',
            required: true,
            label: everyLanguage((language) => NAMES[language]['fan-speed']),
            default: String(state ? fanToGladys(state.fanSpeed) : 0),
            options: supportedFanSpeeds(caps).map((value) => ({
              value: String(value),
              label: everyLanguage((language) => fanName(value, language)),
            })),
          },
        ],
      },
    },
  );
  return { ttl_seconds: 60, components };
}

async function action(hub, { actionKey, values, settings }) {
  const device = settings?.device;
  if (!device) {
    throw new Error(TEXT.pick.en);
  }
  const record = hub.require(device);
  if (isHeatPump(record)) {
    throw new Error(TEXT.heatPump.en);
  }
  if (actionKey === ACTIONS.POWER) {
    const state = await hub.currentState(record);
    const on = state.power !== true;
    await hub.applySettings(device, { power: on ? 1 : 0 });
    return { message: on ? TEXT.switchedOn : TEXT.switchedOff };
  }
  if (actionKey === ACTIONS.DOWN || actionKey === ACTIONS.UP) {
    const state = await hub.currentState(record);
    const step = record.caps.halfDegrees ? 0.5 : 1;
    const target = clampSetpoint(
      record.caps,
      state.targetTemperature + (actionKey === ACTIONS.UP ? step : -step),
    );
    await hub.applySettings(device, { targetTemperature: target });
    return {
      message: Object.fromEntries(
        Object.entries(TEXT.setpointSet).map(([language, prefix]) => [
          language,
          `${prefix}${formatTemperature(target, language)}`,
        ]),
      ),
    };
  }
  if (actionKey === ACTIONS.SETTINGS) {
    if (!values || values.mode === undefined) {
      // A core older than 5.2 drops the form and relays the tap without values.
      throw new Error('This action needs Gladys 5.2 or later');
    }
    await hub.applySettings(device, {
      power: 1,
      mode: Number(values.mode),
      fanSpeed: Number(values.fan_speed),
    });
    return { message: TEXT.applied };
  }
  throw new Error(`Unknown action ${actionKey}`);
}

export const WIDGETS = {
  [WIDGET_KEY]: { get, action },
};
