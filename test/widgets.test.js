// -----------------------------------------------------------------------------
// The `climate` widget: content within the core's vocabulary and budget,
// bound to features the device really has, and its four buttons.
// -----------------------------------------------------------------------------

import { test } from 'node:test';
import assert from 'node:assert/strict';
import { validateWidgetContent } from '@gladysassistant/integration-sdk';
import { ACTIONS } from '../src/widgets.js';
import { CAPS, FakeMidea, createAll, createWorld, deviceId } from './helpers/world.js';

async function createdWorld(t, options) {
  const world = await createWorld(options);
  t.after(() => world.app.stop());
  await createAll(world);
  return world;
}

async function content(world, unit, language = 'en') {
  const ack = await world.fake.widgetGet('climate', {
    settings: { device: deviceId(world.gladys, unit) },
    language,
    units: 'metric',
  });
  assert.equal(ack.success, true, ack.error);
  return ack.data.content;
}

const buttons = (data) => data.components.filter((component) => component.type === 'button');

for (const caps of ['basic', 'metered', 'window']) {
  for (const language of ['en', 'fr', 'de', 'es']) {
    test(`widget content fits the vocabulary and the budget (${caps}, ${language})`, async (t) => {
      const unit = new FakeMidea({
        host: '192.0.2.10',
        caps: CAPS[caps],
        state: { power: true, filterAlert: true, errorCode: 3 },
      });
      const world = await createdWorld(t, { units: [unit] });
      const data = await content(world, unit, language);
      assert.deepEqual(validateWidgetContent(data), []);
      // Every bound tile targets a feature the device has.
      const features = new Set(
        world.fake.discoveredDevices[0].features.map((feature) => feature.external_id),
      );
      for (const component of data.components) {
        if (component.device_feature) {
          assert.ok(features.has(component.device_feature), component.device_feature);
        }
      }
      assert.equal(buttons(data).length, 4);
      const keys = buttons(data).map((button) => button.action.key);
      assert.equal(new Set(keys).size, keys.length, 'unique action keys');
    });
  }
}

test('widget: without a device, or an unknown one, a sentence says what to do', async (t) => {
  const world = await createdWorld(t, { units: [] });
  const none = await world.fake.widgetGet('climate', { settings: {}, language: 'fr' });
  assert.match(none.data.content.components[0].text, /Choisissez un climatiseur/);
  const unknown = await world.fake.widgetGet('climate', {
    settings: { device: 'ext:test-integration:ac:1' },
    language: 'de',
  });
  assert.match(unknown.data.content.components[0].text, /noch unbekannt/);
});

test('widget: the status shows mode, fan, filter and error', async (t) => {
  const unit = new FakeMidea({
    host: '192.0.2.10',
    caps: CAPS.window,
    state: { power: true, mode: 2, fanSpeed: 60, filterAlert: true, errorCode: 3 },
  });
  const world = await createdWorld(t, { units: [unit] });
  const data = await content(world, unit, 'fr');
  const status = data.components.find((component) => component.type === 'status');
  assert.deepEqual(
    status.items.map((item) => [item.label, item.value]),
    [
      ['Mode', 'Froid'],
      ['Ventilation', 'Moyenne'],
      ['Filtre', 'À nettoyer'],
      ['Code erreur', 3],
    ],
  );
});

test('widget buttons: power, setpoint down and up, mode form', async (t) => {
  const unit = new FakeMidea({
    host: '192.0.2.10',
    state: { power: false, targetTemperature: 24 },
  });
  const world = await createdWorld(t, { units: [unit] });
  const settings = { device: deviceId(world.gladys, unit) };
  const act = (key, params = {}, values) =>
    world.fake.widgetAction('climate', key, params, { settings, values });

  assert.equal((await act(ACTIONS.POWER)).success, true);
  assert.equal(unit.state.power, true);
  await act(ACTIONS.UP);
  assert.equal(unit.state.targetTemperature, 24.5);
  const down = await act(ACTIONS.DOWN);
  assert.equal(unit.state.targetTemperature, 24);
  assert.equal(down.data.message.fr, 'Consigne : 24 °C');

  const form = buttons(await content(world, unit)).find(
    (button) => button.action.key === ACTIONS.SETTINGS,
  );
  assert.deepEqual(
    form.action.fields.map((field) => field.key),
    ['mode', 'fan_speed'],
  );
  await act(ACTIONS.SETTINGS, {}, { mode: '2', fan_speed: '5' });
  assert.equal(unit.state.mode, 4);
  assert.equal(unit.state.fanSpeed, 80);
  assert.equal(unit.controls.length, 4, 'one frame per tap');

  // A core older than 5.2 relays the tap without the form.
  assert.equal((await act(ACTIONS.SETTINGS)).success, false);
});
