// -----------------------------------------------------------------------------
// Diagnostic reports (manifest actions `fleet_diagnostic` and `test_device`).
//
// "My unit is not found / not answering / not supported" takes several round
// trips with the user: which protocol, does it have its keys, when did it
// last answer, what does it really send. These reports rebuild the picture on
// demand, from the Configuration screen, as plain text the user pastes into a
// GitHub issue in one gesture.
//
//   - secrets (V3 tokens and keys, typed or from the cloud, the NetHome Plus
//     account and password) are never printed, and the final text is scrubbed
//     of them whatever the options;
//   - identifiers (device ids, serial numbers, local addresses) are masked
//     unless the user explicitly asks for them; the serial number blocks a
//     heat pump appends to its parameters are cut from the raw frames.
//
// Both reports are read-only: the test sends queries, never a command.
// -----------------------------------------------------------------------------

import { readFileSync } from 'node:fs';
import {
  decodeResponse,
  getCapabilitiesCommand,
  getGroupDataCommand,
  getStateCommand,
} from './midea/ac.js';
import {
  BODY_TYPE,
  answersBody,
  decodeC3Response,
  getApplianceCommand,
  getQueryCommand,
  isApplianceAnswer,
} from './midea/c3.js';
import { APPLIANCE } from './midea/frame.js';

/** Bound of a report, in characters: it is shown under the action button. */
export const MAX_REPORT_LENGTH = 12000;

export const MASKED_HOST = '<local-ip>';
const REDACTED = '<redacted>';

const IPV4_PATTERN = /\b(?:(?:25[0-5]|2[0-4]\d|1?\d?\d)\.){3}(?:25[0-5]|2[0-4]\d|1?\d?\d)\b/g;
const IPV4 = /^(?:(?:25[0-5]|2[0-4]\d|1?\d?\d)\.){3}(?:25[0-5]|2[0-4]\d|1?\d?\d)$/;

// The data bytes of a heat pump's parameters before its serial number blocks
// (midea-local: the IDU, ODU and HMI serial numbers start at data byte 96).
const UNIT_PUBLIC_BYTES = 96;

/** Version of the integration, from package.json (shipped in the image). */
export const INTEGRATION_VERSION = (() => {
  try {
    return JSON.parse(readFileSync(new URL('../package.json', import.meta.url), 'utf8')).version;
  } catch {
    return 'unknown';
  }
})();

/** `153931628201396` -> `15…96`: enough to tell two units apart in an issue. */
export function maskIdentifier(value) {
  const text = String(value ?? '');
  if (text === '') {
    return '-';
  }
  return text.length <= 4 ? `${text.slice(0, 1)}…` : `${text.slice(0, 2)}…${text.slice(-2)}`;
}

const escapeRegExp = (value) => value.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');

/**
 * The redaction rules of one report.
 * @param {object} options
 * @param {boolean} options.includeIdentifiers show ids, serials and addresses in full
 * @param {string[]} [options.secrets] never shown, whatever the options
 * @param {string[]} [options.identifiers] device ids and serial numbers (masked)
 * @param {string[]} [options.hosts] local addresses (hidden)
 */
export function createRedactor({ includeIdentifiers, secrets = [], identifiers = [], hosts = [] }) {
  const mask = includeIdentifiers !== true;
  // Longest first: a serial number may contain a shorter identifier.
  const byLength = (values) =>
    [
      ...new Set(
        values.map((value) => String(value ?? '')).filter((value) => value.trim().length >= 4),
      ),
    ].sort((a, b) => b.length - a.length);
  const secretList = byLength(secrets);
  const hostList = byLength(hosts);
  const identifierList = byLength(identifiers);
  const replaceAll = (input, value, replacement) =>
    input.replace(new RegExp(escapeRegExp(value), 'gi'), replacement);
  return {
    masked: mask,
    id: (value) => (mask ? maskIdentifier(value) : String(value ?? '-')),
    host: (value) => (!value ? '-' : mask ? MASKED_HOST : String(value)),
    /** Final pass over the whole text (defense in depth). */
    scrub: (text) => {
      let result = String(text);
      for (const secret of secretList) {
        result = replaceAll(result, secret, REDACTED);
      }
      if (mask) {
        for (const value of hostList) {
          result = replaceAll(result, value, MASKED_HOST);
        }
        for (const value of identifierList) {
          result = replaceAll(result, value, maskIdentifier(value));
        }
        result = result.replace(IPV4_PATTERN, MASKED_HOST);
      }
      return result;
    },
  };
}

/** Cut a report at a line boundary when it exceeds the bound, with a note. */
export function truncateReport(text, max = MAX_REPORT_LENGTH) {
  if (text.length <= max) {
    return text;
  }
  const noteRoom = 200;
  let cut = text.lastIndexOf('\n', max - noteRoom);
  if (cut <= 0) {
    cut = max - noteRoom;
  }
  return (
    `${text.slice(0, cut)}\n[... report truncated: ${text.length - cut} more character(s). ` +
    'Pick a device in the "Device" field to diagnose one unit at a time.]'
  );
}

/** `3 s ago`, `12 min ago`, `2 h ago`, or `never`. */
export function formatAge(at, now) {
  if (!at) {
    return 'never';
  }
  const seconds = Math.max(0, Math.round((now - at) / 1000));
  if (seconds < 120) {
    return `${seconds} s ago`;
  }
  if (seconds < 2 * 3600) {
    return `${Math.round(seconds / 60)} min ago`;
  }
  return `${Math.round(seconds / 3600)} h ago`;
}

const yesNo = (value) => (value ? 'yes' : 'no');
const kindOf = (type) =>
  type === APPLIANCE.HEAT_PUMP
    ? 'heat pump 0xC3'
    : type === APPLIANCE.AIR_CONDITIONER
      ? 'air conditioner 0xAC'
      : `appliance 0x${Number(type).toString(16).toUpperCase()}`;

/** The redactor of a hub: every secret, identifier and address it knows. */
export function redactorFor(hub, includeIdentifiers) {
  const records = [...hub.records.values()];
  const unsupported = [...hub.unsupported.values()];
  const config = hub.config ?? {};
  return createRedactor({
    includeIdentifiers,
    secrets: [
      ...records.flatMap((record) => [record.credentials?.token, record.credentials?.key]),
      ...(config.manualKeys ?? []).flatMap((pair) => [pair.token, pair.key]),
      config.cloud?.account,
      config.cloud?.password,
    ],
    identifiers: [
      ...records.flatMap((record) => [record.id, record.serial]),
      ...unsupported.flatMap((other) => [other.id, other.serial]),
    ],
    hosts: [
      ...records.map((record) => record.host),
      ...unsupported.map((other) => other.host),
      ...(config.hosts ?? []),
    ],
  });
}

function headerLines(title, now, redactor) {
  return [
    title,
    `Generated: ${new Date(now).toISOString()}`,
    `Integration version: ${INTEGRATION_VERSION} (Node ${process.version})`,
    redactor.masked
      ? 'Identifiers: masked (ids and serial numbers shortened, local addresses hidden). No token, key nor password.'
      : 'WARNING: this report shows full ids, serial numbers and local addresses: do not post it publicly. No token, key nor password.',
  ];
}

function configurationLines(hub) {
  const config = hub.config ?? {};
  return [
    '',
    'Configuration',
    `  language: ${config.language}, refresh: ${config.pollSeconds} s, beep: ${yesNo(config.beep)}, energy format: ${config.energyFormat}`,
    `  cloud region: ${config.cloud?.region}, own NetHome Plus account: ${yesNo(config.cloud?.account)}, typed token/key pairs: ${config.manualKeys?.length ?? 0}`,
    `  typed addresses: ${config.hosts?.length ?? 0}, ignored: ${config.invalidHosts?.length ?? 0}`,
  ];
}

function discoveryLines(hub, redactor) {
  const lines = [
    '',
    'Discovery',
    `  last scan through Gladys: ${hub.lastScan.status}, answers: ${hub.lastScan.found}`,
  ];
  for (const other of hub.unsupported.values()) {
    lines.push(
      `  not supported: ${kindOf(Number.parseInt(other.type, 16))} at ${redactor.host(other.host)}, ` +
        `V${other.version ?? '?'}, model ${other.model || '?'}, id ${redactor.id(other.id)}`,
    );
  }
  return lines;
}

/** What the hub knows of one unit, without asking it anything. */
export function recordLines(hub, record, redactor, now) {
  const heatPump = record.type === APPLIANCE.HEAT_PUMP;
  const json = (value) => (value === null || value === undefined ? '-' : JSON.stringify(value));
  const keys =
    record.version !== 3
      ? 'not needed (V2)'
      : record.credentials
        ? `present (${record.keySource ?? 'saved'})`
        : `missing (${record.keyProblem ?? 'not asked yet'})`;
  const lines = [
    '',
    `${hub.name(record, 'en')} (${kindOf(record.type)}, V${record.version}, model ${record.model || '?'})`,
    `  id ${redactor.id(record.id)}, serial ${redactor.id(record.serial)}, address ${redactor.host(record.host)}:${record.port}`,
    `  added to Gladys: ${yesNo(hub.isCreated(record))}, keys: ${keys}`,
    `  answering: ${record.reachable === null ? 'not yet' : yesNo(record.reachable)}, last read ${formatAge(record.lastReadAt, now)}, failures in a row: ${record.failures}`,
    `  last error: ${record.lastError ?? '-'}`,
  ];
  if (heatPump) {
    lines.push(
      `  message protocol: ${record.protocol ?? 'not asked yet'}, energy counters received: ${yesNo(record.hasEnergy)}`,
      `  installation: ${json(record.caps)}`,
      `  state: ${json(record.state)}`,
      `  unit parameters: ${json(record.unit)}`,
      `  energy: ${json(record.energy)}, silent level: ${record.silentLevel ?? '-'}`,
    );
  } else {
    lines.push(
      `  capabilities answered: ${yesNo(record.rawCaps)}, summary: ${json(record.caps)}`,
      `  state: ${json(record.state)}`,
      `  energy: ${json(record.energy)}, humidity: ${record.humidity ?? '-'}`,
    );
  }
  return lines;
}

/**
 * The fleet report: configuration, discovery, then every unit (or the one
 * `filter` designates).
 * @param {object} hub the MideaHub
 * @param {object} [options]
 * @param {boolean} [options.includeIdentifiers]
 * @param {object|null} [options.only] one record
 * @param {number} [options.now]
 */
export function buildFleetReport(
  hub,
  { includeIdentifiers = false, only = null, now = Date.now() } = {},
) {
  const redactor = redactorFor(hub, includeIdentifiers);
  const records = only ? [only] : [...hub.records.values()];
  const lines = [
    ...headerLines('Midea diagnostic', now, redactor),
    ...configurationLines(hub),
    ...discoveryLines(hub, redactor),
    '',
    `Units known: ${hub.records.size}${only ? ' (one shown)' : ''}`,
  ];
  for (const record of records) {
    lines.push(...recordLines(hub, record, redactor, now));
  }
  return truncateReport(redactor.scrub(lines.join('\n')));
}

/** The record a reference designates: external id, address, name or id. */
export function findRecord(hub, reference) {
  const wanted = String(reference ?? '')
    .trim()
    .toLowerCase();
  if (!wanted) {
    return null;
  }
  const records = [...hub.records.values()];
  const names = (record) =>
    ['en', 'fr', 'de', 'es'].map((language) => hub.name(record, language).toLowerCase());
  return (
    hub.resolveDevice(String(reference).trim()) ??
    records.find((record) => record.host === wanted) ??
    records.find((record) => String(record.id) === wanted) ??
    records.find((record) => names(record).includes(wanted)) ??
    null
  );
}

const hex = (frame) => (frame ? frame.toString('hex') : '-');

/** A received frame as the report shows it: serial number blocks cut when masked. */
function shownAnswer(frame, redactor) {
  if (!frame) {
    return 'no answer';
  }
  if (redactor.masked && frame[2] === APPLIANCE.HEAT_PUMP) {
    if (frame[9] === 0xa0) {
      // The appliance answer may carry the model and serial: its header is enough.
      return `${hex(frame.subarray(0, 10))}… (${frame.length} bytes, body hidden)`;
    }
    if (frame[10] === BODY_TYPE.UNIT && frame.length > 11 + UNIT_PUBLIC_BYTES) {
      return `${hex(frame.subarray(0, 11 + UNIT_PUBLIC_BYTES))}… (${frame.length} bytes, serial numbers cut)`;
    }
  }
  return hex(frame);
}

/** The queries of a unit, by kind: label, frame, accepted answer, decoder. */
function queriesOf(record) {
  if (record.type === APPLIANCE.HEAT_PUMP) {
    const protocol = () => ({ protocol: record.protocol ?? 0 });
    const decode = (frame) => decodeC3Response(frame);
    return [
      {
        label: 'appliance (0xA0)',
        frame: () => getApplianceCommand(),
        accept: isApplianceAnswer,
        decode: (frame) => ({ protocol: decodeC3Response(frame).protocol }),
      },
      ...[
        ['basic state (0x01)', BODY_TYPE.BASIC],
        ['unit parameters (0x10)', BODY_TYPE.UNIT],
        ['silent mode (0x05)', BODY_TYPE.SILENCE],
        ['eco mode (0x07)', BODY_TYPE.ECO],
      ].map(([label, bodyType]) => ({
        label,
        frame: () => getQueryCommand(bodyType, protocol()),
        accept: answersBody(bodyType),
        decode,
      })),
    ];
  }
  const ac = (frame) => frame[2] === APPLIANCE.AIR_CONDITIONER;
  return [
    {
      label: 'capabilities (0xB5)',
      frame: () => getCapabilitiesCommand(),
      accept: (frame) => ac(frame) && frame[10] === 0xb5,
      decode: (frame) => decodeResponse(frame),
    },
    {
      label: 'capabilities, second page',
      frame: () => getCapabilitiesCommand(true),
      accept: (frame) => ac(frame) && frame[10] === 0xb5,
      decode: (frame) => decodeResponse(frame),
    },
    {
      label: 'state (0x41)',
      frame: () => getStateCommand(),
      accept: (frame) => ac(frame) && frame[10] === 0xc0,
      decode: (frame) => decodeResponse(frame),
    },
    ...[
      ['energy (group 4)', 4],
      ['humidity (group 5)', 5],
    ].map(([label, group]) => ({
      label,
      frame: () => getGroupDataCommand(group),
      accept: (frame) => ac(frame) && frame[10] === 0xc1 && (frame[13] & 0xf) === group,
      decode: (frame) => decodeResponse(frame),
    })),
  ];
}

/**
 * Read a unit now: every query of its kind, the raw answer and its decoding.
 * Read-only: queries only, never a command.
 * @param {object} hub
 * @param {object} record
 * @param {object} redactor
 */
export async function testLines(hub, record, redactor) {
  const lines = ['', 'Reading the unit now (queries only, no command)'];
  if (record.version === 3 && !record.credentials) {
    lines.push('  skipped: this V3 unit has no token and key yet (see "keys" above)');
    return lines;
  }
  for (const query of queriesOf(record)) {
    const frame = query.frame();
    const started = Date.now();
    let answer;
    try {
      answer = await record.lan.request(frame, query.accept, { optional: true, retries: 1 });
    } catch (err) {
      lines.push(`  ${query.label}: ${err.message}`);
      if (err.unreachable || err.auth) {
        lines.push('  stopped: the unit does not answer, or refuses its keys');
        break;
      }
      continue;
    }
    lines.push(`  ${query.label}: sent ${hex(frame)}`);
    if (!answer) {
      lines.push(`    no answer within the timeout`);
      continue;
    }
    lines.push(`    answer in ${Date.now() - started} ms: ${shownAnswer(answer, redactor)}`);
    try {
      lines.push(`    decoded: ${JSON.stringify(query.decode(answer))}`);
    } catch (err) {
      lines.push(`    not decoded: ${err.message}`);
    }
  }
  return lines;
}

/**
 * The test report of one unit: what the hub knows of it, then a reading now.
 * A typed address the hub does not know is probed: its discovery answer says
 * which appliance it is and why it is not listed.
 * @param {object} hub
 * @param {string} reference external id, address, name or id
 * @param {object} [options]
 * @param {boolean} [options.includeIdentifiers]
 * @param {number} [options.now]
 */
export async function buildTestReport(
  hub,
  reference,
  { includeIdentifiers = false, now = Date.now() } = {},
) {
  const record = findRecord(hub, reference);
  const redactor = record
    ? redactorFor(hub, includeIdentifiers)
    : createRedactor({
        includeIdentifiers,
        hosts: IPV4.test(String(reference ?? '').trim()) ? [String(reference).trim()] : [],
      });
  const lines = headerLines('Midea unit test', now, redactor);
  if (record) {
    lines.push(...recordLines(hub, record, redactor, now));
    lines.push(...(await testLines(hub, record, redactor)));
    return truncateReport(redactorFor(hub, includeIdentifiers).scrub(lines.join('\n')));
  }
  const host = String(reference ?? '').trim();
  if (!IPV4.test(host)) {
    lines.push('', `No known unit matches "${host}". Pick it in the list, or type its IP address.`);
    return redactor.scrub(lines.join('\n'));
  }
  let info = null;
  try {
    info = await hub.probeHost(host);
  } catch (err) {
    lines.push('', `Discovery request to ${redactor.host(host)} failed: ${err.message}`);
  }
  if (!info) {
    lines.push(
      '',
      `No Midea answer from ${redactor.host(host)} (UDP 6445 and 20086): wrong address, unit off, or another appliance.`,
    );
    return redactor.scrub(lines.join('\n'));
  }
  const supported = [APPLIANCE.AIR_CONDITIONER, APPLIANCE.HEAT_PUMP].includes(info.type);
  const scrubber = createRedactor({
    includeIdentifiers,
    hosts: [host, info.host],
    identifiers: [info.deviceId, info.serial],
  });
  lines.push(
    '',
    `Discovery answer from ${scrubber.host(host)}: ${kindOf(info.type)}, V${info.version}, port ${info.port}, model ${info.model || '?'}, id ${scrubber.id(info.deviceId)}, serial ${scrubber.id(info.serial)}`,
    supported
      ? '  supported, but not known yet: add its address in the configuration, then run "Search".'
      : '  not supported yet: paste this report in a GitHub issue to ask for it.',
  );
  return scrubber.scrub(lines.join('\n'));
}
