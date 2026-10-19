// -----------------------------------------------------------------------------
// A complete test world: the SDK's fake Gladys, fake Midea units on a fake
// network, a fake Midea cloud and a temporary /data, with the integration
// wired on top through registerHandlers. No timer runs: the tests read the
// units with `world.hub.pollAll()`.
// -----------------------------------------------------------------------------

import { mkdtempSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { createFakeGladys } from '@gladysassistant/integration-sdk/testing';
import { registerHandlers } from '../../src/app.js';
import { DEVICE_TYPE } from '../../src/devices.js';
import { MideaLan } from '../../src/midea/lan.js';
import { Store } from '../../src/store.js';
import { CAPS, FakeHeatPump, FakeMidea, createFakeCloud, createNetwork } from './fakeMidea.js';

// The integration logs every change; keep the test output readable.
process.env.LOG_LEVEL ??= 'silent';

export const FAST_LAN = {
  connectTimeoutMs: 50,
  answerTimeoutMs: 40,
  retries: 2,
  afterHandshakeMs: 0,
};

/**
 * One V2 unit, one V3 unit with two capability pages, one metered V3 unit, a
 * window unit, an old unit, and a V3 heat pump with two zones that cools.
 */
export function allUnits() {
  return [
    new FakeMidea({ host: '192.0.2.10', version: 2, caps: CAPS.basic }),
    new FakeMidea({ host: '192.0.2.11', version: 3, caps: CAPS.twoPages }),
    new FakeMidea({ host: '192.0.2.12', version: 3, caps: CAPS.metered }),
    new FakeMidea({
      host: '192.0.2.13',
      version: 2,
      caps: CAPS.window,
      state: { outdoorTemperature: null },
    }),
    new FakeMidea({ host: '192.0.2.14', version: 2, caps: null }),
    new FakeHeatPump({
      host: '192.0.2.15',
      version: 3,
      state: { doubleZone: true, cool: true, zoneWaterTemperature: [true, false] },
    }),
  ];
}

/**
 * @param {object} [options]
 * @param {FakeMidea[]} [options.units]
 * @param {boolean} [options.scan] whether the core's discovery finds them
 * @param {object} [options.config] raw integration config
 * @param {Array} [options.created] devices already created in Gladys
 * @param {object} [options.cloud] a fake cloud (default: knows every unit)
 */
export async function createWorld({
  units = [new FakeMidea({ host: '192.0.2.10' })],
  scan = true,
  config = { language: 'en' },
  created = [],
  connect = true,
  cloud,
  dataDir = mkdtempSync(join(tmpdir(), 'gladys-midea-')),
  timings = {},
} = {}) {
  const network = createNetwork(units);
  const fakeCloud = cloud ?? createFakeCloud(units);
  const gladys = createFakeGladys({
    config,
    devices: created,
    scanResults: { 'udp-active-broadcast': scan ? network.scanReplies() : [] },
  });
  const app = registerHandlers(gladys, {
    store: new Store(dataDir),
    timers: false,
    timings: { scanGapMs: 0, ...timings },
    createLan: (options) =>
      new MideaLan({ ...options, connect: network.connect, timings: FAST_LAN }),
    createCloud: () => fakeCloud,
    probeHost: (host) => network.probe(host),
  });
  if (connect) {
    await gladys.connect();
    await app.ready;
  }
  return { gladys, fake: gladys.fake, network, cloud: fakeCloud, app, hub: app.hub, dataDir };
}

export const deviceId = (gladys, unit) => gladys.externalIds(DEVICE_TYPE, String(unit.id)).device;
export const featureId = (gladys, unit, key) =>
  gladys.externalIds(DEVICE_TYPE, String(unit.id)).feature(key);

/** Add every discovered device in Gladys, as the user would. */
export async function createAll(world) {
  for (const device of world.fake.discoveredDevices) {
    await world.fake.deviceCreated(device);
  }
  await world.hub.idle();
}

export { CAPS, FakeHeatPump, FakeMidea };
