// -----------------------------------------------------------------------------
// Midea discovery, ported from msmart-ng `discover.py` and midea-local
// `discover.py` (MIT).
//
// A fixed 72-byte request sent in UDP to ports 6445 and 20086; every Midea
// Wi-Fi module answers in unicast to the sender with an encrypted
// description: its address, TCP port, serial number, SSID ("net_ac_XXXX",
// the appliance type in hex) and protocol version (0x5A5A: V2, 0x8370: V3).
// -----------------------------------------------------------------------------

import { decryptEcb } from './security.js';

export const DISCOVERY_PORTS = [6445, 20086];

export const DISCOVERY_REQUEST = Buffer.from(
  '5a5a0111480092000000000000000000000000000000000000000000000000000000000000000000' +
    '7f75bd6b3e4f8b762e849c6e578d6590036e9d4342a50f1f569eb8ec918e92e5',
  'hex',
);

/**
 * Decode one discovery answer.
 * @param {Buffer} data the raw UDP payload
 * @param {string} sourceIp the address it came from (preferred to the one inside)
 * @returns {{ deviceId: number, host: string, port: number, version: 2|3,
 *   type: number, serial: string, ssid: string, model: string } | null}
 */
export function parseDiscoveryReply(data, sourceIp) {
  if (!Buffer.isBuffer(data) || data.length < 8) {
    return null;
  }
  let packet;
  let version;
  if (data[0] === 0x5a && data[1] === 0x5a) {
    version = 2;
    packet = data;
  } else if (data[0] === 0x83 && data[1] === 0x70 && data.length > 24) {
    version = 3;
    packet = data.subarray(8, data.length - 16);
  } else {
    // XML answers come from the first-generation (V1) modules: not supported.
    return null;
  }
  if (packet.length < 104 || packet[0] !== 0x5a || packet[1] !== 0x5a) {
    return null;
  }
  const deviceId = packet.readUIntLE(20, 6);
  let reply;
  try {
    reply = decryptEcb(packet.subarray(40, packet.length - 16));
  } catch {
    return null;
  }
  if (reply.length <= 41 || reply[40] + 41 > reply.length) {
    return null;
  }
  const ssid = reply.subarray(41, 41 + reply[40]).toString('ascii');
  const type = Number.parseInt(ssid.split('_')[1] ?? '', 16);
  if (!Number.isInteger(type)) {
    return null;
  }
  const port = reply.readUInt32LE(4) || 6444;
  const announced = [3, 2, 1, 0].map((index) => reply[index]).join('.');
  return {
    deviceId,
    host: sourceIp || announced,
    port: port > 0 && port < 65536 ? port : 6444,
    version,
    type,
    serial: printable(reply.subarray(8, 40)),
    ssid,
    model: printable(reply.subarray(17, 25)),
  };
}

const printable = (bytes) =>
  bytes
    .toString('ascii')
    .replace(/[^\x20-\x7e]/g, '')
    .trim();
