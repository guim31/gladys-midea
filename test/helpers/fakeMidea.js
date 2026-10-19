// -----------------------------------------------------------------------------
// Fake Midea air conditioners on a fake network: each one answers the
// discovery request, the TCP session (V2, or V3 with its handshake) and the
// command frames like a unit does. The capability answers are real frames
// from msmart-ng's tests (test/fixtures/msmart-vectors.json); the state
// answers are built from the fake's settings with the layout parseState reads.
// Addresses are 192.0.2.x (documentation range), ids and keys are invented.
// -----------------------------------------------------------------------------

import { EventEmitter } from 'node:events';
import { readFileSync } from 'node:fs';
import { randomBytes } from 'node:crypto';
import { buildFrame, FRAME_TYPE } from '../../src/midea/frame.js';
import {
  V3Codec,
  V3_TYPE,
  decodePacket,
  encodePacket,
  packetLength,
  v3PacketLength,
} from '../../src/midea/packet.js';
import { encryptCbc, encryptEcb, sha256, signV2, udpId } from '../../src/midea/security.js';

const vectors = JSON.parse(
  readFileSync(new URL('../fixtures/msmart-vectors.json', import.meta.url), 'utf8'),
);
const hex = (value) => Buffer.from(value, 'hex');

// Real capability answers (msmart-ng tests).
export const CAPS = {
  // Cool, heat, dry, auto, both swings, eco, turbo, freeze protection.
  basic: [hex(vectors.capabilities[0].frame)],
  // Same family, with a second page (msmart-ng issue #60).
  twoPages: [
    hex(vectors.capabilities[4].frame),
    hex('aa23ac00000000000303b5051e020101130201012202010019020100390001010000febe'),
  ],
  // A window unit: cool, dry, fan; no heat, no horizontal swing.
  window: [hex(vectors.capabilities[3].frame)],
};

/** A capability answer built from raw capability entries (id, value). */
export function capabilityFrame(entries) {
  const body = [0xb5, entries.length];
  for (const [id, value] of entries) {
    body.push(id & 0xff, id >> 8, 1, value);
  }
  body.push(0x00);
  return buildFrame(FRAME_TYPE.QUERY, body, { id: 0 });
}

// A unit with an energy meter and a humidity sensor (synthetic, same grammar).
CAPS.metered = [
  capabilityFrame([
    [0x0214, 1], // cool, heat, dry, auto
    [0x0215, 1], // both swings
    [0x0212, 1], // eco
    [0x021a, 1], // turbo
    [0x0216, 2], // energy statistics
    [0x0217, 1], // filter reminder
    [0x021f, 1], // humidity
  ]),
];

const DEFAULT_STATE = {
  power: false,
  mode: 2,
  targetTemperature: 24,
  fanSpeed: 102,
  swing: 0,
  eco: false,
  turbo: false,
  sleep: false,
  indoorTemperature: 26.5,
  outdoorTemperature: 31,
  filterAlert: false,
  errorCode: 0,
};

/** The STATE answer of a unit with these settings. */
export function stateFrame(state) {
  const body = new Array(23).fill(0);
  body[0] = 0xc0;
  body[1] = state.power ? 1 : 0;
  const integral = Math.trunc(state.targetTemperature);
  const half = state.targetTemperature - integral > 0;
  const inRange = integral >= 17 && integral <= 30;
  body[2] = ((state.mode & 7) << 5) | (inRange ? integral - 16 : 0) | (half ? 0x10 : 0);
  body[3] = state.fanSpeed;
  body[4] = 0x7f;
  body[5] = 0x7f;
  body[7] = state.swing;
  body[8] = state.turbo ? 0x20 : 0;
  body[9] = state.eco ? 0x10 : 0;
  body[10] = (state.sleep ? 1 : 0) | (state.turbo ? 2 : 0);
  body[11] = state.indoorTemperature === null ? 0xff : Math.round(state.indoorTemperature * 2 + 50);
  body[12] =
    state.outdoorTemperature === null ? 0xff : Math.round(state.outdoorTemperature * 2 + 50);
  body[13] = (inRange ? 0 : (integral - 12) & 0x1f) | (state.filterAlert ? 0x20 : 0);
  body[16] = state.errorCode;
  body[19] = 40;
  return buildFrame(FRAME_TYPE.QUERY, body, { id: 0 });
}

/** A group 4 (energy, BCD) answer. */
export function energyFrame(totalKwh, watts) {
  const bcd = (n) => ((Math.floor(n / 10) % 10) << 4) | (n % 10);
  const centi = Math.round(totalKwh * 100);
  const body = new Array(24).fill(0);
  body.splice(0, 4, 0xc1, 0x21, 0x01, 0x44);
  body[4] = bcd(Math.floor(centi / 1000000) % 100);
  body[5] = bcd(Math.floor(centi / 10000) % 100);
  body[6] = bcd(Math.floor(centi / 100) % 100);
  body[7] = bcd(centi % 100);
  const deci = Math.round(watts * 10);
  body[16] = bcd(Math.floor(deci / 10000) % 100);
  body[17] = bcd(Math.floor(deci / 100) % 100);
  body[18] = bcd(deci % 100);
  return buildFrame(FRAME_TYPE.QUERY, body, { id: 0 });
}

export function humidityFrame(percent) {
  const body = new Array(22).fill(0);
  body.splice(0, 5, 0xc1, 0x21, 0x01, 0x45, percent);
  return buildFrame(FRAME_TYPE.QUERY, body, { id: 0 });
}

/** The settings a control frame carries. */
function parseControl(frame) {
  const body = frame.subarray(10);
  const alt = body[18] & 0x1f;
  const half = body[2] & 0x10 ? 0.5 : 0;
  return {
    power: Boolean(body[1] & 1),
    beep: Boolean(body[1] & 0x40),
    mode: (body[2] >> 5) & 7,
    targetTemperature: (alt ? alt + 12 : (body[2] & 0xf) + 16) + half,
    fanSpeed: body[3],
    swing: body[7] & 0xf,
    turbo: Boolean(body[8] & 0x20),
    eco: Boolean(body[9] & 0x80),
    sleep: Boolean(body[10] & 1),
  };
}

let nextId = 0x1e0000c0ff00;

export class FakeMidea {
  /**
   * @param {object} options
   * @param {string} options.host
   * @param {2|3} [options.version]
   * @param {Buffer[]|null} [options.caps] capability pages, null: no answer
   * @param {object} [options.state]
   * @param {number} [options.type] appliance type (0xAC)
   */
  constructor({ host, version = 2, caps = CAPS.basic, state = {}, type = 0xac, energy, humidity }) {
    this.id = nextId++;
    this.host = host;
    this.version = version;
    this.caps = caps;
    this.type = type;
    this.state = { ...DEFAULT_STATE, ...state };
    this.energy = energy ?? { total: 1234.56, watts: 650 };
    this.humidity = humidity ?? 48;
    this.ssid = `net_${type.toString(16)}_${(this.id & 0xffff).toString(16).toUpperCase().padStart(4, '0')}`;
    this.token = randomBytes(64);
    this.key = randomBytes(32);
    this.online = true;
    // Silent: connects but never answers (a stuck module).
    this.silent = false;
    this.controls = [];
    this.connections = 0;
  }

  get credentials() {
    return { token: this.token.toString('hex'), key: this.key.toString('hex') };
  }

  /** The unit's answer to the discovery request. */
  discoveryReply() {
    const reply = Buffer.alloc(41 + this.ssid.length + 16);
    this.host
      .split('.')
      .reverse()
      .forEach((part, index) => {
        reply[index] = Number(part);
      });
    reply.writeUInt32LE(6444, 4);
    Buffer.from(
      `000000P0000000Q1AABBCC${this.id.toString(16).slice(-6).toUpperCase()}0000`
        .padEnd(32, '0')
        .slice(0, 32),
    ).copy(reply, 8);
    reply[40] = this.ssid.length;
    Buffer.from(this.ssid).copy(reply, 41);
    const encrypted = encryptEcb(reply);
    const header = Buffer.alloc(40);
    header.writeUInt16BE(0x5a5a, 0);
    header.writeUInt16BE(0x0111, 2);
    header.writeUInt16LE(40 + encrypted.length + 16, 4);
    header.writeUIntLE(this.id, 20, 6);
    const body = Buffer.concat([header, encrypted]);
    const packet = Buffer.concat([body, signV2(body)]);
    if (this.version === 2) {
      return packet;
    }
    const prefix = Buffer.from([0x83, 0x70, 0, 0, 0x20, 0x0f, 0, 0]);
    return Buffer.concat([prefix, packet, Buffer.alloc(16)]);
  }

  /** What the unit answers to one command frame (null: nothing). */
  answer(frame) {
    const id = frame[10];
    if (id === 0x41 && frame[11] === 0x81) {
      return [stateFrame(this.state)];
    }
    if (id === 0xb5) {
      if (!this.caps) return [];
      const page = frame.length > 14 && frame[12] === 0x01 ? 1 : 0;
      return this.caps[page] ? [this.caps[page]] : [];
    }
    if (id === 0x41 && frame[11] === 0x21) {
      const group = frame[13] & 0xf;
      if (group === 4) return [energyFrame(this.energy.total, this.energy.watts)];
      if (group === 5) return [humidityFrame(this.humidity)];
      return [];
    }
    if (id === 0x40) {
      const control = parseControl(frame);
      this.controls.push(control);
      const settings = { ...control };
      delete settings.beep;
      Object.assign(this.state, settings);
      return [stateFrame(this.state)];
    }
    return [];
  }

  /** A client socket connected to this unit. */
  connect(socket) {
    this.connections += 1;
    const session = { codec: this.version === 3 ? new V3Codec() : null, buffer: Buffer.alloc(0) };
    this.latest = { session, socket };
    socket.onWrite = (data) => {
      session.buffer = Buffer.concat([session.buffer, data]);
      for (;;) {
        const length =
          this.version === 3 ? v3PacketLength(session.buffer) : packetLength(session.buffer);
        if (length === null || session.buffer.length < length) return;
        const packet = session.buffer.subarray(0, length);
        session.buffer = session.buffer.subarray(length);
        this.receive(session, socket, packet);
      }
    };
  }

  receive(session, socket, packet) {
    // Offline: an open connection goes silent, new ones are refused.
    if (this.silent || !this.online) return;
    let v2 = packet;
    if (this.version === 3) {
      if ((packet[5] & 0xf) === V3_TYPE.HANDSHAKE_REQUEST) {
        const token = packet.subarray(8);
        if (!token.equals(this.token)) {
          socket.push(Buffer.from([0x83, 0x70, 0x00, 0x00, 0x20, 0x0f, 0x00, 0x00]));
          return;
        }
        const plain = randomBytes(32);
        const payload = Buffer.concat([encryptCbc(this.key, plain), sha256(plain)]);
        const local = Buffer.alloc(32);
        for (let i = 0; i < 32; i += 1) local[i] = plain[i] ^ this.key[i];
        session.codec.key = local;
        const header = Buffer.from([0x83, 0x70, 0x00, 0x40, 0x20, 0x01, 0x00, 0x00]);
        socket.push(Buffer.concat([header, payload]));
        return;
      }
      v2 = session.codec.decode(packet).payload;
    }
    const frame = decodePacket(v2);
    for (const answer of this.answer(frame)) {
      this.send(session, socket, answer);
    }
  }

  send(session, socket, frame) {
    const reply = encodePacket(this.id, frame);
    socket.push(
      this.version === 3
        ? session.codec.encrypt(reply, undefined, V3_TYPE.ENCRYPTED_RESPONSE)
        : reply,
    );
  }
}

/** A socket the LAN client writes to, wired to a fake unit. */
class FakeSocket extends EventEmitter {
  constructor() {
    super();
    this.onWrite = () => {};
    this.destroyed = false;
  }

  write(data) {
    if (!this.destroyed) {
      setImmediate(() => this.onWrite(Buffer.from(data)));
    }
    return true;
  }

  push(data) {
    setImmediate(() => {
      if (!this.destroyed) this.emit('data', data);
    });
  }

  setNoDelay() {}

  destroy() {
    if (this.destroyed) return;
    this.destroyed = true;
    setImmediate(() => this.emit('close'));
  }
}

/** The network of fake units: TCP connections, unicast probes, broadcast replies. */
export function createNetwork(units) {
  const byHost = () => new Map(units.map((unit) => [unit.host, unit]));
  return {
    units,
    connect({ host }) {
      const socket = new FakeSocket();
      const unit = byHost().get(host);
      setImmediate(() => {
        if (!unit || !unit.online) {
          socket.emit(
            'error',
            Object.assign(new Error('connect ECONNREFUSED'), { code: 'ECONNREFUSED' }),
          );
          return;
        }
        unit.connect(socket);
        socket.emit('connect');
      });
      return socket;
    },
    async probe(host) {
      const unit = byHost().get(host);
      if (!unit || !unit.online) return null;
      const { parseDiscoveryReply } = await import('../../src/midea/discovery.js');
      return parseDiscoveryReply(unit.discoveryReply(), host);
    },
    scanReplies() {
      return units
        .filter((unit) => unit.online)
        .map((unit) => ({
          source_ip: unit.host,
          source_port: 6445,
          payload_base64: unit.discoveryReply().toString('base64'),
        }));
    },
  };
}

/** A fake Midea cloud: the token of every V3 unit under its little-endian udpid. */
export function createFakeCloud(units, { reachable = true } = {}) {
  const calls = [];
  return {
    calls,
    async getToken(udpid) {
      calls.push(udpid);
      if (!reachable) {
        throw Object.assign(new Error('Midea cloud unreachable (ENOTFOUND)'), {
          name: 'CloudError',
          network: true,
        });
      }
      const unit = units.find((candidate) => udpId(candidate.id, 'little') === udpid);
      if (!unit) {
        throw Object.assign(new Error('Midea cloud has no token for this device'), {
          name: 'CloudError',
          code: 'NO_TOKEN',
        });
      }
      return unit.credentials;
    },
  };
}

// --- Heat pumps (appliance 0xC3) -------------------------------------------------

const DEFAULT_HEAT_PUMP = {
  zone1Power: true,
  zone2Power: false,
  dhwPower: false,
  zone1Curve: false,
  zone2Curve: false,
  tbh: false,
  fastDhw: false,
  heat: true,
  cool: false,
  dhw: true,
  doubleZone: false,
  zoneWaterTemperature: [true, false],
  silent: false,
  silentLevel: 0,
  eco: false,
  mode: 3,
  modeAuto: 3,
  zoneTargets: [50, 25],
  dhwTarget: 50,
  roomTarget: 22,
  zoneHeating: [
    { min: 25, max: 60 },
    { min: 25, max: 55 },
  ],
  zoneCooling: [
    { min: 18, max: 25 },
    { min: 18, max: 25 },
  ],
  room: { min: 17, max: 30 },
  dhwRange: { min: 20, max: 60 },
  tankTemperature: 25,
  errorCode: 0,
};

/** A C3 frame (midea-local layout: no message id, no CRC-8). */
export function c3Frame(messageType, body, protocol = 2) {
  const header = Buffer.from([0xaa, 10 + body.length, 0xc3, 0, 0, 0, 0, 0, protocol, messageType]);
  const frame = Buffer.concat([header, Buffer.from(body)]);
  let sum = 0;
  for (const byte of frame.subarray(1)) sum += byte;
  return Buffer.concat([frame, Buffer.from([(~sum + 1) & 0xff])]);
}

/** The basic body (type 0x01) of a heat pump with this state. */
export function basicBody(state) {
  const flag = (value, mask) => (value ? mask : 0);
  return [
    0x01,
    flag(state.zone1Power, 0x01) |
      flag(state.zone2Power, 0x02) |
      flag(state.dhwPower, 0x04) |
      flag(state.zone1Curve, 0x08) |
      flag(state.zone2Curve, 0x10) |
      flag(state.tbh, 0x20) |
      flag(state.fastDhw, 0x40),
    flag(state.heat, 0x01) |
      flag(state.cool, 0x02) |
      flag(state.dhw, 0x04) |
      flag(state.doubleZone, 0x08) |
      flag(state.zoneWaterTemperature[0], 0x10) |
      flag(state.zoneWaterTemperature[1], 0x20),
    flag(state.silent, 0x02) | flag(state.eco, 0x08),
    state.mode,
    state.modeAuto,
    state.zoneTargets[0],
    state.zoneTargets[1],
    state.dhwTarget,
    state.roomTarget * 2,
    state.zoneHeating[0].max,
    state.zoneHeating[0].min,
    state.zoneCooling[0].max,
    state.zoneCooling[0].min,
    state.zoneHeating[1].max,
    state.zoneHeating[1].min,
    state.zoneCooling[1].max,
    state.zoneCooling[1].min,
    state.room.max * 2,
    state.room.min * 2,
    state.dhwRange.max,
    state.dhwRange.min,
    state.tankTemperature,
    state.errorCode,
    0x00,
  ];
}

/** The unit parameters body (type 0x10). */
export function unitBody({
  outdoor,
  waterIn,
  waterOut,
  watts,
  compressor = 40,
  run = 0x10,
  defrost = false,
  backup = false,
  flow = 152,
  pressure = 180,
}) {
  const body = new Array(1 + 190).fill(0);
  body[0] = 0x10;
  body[1 + 0] = compressor;
  body[1 + 7] = outdoor & 0xff;
  body[1 + 9] = waterIn;
  body[1 + 10] = waterOut;
  body[1 + 30] = run;
  body[1 + 31] = defrost ? 0x80 : 0;
  body[1 + 32] = backup ? 0x01 : 0;
  body[1 + 54] = flow >> 8;
  body[1 + 55] = flow & 0xff;
  body[1 + 61] = pressure >> 8;
  body[1 + 62] = pressure & 0xff;
  body[1 + 82] = watts >> 8;
  body[1 + 83] = watts & 0xff;
  return body;
}

/** The unit parameters notification body (notify1, type 0x05). */
export function unitNotificationBody({ outdoor, waterIn, waterOut, watts, runTime }) {
  const body = new Array(1 + 70).fill(0);
  body[0] = 0x05;
  body[1 + 0] = 40;
  body[1 + 3] = outdoor & 0xff;
  body[1 + 5] = waterIn;
  body[1 + 6] = waterOut;
  body[1 + 48] = watts >> 8;
  body[1 + 49] = watts & 0xff;
  body[1 + 56] = runTime >> 8;
  body[1 + 57] = runTime & 0xff;
  return body;
}

/** The silence answer body (type 0x05): level 1 or 3 as bits 0 and 3. */
export const silenceBody = (level) => [
  0x05,
  level === 0 ? 0 : level === 3 ? 0x09 : 0x01,
  ...new Array(9).fill(0),
];

/** The energy notification body (type 0x04). */
export function energyBody(totalKwh, producedKwh = 0) {
  const u32 = (n) => [(n >>> 24) & 0xff, (n >> 16) & 0xff, (n >> 8) & 0xff, n & 0xff];
  return [0x04, 0x01, ...u32(totalKwh), ...u32(producedKwh), 5, 50, 25, 50, 22];
}

export class FakeHeatPump extends FakeMidea {
  /**
   * @param {object} options FakeMidea options, and:
   * @param {object} [options.state] DEFAULT_HEAT_PUMP overrides
   * @param {boolean} [options.unitAnswers] answers the unit parameters query
   * @param {boolean} [options.applianceAnswers] answers the appliance query
   * @param {boolean} [options.setAnswers] answers the set commands
   * @param {boolean} [options.silenceAnswers] answers the silence query
   */
  constructor({
    state = {},
    unitAnswers = true,
    applianceAnswers = true,
    setAnswers = true,
    silenceAnswers = true,
    ...options
  } = {}) {
    super({ ...options, type: 0xc3, caps: null });
    this.state = structuredClone({ ...DEFAULT_HEAT_PUMP, ...state });
    this.sensors = { outdoor: 6, waterIn: 30, waterOut: 35, watts: 1200 };
    this.unitAnswers = unitAnswers;
    this.applianceAnswers = applianceAnswers;
    this.setAnswers = setAnswers;
    this.silenceAnswers = silenceAnswers;
    this.frames = [];
  }

  /** Push a frame without request on the open session, as the unit does between the reads. */
  push(frame) {
    this.send(this.latest.session, this.latest.socket, frame);
  }

  answer(frame) {
    this.frames.push(frame);
    const type = frame[9];
    const body = frame.subarray(10, frame.length - 1);
    if (type === 0xa0) {
      return this.applianceAnswers ? [c3Frame(0xa0, new Array(19).fill(0), 2)] : [];
    }
    if (type === 0x03 && body[0] === 0x01) {
      return [c3Frame(0x03, basicBody(this.state))];
    }
    if (type === 0x03 && body[0] === 0x10) {
      return this.unitAnswers ? [c3Frame(0x03, unitBody(this.sensors))] : [];
    }
    if (type === 0x03 && body[0] === 0x05) {
      return this.silenceAnswers ? [c3Frame(0x03, silenceBody(this.state.silentLevel))] : [];
    }
    if (type === 0x02 && body[0] === 0x01) {
      const powers = body[1];
      Object.assign(this.state, {
        zone1Power: Boolean(powers & 1),
        zone2Power: Boolean(powers & 2),
        dhwPower: Boolean(powers & 4),
        mode: body[2],
        zoneTargets: [body[3], body[4]],
        dhwTarget: body[5],
        roomTarget: body[6] / 2,
        zone1Curve: Boolean(body[7] & 1),
        zone2Curve: Boolean(body[7] & 2),
        tbh: Boolean(body[7] & 4),
        fastDhw: Boolean(body[7] & 8),
      });
      return this.setAnswers ? [c3Frame(0x02, basicBody(this.state))] : [];
    }
    if (type === 0x02 && body[0] === 0x07) {
      this.state.eco = Boolean(body[1] & 1);
      return this.setAnswers ? [c3Frame(0x02, [0x07, body[1], 0, 0, 0, 0, 0])] : [];
    }
    if (type === 0x02 && body[0] === 0x05) {
      this.state.silent = body[1] !== 0;
      this.state.silentLevel = body[1];
      return this.setAnswers ? [c3Frame(0x02, [0x05, body[1], 0, 0, 0, 0, 0, 0, 0, 0])] : [];
    }
    return [];
  }
}

// --- Dehumidifiers (appliance 0xA1) ----------------------------------------------

const DEFAULT_DEHUMIDIFIER = {
  power: true,
  mode: 3,
  fanSpeed: 60,
  targetHumidity: 55,
  childLock: false,
  anion: false,
  pump: false,
  pumpEnabled: false,
  filterAlert: false,
  tank: 30,
  waterLevelSet: 50,
  humidity: 62,
  temperature: 21,
  swing: false,
};

/** The state body (0xC8) of a dehumidifier, midea-local's layout. */
export function dehumidifierBody(state) {
  const body = new Array(25).fill(0);
  body[0] = 0xc8;
  body[1] = state.power ? 1 : 0;
  body[2] = state.mode;
  body[3] = state.fanSpeed;
  body[7] = state.targetHumidity;
  body[8] = state.childLock ? 0x80 : 0;
  body[9] =
    (state.anion ? 0x40 : 0) |
    (state.pump ? 0x08 : 0) |
    (state.pumpEnabled ? 0x10 : 0) |
    (state.filterAlert ? 0x80 : 0);
  body[10] = state.tank;
  body[15] = state.waterLevelSet;
  body[16] = state.humidity;
  body[17] = Math.round(state.temperature * 2 + 50);
  body[19] = state.swing ? 0x20 : 0;
  return body;
}

export class FakeDehumidifier extends FakeMidea {
  /**
   * @param {object} options FakeMidea options, and:
   * @param {object} [options.state] DEFAULT_DEHUMIDIFIER overrides
   */
  constructor({ state = {}, ...options } = {}) {
    super({ ...options, type: 0xa1, caps: null });
    this.state = { ...DEFAULT_DEHUMIDIFIER, ...state };
    this.frames = [];
  }

  frame(frameType, body) {
    return buildFrame(frameType, body, { id: 0, appliance: 0xa1 });
  }

  /** Push the state without request, as the unit does after a change on it. */
  push() {
    this.send(
      this.latest.session,
      this.latest.socket,
      this.frame(0x04, dehumidifierBody(this.state)),
    );
  }

  answer(frame) {
    this.frames.push(frame);
    const body = frame.subarray(10, frame.length - 2);
    if (frame[9] === 0x03 && body[0] === 0x41) {
      return [this.frame(FRAME_TYPE.QUERY, dehumidifierBody(this.state))];
    }
    if (frame[9] === 0x02 && body[0] === 0x48) {
      Object.assign(this.state, {
        power: Boolean(body[1] & 1),
        beep: Boolean(body[1] & 0x40),
        mode: body[2],
        fanSpeed: body[3],
        targetHumidity: body[7],
        childLock: Boolean(body[8] & 0x80),
        anion: Boolean(body[9] & 0x40),
        pump: Boolean(body[9] & 0x08),
        swing: Boolean(body[10] & 0x08),
        waterLevelSet: body[13],
      });
      return [this.frame(FRAME_TYPE.CONTROL, dehumidifierBody(this.state))];
    }
    return [];
  }
}
