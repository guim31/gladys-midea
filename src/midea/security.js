// -----------------------------------------------------------------------------
// The cryptography of the Midea LAN protocol, ported from msmart-ng
// (mill1000/midea-msmart, MIT) and midea-local (midea-lan/midea-local, MIT).
//
// - V2 packets: the command frame is encrypted with AES-128-ECB under a fixed
//   key (MD5 of the sign key), the packet is signed with MD5(packet + sign
//   key). Every Midea Wi-Fi module shares these constants.
// - V3 devices (most units sold since 2020) wrap the V2 packet in an "8370"
//   envelope encrypted with AES-256-CBC under a session key. The session key
//   comes from a handshake that needs the device's token and key, obtained
//   once from the Midea cloud (src/midea/cloud.js).
// -----------------------------------------------------------------------------

import { createCipheriv, createDecipheriv, createHash } from 'node:crypto';

const SIGN_KEY = Buffer.from('xhdiwjnchekd4d512chdjx5d8e4c394D2D7S', 'ascii');
const ENC_KEY = createHash('md5').update(SIGN_KEY).digest();
const ZERO_IV = Buffer.alloc(16);

export const sha256 = (data) => createHash('sha256').update(data).digest();

/** AES-128-ECB with PKCS#7 padding, under the fixed key (V2 payloads). */
export function encryptEcb(data) {
  const cipher = createCipheriv('aes-128-ecb', ENC_KEY, null);
  return Buffer.concat([cipher.update(data), cipher.final()]);
}

/** Reverse of encryptEcb; throws on a bad padding (not a Midea payload). */
export function decryptEcb(data) {
  const decipher = createDecipheriv('aes-128-ecb', ENC_KEY, null);
  return Buffer.concat([decipher.update(data), decipher.final()]);
}

/** MD5(data + sign key): the 16-byte signature closing a V2 packet. */
export function signV2(data) {
  return createHash('md5').update(data).update(SIGN_KEY).digest();
}

function cbc(mode, key, data) {
  const algorithm = `aes-${key.length * 8}-cbc`;
  const cipher =
    mode === 'encrypt'
      ? createCipheriv(algorithm, key, ZERO_IV)
      : createDecipheriv(algorithm, key, ZERO_IV);
  cipher.setAutoPadding(false);
  return Buffer.concat([cipher.update(data), cipher.final()]);
}

/** AES-CBC, zero IV, no padding (the caller pads to 16 bytes). */
export const encryptCbc = (key, data) => cbc('encrypt', key, data);
export const decryptCbc = (key, data) => cbc('decrypt', key, data);

/**
 * The session key of a V3 connection, from the 64 bytes the device answers
 * to the handshake: 32 encrypted bytes and their SHA-256.
 * @param {Buffer} key the device key (32 bytes, from the cloud)
 * @param {Buffer} data the handshake answer payload
 */
export function sessionKey(key, data) {
  if (data.length !== 64) {
    throw new Error(`unexpected handshake answer length ${data.length}`);
  }
  const plain = decryptCbc(key, data.subarray(0, 32));
  if (!sha256(plain).equals(data.subarray(32, 64))) {
    throw new Error('handshake answer signature mismatch (wrong token or key)');
  }
  const local = Buffer.alloc(32);
  for (let i = 0; i < 32; i += 1) {
    local[i] = plain[i] ^ key[i];
  }
  return local;
}

/**
 * The "udpid" the Midea cloud files a device token under: SHA-256 of the
 * 6-byte device id, its two halves XORed. Modules disagree on the byte order,
 * so both are tried (msmart-ng does the same).
 * @param {number} deviceId
 * @param {'little'|'big'} endian
 */
export function udpId(deviceId, endian) {
  const bytes = Buffer.alloc(6);
  if (endian === 'little') {
    bytes.writeUIntLE(deviceId, 0, 6);
  } else {
    bytes.writeUIntBE(deviceId, 0, 6);
  }
  const hash = sha256(bytes);
  const id = Buffer.alloc(16);
  for (let i = 0; i < 16; i += 1) {
    id[i] = hash[i] ^ hash[i + 16];
  }
  return id.toString('hex');
}
