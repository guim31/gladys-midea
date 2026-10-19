// -----------------------------------------------------------------------------
// Conformity with the Gladys core, on every device discovered from realistic
// fixtures (test/helpers/fakeMidea.js: real capability answers of msmart-ng's
// tests): a V2 unit, two V3 units, a metered unit, a window unit without
// outdoor sensor and an old unit that does not answer the capability query —
// in every feature-name language.
//
// The table (test/fixtures/gladys-feature-table.json) is extracted from the
// core code: a category/type couple missing there shows as "undefined" or
// without icon in Gladys, a poll frequency outside its list is a 400 on
// discovery, a feature without min/max is a 422 on "Add to Gladys".
// Do not loosen this test to make it pass: fix the integration.
// -----------------------------------------------------------------------------

import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import { allUnits, createWorld } from './helpers/world.js';

const table = JSON.parse(
  await readFile(new URL('./fixtures/gladys-feature-table.json', import.meta.url), 'utf8'),
);

const scenarios = [
  { label: 'default configuration (French names)', config: {} },
  { label: 'English names', config: { language: 'en' } },
  { label: 'German names', config: { language: 'de' } },
  { label: 'Spanish names', config: { language: 'es' } },
];

for (const scenario of scenarios) {
  test(`every discovered device follows the Gladys rules (${scenario.label})`, async () => {
    const units = allUnits();
    const { fake, app } = await createWorld({ units, config: scenario.config });
    try {
      const devices = fake.discoveredDevices;
      assert.equal(devices.length, units.length, 'one device per unit');
      const deviceIds = new Set();

      for (const device of devices) {
        const where = `${device.name} (${device.model})`;
        assert.ok(!deviceIds.has(device.external_id), `${where}: duplicate device external_id`);
        deviceIds.add(device.external_id);

        // should_poll: true if and only if poll_frequency is provided, in ms.
        if (device.poll_frequency === undefined) {
          assert.notEqual(device.should_poll, true, `${where}: should_poll without poll_frequency`);
        } else {
          assert.equal(device.should_poll, true, `${where}: poll_frequency without should_poll`);
          assert.ok(
            table.poll_frequencies_ms.includes(device.poll_frequency),
            `${where}: poll_frequency ${device.poll_frequency} is not one of ${table.poll_frequencies_ms}`,
          );
        }

        assert.ok(device.features.length > 0, `${where}: no feature`);
        const externalIds = new Set();
        const names = new Set();
        for (const feature of device.features) {
          const at = `${where} / ${feature.name}`;
          const pair = table.pairs[`${feature.category}/${feature.type}`];
          assert.ok(
            pair,
            `${at}: ${feature.category}/${feature.type} is not a couple Gladys knows`,
          );
          assert.ok(
            pair.label_en && pair.label_fr && pair.icon,
            `${at}: couple without label or icon`,
          );

          assert.equal(typeof feature.min, 'number', `${at}: min must be a number`);
          assert.equal(typeof feature.max, 'number', `${at}: max must be a number`);
          assert.ok(
            Number.isFinite(feature.min) && Number.isFinite(feature.max),
            `${at}: finite min/max`,
          );
          assert.ok(feature.min <= feature.max, `${at}: min > max`);
          assert.equal(typeof feature.read_only, 'boolean', `${at}: read_only must be a boolean`);
          assert.equal(
            typeof feature.has_feedback,
            'boolean',
            `${at}: has_feedback must be a boolean`,
          );
          if (feature.unit !== undefined) {
            assert.ok(table.units.includes(feature.unit), `${at}: unknown unit ${feature.unit}`);
            const allowed = (table.units_by_category[feature.category] ?? []).flat();
            assert.ok(
              allowed.includes(feature.unit),
              `${at}: unit ${feature.unit} not for ${feature.category}`,
            );
          }
          if (feature.step !== undefined) {
            assert.ok(
              typeof feature.step === 'number' && feature.step > 0,
              `${at}: step must be > 0`,
            );
          }
          if (feature.supported_options !== undefined) {
            // Host API rules: integer values, unique, non-empty labels, within min/max.
            assert.ok(feature.supported_options.length > 0, `${at}: empty supported_options`);
            const values = feature.supported_options.map((option) => option.value);
            assert.equal(new Set(values).size, values.length, `${at}: duplicate option value`);
            for (const option of feature.supported_options) {
              if (feature.category === 'text' && feature.type === 'select') {
                // A dynamic select: string values only (normalizeSupportedOptions).
                assert.ok(
                  typeof option.value === 'string' && option.value.trim(),
                  `${at}: a select option value must be a non-empty string`,
                );
                assert.ok(
                  typeof option.label === 'string' && option.label.trim(),
                  `${at}: option label`,
                );
                continue;
              }
              assert.ok(Number.isInteger(option.value), `${at}: option value must be an integer`);
              assert.ok(
                option.value >= feature.min && option.value <= feature.max,
                `${at}: option out of range`,
              );
              assert.ok(
                typeof option.label === 'string' && option.label.trim(),
                `${at}: option label`,
              );
            }
          }

          assert.ok(!externalIds.has(feature.external_id), `${at}: duplicate external_id`);
          externalIds.add(feature.external_id);
          assert.ok(
            feature.external_id.startsWith(`${device.external_id}:`),
            `${at}: feature id outside its device`,
          );
          assert.ok(!names.has(feature.name), `${at}: duplicate feature name on the device`);
          names.add(feature.name);
        }
      }
    } finally {
      await app.stop();
    }
  });
}

test('the published states fit the features they target', async () => {
  const units = allUnits();
  const world = await createWorld({ units });
  try {
    for (const device of world.fake.discoveredDevices) {
      await world.fake.deviceCreated(device);
    }
    await world.hub.idle();
    await world.hub.pollAll({ force: true });
    const features = new Map(
      world.fake.discoveredDevices.flatMap((device) =>
        device.features.map((feature) => [feature.external_id, feature]),
      ),
    );
    assert.ok(world.fake.states.length > 40);
    for (const state of world.fake.states) {
      const feature = features.get(state.device_feature_external_id);
      assert.ok(feature, `state for an unknown feature ${state.device_feature_external_id}`);
      if (feature.category === 'text') {
        // A text state carries `text`, never empty, and no number.
        assert.ok(typeof state.text === 'string' && state.text.trim(), `${feature.name}: text`);
        assert.equal(state.state, undefined);
        if (feature.supported_options) {
          assert.ok(
            feature.supported_options.some((option) => option.value === state.text),
            `${feature.name}: ${state.text} is not an offered option`,
          );
        }
        continue;
      }
      assert.equal(typeof state.state, 'number');
      assert.ok(
        state.state >= feature.min && state.state <= feature.max,
        `${feature.name}: ${state.state} outside ${feature.min}..${feature.max}`,
      );
      if (feature.supported_options) {
        assert.ok(
          feature.supported_options.some((option) => option.value === state.state),
          `${feature.name}: ${state.state} is not an offered option`,
        );
      }
    }
  } finally {
    await world.app.stop();
  }
});
