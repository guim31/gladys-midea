// -----------------------------------------------------------------------------
// Configuration normalization: defaults, typed addresses, cloud account.
// -----------------------------------------------------------------------------

import { test } from 'node:test';
import assert from 'node:assert/strict';
import { normalizeConfig, parseHosts } from '../src/config.js';

test('defaults: French names, 30 s, public European account, no beep', () => {
  assert.deepEqual(normalizeConfig(), {
    hosts: [],
    invalidHosts: [],
    pollSeconds: 30,
    cloud: { region: 'DE', account: '', password: '' },
    manualKeys: [],
    energyFormat: 'bcd',
    beep: false,
    language: 'fr',
  });
});

test('typed addresses: separators, duplicates, leading zeros and garbage', () => {
  assert.deepEqual(parseHosts('192.0.2.1, 192.0.2.001;192.0.2.2\n300.1.1.1 ac.local'), {
    hosts: ['192.0.2.1', '192.0.2.2'],
    invalid: ['300.1.1.1', 'ac.local'],
  });
});

test('an own account needs both its e-mail and its password', () => {
  assert.deepEqual(normalizeConfig({ cloud_account: 'me@example.com' }).cloud, {
    region: 'DE',
    account: '',
    password: '',
  });
  assert.deepEqual(
    normalizeConfig({ cloud_account: ' me@example.com ', cloud_password: 'pw', cloud_region: 'US' })
      .cloud,
    { region: 'US', account: 'me@example.com', password: 'pw' },
  );
});

test('unknown values fall back to the defaults', () => {
  const config = normalizeConfig({
    poll_interval: '7',
    cloud_region: 'XX',
    energy_format: 'hex',
    language: 'it',
    beep: 'true',
  });
  assert.equal(config.pollSeconds, 30);
  assert.equal(config.cloud.region, 'DE');
  assert.equal(config.energyFormat, 'bcd');
  assert.equal(config.language, 'fr');
  assert.equal(config.beep, true);
});
