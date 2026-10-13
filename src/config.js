// -----------------------------------------------------------------------------
// Integration configuration: defaults (they mirror the `default` values of the
// manifest `config_schema`, see test/manifest.test.js) and normalization, so
// the rest of the code never deals with strings, blanks or `undefined`.
// -----------------------------------------------------------------------------

import { REGIONS } from './midea/cloud.js';

export const LANGUAGES = ['en', 'fr', 'de', 'es'];

// Seconds between two reads of every unit (`poll_interval` options).
export const POLL_INTERVALS = [15, 30, 60, 120, 300];

export const ENERGY_FORMATS = ['bcd', 'binary'];

export const DEFAULT_CONFIG = {
  hosts: '',
  poll_interval: '30',
  cloud_region: 'DE',
  cloud_account: '',
  cloud_password: '',
  energy_format: 'bcd',
  beep: false,
  language: 'fr',
};

const IPV4 = /^(\d{1,3})\.(\d{1,3})\.(\d{1,3})\.(\d{1,3})$/;
const MAX_HOSTS = 32;

/**
 * Parse the manual address list (commas, semicolons, spaces or new lines).
 * @param {unknown} raw
 * @returns {{ hosts: string[], invalid: string[] }}
 */
export function parseHosts(raw) {
  const hosts = [];
  const invalid = [];
  const entries = typeof raw === 'string' ? raw.split(/[\s,;]+/) : [];
  for (const entry of entries) {
    const host = entry.trim();
    if (!host) {
      continue;
    }
    const match = host.match(IPV4);
    if (!match || !match.slice(1).every((part) => Number(part) <= 255)) {
      invalid.push(host);
    } else {
      const normalized = match.slice(1).map(Number).join('.');
      if (!hosts.includes(normalized) && hosts.length < MAX_HOSTS) {
        hosts.push(normalized);
      }
    }
  }
  return { hosts, invalid };
}

const text = (value) => (typeof value === 'string' ? value.trim() : '');

/**
 * @param {Record<string, unknown>} raw the configuration returned by the SDK
 */
export function normalizeConfig(raw = {}) {
  const source = raw && typeof raw === 'object' ? raw : {};
  const { hosts, invalid } = parseHosts(
    typeof source.hosts === 'string' ? source.hosts : DEFAULT_CONFIG.hosts,
  );
  const interval = Number(source.poll_interval ?? DEFAULT_CONFIG.poll_interval);
  const account = text(source.cloud_account);
  const password = typeof source.cloud_password === 'string' ? source.cloud_password : '';
  return {
    hosts,
    invalidHosts: invalid,
    pollSeconds: POLL_INTERVALS.includes(interval)
      ? interval
      : Number(DEFAULT_CONFIG.poll_interval),
    cloud: {
      region: REGIONS.includes(source.cloud_region)
        ? source.cloud_region
        : DEFAULT_CONFIG.cloud_region,
      // An account without its password (or the reverse) falls back to the public ones.
      account: account && password ? account : '',
      password: account && password ? password : '',
    },
    energyFormat: ENERGY_FORMATS.includes(source.energy_format)
      ? source.energy_format
      : DEFAULT_CONFIG.energy_format,
    beep: source.beep === true || source.beep === 'true',
    language: LANGUAGES.includes(source.language) ? source.language : DEFAULT_CONFIG.language,
  };
}
