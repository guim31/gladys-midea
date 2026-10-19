// -----------------------------------------------------------------------------
// The hub against fake units: discovery, V3 keys, polling by the container's
// own timer, commands, reachability, triggers and persistence.
// -----------------------------------------------------------------------------

import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFile, stat } from 'node:fs/promises';
import { join } from 'node:path';
import { GladysApiError } from '@gladysassistant/integration-sdk';
import { FEATURE_KEYS, AC_MODE, AC_FAN_SPEED } from '../src/devices.js';
import { TRIGGERS } from '../src/hub.js';
import { createFakeCloud } from './helpers/fakeMidea.js';
import { CAPS, FakeMidea, createAll, createWorld, deviceId, featureId } from './helpers/world.js';

async function createdWorld(t, options) {
  const world = await createWorld(options);
  t.after(() => world.app.stop());
  await createAll(world);
  return world;
}

const lastState = (world, unit, key) => world.fake.lastState(featureId(world.gladys, unit, key));
const record = (world, unit) => world.hub.records.get(unit.id);

test('discovery: one device per air conditioner, other appliances reported', async (t) => {
  const ac = new FakeMidea({ host: '192.0.2.10' });
  const dehumidifier = new FakeMidea({ host: '192.0.2.20', type: 0xa1 });
  const world = await createWorld({ units: [ac, dehumidifier] });
  t.after(() => world.app.stop());
  assert.deepEqual(
    world.fake.discoveredDevices.map((device) => device.external_id),
    [deviceId(world.gladys, ac)],
  );
  const [device] = world.fake.discoveredDevices;
  assert.deepEqual(device.params, [
    { name: 'IP_ADDRESS', value: '192.0.2.10' },
    { name: 'PROTOCOL', value: 'V2' },
  ]);
  assert.deepEqual(world.hub.summary().unsupported, [{ type: '0xA1', host: '192.0.2.20' }]);
  assert.equal(world.fake.connectionStatus.connected, true);
});

test('discovery: typed addresses are probed when the broadcast finds nothing', async (t) => {
  const ac = new FakeMidea({ host: '192.0.2.30' });
  const world = await createWorld({
    units: [ac],
    scan: false,
    config: { hosts: '192.0.2.30, 999.1.1.1' },
  });
  t.after(() => world.app.stop());
  assert.equal(world.fake.discoveredDevices.length, 1);
  assert.deepEqual(world.hub.summary().invalidHosts, ['999.1.1.1']);
});

test('discovery: no unit gives a status that says what to do', async (t) => {
  const world = await createWorld({ units: [], scan: false });
  t.after(() => world.app.stop());
  assert.deepEqual(world.fake.discoveredDevices, []);
  assert.equal(world.fake.connectionStatus.connected, false);
  assert.match(world.fake.connectionStatus.message.en, /No Midea air conditioner found/);
});

test('discovery: a core refusing the scan (old Gladys, rate limit) still probes the typed addresses', async (t) => {
  const ac = new FakeMidea({ host: '192.0.2.31' });
  const world = await createWorld({ units: [ac], connect: false, config: { hosts: '192.0.2.31' } });
  t.after(() => world.app.stop());
  t.mock.method(world.gladys, 'scanNetwork', async () => {
    throw new GladysApiError(429, 'TOO_MANY_REQUESTS', 'one scan per 10 s');
  });
  await world.gladys.connect();
  await world.app.ready;
  assert.equal(world.fake.discoveredDevices.length, 1);
  assert.equal(world.hub.summary().scan, 'busy');
});

test('V3: the keys come from the cloud once, are kept in /data, and the cloud is not needed after', async (t) => {
  const unit = new FakeMidea({ host: '192.0.2.11', version: 3, caps: CAPS.twoPages });
  const world = await createWorld({ units: [unit] });
  assert.equal(world.fake.discoveredDevices.length, 1);
  assert.equal(world.cloud.calls.length, 1, 'one udpid asked (little endian first)');
  await world.app.stop();

  const path = join(world.dataDir, 'midea-state.json');
  const saved = JSON.parse(await readFile(path, 'utf8'));
  assert.deepEqual(saved.devices[unit.id].credentials, unit.credentials);
  assert.equal((await stat(path)).mode & 0o777, 0o600);

  // Restart with the cloud gone: the unit is read with the saved keys.
  const offline = createFakeCloud([unit], { reachable: false });
  const again = await createWorld({ units: [unit], dataDir: world.dataDir, cloud: offline });
  t.after(() => again.app.stop());
  await createAll(again);
  await again.hub.pollAll({ force: true });
  assert.equal(offline.calls.length, 0);
  assert.equal(lastState(again, unit, FEATURE_KEYS.INDOOR_TEMPERATURE), 26.5);
});

test('V3: both byte orders of the udpid are tried', async (t) => {
  const unit = new FakeMidea({ host: '192.0.2.11', version: 3 });
  const asked = [];
  const cloud = {
    async getToken(udpid) {
      asked.push(udpid);
      if (asked.length === 1) {
        throw Object.assign(new Error('no token'), { name: 'CloudError', code: 'NO_TOKEN' });
      }
      return unit.credentials;
    },
  };
  const world = await createWorld({ units: [unit], cloud });
  t.after(() => world.app.stop());
  assert.equal(asked.length, 2);
  assert.notEqual(asked[0], asked[1]);
  assert.equal(world.fake.discoveredDevices.length, 1);
});

test('V3: without the cloud the unit is not published, the status and the search say why', async (t) => {
  const unit = new FakeMidea({ host: '192.0.2.11', version: 3 });
  const cloud = createFakeCloud([unit], { reachable: false });
  const world = await createWorld({ units: [unit], cloud });
  t.after(() => world.app.stop());
  assert.deepEqual(world.fake.discoveredDevices, []);
  assert.equal(world.fake.connectionStatus.connected, false);
  assert.match(world.fake.connectionStatus.message.en, /\(V3\) unit has no key/);
  const { data } = await world.fake.action('search', {});
  assert.match(data.message.en, /no key from the Midea cloud/);
  assert.equal(cloud.calls.length, 2, 'once at start, once more by the search');
});

test('V3: a unit re-paired in its app gets new keys', async (t) => {
  const unit = new FakeMidea({ host: '192.0.2.11', version: 3 });
  const world = await createdWorld(t, { units: [unit] });
  // New pairing: the module now expects another token and key.
  unit.token = Buffer.alloc(64, 7);
  unit.key = Buffer.alloc(32, 9);
  record(world, unit).lan.close();
  await world.hub.pollAll({ force: true });
  await world.hub.rediscover();
  assert.deepEqual(record(world, unit).credentials, unit.credentials);
  assert.equal(record(world, unit).reachable, true);
});

test('polling: the container reads the units by its own timer, without onPoll', async (t) => {
  const unit = new FakeMidea({ host: '192.0.2.10' });
  const world = await createdWorld(t, { units: [unit] });
  t.mock.timers.enable({ apis: ['setInterval'] });
  world.hub.timersEnabled = true;
  world.hub.startTimers();
  unit.state.indoorTemperature = 22;
  record(world, unit).lastPolledAt = 0;
  t.mock.timers.tick(30_000);
  await world.hub.idle();
  assert.equal(lastState(world, unit, FEATURE_KEYS.INDOOR_TEMPERATURE), 22);
  world.hub.stopped = true;
  clearInterval(world.hub.pollTimer);
  clearInterval(world.hub.rediscoveryTimer);
});

test("polling: the core's onPoll is skipped right after a read, and works alone", async (t) => {
  const unit = new FakeMidea({ host: '192.0.2.10' });
  const world = await createdWorld(t, { units: [unit] });
  const [device] = world.fake.discoveredDevices;
  unit.state.indoorTemperature = 20;
  await world.fake.poll(device);
  assert.equal(lastState(world, unit, FEATURE_KEYS.INDOOR_TEMPERATURE), 26.5, 'just read: skipped');
  record(world, unit).lastPolledAt = 0;
  await world.fake.poll(device);
  assert.equal(lastState(world, unit, FEATURE_KEYS.INDOOR_TEMPERATURE), 20);
});

test('polling: only the changes are sent, with a heartbeat under 12 h', async (t) => {
  const unit = new FakeMidea({ host: '192.0.2.10' });
  const world = await createdWorld(t, { units: [unit] });
  const calls = t.mock.method(world.gladys, 'publishChangedStates');
  const before = world.fake.states.length;
  await world.hub.pollAll({ force: true });
  assert.equal(world.fake.states.length, before, 'nothing changed, nothing sent');
  for (const call of calls.mock.calls) {
    assert.ok(call.arguments[1].heartbeat <= 12 * 3600_000);
  }
});

test('a device added to Gladys gets its states at once', async (t) => {
  const unit = new FakeMidea({ host: '192.0.2.10' });
  const world = await createWorld({ units: [unit] });
  t.after(() => world.app.stop());
  assert.equal(world.fake.states.length, 0, 'not added yet: nothing sent');
  await createAll(world);
  assert.equal(lastState(world, unit, FEATURE_KEYS.TARGET_TEMPERATURE), 24);
  assert.equal(lastState(world, unit, FEATURE_KEYS.OUTDOOR_TEMPERATURE), 31);
  assert.deepEqual(world.fake.transports.at(-1), {
    device_external_id: deviceId(world.gladys, unit),
    transport: 'local',
  });
});

test('commands: one control frame carrying every setting, state read back', async (t) => {
  const unit = new FakeMidea({ host: '192.0.2.10', state: { swing: 0x3 } });
  const world = await createdWorld(t, { units: [unit] });
  const [device] = world.fake.discoveredDevices;
  const feature = (key) => device.features.find((item) => item.external_id.endsWith(`:${key}`));

  assert.deepEqual(await world.fake.setValue(device, feature(FEATURE_KEYS.POWER), 1), {
    success: true,
  });
  await world.fake.setValue(device, feature(FEATURE_KEYS.MODE), AC_MODE.HEATING);
  await world.fake.setValue(device, feature(FEATURE_KEYS.TARGET_TEMPERATURE), 22.5);
  await world.fake.setValue(device, feature(FEATURE_KEYS.FAN_SPEED), AC_FAN_SPEED.LOW);
  await world.fake.setValue(device, feature(FEATURE_KEYS.SWING_VERTICAL), 1);

  const last = unit.controls.at(-1);
  assert.deepEqual(
    { ...last },
    {
      power: true,
      beep: false,
      mode: 4,
      targetTemperature: 22.5,
      fanSpeed: 40,
      swing: 0xf,
      turbo: false,
      eco: false,
      sleep: false,
    },
  );
  assert.equal(lastState(world, unit, FEATURE_KEYS.MODE), AC_MODE.HEATING);
  assert.equal(lastState(world, unit, FEATURE_KEYS.TARGET_TEMPERATURE), 22.5);
  assert.equal(lastState(world, unit, FEATURE_KEYS.FAN_SPEED), AC_FAN_SPEED.LOW);
  assert.equal(lastState(world, unit, FEATURE_KEYS.SWING_HORIZONTAL), 1, 'other swing kept');
});

test('commands: a setpoint is rounded and kept within the range of the unit', async (t) => {
  const unit = new FakeMidea({ host: '192.0.2.10' });
  const world = await createdWorld(t, { units: [unit] });
  const [device] = world.fake.discoveredDevices;
  const setpoint = device.features.find((item) => item.external_id.endsWith(':target-temperature'));
  await world.fake.setValue(device, setpoint, 40);
  assert.equal(unit.controls.at(-1).targetTemperature, 30);
  await world.fake.setValue(device, setpoint, 21.3);
  assert.equal(unit.controls.at(-1).targetTemperature, 21.5);
});

test('commands: a mode the unit does not have is refused, nothing is sent', async (t) => {
  const unit = new FakeMidea({
    host: '192.0.2.13',
    caps: CAPS.window,
    state: { outdoorTemperature: null },
  });
  const world = await createdWorld(t, { units: [unit] });
  const [device] = world.fake.discoveredDevices;
  const mode = device.features.find((item) => item.external_id.endsWith(':mode'));
  assert.deepEqual(
    mode.supported_options.map((option) => option.value),
    [AC_MODE.AUTO, AC_MODE.COOLING, AC_MODE.DRYING, AC_MODE.FAN],
  );
  const ack = await world.fake.setValue(device, mode, AC_MODE.HEATING);
  assert.equal(ack.success, false);
  assert.equal(unit.controls.length, 0);
});

test('commands: the beep follows the configuration', async (t) => {
  const unit = new FakeMidea({ host: '192.0.2.10' });
  const world = await createdWorld(t, { units: [unit], config: { beep: true } });
  const [device] = world.fake.discoveredDevices;
  await world.fake.setValue(device, device.features[0], 1);
  assert.equal(unit.controls.at(-1).beep, true);
});

test('reachability: a unit that stops answering is unreachable after two reads, then back', async (t) => {
  const unit = new FakeMidea({ host: '192.0.2.10' });
  const world = await createdWorld(t, { units: [unit] });
  unit.online = false;
  await world.hub.pollAll({ force: true });
  assert.equal(record(world, unit).reachable, true, 'one miss is not enough');
  await world.hub.pollAll({ force: true });
  assert.equal(record(world, unit).reachable, false);
  assert.equal(world.fake.transports.at(-1).transport, 'unreachable');
  assert.equal(world.fake.connectionStatus.connected, false);

  unit.online = true;
  await world.hub.pollAll({ force: true });
  assert.equal(record(world, unit).reachable, true);
  assert.equal(world.fake.transports.at(-1).transport, 'local');
  assert.equal(world.fake.connectionStatus.connected, true);
});

test('reachability: a new address (DHCP) is followed by the next discovery', async (t) => {
  const unit = new FakeMidea({ host: '192.0.2.10' });
  const world = await createdWorld(t, { units: [unit] });
  unit.host = '192.0.2.99';
  world.fake.scanResults['udp-active-broadcast'] = world.network.scanReplies();
  await world.hub.rediscover();
  assert.equal(record(world, unit).host, '192.0.2.99');
  assert.deepEqual(world.fake.discoveredDevices[0].params[0], {
    name: 'IP_ADDRESS',
    value: '192.0.2.99',
  });
});

test('triggers: the filter alert and a new error code fire once each', async (t) => {
  const unit = new FakeMidea({ host: '192.0.2.10' });
  const world = await createdWorld(t, { units: [unit] });
  const device = deviceId(world.gladys, unit);

  await world.hub.pollAll({ force: true });
  assert.deepEqual(world.fake.sceneEvents, []);

  unit.state.filterAlert = true;
  await world.hub.pollAll({ force: true });
  await world.hub.pollAll({ force: true });
  unit.state.errorCode = 5;
  await world.hub.pollAll({ force: true });
  await world.hub.pollAll({ force: true });
  await world.hub.idle();
  assert.deepEqual(
    world.fake.sceneEvents.map(({ key, data }) => [key, data]),
    [
      [TRIGGERS.FILTER, { device }],
      [TRIGGERS.ERROR, { device, error_code: 5, error_display: '5' }],
    ],
  );
});

test('triggers: a restart does not fire again for an alert already known', async (t) => {
  const unit = new FakeMidea({ host: '192.0.2.10', state: { filterAlert: false } });
  const world = await createdWorld(t, { units: [unit] });
  unit.state.filterAlert = true;
  await world.hub.pollAll({ force: true });
  await world.hub.idle();
  assert.equal(world.fake.sceneEvents.length, 1);
  await world.app.stop();

  const again = await createWorld({
    units: [unit],
    dataDir: world.dataDir,
    created: world.fake.discoveredDevices,
  });
  t.after(() => again.app.stop());
  await again.hub.pollAll({ force: true });
  await again.hub.idle();
  assert.deepEqual(again.fake.sceneEvents, []);
});

test('the search action reports every unit', async (t) => {
  const units = [
    new FakeMidea({ host: '192.0.2.10' }),
    new FakeMidea({ host: '192.0.2.11', version: 3 }),
  ];
  const world = await createWorld({ units, config: { language: 'fr', hosts: 'nope' } });
  t.after(() => world.app.stop());
  const ack = await world.fake.action('search', {});
  assert.equal(ack.success, true);
  assert.match(ack.data.message.fr, /2 appareil\(s\) Midea, 2 répondent/);
  assert.match(ack.data.message.fr, /192\.0\.2\.11, V3\): répond/);
  assert.match(ack.data.message.en, /Ignored addresses: nope/);
});

test('scene action: mode, setpoint and fan in a single frame, unit switched on', async (t) => {
  const unit = new FakeMidea({ host: '192.0.2.10' });
  const world = await createdWorld(t, { units: [unit] });
  const ack = await world.fake.sceneAction('set_climate', {
    device: deviceId(world.gladys, unit),
    mode: '1',
    target_temperature: '23,5',
    fan_speed: '3',
  });
  assert.deepEqual(ack, { success: true, data: { outputs: { target_temperature: 23.5 } } });
  assert.equal(unit.controls.length, 1);
  assert.deepEqual(
    [
      unit.controls[0].power,
      unit.controls[0].mode,
      unit.controls[0].targetTemperature,
      unit.controls[0].fanSpeed,
    ],
    [true, 2, 23.5, 60],
  );
});

test('scene action: empty fields keep the current settings', async (t) => {
  const unit = new FakeMidea({ host: '192.0.2.10', state: { mode: 4, targetTemperature: 21 } });
  const world = await createdWorld(t, { units: [unit] });
  await world.fake.sceneAction('set_climate', {
    device: deviceId(world.gladys, unit),
    mode: '',
    fan_speed: null,
  });
  assert.deepEqual(
    [unit.controls[0].power, unit.controls[0].mode, unit.controls[0].targetTemperature],
    [true, 4, 21],
  );
});
