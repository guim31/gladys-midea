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
  v3_keys: '',
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

const TOKEN = /^[0-9a-f]{128}$/;
const KEY = /^[0-9a-f]{64}$/;
const MAX_KEYS = 16;

/**
 * Parse the V3 token and key pairs typed by hand ("token:key", separated by
 * commas, semicolons, spaces or new lines), for a unit the cloud gives no key.
 * @param {unknown} raw
 * @returns {{ token: string, key: string }[]}
 */
export function parseManualKeys(raw) {
  const pairs = [];
  const entries = typeof raw === 'string' ? raw.split(/[\s,;]+/) : [];
  for (const entry of entries) {
    const [token, key, extra] = entry.trim().toLowerCase().split(':');
    if (extra === undefined && TOKEN.test(token ?? '') && KEY.test(key ?? '')) {
      if (!pairs.some((pair) => pair.token === token) && pairs.length < MAX_KEYS) {
        pairs.push({ token, key });
      }
    }
  }
  return pairs;
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
    manualKeys: parseManualKeys(source.v3_keys),
    energyFormat: ENERGY_FORMATS.includes(source.energy_format)
      ? source.energy_format
      : DEFAULT_CONFIG.energy_format,
    beep: source.beep === true || source.beep === 'true',
    language: LANGUAGES.includes(source.language) ? source.language : DEFAULT_CONFIG.language,
  };
}
