// -----------------------------------------------------------------------------
// The Midea hub: finds the air conditioners and the air-to-water heat pumps,
// gets the keys of the V3 units (once, from the Midea cloud), reads every
// unit at the configured pace, publishes devices and states to Gladys, runs
// the commands and fires the scene triggers. Both kinds share discovery,
// keys and sessions; each record takes the path of its appliance type
// (`record.type`, 0xAC or 0xC3) for the frames and the Gladys device.
//
// Polling by the container's own timer: the core polls external devices
// unreliably (GladysAssistant/Gladys#3198), so the devices are published
// with should_poll and a one-minute poll_frequency only as a fallback, and
// the core's onPoll is skipped when the timer has just read the unit.
// -----------------------------------------------------------------------------

import { GladysApiError, createLogger } from '@gladysassistant/integration-sdk';
import { LANGUAGES } from './config.js';
import {
  FEATURE_KEYS,
  applyCommand,
  buildDevice,
  deviceIds,
  deviceName,
  deviceValues,
  featureSpecs,
} from './devices.js';
import {
  RESPONSE_ID,
  decodeResponse,
  getCapabilitiesCommand,
  getGroupDataCommand,
  getStateCommand,
  setStateCommand,
  summarizeCapabilities,
} from './midea/ac.js';
import {
  BODY_TYPE,
  SILENT_LEVEL,
  answersBody,
  decodeC3Response,
  errorDisplay,
  getApplianceCommand,
  getQueryCommand,
  isApplianceAnswer,
  setBasicCommand,
  setEcoCommand,
  setSilentCommand,
} from './midea/c3.js';
import { NetHomePlusCloud } from './midea/cloud.js';
import { DISCOVERY_PORTS, DISCOVERY_REQUEST, parseDiscoveryReply } from './midea/discovery.js';
import { APPLIANCE } from './midea/frame.js';
import { MideaLan } from './midea/lan.js';
import { udpId } from './midea/security.js';
import { probeHost } from './midea/udp.js';
import {
  buildHeatPump,
  heatPumpCommand,
  heatPumpFeatureSpecs,
  heatPumpIds,
  heatPumpName,
  heatPumpValues,
  summarizeHeatPump,
} from './heatpump.js';
import { ProblemLog } from './problems.js';
import { CONNECTION_TEXT } from './texts.js';

const logger = createLogger({ name: 'midea-hub' });

export const WIDGET_KEY = 'climate';
export const TRIGGERS = {
  FILTER: 'filter_cleaning_needed',
  ERROR: 'unit_error',
};

export const HUB_TIMINGS = {
  // New scan, to follow DHCP changes and find new units.
  rediscoveryMs: 30 * 60_000,
  // The core accepts one active scan per 10 s per integration.
  scanGapMs: 10_500,
  scanTimeoutSeconds: 5,
  // Polls in a row without answer before a unit is "unreachable".
  unreachableAfter: 2,
  // An unchanged value is published again at least this often, or Gladys
  // shows "no recent value" after 48 h.
  heartbeatMs: 6 * 3600_000,
};

const CONCURRENCY = 4;
// Changes of these features change what the widget shows.
const WIDGET_KEYS = [
  FEATURE_KEYS.POWER,
  FEATURE_KEYS.MODE,
  FEATURE_KEYS.FAN_SPEED,
  FEATURE_KEYS.TARGET_TEMPERATURE,
];

const SUPPORTED = [APPLIANCE.AIR_CONDITIONER, APPLIANCE.HEAT_PUMP];
export const isHeatPump = (record) => record.type === APPLIANCE.HEAT_PUMP;

const isState = (frame) => frame[10] === RESPONSE_ID.STATE;
const isCapabilities = (frame) => frame[10] === RESPONSE_ID.CAPABILITIES && frame[9] === 0x03;
const isGroup = (group) => (frame) =>
  frame[10] === RESPONSE_ID.GROUP_DATA && (frame[13] & 0xf) === group;
const isAnyAc = (frame) => frame[2] === APPLIANCE.AIR_CONDITIONER;

/** Gladys refused a call or did not answer: a passing condition, unlike a bug. */
const isGladysFailure = (err) =>
  err instanceof GladysApiError ||
  err?.name === 'TimeoutError' ||
  err?.name === 'AbortError' ||
  (err instanceof TypeError && err.message === 'fetch failed');

const describe = (err) => {
  const code = err?.cause?.code;
  return code && !err.message.includes(code) ? `${err.message} (${code})` : err.message;
};

/** Run `task` on every item, `limit` at a time; `{ value }` or `{ error }` in order. */
export async function mapLimit(items, limit, task) {
  const results = new Array(items.length);
  let next = 0;
  const worker = async () => {
    while (next < items.length) {
      const index = next;
      next += 1;
      try {
        results[index] = { value: await task(items[index]) };
      } catch (error) {
        results[index] = { error };
      }
    }
  };
  await Promise.all(Array.from({ length: Math.min(limit, items.length) }, worker));
  return results;
}

const sleep = (ms) => new Promise((resolve) => setTimeout(resolve, ms));

export class MideaHub {
  /**
   * @param {object} options
   * @param {object} options.gladys GladysIntegration (or the SDK's fake)
   * @param {object} options.store persistence (src/store.js)
   * @param {boolean} [options.timers] periodic timers (off in tests)
   * @param {object} [options.timings] HUB_TIMINGS overrides
   * @param {(options: object) => MideaLan} [options.createLan]
   * @param {(cloudConfig: object) => object} [options.createCloud]
   * @param {(host: string) => Promise<object|null>} [options.probeHost]
   */
  constructor({ gladys, store, timers = true, timings, createLan, createCloud, probeHost: probe }) {
    this.gladys = gladys;
    this.store = store;
    this.timersEnabled = timers;
    this.timings = { ...HUB_TIMINGS, ...timings };
    this.createLan = createLan ?? ((options) => new MideaLan(options));
    this.createCloud = createCloud ?? ((cloud) => new NetHomePlusCloud(cloud));
    this.probeHost = probe ?? ((host) => probeHost(host));
    this.config = null;
    this.cloud = null;
    /** @type {Map<number, object>} unit records, by device id */
    this.records = new Map();
    /** Other Midea appliances seen, by device id: `{ type, host }`. */
    this.unsupported = new Map();
    this.pending = new Set();
    this.pollTimer = null;
    this.rediscoveryTimer = null;
    this.polling = null;
    this.discovering = null;
    this.lastScan = { status: 'not-run', found: 0 };
    this.stopped = false;
    this.problems = new ProblemLog(logger);
  }

  // --- Lifecycle -------------------------------------------------------------

  async start(config) {
    this.config = config;
    await this.restore();
    await this.discover();
    await this.publishEverything();
    this.startTimers();
  }

  /** Gladys came back (restart, network): it may have lost what was published. */
  async resync(config) {
    this.applyConfig(config);
    this.gladys.forgetPublishedStates();
    for (const record of this.records.values()) {
      record.published = {};
    }
    await this.publishEverything();
    this.gladysRecovered();
  }

  async reconfigure(config) {
    const previous = this.config;
    this.applyConfig(config);
    const cloudChanged =
      JSON.stringify(previous?.cloud) !== JSON.stringify(config.cloud) ||
      JSON.stringify(previous?.manualKeys) !== JSON.stringify(config.manualKeys);
    if (cloudChanged) {
      // Units without keys may get them with the new account or region.
      for (const record of this.records.values()) {
        record.keyProblem = null;
      }
    }
    if (!previous || previous.hosts.join(',') !== config.hosts.join(',') || cloudChanged) {
      await this.discover();
    }
    if (previous && previous.pollSeconds !== config.pollSeconds) {
      this.startTimers();
    }
    // New devices, or names in another language for the Discovery list.
    await this.publishEverything();
  }

  applyConfig(config) {
    if (JSON.stringify(this.config?.cloud) !== JSON.stringify(config.cloud)) {
      this.cloud = null;
    }
    this.config = config;
  }

  async publishEverything() {
    await this.publishDevices();
    await this.publishAllStates();
    await this.publishTransports();
    await this.publishConnectionStatus();
    this.requestWidgetRefresh();
  }

  startTimers() {
    if (!this.timersEnabled || this.stopped) {
      return;
    }
    clearInterval(this.pollTimer);
    clearInterval(this.rediscoveryTimer);
    this.pollTimer = setInterval(() => this.track(this.pollAll()), this.config.pollSeconds * 1000);
    this.rediscoveryTimer = setInterval(
      () => this.track(this.rediscover()),
      this.timings.rediscoveryMs,
    );
  }

  async stop() {
    this.stopped = true;
    clearInterval(this.pollTimer);
    clearInterval(this.rediscoveryTimer);
    await this.idle();
    for (const record of this.records.values()) {
      record.lan?.close();
    }
    await this.store.flush();
  }

  /** Keep track of background work, so the tests (and stop) can wait for it. */
  track(promise) {
    const tracked = Promise.resolve(promise)
      .catch((err) => this.backgroundFailed(err))
      .finally(() => this.pending.delete(tracked));
    this.pending.add(tracked);
    return tracked;
  }

  backgroundFailed(err) {
    if (isGladysFailure(err)) {
      this.problems.fail('gladys', `Gladys does not take the Midea updates: ${describe(err)}`);
    } else {
      this.problems.fail(`bug:${err?.message}`, 'Background task failed', 'error', err);
    }
  }

  gladysRecovered() {
    this.problems.recover('gladys', 'Gladys takes the Midea updates again');
  }

  async idle() {
    while (this.pending.size > 0) {
      await Promise.all([...this.pending]);
    }
  }

  // --- Persistence -----------------------------------------------------------

  async restore() {
    const data = await this.store.load();
    for (const saved of Object.values(data.devices ?? {})) {
      if (
        !saved ||
        !Number.isSafeInteger(saved.id) ||
        typeof saved.host !== 'string' ||
        ![2, 3].includes(saved.version) ||
        !SUPPORTED.includes(saved.type ?? APPLIANCE.AIR_CONDITIONER)
      ) {
        continue;
      }
      const record = this.createRecord(saved);
      Object.assign(record, {
        credentials: saved.credentials?.token && saved.credentials?.key ? saved.credentials : null,
        rawCaps: saved.rawCaps ?? null,
        capsQueried: saved.capsQueried === true,
        hasOutdoor: saved.hasOutdoor === true,
        hasEnergy: saved.hasEnergy === true,
        hasRunTime: saved.hasRunTime === true,
        protocol: Number.isInteger(saved.protocol) ? saved.protocol : null,
        filterAlert: typeof saved.filterAlert === 'boolean' ? saved.filterAlert : null,
        errorCode: Number.isInteger(saved.errorCode) ? saved.errorCode : null,
      });
      if (isHeatPump(record)) {
        // A heat pump keeps its summary (src/heatpump.js) as its capabilities.
        record.caps = record.rawCaps?.known ? record.rawCaps : null;
        record.capsQueried = record.capsQueried && record.caps !== null;
      } else {
        record.caps = summarizeCapabilities(record.rawCaps);
      }
      this.records.set(record.id, record);
    }
  }

  save() {
    const devices = {};
    for (const record of this.records.values()) {
      devices[record.id] = {
        id: record.id,
        host: record.host,
        port: record.port,
        version: record.version,
        type: record.type,
        serial: record.serial,
        ssid: record.ssid,
        model: record.model,
        credentials: record.credentials,
        rawCaps: record.rawCaps,
        capsQueried: record.capsQueried,
        hasOutdoor: record.hasOutdoor,
        hasEnergy: record.hasEnergy,
        hasRunTime: record.hasRunTime,
        protocol: record.protocol,
        filterAlert: record.filterAlert,
        errorCode: record.errorCode,
      };
    }
    return this.store.save({ devices });
  }

  // --- Discovery -------------------------------------------------------------

  createRecord(info) {
    const record = {
      id: info.id ?? info.deviceId,
      host: info.host,
      port: info.port ?? 6444,
      version: info.version,
      type: info.type ?? APPLIANCE.AIR_CONDITIONER,
      serial: info.serial ?? '',
      ssid: info.ssid ?? '',
      model: info.model ?? '',
      credentials: null,
      keyProblem: null,
      rawCaps: null,
      capsQueried: false,
      caps: null,
      state: null,
      energy: null,
      humidity: null,
      // Heat pumps: the unit parameters, whether the energy notification
      // came once, and the message protocol of the unit's appliance answer
      // (null until asked).
      unit: null,
      hasEnergy: false,
      hasRunTime: false,
      silentLevel: null,
      protocol: null,
      hasOutdoor: false,
      filterAlert: null,
      errorCode: null,
      // null until the first answer or the first discovery without one.
      reachable: null,
      failures: 0,
      // Bumped on every command: a poll started before it is stale.
      commandSeq: 0,
      lastPolledAt: 0,
      published: {},
    };
    record.caps = isHeatPump(record) ? null : summarizeCapabilities(null);
    record.lan = this.createLan({
      host: record.host,
      port: record.port,
      deviceId: record.id,
      version: record.version,
      credentials: null,
      logger: createLogger({ name: 'midea-lan' }),
      // A heat pump pushes its state and energy counters between the reads.
      onUnsolicited: isHeatPump(record)
        ? (frame) => this.track(this.heatPumpPush(record, frame))
        : undefined,
    });
    return record;
  }

  /** Scan, probe the typed addresses, then talk to every unit. */
  discover() {
    this.discovering ??= this.runDiscovery().finally(() => {
      this.discovering = null;
    });
    return this.discovering;
  }

  async runDiscovery() {
    const found = [...(await this.scan())];
    const typed = await mapLimit(this.config.hosts, CONCURRENCY, (host) => this.probeHost(host));
    typed.forEach((result, index) => {
      if (result.value) {
        found.push(result.value);
      } else {
        logger.debug(`No Midea answer from ${this.config.hosts[index]}`);
      }
    });
    const seen = new Set();
    for (const info of found) {
      if (seen.has(info.deviceId)) {
        continue;
      }
      seen.add(info.deviceId);
      if (!SUPPORTED.includes(info.type)) {
        if (!this.unsupported.has(info.deviceId)) {
          logger.info(
            `Midea appliance of type 0x${info.type.toString(16)} at ${info.host}: not supported`,
          );
        }
        this.unsupported.set(info.deviceId, {
          type: `0x${info.type.toString(16).toUpperCase()}`,
          host: info.host,
        });
        continue;
      }
      this.adopt(info);
    }
    await mapLimit([...this.records.values()], CONCURRENCY, (record) => this.connectRecord(record));
    await this.save();
    return seen.size;
  }

  /** The discovery broadcasts through the Gladys core, one per port. */
  async scan() {
    const found = [];
    let status = 'ok';
    for (const [index, port] of DISCOVERY_PORTS.entries()) {
      if (index > 0) {
        await sleep(this.timings.scanGapMs);
      }
      try {
        const replies = await this.gladys.scanNetwork('udp-active-broadcast', {
          port,
          payload: DISCOVERY_REQUEST,
          timeoutSeconds: this.timings.scanTimeoutSeconds,
        });
        for (const reply of Array.isArray(replies) ? replies : []) {
          const info = parseDiscoveryReply(
            Buffer.from(String(reply?.payload_base64 ?? ''), 'base64'),
            reply?.source_ip,
          );
          if (info) {
            found.push(info);
          }
        }
        this.problems.recover('scan', 'Midea discovery through Gladys works again');
      } catch (err) {
        // 403: a core without mediated discovery; 429/409: a scan ran less
        // than 10 s ago. The typed and known addresses still work.
        const busy = err.status === 429 || err.status === 409;
        const message = `Midea discovery through Gladys failed: ${describe(err)}`;
        if (busy) {
          logger.debug(message);
        } else {
          this.problems.fail('scan', message);
        }
        status = busy ? 'busy' : 'unavailable';
        break;
      }
    }
    this.lastScan = { status, found: found.length };
    return found;
  }

  /** A discovery answer: a new unit is added, a known one may have moved. */
  adopt(info) {
    let record = this.records.get(info.deviceId);
    if (!record) {
      record = this.createRecord(info);
      this.records.set(record.id, record);
      const kind = isHeatPump(record) ? 'heat pump' : 'air conditioner';
      logger.info(
        `Midea ${kind} ${info.ssid || info.deviceId} (V${info.version}) found at ${info.host}`,
      );
      return record;
    }
    if (record.host !== info.host || record.port !== info.port) {
      logger.info(`${this.label(record)} moved from ${record.host} to ${info.host}`);
    }
    Object.assign(record, {
      host: info.host,
      port: info.port,
      version: info.version,
      serial: info.serial || record.serial,
      ssid: info.ssid || record.ssid,
      model: info.model || record.model,
    });
    record.lan.update({ host: info.host, port: info.port });
    if (record.lan.version !== info.version) {
      record.lan.version = info.version;
      record.lan.close();
    }
    return record;
  }

  /**
   * First conversation with a unit (and again at each discovery): keys,
   * capabilities, state. Never throws: the record says what went wrong.
   */
  async connectRecord(record) {
    try {
      if (record.version === 3 && !record.credentials) {
        if (record.keyProblem) {
          return;
        }
        await this.fetchKeys(record);
      }
      record.lan.update({ credentials: record.credentials });
      if (!record.capsQueried) {
        await this.queryCapabilities(record);
      }
      await this.refresh(record, { rethrow: true });
    } catch (err) {
      let failure = err;
      if (err.auth && record.credentials) {
        // Keys refused (the unit was reset or re-paired): fetch them again once.
        logger.info(`${this.label(record)} refused its keys, asking the Midea cloud again`);
        record.credentials = null;
        record.keyProblem = null;
        try {
          await this.fetchKeys(record);
          record.lan.update({ credentials: record.credentials });
          await this.refresh(record, { rethrow: true });
          return;
        } catch (again) {
          failure = again;
        }
      }
      if (failure.unreachable) {
        await this.failed(record, { now: true });
      } else {
        logger.debug(`${this.label(record)}: ${failure.message}`);
      }
    }
  }

  /** The read that checks a session: the state query of the unit's kind. */
  async probe(record) {
    if (!isHeatPump(record)) {
      return record.lan.request(getStateCommand(), isState);
    }
    if (record.protocol === null) {
      // The appliance answer gives the message protocol of every later frame;
      // like midea-local, a unit that does not answer gets protocol 0.
      const appliance = await record.lan.request(getApplianceCommand(), isApplianceAnswer, {
        optional: true,
        retries: 1,
      });
      record.protocol = appliance ? decodeC3Response(appliance).protocol : 0;
    }
    return record.lan.request(
      getQueryCommand(BODY_TYPE.BASIC, { protocol: record.protocol }),
      answersBody(BODY_TYPE.BASIC),
    );
  }

  /**
   * The token and key of a V3 unit: the pairs typed in the configuration
   * first, then the Midea cloud (both byte orders of the udpid). Each pair is
   * checked by a real handshake.
   */
  async fetchKeys(record) {
    const cloud = (endian) => () => {
      this.cloud ??= this.createCloud(this.config.cloud);
      return this.cloud.getToken(udpId(record.id, endian), record.id);
    };
    const attempts = [
      ...(this.config.manualKeys ?? []).map((pair) => ({ typed: true, get: async () => pair })),
      { typed: false, get: cloud('little') },
      { typed: false, get: cloud('big') },
    ];
    let lastError = null;
    for (const attempt of attempts) {
      let credentials;
      try {
        credentials = await attempt.get();
      } catch (err) {
        lastError = err;
        if (err.network) {
          // The cloud itself is unreachable: no use trying the other order.
          break;
        }
        continue;
      }
      record.lan.update({ credentials });
      try {
        await this.probe(record);
      } catch (err) {
        lastError = err;
        // A typed pair may belong to another unit, and some modules ignore a
        // wrong token instead of refusing it: never keep one unchecked.
        if (err.auth || attempt.typed) {
          continue;
        }
        // Unreachable right now: keep the keys, checked at the next contact
        // (refused keys are fetched again, see connectRecord).
        record.credentials = credentials;
        await this.save();
        throw err;
      }
      record.credentials = credentials;
      record.keyProblem = null;
      this.problems.recover(`keys:${record.id}`, `${this.label(record)} has its keys`);
      logger.info(
        attempt.typed
          ? `${this.label(record)} accepts a token and key typed in the configuration`
          : `Keys of ${this.label(record)} fetched from the Midea cloud and saved`,
      );
      await this.save();
      return;
    }
    record.lan.update({ credentials: null });
    record.keyProblem = lastError?.name === 'CloudError' ? 'cloud' : 'refused';
    this.problems.fail(
      `keys:${record.id}`,
      `No key for ${this.label(record)} (V3): ${lastError?.message ?? 'unknown error'}`,
    );
    const error = new Error(`no key for ${this.label(record)}`);
    error.keys = true;
    throw error;
  }

  async queryCapabilities(record) {
    if (isHeatPump(record)) {
      await this.queryHeatPump(record);
      return;
    }
    let raw = null;
    try {
      const first = decodeResponse(
        await record.lan.request(getCapabilitiesCommand(), isCapabilities),
      );
      raw = { ...first.raw };
      if (first.more) {
        try {
          const more = decodeResponse(
            await record.lan.request(getCapabilitiesCommand(true), isCapabilities),
          );
          Object.assign(raw, more.raw);
        } catch (err) {
          logger.debug(`${this.label(record)}: no second capability page (${err.message})`);
        }
      }
    } catch (err) {
      if (err.auth) {
        throw err;
      }
      // Older units do not answer the query: msmart-ng's defaults apply.
      logger.debug(`${this.label(record)}: no capability answer (${err.message})`);
    }
    record.rawCaps = raw;
    record.caps = summarizeCapabilities(raw);
    record.capsQueried = true;
  }

  /**
   * What a heat pump has: its basic state (zones, hot water, limits) and
   * whether it answers the unit parameters query.
   */
  async queryHeatPump(record) {
    const basic = decodeC3Response(await this.probe(record)).state;
    const unit = await this.queryHeatPumpUnit(record);
    const silentLevel = await this.queryHeatPumpSilence(record);
    record.state = basic;
    record.unit = unit;
    record.silentLevel = silentLevel;
    record.rawCaps = summarizeHeatPump(basic, {
      unit: unit !== null,
      silenceLevel: silentLevel !== null,
    });
    record.caps = record.rawCaps;
    record.capsQueried = true;
  }

  /** The unit parameters, or null when the unit does not answer them. */
  async queryHeatPumpUnit(record) {
    const answer = await record.lan.request(
      getQueryCommand(BODY_TYPE.UNIT, { protocol: record.protocol }),
      answersBody(BODY_TYPE.UNIT),
      { optional: true, retries: 1 },
    );
    if (!answer) {
      return null;
    }
    try {
      return decodeC3Response(answer).unit;
    } catch (err) {
      logger.debug(`${this.label(record)}: ${err.message}`);
      return null;
    }
  }

  /** The silent level (off, silent, super silent), or null without answer. */
  async queryHeatPumpSilence(record) {
    const answer = await record.lan.request(
      getQueryCommand(BODY_TYPE.SILENCE, { protocol: record.protocol }),
      answersBody(BODY_TYPE.SILENCE),
      { optional: true, retries: 1 },
    );
    try {
      return answer ? decodeC3Response(answer).silentLevel : null;
    } catch (err) {
      logger.debug(`${this.label(record)}: ${err.message}`);
      return null;
    }
  }

  /** The "Search" action: also asks the cloud again for the units without keys. */
  async search() {
    for (const record of this.records.values()) {
      record.keyProblem = null;
    }
    this.cloud = null;
    await this.rediscover();
  }

  async rediscover() {
    await this.discover();
    await this.publishEverything();
    this.gladysRecovered();
  }

  // --- Devices ---------------------------------------------------------------

  /** Units talked to at least once: their features are known. */
  publishable() {
    return [...this.records.values()].filter((record) => record.capsQueried);
  }

  async publishDevices() {
    const devices = this.publishable().map((record) =>
      isHeatPump(record)
        ? buildHeatPump(this.gladys, record, this.config.language)
        : buildDevice(this.gladys, record, this.config.language),
    );
    await this.gladys.publishDiscoveredDevices(devices);
  }

  /** The record behind a Gladys device external id, or null. */
  resolveDevice(externalId) {
    if (typeof externalId !== 'string') {
      return null;
    }
    for (const [prefix, heatPump] of [
      [deviceIds(this.gladys, '').device, false],
      [heatPumpIds(this.gladys, '').device, true],
    ]) {
      if (externalId.startsWith(prefix)) {
        const record = this.records.get(Number(externalId.slice(prefix.length)));
        return record && isHeatPump(record) === heatPump ? record : null;
      }
    }
    return null;
  }

  /** The Gladys external ids of a unit. */
  ids(record) {
    return isHeatPump(record)
      ? heatPumpIds(this.gladys, record.id)
      : deviceIds(this.gladys, record.id);
  }

  /** The name of a unit's device in a language. */
  name(record, language) {
    return isHeatPump(record) ? heatPumpName(record, language) : deviceName(record, language);
  }

  require(externalId) {
    const record = this.resolveDevice(externalId);
    if (!record) {
      throw new Error(`Unknown Midea device ${externalId}`);
    }
    return record;
  }

  isCreated(record) {
    const id = this.ids(record).device;
    return (this.gladys.devices ?? []).some((device) => device.external_id === id);
  }

  label(record) {
    return this.name(record, 'en');
  }

  // --- States ----------------------------------------------------------------

  /** Publish what changed for one unit, if the user created it. Resolves with the changed keys. */
  async publishStates(record) {
    if (!record.capsQueried || !this.isCreated(record)) {
      return [];
    }
    const ids = this.ids(record);
    const heatPump = isHeatPump(record);
    const values = heatPump ? heatPumpValues(record, this.config.language) : deviceValues(record);
    const specs = heatPump
      ? heatPumpFeatureSpecs(record, this.config.language)
      : featureSpecs(record, this.config.language);
    const states = [];
    const changed = [];
    for (const spec of specs) {
      const value = values[spec.key];
      if (value === undefined || value === null) {
        continue;
      }
      states.push(
        spec.category === 'text'
          ? { device_feature_external_id: ids.feature(spec.key), text: value }
          : { device_feature_external_id: ids.feature(spec.key), state: value },
      );
      if (record.published[spec.key] !== value) {
        changed.push(spec.key);
      }
    }
    // The SDK sends only the values that changed since its last publication.
    await this.gladys.publishChangedStates(states, { heartbeat: this.timings.heartbeatMs });
    for (const key of changed) {
      record.published[key] = values[key];
    }
    return changed;
  }

  async publishAllStates() {
    for (const record of this.records.values()) {
      try {
        await this.publishStates(record);
      } catch (err) {
        this.backgroundFailed(err);
      }
    }
  }

  /** The user added a device: states sent before were dropped by Gladys. */
  async onDeviceCreated(device) {
    const record = this.resolveDevice(device?.external_id);
    if (!record) {
      return;
    }
    record.published = {};
    this.gladys.forgetPublishedStates(device.external_id);
    await this.publishStates(record);
    await this.publishTransports([record]);
    this.requestWidgetRefresh();
    // A fresh reading rather than waiting for the timer.
    this.track(this.refresh(record));
  }

  async publishTransports(records = [...this.records.values()]) {
    const entries = records
      .filter((record) => this.isCreated(record))
      .map((record) => ({
        external_id: this.ids(record).device,
        transport: record.reachable === true ? 'local' : 'unreachable',
      }));
    for (let at = 0; at < entries.length; at += 100) {
      await this.gladys.publishTransports(entries.slice(at, at + 100));
    }
  }

  async publishConnectionStatus() {
    const records = [...this.records.values()];
    if (records.length === 0) {
      await this.gladys.setConnectionStatus(false, CONNECTION_TEXT.noDevice);
    } else if (records.some((record) => record.reachable === true)) {
      await this.gladys.setConnectionStatus(true);
    } else if (records.some((record) => record.keyProblem)) {
      await this.gladys.setConnectionStatus(false, CONNECTION_TEXT.noKeys);
    } else {
      await this.gladys.setConnectionStatus(false, CONNECTION_TEXT.noAnswer);
    }
  }

  requestWidgetRefresh() {
    this.gladys.requestWidgetRefresh(WIDGET_KEY);
  }

  // --- Polling -----------------------------------------------------------------

  /**
   * Read every unit added to Gladys (the timer's job), skipping those read
   * less than half a period ago (by the core's fallback poll).
   * @param {object} [options]
   * @param {boolean} [options.force] read them all (tests)
   */
  pollAll({ force = false } = {}) {
    this.polling ??= mapLimit(
      [...this.records.values()].filter((record) => this.isCreated(record)),
      CONCURRENCY,
      (record) => this.pollRecord(record, force ? 0 : 0.5),
    )
      .then((results) => {
        const errors = results.filter((result) => result.error).map((result) => result.error);
        errors.forEach((err) => this.backgroundFailed(err));
        if (errors.length === 0) {
          this.gladysRecovered();
        }
      })
      .finally(() => {
        this.polling = null;
      });
    return this.polling;
  }

  /** Read a unit unless it was read less than `minGap` periods ago. */
  async pollRecord(record, minGap) {
    const period = this.config.pollSeconds * 1000;
    if (Date.now() - record.lastPolledAt < period * minGap) {
      logger.debug(
        `${this.label(record)}: read ${Date.now() - record.lastPolledAt} ms ago, skipped`,
      );
      return;
    }
    if (record.version === 3 && !record.credentials) {
      return;
    }
    if (!record.capsQueried) {
      await this.connectRecord(record);
      return;
    }
    await this.refresh(record);
  }

  /** The core's onPoll (fallback): skipped while the timer does its job. */
  async pollFromCore(device) {
    const record = this.resolveDevice(device?.external_id);
    if (record) {
      await this.pollRecord(record, 0.9);
    }
  }

  /**
   * Read one unit and publish what changed. An unreachable unit is counted,
   * not thrown (unless `rethrow`); Gladys refusing the states is thrown.
   */
  async refresh(record, { rethrow = false } = {}) {
    const seq = record.commandSeq;
    record.lastPolledAt = Date.now();
    let reading;
    try {
      reading = isHeatPump(record) ? await this.readHeatPump(record) : await this.readAc(record);
    } catch (err) {
      if (rethrow) {
        throw err;
      }
      await this.readFailed(record, err);
      return;
    }
    this.problems.recover(`read:${record.id}`, `${this.label(record)} reads again`);
    if (seq !== record.commandSeq) {
      // A Gladys command ran meanwhile: this reading may predate it.
      return;
    }
    Object.assign(record, reading.extra);
    await this.applyReading(record, reading.state);
  }

  async readAc(record) {
    let energy = record.energy;
    let humidity = record.humidity;
    const state = decodeResponse(await record.lan.request(getStateCommand(), isState)).state;
    const options = { energyFormat: this.config.energyFormat };
    if (record.caps.energy) {
      energy = decodeResponse(
        await record.lan.request(getGroupDataCommand(4), isGroup(4)),
        options,
      );
    }
    if (record.caps.humidity) {
      humidity = decodeResponse(
        await record.lan.request(getGroupDataCommand(5), isGroup(5)),
      ).humidity;
    }
    return {
      state,
      extra: {
        energy: energy ? { totalEnergy: energy.totalEnergy, power: energy.power } : null,
        humidity,
      },
    };
  }

  async readHeatPump(record) {
    const state = decodeC3Response(await this.probe(record)).state;
    const unit = record.caps?.unit ? await this.queryHeatPumpUnit(record) : null;
    const silentLevel = record.caps?.silenceLevel ? await this.queryHeatPumpSilence(record) : null;
    return {
      state,
      extra: {
        // The run time comes only with the notifications: kept across reads.
        unit: unit ? { ...record.unit, ...unit } : record.unit,
        silentLevel: silentLevel ?? record.silentLevel,
      },
    };
  }

  /** A read that failed: counted when the unit does not answer, said once otherwise. */
  async readFailed(record, err) {
    if (err.unreachable) {
      await this.failed(record);
    } else if (err.auth) {
      // The keys stopped working: the next discovery fetches new ones.
      record.credentials = null;
      this.problems.fail(`read:${record.id}`, `${this.label(record)} refuses its keys`);
    } else {
      this.problems.fail(`read:${record.id}`, `Cannot read ${this.label(record)}: ${err.message}`);
    }
  }

  /**
   * What a heat pump pushes between the reads: its state after a change made
   * on its controller, its sensors, its energy counters.
   */
  async heatPumpPush(record, frame) {
    let decoded;
    try {
      decoded = decodeC3Response(frame);
    } catch (err) {
      logger.debug(`${this.label(record)}: ${err.message}`);
      return;
    }
    if (decoded.kind === 'energy') {
      record.energy = decoded.energy;
      if (!record.hasEnergy) {
        record.hasEnergy = true;
        await this.save();
        await this.publishDevices();
      }
      await this.publishStates(record);
    } else if (decoded.kind === 'unit' && record.caps?.unit) {
      record.unit = { ...record.unit, ...decoded.unit };
      if (!record.hasRunTime && decoded.unit.compressorRunTime !== undefined) {
        record.hasRunTime = true;
        await this.save();
        await this.publishDevices();
      }
      await this.publishStates(record);
    } else if (decoded.kind === 'basic' && record.capsQueried) {
      await this.applyReading(record, decoded.state);
    } else {
      logger.debug(`${this.label(record)}: unsolicited ${frame.toString('hex')}`);
    }
  }

  /**
   * A fresh state: follow the reachability, fire the triggers, publish what
   * changed.
   */
  async applyReading(record, state) {
    record.state = state;
    record.failures = 0;
    const heatPump = isHeatPump(record);
    let structureChanged = false;
    if (!heatPump && state.outdoorTemperature !== null && !record.hasOutdoor) {
      record.hasOutdoor = true;
      structureChanged = true;
    }
    if (record.reachable !== true) {
      record.reachable = true;
      logger.info(`${this.label(record)} answers at ${record.host}`);
      await this.publishTransports([record]);
      await this.publishConnectionStatus();
      this.requestWidgetRefresh();
    }
    let persist = structureChanged;
    if (!heatPump && record.filterAlert !== state.filterAlert) {
      if (record.filterAlert === false && state.filterAlert) {
        this.fire(record, TRIGGERS.FILTER, {});
      }
      record.filterAlert = state.filterAlert;
      persist = true;
    }
    if (record.errorCode !== state.errorCode) {
      if (record.errorCode !== null && state.errorCode !== 0) {
        logger.info(`${this.label(record)} reports error code ${state.errorCode}`);
        this.fire(record, TRIGGERS.ERROR, {
          error_code: state.errorCode,
          // What the unit's own screen shows (E8...), the number for an air conditioner.
          error_display: isHeatPump(record)
            ? errorDisplay(state.errorCode)
            : String(state.errorCode),
        });
      }
      record.errorCode = state.errorCode;
      persist = true;
    }
    if (persist) {
      await this.save();
    }
    if (structureChanged) {
      await this.publishDevices();
    }
    const changed = await this.publishStates(record);
    if (changed.some((key) => WIDGET_KEYS.includes(key))) {
      this.requestWidgetRefresh();
    }
  }

  /** A read without answer; after a few in a row the unit is unreachable. */
  async failed(record, { now = false } = {}) {
    if (this.stopped) {
      return;
    }
    record.failures += 1;
    if (record.reachable === false) {
      return;
    }
    if (!now && record.failures < this.timings.unreachableAfter) {
      return;
    }
    const known = record.reachable === true;
    record.reachable = false;
    if (known) {
      logger.info(`${this.label(record)} no longer answers at ${record.host}`);
    } else {
      logger.info(`${this.label(record)} does not answer at ${record.host}`);
    }
    await this.publishTransports([record]);
    await this.publishConnectionStatus();
    this.requestWidgetRefresh();
  }

  fire(record, key, data) {
    if (!this.isCreated(record)) {
      return;
    }
    this.track(
      this.gladys.publishSceneEvent(key, {
        device: this.ids(record).device,
        ...data,
      }),
    );
  }

  // --- Commands ----------------------------------------------------------------

  /** The current state, read now if not known yet. */
  async currentState(record) {
    if (!record.state) {
      await this.refresh(record, { rethrow: true });
    }
    return record.state;
  }

  /**
   * Send a whole set of settings (the unit has no partial command), then take
   * the state it answers.
   */
  async send(record, settings) {
    record.commandSeq += 1;
    let answer;
    try {
      answer = await record.lan.request(
        setStateCommand({ ...settings, beep: this.config.beep }),
        isAnyAc,
      );
    } catch (err) {
      if (err.unreachable) {
        await this.failed(record, { now: true });
        throw new Error(`${this.label(record)} does not answer at ${record.host}`, { cause: err });
      }
      throw err;
    }
    let state = null;
    try {
      const decoded = decodeResponse(answer);
      state = decoded.kind === 'state' ? decoded.state : null;
    } catch {
      // An acknowledgement without state: assume the settings took.
    }
    // The unit keeps its sensors: only the settings come from the command.
    await this.applyReading(record, state ?? { ...record.state, ...settings });
  }

  /**
   * A heat pump command (heatPumpCommand): the basic settings at once, or
   * eco or silent mode. midea-local does not wait for an answer to these:
   * an answer carrying the state is taken, its absence means the settings
   * took, and the next read says otherwise if they did not.
   */
  async sendHeatPump(record, command) {
    record.commandSeq += 1;
    const protocol = { protocol: record.protocol ?? 0 };
    let frame;
    let bodyType;
    let assumed;
    if (command.basic) {
      frame = setBasicCommand(command.basic, protocol);
      bodyType = BODY_TYPE.BASIC;
      assumed = command.basic;
    } else if (command.eco !== undefined) {
      frame = setEcoCommand(command.eco, protocol);
      bodyType = BODY_TYPE.ECO;
      assumed = { ...record.state, eco: command.eco };
    } else {
      frame = setSilentCommand(command.silentLevel, protocol);
      bodyType = BODY_TYPE.SILENCE;
      assumed = { ...record.state, silent: command.silentLevel !== SILENT_LEVEL.OFF };
      record.silentLevel = command.silentLevel;
    }
    let answer;
    try {
      answer = await record.lan.request(frame, answersBody(bodyType), {
        optional: true,
        retries: 1,
      });
    } catch (err) {
      if (err.unreachable) {
        await this.failed(record, { now: true });
        throw new Error(`${this.label(record)} does not answer at ${record.host}`, { cause: err });
      }
      throw err;
    }
    let state = null;
    try {
      const decoded = answer ? decodeC3Response(answer) : null;
      state = decoded?.kind === 'basic' ? decoded.state : null;
    } catch {
      // An acknowledgement without state: assume the settings took.
    }
    await this.applyReading(record, state ?? assumed);
  }

  /** A Gladys command on a feature of one of the units. */
  async setValue(device, feature, value) {
    const record = this.require(device?.external_id);
    const prefix = `${device.external_id}:`;
    const key = feature?.external_id?.startsWith(prefix)
      ? feature.external_id.slice(prefix.length)
      : null;
    logger.info(`Command: ${this.label(record)} ${key} = ${value}`);
    await this.currentState(record);
    if (isHeatPump(record)) {
      await this.sendHeatPump(record, heatPumpCommand(record, key, value));
      return;
    }
    await this.send(record, applyCommand(record, key, value));
  }

  /**
   * Several settings at once (scene action, widget form): `{ power, mode,
   * targetTemperature, fanSpeed }` in Gladys values, each optional.
   */
  async applySettings(deviceExternalId, settings) {
    const record = this.require(deviceExternalId);
    if (isHeatPump(record)) {
      throw new Error(`${this.label(record)} is a heat pump, not an air conditioner`);
    }
    await this.currentState(record);
    let next = { ...record.state };
    const steps = [
      [FEATURE_KEYS.POWER, settings.power],
      [FEATURE_KEYS.MODE, settings.mode],
      [FEATURE_KEYS.TARGET_TEMPERATURE, settings.targetTemperature],
      [FEATURE_KEYS.FAN_SPEED, settings.fanSpeed],
    ];
    for (const [key, value] of steps) {
      if (value !== undefined && value !== null && value !== '') {
        next = applyCommand({ ...record, state: next }, key, value);
      }
    }
    await this.send(record, next);
    return record;
  }

  /** What the Configuration screen's "Search" action reports. */
  summary() {
    return {
      scan: this.lastScan.status,
      invalidHosts: this.config.invalidHosts,
      unsupported: [...this.unsupported.values()],
      devices: [...this.records.values()].map((record) => ({
        names: Object.fromEntries(
          LANGUAGES.map((language) => [language, this.name(record, language)]),
        ),
        host: record.host,
        version: record.version,
        status:
          record.reachable === true
            ? 'answering'
            : record.version === 3 && !record.credentials
              ? 'no-keys'
              : 'unreachable',
      })),
    };
  }
}
