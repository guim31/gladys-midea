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
      const reply = encodePacket(this.id, answer);
      socket.push(
        this.version === 3
          ? session.codec.encrypt(reply, undefined, V3_TYPE.ENCRYPTED_RESPONSE)
          : reply,
      );
    }
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
