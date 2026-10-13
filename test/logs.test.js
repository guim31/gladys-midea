// -----------------------------------------------------------------------------
// What the container writes: at the default level (info), the life of the
// units and of Gladys, never one line per reading, a repeated failure once;
// at any level, never a password, a token or a key.
// -----------------------------------------------------------------------------

import { test } from 'node:test';
import assert from 'node:assert/strict';
import { GladysApiError } from '@gladysassistant/integration-sdk';
import { FEATURE_KEYS } from '../src/devices.js';
import { FakeMidea, createAll, createWorld, featureId } from './helpers/world.js';

/**
 * The log lines written on stdout and stderr while `fn` runs, at `level`.
 * Anything else (the test runner's own reports) goes through untouched.
 */
async function capture(t, fn, level = 'info') {
  const lines = [];
  const previous = process.env.LOG_LEVEL;
  process.env.LOG_LEVEL = level;
  const intercept = (stream) => {
    const original = stream.write.bind(stream);
    return t.mock.method(stream, 'write', (chunk, ...rest) => {
      const text = typeof chunk === 'string' ? chunk : Buffer.from(chunk).toString();
      if (!/^\[\d{4}-\d\d-\d\dT/.test(text)) {
        return original(chunk, ...rest);
      }
      lines.push(...text.split('\n').filter(Boolean));
      return true;
    });
  };
  const stdout = intercept(process.stdout);
  const stderr = intercept(process.stderr);
  try {
    await fn();
  } finally {
    stdout.mock.restore();
    stderr.mock.restore();
    process.env.LOG_LEVEL = previous;
  }
  return lines;
}

async function createdWorld(t, options) {
  const world = await createWorld(options);
  t.after(() => world.app.stop());
  await createAll(world);
  return world;
}

test('logs: normal readings, with changes, write nothing at the info level', async (t) => {
  const unit = new FakeMidea({ host: '192.0.2.10' });
  const world = await createdWorld(t, { units: [unit] });
  const lines = await capture(t, async () => {
    for (const temperature of [25, 25.5, 26, 26]) {
      unit.state.indoorTemperature = temperature;
      await world.hub.pollAll({ force: true });
    }
    await world.hub.rediscover();
    await world.hub.idle();
  });
  assert.equal(
    world.fake.lastState(featureId(world.gladys, unit, FEATURE_KEYS.INDOOR_TEMPERATURE)),
    26,
  );
  assert.deepEqual(lines, []);
});

test('logs: a user command writes one info line', async (t) => {
  const unit = new FakeMidea({ host: '192.0.2.10' });
  const world = await createdWorld(t, { units: [unit] });
  const [device] = world.fake.discoveredDevices;
  const lines = await capture(t, () => world.fake.setValue(device, device.features[0], 1));
  assert.equal(lines.length, 1, lines.join('\n'));
  assert.match(lines[0], /\[INFO\].*Command: Air conditioner [0-9A-F]{4} power = 1/);
});

test('logs: Gladys refusing the states at every reading is said once, and its return once', async (t) => {
  const unit = new FakeMidea({ host: '192.0.2.10' });
  const world = await createdWorld(t, { units: [unit] });
  const refusal = t.mock.method(world.gladys, 'publishChangedStates', async () => {
    throw new GladysApiError(503, 'SERVICE_UNAVAILABLE', 'Gladys is restarting');
  });
  const failing = await capture(t, async () => {
    for (const temperature of [20, 21, 22, 23]) {
      unit.state.indoorTemperature = temperature;
      await world.hub.pollAll({ force: true });
    }
    await world.hub.idle();
  });
  assert.equal(failing.length, 1, failing.join('\n'));
  assert.match(
    failing[0],
    /\[WARN\].*Gladys does not take the Midea updates: Gladys is restarting/,
  );

  refusal.mock.restore();
  const back = await capture(t, async () => {
    await world.hub.pollAll({ force: true });
    await world.hub.pollAll({ force: true });
  });
  assert.equal(back.length, 1, back.join('\n'));
  assert.match(back[0], /\[INFO\].*Gladys takes the Midea updates again/);
});

test('logs: a unit lost then back writes one line each, not one per reading', async (t) => {
  const unit = new FakeMidea({ host: '192.0.2.10' });
  const world = await createdWorld(t, { units: [unit] });
  const lines = await capture(t, async () => {
    unit.online = false;
    for (let i = 0; i < 5; i += 1) {
      await world.hub.pollAll({ force: true });
    }
    unit.online = true;
    for (let i = 0; i < 3; i += 1) {
      await world.hub.pollAll({ force: true });
    }
  });
  assert.equal(lines.length, 2, lines.join('\n'));
  assert.match(lines[0], /no longer answers at 192\.0\.2\.10/);
  assert.match(lines[1], /answers at 192\.0\.2\.10/);
});

test('logs: no password, token or key at any level', async (t) => {
  const unit = new FakeMidea({ host: '192.0.2.11', version: 3 });
  const password = 'Sup3r-Secret-Passw0rd';
  const secrets = [password, unit.credentials.token, unit.credentials.key];
  const lines = await capture(
    t,
    async () => {
      const world = await createWorld({
        units: [unit],
        config: { cloud_account: 'someone@example.com', cloud_password: password },
      });
      t.after(() => world.app.stop());
      await createAll(world);
      await world.hub.pollAll({ force: true });
      const [device] = world.fake.discoveredDevices;
      await world.fake.setValue(device, device.features[0], 1);
      const session = world.hub.records.get(unit.id).lan.codec.key.toString('hex');
      secrets.push(session);
      // A re-paired unit: refused keys, new keys fetched (the failure paths).
      unit.token = Buffer.alloc(64, 0x5c);
      unit.key = Buffer.alloc(32, 0x3a);
      secrets.push(unit.credentials.token, unit.credentials.key);
      world.hub.records.get(unit.id).lan.close();
      await world.hub.pollAll({ force: true });
      await world.fake.action('search', {});
      assert.equal(world.hub.records.get(unit.id).reachable, true);
      await world.app.stop();
    },
    'debug',
  );
  assert.ok(lines.length >= 5, `debug lines were written: ${JSON.stringify(lines)}`);
  for (const line of lines) {
    for (const secret of secrets) {
      assert.ok(!line.toLowerCase().includes(secret.toLowerCase()), `secret in: ${line}`);
    }
  }
});
