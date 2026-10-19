// -----------------------------------------------------------------------------
// Air-to-water heat pumps (appliance 0xC3): the frames against midea-local
// itself (test/fixtures/midea-local-c3-vectors.json, produced by running
// midea-local on fixed inputs), then the hub against fake heat pumps:
// discovery, features, states, commands, notifications, typed keys.
// -----------------------------------------------------------------------------

import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import {
  BODY_TYPE,
  MESSAGE_TYPE,
  SILENT_LEVEL,
  decodeC3Response,
  errorDisplay,
  getApplianceCommand,
  getQueryCommand,
  setBasicCommand,
  setEcoCommand,
  setSilentCommand,
} from '../src/midea/c3.js';
import { HP_KEYS, OPERATING_STATE, THERMOSTAT_MODE, heatPumpIds } from '../src/heatpump.js';
import { TRIGGERS } from '../src/hub.js';
import {
  FakeHeatPump,
  basicBody,
  c3Frame,
  createFakeCloud,
  energyBody,
  unitNotificationBody,
} from './helpers/fakeMidea.js';
import { FakeMidea, createAll, createWorld } from './helpers/world.js';

const vectors = JSON.parse(
  await readFile(new URL('./fixtures/midea-local-c3-vectors.json', import.meta.url), 'utf8'),
);
const hex = (value) => Buffer.from(value, 'hex');

// --- Frames ----------------------------------------------------------------------

test('C3 queries are byte for byte those of midea-local', () => {
  assert.equal(getApplianceCommand().toString('hex'), vectors.queries.appliance);
  const options = { protocol: 2 };
  assert.equal(getQueryCommand(BODY_TYPE.BASIC, options).toString('hex'), vectors.queries.basic);
  assert.equal(getQueryCommand(BODY_TYPE.UNIT, options).toString('hex'), vectors.queries.unit);
  assert.equal(getQueryCommand(BODY_TYPE.ECO, options).toString('hex'), vectors.queries.eco);
  assert.equal(
    getQueryCommand(BODY_TYPE.SILENCE, options).toString('hex'),
    vectors.queries.silence,
  );
});

test('C3 set commands are byte for byte those of midea-local', () => {
  const options = { protocol: 2 };
  for (const { input, frame } of vectors.sets) {
    let built;
    if ('eco_mode' in input) {
      built = setEcoCommand(input.eco_mode, options);
    } else if ('silent_level' in input) {
      built = setSilentCommand(input.silent_level, options);
    } else {
      built = setBasicCommand(
        {
          zone1Power: input.zone1_power,
          zone2Power: input.zone2_power,
          dhwPower: input.dhw_power,
          mode: input.mode,
          zoneTargets: input.zone_target_temp,
          dhwTarget: input.dhw_target_temp,
          roomTarget: input.room_target_temp,
          zone1Curve: input.zone1_curve,
          zone2Curve: input.zone2_curve,
          tbh: input.tbh,
          fastDhw: input.fast_dhw,
        },
        options,
      );
    }
    assert.equal(built.toString('hex'), frame, JSON.stringify(input));
  }
});

test('C3 answers decode as midea-local decodes them', () => {
  for (const { frame, attrs } of vectors.responses) {
    const decoded = decodeC3Response(hex(frame));
    const where = `${decoded.kind} ${frame.slice(18, 22)}`;
    if (decoded.kind === 'basic') {
      const s = decoded.state;
      assert.deepEqual(
        {
          zone1_power: s.zone1Power,
          zone2_power: s.zone2Power,
          dhw_power: s.dhwPower,
          zone1_curve: s.zone1Curve,
          zone2_curve: s.zone2Curve,
          tbh: s.tbh,
          fast_dhw: s.fastDhw,
          heat: s.heat,
          cool: s.cool,
          dhw: s.dhw,
          double_zone: s.doubleZone,
          zone_temp_type: s.zoneWaterTemperature,
          silent_mode: s.silent,
          eco_mode: s.eco,
          mode: s.mode,
          mode_auto: s.modeAuto,
          zone_target_temp: s.zoneTargets,
          dhw_target_temp: s.dhwTarget,
          room_target_temp: s.roomTarget,
          zone_heating_temp_max: s.zoneHeating.map((zone) => zone.max),
          zone_heating_temp_min: s.zoneHeating.map((zone) => zone.min),
          zone_cooling_temp_max: s.zoneCooling.map((zone) => zone.max),
          zone_cooling_temp_min: s.zoneCooling.map((zone) => zone.min),
          room_temp_max: s.room.max,
          room_temp_min: s.room.min,
          dhw_temp_max: s.dhwRange.max,
          dhw_temp_min: s.dhwRange.min,
          tank_actual_temperature: s.tankTemperature,
          error_code: s.errorCode,
        },
        Object.fromEntries(
          Object.entries(attrs).filter(([key]) => key !== 'error_code_description'),
        ),
        where,
      );
      // The code the controller shows: midea-local's "E8: Water flow failure".
      const display = errorDisplay(s.errorCode);
      if (display === null) {
        assert.equal(attrs.error_code_description, 'No error', where);
      } else if (display.startsWith('#')) {
        assert.equal(attrs.error_code_description, `Unknown code (raw=${s.errorCode})`, where);
      } else {
        assert.ok(attrs.error_code_description.startsWith(`${display}: `), where);
      }
    } else if (decoded.kind === 'energy') {
      const e = decoded.energy;
      assert.deepEqual(
        {
          status_heating: e.heating,
          status_cool: e.cooling,
          status_dhw: e.heatingWater,
          backup_heater: e.backupHeater,
          total_energy_consumption: e.totalEnergy,
          total_produced_energy: e.producedEnergy,
          outdoor_temperature: e.outdoorTemperature,
        },
        {
          ...Object.fromEntries(
            Object.entries(attrs).filter(([key]) => !['status_ibh', 'status_tbh'].includes(key)),
          ),
          backup_heater: attrs.status_ibh || attrs.status_tbh,
        },
        where,
      );
    } else if (decoded.kind === 'unit') {
      const u = decoded.unit;
      const signed = (value) => (value > 127 ? value - 256 : value);
      assert.equal(u.compressorFrequency, attrs.comp_run_freq, where);
      // midea-local keeps the raw byte; a frost day reads below zero here.
      assert.equal(u.outdoorTemperature, signed(attrs.temp_t4), where);
      assert.equal(u.waterInletTemperature, attrs.temp_tw_in, where);
      assert.equal(u.waterOutletTemperature, attrs.temp_tw_out, where);
      assert.equal(u.power, attrs.instant_power0, where);
      // midea-local keeps the raw flow; midea_ac_lan shows it as hundredths of m³/h.
      assert.equal(u.waterFlow, attrs.water_flower / 100, where);
      assert.equal(u.waterPressure, attrs.water_pressure, where);
      if ('heat_run' in attrs) {
        assert.equal(u.heating, attrs.heat_run, where);
        assert.equal(u.cooling, attrs.cool_run, where);
        assert.equal(u.heatingWater, attrs.dhw_run, where);
        assert.equal(u.defrost, attrs.defrost_valve_on, where);
        assert.equal(
          u.backupHeater,
          attrs.ibh1_on || attrs.ibh2_on || attrs.load_output_tbh,
          where,
        );
        assert.equal(u.totalElectricity, attrs.total_electricity0, where);
        assert.equal(u.totalThermal, attrs.total_thermal0, where);
      } else {
        assert.equal(u.compressorRunTime, attrs.comp_total_run_time, where);
      }
    } else if (decoded.kind === 'eco') {
      assert.equal(decoded.eco, attrs.eco_function_state, where);
    } else if (decoded.kind === 'silence') {
      assert.equal(decoded.silent, attrs.silent_mode, where);
      assert.equal(
        decoded.silentLevel,
        {
          off: SILENT_LEVEL.OFF,
          silent: SILENT_LEVEL.SILENT,
          super_silent: SILENT_LEVEL.SUPER_SILENT,
        }[attrs.silent_level],
        where,
      );
    } else {
      assert.fail(`${where}: not decoded`);
    }
  }
});

test('C3 frames: a bad checksum, another appliance or a short state are refused', () => {
  const good = c3Frame(MESSAGE_TYPE.QUERY, basicBody({ ...stateOf(new FakeHeatPump()) }));
  const broken = Buffer.from(good);
  broken[broken.length - 1] ^= 0xff;
  assert.throws(() => decodeC3Response(broken), /checksum/);
  const other = c3Frame(MESSAGE_TYPE.QUERY, basicBody(stateOf(new FakeHeatPump())));
  other[2] = 0xac;
  other[other.length - 1] = (other[other.length - 1] + 0xc3 - 0xac) & 0xff;
  assert.throws(() => decodeC3Response(other), /appliance 0xac/);
  assert.throws(() => decodeC3Response(c3Frame(MESSAGE_TYPE.QUERY, [0x01, 0, 0])), /too short/);
  assert.equal(decodeC3Response(c3Frame(MESSAGE_TYPE.QUERY, [0x09, 1, 2, 3, 4])).kind, 'other');
});

function stateOf(unit) {
  return unit.state;
}

// --- Hub -------------------------------------------------------------------------

const ids = (world, unit) => heatPumpIds(world.gladys, unit.id);
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

test('discovery: a heat pump becomes a device of its own, beside the air conditioners', async (t) => {
  const ac = new FakeMidea({ host: '192.0.2.10' });
  const pump = new FakeHeatPump({ host: '192.0.2.40', version: 3 });
  const world = await createWorld({ units: [ac, pump], config: { language: 'fr' } });
  t.after(() => world.app.stop());
  assert.equal(world.fake.discoveredDevices.length, 2);
  assert.deepEqual(world.hub.summary().unsupported, []);
  const device = deviceOf(world, pump);
  assert.match(device.name, /^Pompe à chaleur [0-9A-F]{4}$/);
  assert.equal(device.external_id, `ext:test-integration:heat-pump:${pump.id}`);
  assert.deepEqual(keysOf(device), [
    HP_KEYS.ZONE1_MODE,
    HP_KEYS.ZONE1_TARGET,
    HP_KEYS.ZONE1_STATE,
    HP_KEYS.ZONE1_CURVE,
    HP_KEYS.DHW_POWER,
    HP_KEYS.DHW_TARGET,
    HP_KEYS.TANK_TEMPERATURE,
    HP_KEYS.DHW_HEATING,
    HP_KEYS.OUTDOOR_TEMPERATURE,
    HP_KEYS.WATER_INLET,
    HP_KEYS.WATER_OUTLET,
    HP_KEYS.WATER_FLOW,
    HP_KEYS.WATER_PRESSURE,
    HP_KEYS.ECO,
    HP_KEYS.SILENT,
    HP_KEYS.SUPER_SILENT,
    HP_KEYS.COMPRESSOR,
    HP_KEYS.DEFROST,
    HP_KEYS.BACKUP_HEATER,
    HP_KEYS.ERROR,
    HP_KEYS.POWER_DRAW,
  ]);
  const [mode, target] = device.features;
  assert.equal(mode.category, 'thermostat');
  assert.deepEqual(
    mode.supported_options.map((option) => [option.value, option.label]),
    [
      [THERMOSTAT_MODE.OFF, 'Arrêt'],
      [THERMOSTAT_MODE.HEATING, 'Chaud'],
    ],
  );
  // Water temperature mode: whole degrees, within the unit's heating limits.
  assert.deepEqual([target.min, target.max, target.step], [25, 60, 1]);
  const dhw = device.features.find((item) => item.external_id.endsWith(`:${HP_KEYS.DHW_TARGET}`));
  assert.deepEqual([dhw.category, dhw.min, dhw.max], ['water-heater', 20, 60]);
  // The appliance answer gave the message protocol of the later frames.
  assert.equal(world.hub.records.get(pump.id).protocol, 2);
  assert.ok(pump.frames.filter((frame) => frame[9] !== 0xa0).every((frame) => frame[8] === 2));
});

test('discovery: two zones, heating and cooling, a room-temperature zone', async (t) => {
  const pump = new FakeHeatPump({
    host: '192.0.2.40',
    state: { doubleZone: true, cool: true, zoneWaterTemperature: [true, false] },
  });
  const world = await createWorld({ units: [pump] });
  t.after(() => world.app.stop());
  const device = deviceOf(world, pump);
  const feature = (key) =>
    device.features.find((item) => item.external_id === ids(world, pump).feature(key));
  assert.deepEqual(
    feature(HP_KEYS.ZONE1_MODE).supported_options.map((option) => option.value),
    [THERMOSTAT_MODE.OFF, THERMOSTAT_MODE.HEATING, THERMOSTAT_MODE.COOLING, THERMOSTAT_MODE.AUTO],
  );
  // Zone 1 (water): heating and cooling limits together; zone 2 (room): by halves.
  const zone1 = feature(HP_KEYS.ZONE1_TARGET);
  assert.deepEqual([zone1.min, zone1.max, zone1.step], [18, 60, 1]);
  const zone2 = feature(HP_KEYS.ZONE2_TARGET);
  assert.deepEqual([zone2.min, zone2.max, zone2.step], [17, 30, 0.5]);
});

test('states: zones, hot water and sensors are published once the device is added', async (t) => {
  const pump = new FakeHeatPump({ host: '192.0.2.40', version: 3 });
  const world = await createdWorld(t, { units: [pump] });
  await world.hub.pollAll({ force: true });
  assert.equal(lastState(world, pump, HP_KEYS.ZONE1_MODE), THERMOSTAT_MODE.HEATING);
  assert.equal(lastState(world, pump, HP_KEYS.ZONE1_TARGET), 50);
  assert.equal(lastState(world, pump, HP_KEYS.DHW_POWER), 0);
  assert.equal(lastState(world, pump, HP_KEYS.DHW_TARGET), 50);
  assert.equal(lastState(world, pump, HP_KEYS.TANK_TEMPERATURE), 25);
  assert.equal(lastState(world, pump, HP_KEYS.OUTDOOR_TEMPERATURE), 6);
  assert.equal(lastState(world, pump, HP_KEYS.WATER_INLET), 30);
  assert.equal(lastState(world, pump, HP_KEYS.WATER_OUTLET), 35);
  assert.equal(lastState(world, pump, HP_KEYS.POWER_DRAW), 1200);
  assert.equal(lastState(world, pump, HP_KEYS.ECO), 0);

  // A frost day, the zone switched off on the controller.
  pump.sensors.outdoor = -4;
  pump.state.zone1Power = false;
  await world.hub.pollAll({ force: true });
  assert.equal(lastState(world, pump, HP_KEYS.OUTDOOR_TEMPERATURE), -4);
  assert.equal(lastState(world, pump, HP_KEYS.ZONE1_MODE), THERMOSTAT_MODE.OFF);
});

test('states: what runs (zone, hot water, compressor, defrost, backup heater), flow, pressure, error', async (t) => {
  const pump = new FakeHeatPump({ host: '192.0.2.40' });
  const world = await createdWorld(t, { units: [pump] });
  await world.hub.pollAll({ force: true });
  assert.equal(lastState(world, pump, HP_KEYS.ZONE1_STATE), OPERATING_STATE.HEATING);
  assert.equal(lastState(world, pump, HP_KEYS.DHW_HEATING), 0);
  assert.equal(lastState(world, pump, HP_KEYS.COMPRESSOR), 1);
  assert.equal(lastState(world, pump, HP_KEYS.DEFROST), 0);
  assert.equal(lastState(world, pump, HP_KEYS.BACKUP_HEATER), 0);
  assert.equal(lastState(world, pump, HP_KEYS.WATER_FLOW), 1.52);
  assert.equal(lastState(world, pump, HP_KEYS.WATER_PRESSURE), 180);
  assert.equal(lastState(world, pump, HP_KEYS.ZONE1_CURVE), 0);
  assert.equal(lastState(world, pump, HP_KEYS.ERROR), 'No error');

  // Hot water now, the compressor defrosting with the backup heater on.
  Object.assign(pump.sensors, { run: 0x20, defrost: true, backup: true, compressor: 0 });
  await world.hub.pollAll({ force: true });
  assert.equal(lastState(world, pump, HP_KEYS.ZONE1_STATE), OPERATING_STATE.IDLE);
  assert.equal(lastState(world, pump, HP_KEYS.DHW_HEATING), 1);
  assert.equal(lastState(world, pump, HP_KEYS.COMPRESSOR), 0);
  assert.equal(lastState(world, pump, HP_KEYS.DEFROST), 1);
  assert.equal(lastState(world, pump, HP_KEYS.BACKUP_HEATER), 1);

  // A zone switched off is idle, whatever the unit does.
  pump.sensors.run = 0x10;
  pump.state.zone1Power = false;
  await world.hub.pollAll({ force: true });
  assert.equal(lastState(world, pump, HP_KEYS.ZONE1_STATE), OPERATING_STATE.IDLE);
});

test('commands: the weather curve of a zone rides on the basic set frame', async (t) => {
  const pump = new FakeHeatPump({ host: '192.0.2.40', state: { doubleZone: true } });
  const world = await createdWorld(t, { units: [pump] });
  await setValue(world, pump, HP_KEYS.ZONE2_CURVE, 1);
  assert.equal(pump.state.zone2Curve, true);
  assert.equal(pump.state.zone1Curve, false);
  assert.equal(lastState(world, pump, HP_KEYS.ZONE2_CURVE), 1);
});

test('commands: silent and super silent modes are one level', async (t) => {
  const pump = new FakeHeatPump({ host: '192.0.2.40' });
  const world = await createdWorld(t, { units: [pump] });
  await setValue(world, pump, HP_KEYS.SUPER_SILENT, 1);
  assert.equal(pump.state.silentLevel, SILENT_LEVEL.SUPER_SILENT);
  assert.equal(lastState(world, pump, HP_KEYS.SUPER_SILENT), 1);
  assert.equal(lastState(world, pump, HP_KEYS.SILENT), 1);
  // Silent mode switched on again keeps the super silent level.
  await setValue(world, pump, HP_KEYS.SILENT, 1);
  assert.equal(pump.state.silentLevel, SILENT_LEVEL.SUPER_SILENT);
  await setValue(world, pump, HP_KEYS.SUPER_SILENT, 0);
  assert.equal(pump.state.silentLevel, SILENT_LEVEL.SILENT);
  await setValue(world, pump, HP_KEYS.SILENT, 0);
  assert.equal(pump.state.silentLevel, SILENT_LEVEL.OFF);
  assert.equal(lastState(world, pump, HP_KEYS.SUPER_SILENT), 0);

  // A level changed on the controller is read back.
  pump.state.silent = true;
  pump.state.silentLevel = SILENT_LEVEL.SUPER_SILENT;
  await world.hub.pollAll({ force: true });
  assert.equal(lastState(world, pump, HP_KEYS.SUPER_SILENT), 1);
});

test('commands: one set frame carrying every setting, the rest kept', async (t) => {
  const pump = new FakeHeatPump({ host: '192.0.2.40', state: { zone2Curve: true } });
  const world = await createdWorld(t, { units: [pump] });

  assert.deepEqual(await setValue(world, pump, HP_KEYS.DHW_POWER, 1), { success: true });
  await setValue(world, pump, HP_KEYS.DHW_TARGET, 55);
  await setValue(world, pump, HP_KEYS.ZONE1_TARGET, 45);
  await setValue(world, pump, HP_KEYS.ZONE1_MODE, THERMOSTAT_MODE.OFF);
  assert.equal(pump.state.dhwPower, true);
  assert.equal(pump.state.dhwTarget, 55);
  assert.deepEqual(pump.state.zoneTargets, [45, 25]);
  assert.equal(pump.state.zone1Power, false);
  assert.equal(pump.state.mode, 3, 'the operating mode is kept when a zone stops');
  assert.equal(pump.state.zone2Curve, true, 'settings Gladys does not show are kept');
  assert.equal(lastState(world, pump, HP_KEYS.ZONE1_MODE), THERMOSTAT_MODE.OFF);
  assert.equal(lastState(world, pump, HP_KEYS.DHW_TARGET), 55);

  await setValue(world, pump, HP_KEYS.ZONE1_MODE, THERMOSTAT_MODE.HEATING);
  assert.equal(pump.state.zone1Power, true);
});

test('commands: setpoints stay within the limits the unit announces', async (t) => {
  const pump = new FakeHeatPump({ host: '192.0.2.40' });
  const world = await createdWorld(t, { units: [pump] });
  await setValue(world, pump, HP_KEYS.ZONE1_TARGET, 75);
  assert.deepEqual(pump.state.zoneTargets, [60, 25]);
  await setValue(world, pump, HP_KEYS.ZONE1_TARGET, 41.6);
  assert.deepEqual(pump.state.zoneTargets, [42, 25]);
  await setValue(world, pump, HP_KEYS.DHW_TARGET, 90);
  assert.equal(pump.state.dhwTarget, 60);
  const ack = await setValue(world, pump, HP_KEYS.ZONE1_MODE, THERMOSTAT_MODE.COOLING);
  assert.equal(ack.success, false, 'a heating-only installation does not cool');
  assert.equal(pump.state.mode, 3);
});

test('commands: eco and silent modes have frames of their own', async (t) => {
  const pump = new FakeHeatPump({ host: '192.0.2.40' });
  const world = await createdWorld(t, { units: [pump] });
  await setValue(world, pump, HP_KEYS.ECO, 1);
  await setValue(world, pump, HP_KEYS.SILENT, 1);
  assert.equal(pump.state.eco, true);
  assert.equal(pump.state.silent, true);
  const sets = pump.frames.filter((frame) => frame[9] === MESSAGE_TYPE.SET);
  assert.deepEqual(
    sets.map((frame) => [frame[10], frame[11]]),
    [
      [BODY_TYPE.ECO, 1],
      [BODY_TYPE.SILENCE, SILENT_LEVEL.SILENT],
    ],
  );
  assert.equal(lastState(world, pump, HP_KEYS.ECO), 1);
  assert.equal(lastState(world, pump, HP_KEYS.SILENT), 1);
});

test('commands: a unit that does not answer the set is assumed to take it, once', async (t) => {
  const pump = new FakeHeatPump({ host: '192.0.2.40', setAnswers: false });
  const world = await createdWorld(t, { units: [pump] });
  assert.deepEqual(await setValue(world, pump, HP_KEYS.DHW_POWER, 1), { success: true });
  assert.equal(pump.frames.filter((frame) => frame[9] === MESSAGE_TYPE.SET).length, 1);
  assert.equal(lastState(world, pump, HP_KEYS.DHW_POWER), 1);
  assert.equal(world.hub.records.get(pump.id).reachable, true);
});

test('a unit answering only the basic state: no sensors, protocol 0', async (t) => {
  const pump = new FakeHeatPump({
    host: '192.0.2.40',
    unitAnswers: false,
    applianceAnswers: false,
    silenceAnswers: false,
  });
  const world = await createdWorld(t, { units: [pump] });
  const device = deviceOf(world, pump);
  assert.ok(!keysOf(device).includes(HP_KEYS.OUTDOOR_TEMPERATURE));
  assert.ok(!keysOf(device).includes(HP_KEYS.POWER_DRAW));
  assert.ok(!keysOf(device).includes(HP_KEYS.ZONE1_STATE));
  assert.ok(!keysOf(device).includes(HP_KEYS.SUPER_SILENT));
  assert.equal(world.hub.records.get(pump.id).protocol, 0);
  // The parameters are not asked again at every read.
  const before = pump.frames.length;
  await world.hub.pollAll({ force: true });
  assert.equal(pump.frames.length, before + 1);
  assert.equal(lastState(world, pump, HP_KEYS.ZONE1_TARGET), 50);
});

test('notifications: a change on the controller and the energy counter are taken', async (t) => {
  const pump = new FakeHeatPump({ host: '192.0.2.40', version: 3 });
  const world = await createdWorld(t, { units: [pump] });
  await world.hub.pollAll({ force: true });

  pump.state.dhwPower = true;
  pump.push(c3Frame(MESSAGE_TYPE.NOTIFY2, basicBody(pump.state)));
  await new Promise((resolve) => setTimeout(resolve, 20));
  await world.hub.idle();
  assert.equal(lastState(world, pump, HP_KEYS.DHW_POWER), 1);

  pump.push(c3Frame(MESSAGE_TYPE.NOTIFY1, energyBody(4321, 15876)));
  await new Promise((resolve) => setTimeout(resolve, 20));
  await world.hub.idle();
  let device = world.fake.discoveredDevices.at(-1);
  assert.ok(keysOf(device).includes(HP_KEYS.ENERGY_INDEX), 'the energy features appear');
  assert.ok(keysOf(device).includes(HP_KEYS.HEAT_PRODUCED));
  assert.ok(!keysOf(device).includes(HP_KEYS.COMPRESSOR_RUN_TIME));

  pump.push(
    c3Frame(
      MESSAGE_TYPE.NOTIFY1,
      unitNotificationBody({ outdoor: 3, waterIn: 31, waterOut: 36, watts: 900, runTime: 2964 }),
    ),
  );
  await new Promise((resolve) => setTimeout(resolve, 20));
  await world.hub.idle();
  device = world.fake.discoveredDevices.at(-1);
  assert.ok(keysOf(device).includes(HP_KEYS.COMPRESSOR_RUN_TIME), 'the run time appears');
  await world.fake.deviceCreated(device);
  await world.hub.idle();
  assert.equal(lastState(world, pump, HP_KEYS.ENERGY_INDEX), 4321);
  assert.equal(lastState(world, pump, HP_KEYS.HEAT_PRODUCED), 15876);
  assert.equal(lastState(world, pump, HP_KEYS.COMPRESSOR_RUN_TIME), 2964);

  // The next read keeps the run time, which only the notification carries.
  await world.hub.pollAll({ force: true });
  assert.equal(world.hub.records.get(pump.id).unit.compressorRunTime, 2964);
});

test('V3: a token and key typed in the configuration open the unit without the cloud', async (t) => {
  const pump = new FakeHeatPump({ host: '192.0.2.40', version: 3 });
  const other = new FakeHeatPump({ host: '192.0.2.41', version: 3 });
  const world = await createWorld({
    units: [pump],
    cloud: createFakeCloud([], { reachable: false }),
    config: {
      language: 'en',
      // A pair of another unit first: tried, refused, the right one taken.
      v3_keys: `${other.credentials.token}:${other.credentials.key}, ${pump.credentials.token.toUpperCase()}:${pump.credentials.key}`,
    },
  });
  t.after(() => world.app.stop());
  assert.equal(world.fake.discoveredDevices.length, 1);
  assert.equal(world.cloud.calls.length, 0);
  assert.deepEqual(world.hub.records.get(pump.id).credentials, pump.credentials);
});

test('triggers: a new error code of the heat pump fires the unit error', async (t) => {
  const pump = new FakeHeatPump({ host: '192.0.2.40' });
  const world = await createdWorld(t, { units: [pump] });
  await world.hub.pollAll({ force: true });
  pump.state.errorCode = 9;
  await world.hub.pollAll({ force: true });
  await world.hub.pollAll({ force: true });
  await world.hub.idle();
  assert.deepEqual(
    world.fake.sceneEvents.map(({ key, data }) => [key, data]),
    [[TRIGGERS.ERROR, { device: ids(world, pump).device, error_code: 9, error_display: 'E8' }]],
  );
  assert.equal(world.fake.lastState(ids(world, pump).feature(HP_KEYS.ERROR)), 'E8');
});

test('the air conditioner widget and scene action say they are not for a heat pump', async (t) => {
  const pump = new FakeHeatPump({ host: '192.0.2.40' });
  const world = await createdWorld(t, { units: [pump] });
  const device = ids(world, pump).device;
  const widget = await world.fake.widgetGet('climate', { settings: { device }, language: 'fr' });
  assert.match(widget.data.content.components[0].text, /pompe à chaleur/);
  const ack = await world.fake.sceneAction('set_climate', { device, mode: '2' });
  assert.equal(ack.success, false);
  assert.equal(pump.frames.filter((frame) => frame[9] === MESSAGE_TYPE.SET).length, 0);
});

test('a restart keeps the heat pump and its features, without asking the unit first', async (t) => {
  const pump = new FakeHeatPump({ host: '192.0.2.40', version: 3 });
  const world = await createdWorld(t, { units: [pump] });
  const before = deviceOf(world, pump);
  await world.app.stop();

  pump.online = false;
  const again = await createWorld({
    units: [pump],
    dataDir: world.dataDir,
    created: world.fake.discoveredDevices,
  });
  t.after(() => again.app.stop());
  assert.deepEqual(deviceOf(again, pump), before);
});
