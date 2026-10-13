// -----------------------------------------------------------------------------
// The Node port of the Midea LAN protocol against msmart-ng itself.
//
// test/fixtures/msmart-vectors.json was produced by running msmart-ng (MIT)
// on fixed inputs: its packets, envelopes, commands and decodings of real
// frames from its own test suite (frames reported by users of real units).
// The discovery replies of its tests were anonymized (address, serial, SSID
// and device id replaced, then re-encrypted and re-signed with msmart-ng's
// primitives). The token, key and account used here are invented.
// -----------------------------------------------------------------------------

import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import {
  decodeResponse,
  getCapabilitiesCommand,
  getGroupDataCommand,
  getStateCommand,
  setStateCommand,
  summarizeCapabilities,
} from '../src/midea/ac.js';
import { hashPassword, sign } from '../src/midea/cloud.js';
import { DISCOVERY_REQUEST, parseDiscoveryReply } from '../src/midea/discovery.js';
import { crc8 } from '../src/midea/frame.js';
import { V3Codec, decodePacket, encodePacket } from '../src/midea/packet.js';
import { udpId } from '../src/midea/security.js';

const vectors = JSON.parse(
  await readFile(new URL('./fixtures/msmart-vectors.json', import.meta.url), 'utf8'),
);
const hex = (value) => Buffer.from(value, 'hex');

test('CRC-8 matches the table of msmart-ng', () => {
  assert.equal(crc8([1]), 0x5e);
  assert.equal(crc8([0x80]), 0x8c);
});

test('V2 packet: same bytes as msmart-ng, and back to the frame', () => {
  const { deviceId, now, frame, packet } = vectors.v2;
  const encoded = encodePacket(deviceId, hex(frame), new Date(now));
  assert.equal(encoded.toString('hex'), packet);
  assert.equal(decodePacket(encoded).toString('hex'), frame);
});

test('V2 packet: a tampered packet is refused', () => {
  const tampered = hex(vectors.v2.packet);
  tampered[50] ^= 0xff;
  assert.throws(() => decodePacket(tampered), /signature/);
});

test('V3: handshake, session key and envelopes as msmart-ng', () => {
  const v3 = vectors.v3;
  const codec = new V3Codec();
  const request = codec.handshake(hex(v3.token));
  assert.equal(request.subarray(8).toString('hex'), v3.handshakeRequestPayload);
  assert.equal(request.readUInt16BE(2), 64);

  const answer = codec.decode(hex(v3.handshakeAnswer));
  codec.authenticate(hex(v3.key), answer.payload);
  assert.equal(codec.key.toString('hex'), v3.localKey);

  codec.packetId = v3.packetId;
  const encrypted = codec.encrypt(hex(v3.payload), (n) => Buffer.alloc(n, v3.padByte));
  assert.equal(encrypted.toString('hex'), v3.request);

  const decoded = codec.decode(hex(v3.response));
  assert.equal(decoded.payload.toString('hex'), v3.payload);
});

test('V3: a wrong key fails the handshake', () => {
  const codec = new V3Codec();
  const answer = codec.decode(hex(vectors.v3.handshakeAnswer));
  assert.throws(
    () => codec.authenticate(Buffer.alloc(32, 1), answer.payload),
    /wrong token or key/,
  );
});

test('discovery: same request, same decoding of V2 and V3 replies', () => {
  assert.equal(DISCOVERY_REQUEST.toString('hex'), vectors.discoveryRequest);
  for (const { reply, sourceIp, expected } of vectors.discovery) {
    const info = parseDiscoveryReply(hex(reply), sourceIp);
    assert.deepEqual(
      {
        ip: info.host,
        port: info.port,
        device_id: info.deviceId,
        name: info.ssid,
        sn: info.serial,
        device_type: info.type,
        version: info.version,
      },
      expected,
    );
  }
  assert.equal(parseDiscoveryReply(Buffer.from('<?xml version="1.0"?>'), '192.0.2.1'), null);
  assert.equal(parseDiscoveryReply(Buffer.alloc(200, 0x5a), '192.0.2.1'), null);
});

test('commands: same frames as msmart-ng', () => {
  assert.equal(getStateCommand({ id: 0x10 }).toString('hex'), vectors.getState);
  assert.equal(
    getCapabilitiesCommand(false, { id: 0x20 }).toString('hex'),
    vectors.getCapabilities,
  );
  assert.equal(
    getCapabilitiesCommand(true, { id: 0x21 }).toString('hex'),
    vectors.getCapabilitiesMore,
  );
  assert.equal(getGroupDataCommand(4, { id: 0x30 }).toString('hex'), vectors.getGroup4);
  assert.equal(getGroupDataCommand(5, { id: 0x31 }).toString('hex'), vectors.getGroup5);
  for (const { state, id, frame } of vectors.setState) {
    const encoded = setStateCommand(
      {
        power: state.power_on,
        targetTemperature: state.target_temperature,
        mode: state.operational_mode,
        fanSpeed: state.fan_speed,
        swing: state.swing_mode,
        eco: state.eco,
        turbo: state.turbo,
        sleep: state.sleep,
        fahrenheit: state.fahrenheit,
        beep: state.beep_on,
        freezeProtection: state.freeze_protection,
        targetHumidity: state.target_humidity,
      },
      { id },
    );
    assert.equal(encoded.toString('hex'), frame, JSON.stringify(state));
  }
});

test('state answers decode as msmart-ng decodes them', () => {
  for (const { frame, expected } of vectors.states) {
    const { kind, state } = decodeResponse(hex(frame));
    assert.equal(kind, 'state');
    for (const [key, value] of Object.entries(expected)) {
      assert.equal(state[key], value, `${frame} ${key}`);
    }
  }
});

test('capability answers decode as msmart-ng decodes them', () => {
  for (const { frame, expected } of vectors.capabilities) {
    const decoded = decodeResponse(hex(frame));
    assert.equal(decoded.kind, 'capabilities');
    const caps = summarizeCapabilities(decoded.raw);
    const modes = new Set(caps.modes);
    assert.deepEqual(
      {
        more: decoded.more,
        eco: caps.eco,
        turbo: caps.turbo,
        heat: modes.has(4),
        cool: modes.has(2),
        dry: modes.has(3),
        auto: modes.has(1),
        swingVertical: caps.swingVertical,
        swingHorizontal: caps.swingHorizontal,
        fanSilent: caps.fanSpeeds.silent,
        fanLow: caps.fanSpeeds.low,
        fanMedium: caps.fanSpeeds.medium,
        fanHigh: caps.fanSpeeds.high,
        fanAuto: caps.fanSpeeds.auto,
        fanCustom: caps.fanSpeeds.max,
        energy: caps.energy,
        filter: caps.filter,
        humidity: caps.humidity,
        minTemperature: caps.minTemperature,
        maxTemperature: caps.maxTemperature,
      },
      expected,
      frame,
    );
  }
});

test('energy and humidity answers decode as msmart-ng decodes them', () => {
  for (const { frame, expected } of vectors.energy) {
    for (const format of ['bcd', 'binary']) {
      const decoded = decodeResponse(hex(frame), { energyFormat: format });
      assert.equal(decoded.kind, 'energy');
      assert.deepEqual(
        { totalEnergy: decoded.totalEnergy, power: decoded.power },
        expected[format],
        `${format} ${frame}`,
      );
    }
  }
  for (const { frame, expected } of vectors.humidity) {
    const decoded = decodeResponse(hex(frame));
    assert.equal(decoded.kind, 'humidity');
    assert.equal(decoded.humidity, expected);
  }
});

test('a frame with a bad checksum is refused', () => {
  const frame = hex(vectors.states[1].frame);
  frame[12] ^= 1;
  assert.throws(() => decodeResponse(frame), /checksum/);
});

test('cloud: request signature and password hash as msmart-ng', () => {
  const { path, body, sign: signature, loginId, password, passwordHash } = vectors.cloud;
  assert.equal(sign(path, body), signature);
  assert.equal(hashPassword(loginId, password), passwordHash);
});

test('udpid in both byte orders as msmart-ng', () => {
  const { deviceId, little, big } = vectors.udpid;
  assert.equal(udpId(deviceId, 'little'), little);
  assert.equal(udpId(deviceId, 'big'), big);
});
