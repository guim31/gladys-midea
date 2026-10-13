// -----------------------------------------------------------------------------
// LAN packets (port 6444), ported from msmart-ng `lan.py` (MIT).
//
// V2 packet: 40-byte header (0x5A5A, type 0x0111, length, 0x2000, message
// id, timestamp, device id), the command frame encrypted (AES-ECB), and an
// MD5 signature.
//
// V3 "8370" envelope: 6-byte header (0x8370, size, 0x20, padding << 4 |
// type), a 2-byte packet id, the payload (a V2 packet), AES-256-CBC under the
// session key, then the SHA-256 of header + plain payload.
// -----------------------------------------------------------------------------

import { randomBytes } from 'node:crypto';
import {
  decryptCbc,
  decryptEcb,
  encryptCbc,
  encryptEcb,
  sessionKey,
  sha256,
  signV2,
} from './security.js';

export const V3_TYPE = {
  HANDSHAKE_REQUEST: 0x0,
  HANDSHAKE_RESPONSE: 0x1,
  ENCRYPTED_RESPONSE: 0x3,
  ENCRYPTED_REQUEST: 0x6,
  ERROR: 0xf,
};

/** 8 bytes: hundredths, seconds, minutes, hours, day, month, year % 100, century. */
function timestamp(now = new Date()) {
  return Buffer.from([
    Math.floor(now.getUTCMilliseconds() / 10),
    now.getUTCSeconds(),
    now.getUTCMinutes(),
    now.getUTCHours(),
    now.getUTCDate(),
    now.getUTCMonth() + 1,
    now.getUTCFullYear() % 100,
    Math.floor(now.getUTCFullYear() / 100),
  ]);
}

/**
 * Wrap a command frame in a V2 packet.
 * @param {number} deviceId
 * @param {Buffer} frame
 * @param {Date} [now]
 */
export function encodePacket(deviceId, frame, now) {
  const payload = encryptEcb(frame);
  const header = Buffer.alloc(40);
  header.writeUInt16BE(0x5a5a, 0);
  header.writeUInt16BE(0x0111, 2);
  header.writeUInt16LE(40 + payload.length + 16, 4);
  header.writeUInt16BE(0x2000, 6);
  timestamp(now).copy(header, 12);
  header.writeUIntLE(deviceId, 20, 6);
  const packet = Buffer.concat([header, payload]);
  return Buffer.concat([packet, signV2(packet)]);
}

/** Length announced by a V2 packet header, or null when not a V2 packet. */
export function packetLength(data) {
  if (data.length < 6 || data[0] !== 0x5a || data[1] !== 0x5a) {
    return null;
  }
  return data.readUInt16LE(4);
}

/**
 * Unwrap a V2 packet into its command frame, or null for a packet without
 * frame (the module's own heartbeat answers). Throws on a forged or
 * truncated packet.
 * @param {Buffer} data
 */
export function decodePacket(data) {
  const length = packetLength(data);
  if (length === null) {
    throw new Error(`not a V2 packet: ${data.subarray(0, 8).toString('hex')}`);
  }
  if (data.length < length) {
    throw new Error(`truncated packet: ${data.length} of ${length} bytes`);
  }
  const packet = data.subarray(0, length);
  const type = packet.readUInt16LE(2);
  if (type === 0x1001 || type === 0x0001 || length <= 56) {
    return null;
  }
  if (!signV2(packet.subarray(0, length - 16)).equals(packet.subarray(length - 16))) {
    throw new Error('packet signature mismatch');
  }
  return decryptEcb(packet.subarray(40, length - 16));
}

/**
 * One V3 connection: the packet counter and the session key.
 */
export class V3Codec {
  constructor() {
    this.packetId = 0;
    this.key = null;
  }

  header(size, type, pad = 0) {
    const header = Buffer.alloc(6);
    header.writeUInt16BE(0x8370, 0);
    header.writeUInt16BE(size, 2);
    header[4] = 0x20;
    header[5] = (pad << 4) | type;
    return header;
  }

  nextId() {
    const id = Buffer.alloc(2);
    id.writeUInt16BE(this.packetId, 0);
    this.packetId = (this.packetId + 1) & 0xfff;
    return id;
  }

  /** The handshake request carrying the device token. */
  handshake(token) {
    return Buffer.concat([
      this.header(token.length, V3_TYPE.HANDSHAKE_REQUEST),
      this.nextId(),
      token,
    ]);
  }

  /** Derive the session key from the handshake answer payload. */
  authenticate(key, payload) {
    this.key = sessionKey(key, payload);
  }

  /** Wrap a V2 packet in an encrypted request (or response: the unit's side). */
  encrypt(data, padding = randomBytes, type = V3_TYPE.ENCRYPTED_REQUEST) {
    if (!this.key) {
      throw new Error('V3 connection not authenticated');
    }
    const remainder = (data.length + 2) % 16;
    const pad = remainder === 0 ? 0 : 16 - remainder;
    const header = this.header(data.length + pad + 32, type, pad);
    const plain = Buffer.concat([this.nextId(), data, padding(pad)]);
    return Buffer.concat([
      header,
      encryptCbc(this.key, plain),
      sha256(Buffer.concat([header, plain])),
    ]);
  }

  /**
   * Decode one complete 8370 packet: `{ type, payload }`, the payload being
   * the V2 packet of an encrypted response or the handshake answer.
   */
  decode(packet) {
    if (packet.length < 8 || packet[0] !== 0x83 || packet[1] !== 0x70 || packet[4] !== 0x20) {
      throw new Error(`not a V3 packet: ${packet.subarray(0, 8).toString('hex')}`);
    }
    const type = packet[5] & 0xf;
    if (type === V3_TYPE.ERROR) {
      throw Object.assign(new Error('the device answered with an error packet'), {
        kind: 'v3-error',
      });
    }
    if (type === V3_TYPE.HANDSHAKE_RESPONSE) {
      return { type, payload: packet.subarray(8) };
    }
    if (type !== V3_TYPE.ENCRYPTED_RESPONSE && type !== V3_TYPE.ENCRYPTED_REQUEST) {
      throw new Error(`unexpected V3 packet type ${type}`);
    }
    if (!this.key) {
      throw new Error('V3 connection not authenticated');
    }
    const header = packet.subarray(0, 6);
    const plain = decryptCbc(this.key, packet.subarray(6, packet.length - 32));
    if (!sha256(Buffer.concat([header, plain])).equals(packet.subarray(packet.length - 32))) {
      throw new Error('V3 packet signature mismatch');
    }
    const pad = header[5] >> 4;
    return { type, payload: plain.subarray(2, plain.length - pad) };
  }
}

/** Total length of the 8370 packet at the start of `data`, or null if incomplete. */
export function v3PacketLength(data) {
  if (data.length < 6) {
    return null;
  }
  return data.readUInt16BE(2) + 8;
}
