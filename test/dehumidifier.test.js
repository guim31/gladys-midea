// -----------------------------------------------------------------------------
// Dehumidifiers (appliance 0xA1): the frames against midea-local itself
// (test/fixtures/midea-local-a1-vectors.json, produced by running midea-local
// on fixed inputs), then the hub against fake dehumidifiers: discovery,
// features, states, commands, notifications, triggers.
// -----------------------------------------------------------------------------

import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import { decodeA1Response, getA1StateCommand, setA1StateCommand } from '../src/midea/a1.js';
import { DH_KEYS, dehumidifierIds } from '../src/dehumidifier.js';
import { TRIGGERS } from '../src/hub.js';
import { FakeDehumidifier, FakeMidea, createAll, createWorld } from './helpers/world.js';

const vectors = JSON.parse(
  await readFile(new URL('./fixtures/midea-local-a1-vectors.json', import.meta.url), 'utf8'),
);

// --- Frames ----------------------------------------------------------------------

test('A1 query and set frames are byte for byte those of midea-local', () => {
  const [query] = vectors.queries;
  assert.equal(getA1StateCommand({ id: query.id }).toString('hex'), query.frame);
  for (const { id, input, frame } of vectors.sets) {
    const built = setA1StateCommand(
      {
        power: input.power,
        mode: input.mode,
        fanSpeed: input.fan_speed,
        targetHumidity: input.target_humidity,
        childLock: input.child_lock,
        anion: input.anion,
        pump: input.pump,
        pumpEnabled: input.pump_enable,
        swing: input.swing,
        waterLevelSet: input.water_level_set,
      },
      { id, beep: input.prompt_tone },
    );
    assert.equal(built.toString('hex'), frame, JSON.stringify(input));
  }
});

test('A1 answers decode as midea-local decodes them', () => {
  for (const { frame, attrs } of vectors.responses) {
    const { kind, state } = decodeA1Response(Buffer.from(frame, 'hex'));
    assert.equal(kind, 'state');
    assert.deepEqual(
      {
        power: state.power,
        mode: state.mode,
        fan_speed: state.fanSpeed,
        target_humidity: state.targetHumidity,
        child_lock: state.childLock,
        anion: state.anion,
        pump: state.pump,
        pump_enable: state.pumpEnabled,
        tank: state.tank,
        water_level_set: state.waterLevelSet,
        current_humidity: state.humidity,
        current_temperature: state.temperature,
        swing: state.swing,
        filter_cleaning_reminder: state.filterAlert,
      },
      attrs,
    );
  }
});

// --- Hub -------------------------------------------------------------------------

const ids = (world, unit) => dehumidifierIds(world.gladys, unit.id);
const deviceOf = (world, unit) =>
  world.fake.discoveredDevices.find((device) => device.external_id === ids(world, unit).device);
const keysOf = (device) =>
  device.features.map((feature) => feature.external_id.slice(device.external_id.length + 1));
const lastState = (world, unit, key) => world.fake.lastState(ids(world, unit).feature(key));
const setValue = (world, unit, key, value) => {
  const device = deviceOf(world, unit);
  const feature = device.features.find(
    (item) => item.external_id === ids(world, unit).feature(key),
  );
  return world.fake.setValue(device, feature, value);
};

async function createdWorld(t, options) {
  const world = await createWorld(options);
  t.after(() => world.app.stop());
  await createAll(world);
  return world;
}

test('discovery: a dehumidifier becomes a device of its own (issue: Comfee 0xA1)', async (t) => {
  const ac = new FakeMidea({ host: '192.0.2.10' });
  const unit = new FakeDehumidifier({ host: '192.0.2.50' });
  const world = await createWorld({ units: [ac, unit], config: { language: 'fr' } });
  t.after(() => world.app.stop());
  assert.deepEqual(world.hub.summary().unsupported, []);
  const device = deviceOf(world, unit);
  assert.match(device.name, /^Déshumidificateur [0-9A-F]{4}$/);
  assert.equal(device.external_id, `ext:test-integration:dehumidifier:${unit.id}`);
  assert.deepEqual(keysOf(device), [
    DH_KEYS.POWER,
    DH_KEYS.MODE,
    DH_KEYS.FAN_SPEED,
    DH_KEYS.TARGET_HUMIDITY,
    DH_KEYS.HUMIDITY,
    DH_KEYS.TEMPERATURE,
    DH_KEYS.TANK_LEVEL,
    DH_KEYS.TANK_FULL,
    DH_KEYS.CHILD_LOCK,
    DH_KEYS.IONIZER,
    DH_KEYS.SWING,
  ]);
  const mode = device.features[1];
  assert.deepEqual([mode.category, mode.type], ['text', 'select']);
  assert.deepEqual(
    mode.supported_options.map((option) => [option.value, option.label]),
    [
      ['manual', 'Consigne'],
      ['continuous', 'Continu'],
      ['auto', 'Auto'],
      ['clothes-dry', 'Séchage du linge'],
      ['shoes-dry', 'Séchage des chaussures'],
    ],
  );
});

test('discovery: a unit with a drain pump gets its switch', async (t) => {
  const unit = new FakeDehumidifier({ host: '192.0.2.50', state: { pumpEnabled: true } });
  const world = await createWorld({ units: [unit] });
  t.after(() => world.app.stop());
  assert.ok(keysOf(deviceOf(world, unit)).includes(DH_KEYS.PUMP));
});

test('states: settings as select values, sensors, tank', async (t) => {
  const unit = new FakeDehumidifier({ host: '192.0.2.50', version: 3 });
  const world = await createdWorld(t, { units: [unit] });
  await world.hub.pollAll({ force: true });
  assert.equal(lastState(world, unit, DH_KEYS.POWER), 1);
  assert.equal(lastState(world, unit, DH_KEYS.MODE), 'auto');
  assert.equal(lastState(world, unit, DH_KEYS.FAN_SPEED), 'medium');
  assert.equal(lastState(world, unit, DH_KEYS.TARGET_HUMIDITY), '55');
  assert.equal(lastState(world, unit, DH_KEYS.HUMIDITY), 62);
  assert.equal(lastState(world, unit, DH_KEYS.TEMPERATURE), 21);
  assert.equal(lastState(world, unit, DH_KEYS.TANK_LEVEL), 30);
  assert.equal(lastState(world, unit, DH_KEYS.TANK_FULL), 0);

  // The tank fills past the level set; a setpoint between two steps.
  Object.assign(unit.state, { tank: 55, targetHumidity: 52, fanSpeed: 70 });
  await world.hub.pollAll({ force: true });
  assert.equal(lastState(world, unit, DH_KEYS.TANK_FULL), 1);
  assert.equal(lastState(world, unit, DH_KEYS.TARGET_HUMIDITY), '50');
  assert.equal(lastState(world, unit, DH_KEYS.FAN_SPEED), 'medium');
});

test('commands: one set frame carrying every setting, the rest kept', async (t) => {
  const unit = new FakeDehumidifier({
    host: '192.0.2.50',
    state: { pumpEnabled: true, waterLevelSet: 75 },
  });
  const world = await createdWorld(t, { units: [unit] });
  assert.deepEqual(await setValue(world, unit, DH_KEYS.MODE, 'continuous'), { success: true });
  await setValue(world, unit, DH_KEYS.FAN_SPEED, 'high');
  await setValue(world, unit, DH_KEYS.TARGET_HUMIDITY, '45');
  await setValue(world, unit, DH_KEYS.CHILD_LOCK, 1);
  await setValue(world, unit, DH_KEYS.IONIZER, 1);
  await setValue(world, unit, DH_KEYS.SWING, 1);
  await setValue(world, unit, DH_KEYS.PUMP, 1);
  await setValue(world, unit, DH_KEYS.POWER, 0);
  assert.deepEqual(
    {
      power: unit.state.power,
      mode: unit.state.mode,
      fanSpeed: unit.state.fanSpeed,
      targetHumidity: unit.state.targetHumidity,
      childLock: unit.state.childLock,
      anion: unit.state.anion,
      swing: unit.state.swing,
      pump: unit.state.pump,
      waterLevelSet: unit.state.waterLevelSet,
      beep: unit.state.beep,
    },
    {
      power: false,
      mode: 2,
      fanSpeed: 80,
      targetHumidity: 45,
      childLock: true,
      anion: true,
      swing: true,
      pump: true,
      waterLevelSet: 75,
      beep: false,
    },
  );
  assert.equal(lastState(world, unit, DH_KEYS.MODE), 'continuous');
  assert.equal(lastState(world, unit, DH_KEYS.POWER), 0);
});

test('commands: a value the unit does not have is refused, nothing is sent', async (t) => {
  const unit = new FakeDehumidifier({ host: '192.0.2.50' });
  const world = await createdWorld(t, { units: [unit] });
  const before = unit.frames.length;
  assert.equal((await setValue(world, unit, DH_KEYS.MODE, 'turbo')).success, false);
  assert.equal((await setValue(world, unit, DH_KEYS.FAN_SPEED, 'max')).success, false);
  assert.equal(unit.frames.slice(before).filter((frame) => frame[9] === 0x02).length, 0);
  await setValue(world, unit, DH_KEYS.TARGET_HUMIDITY, '95');
  assert.equal(unit.state.targetHumidity, 85, 'kept within 35-85 %');
});

test('notifications: a change made on the unit is taken at once', async (t) => {
  const unit = new FakeDehumidifier({ host: '192.0.2.50' });
  const world = await createdWorld(t, { units: [unit] });
  await world.hub.pollAll({ force: true });
  unit.state.power = false;
  unit.push();
  await new Promise((resolve) => setTimeout(resolve, 20));
  await world.hub.idle();
  assert.equal(lastState(world, unit, DH_KEYS.POWER), 0);
});

test('triggers: the filter reminder of a dehumidifier fires once', async (t) => {
  const unit = new FakeDehumidifier({ host: '192.0.2.50' });
  const world = await createdWorld(t, { units: [unit] });
  await world.hub.pollAll({ force: true });
  unit.state.filterAlert = true;
  await world.hub.pollAll({ force: true });
  await world.hub.pollAll({ force: true });
  await world.hub.idle();
  assert.deepEqual(
    world.fake.sceneEvents.map(({ key, data }) => [key, data]),
    [[TRIGGERS.FILTER, { device: ids(world, unit).device }]],
  );
});

test('the widget (no dehumidifier view yet) and the AC scene action refuse a dehumidifier', async (t) => {
  const unit = new FakeDehumidifier({ host: '192.0.2.50' });
  const world = await createdWorld(t, { units: [unit] });
  const device = ids(world, unit).device;
  const widget = await world.fake.widgetGet('climate', { settings: { device }, language: 'en' });
  assert.match(widget.data.content.components[0].text, /no view for this kind of unit/);
  const ack = await world.fake.sceneAction('set_climate', { device, mode: '2' });
  assert.equal(ack.success, false);
});

test('a restart keeps the dehumidifier and its features', async (t) => {
  const unit = new FakeDehumidifier({ host: '192.0.2.50', state: { pumpEnabled: true } });
  const world = await createdWorld(t, { units: [unit] });
  const before = deviceOf(world, unit);
  await world.app.stop();
  unit.online = false;
  const again = await createWorld({
    units: [unit],
    dataDir: world.dataDir,
    created: world.fake.discoveredDevices,
  });
  t.after(() => again.app.stop());
  assert.deepEqual(deviceOf(again, unit), before);
});
