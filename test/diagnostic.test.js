// -----------------------------------------------------------------------------
// Diagnostic reports (actions `fleet_diagnostic` and `test_device`): what they
// show, what they never show (tokens, keys, passwords), what they mask unless
// asked (ids, serial numbers, local addresses), and that the unit test only
// sends queries.
// -----------------------------------------------------------------------------

import { test } from 'node:test';
import assert from 'node:assert/strict';
import { MASKED_HOST, createRedactor, maskIdentifier, truncateReport } from '../src/diagnostic.js';
import { heatPumpIds } from '../src/heatpump.js';
import { DEVICE_REQUIRED } from '../src/texts.js';
import { FakeHeatPump, FakeMidea, createAll, createWorld, deviceId } from './helpers/world.js';

async function world(t, options) {
  const created = await createWorld(options);
  t.after(() => created.app.stop());
  await createAll(created);
  return created;
}

const report = (ack) => {
  assert.equal(ack.success, true, ack.error);
  return ack.data.message.en;
};

/** Everything a report must never contain. */
function assertNoSecret(text, units, extra = []) {
  for (const unit of units) {
    assert.ok(!text.includes(unit.credentials.token), 'a token leaked');
    assert.ok(!text.includes(unit.credentials.key), 'a key leaked');
  }
  for (const secret of extra) {
    assert.ok(!text.toLowerCase().includes(secret.toLowerCase()), `${secret} leaked`);
  }
}

test('identifiers: shortened, never empty', () => {
  assert.equal(maskIdentifier(153931628201396), '15…96');
  assert.equal(maskIdentifier('abc'), 'a…');
  assert.equal(maskIdentifier(''), '-');
  const redactor = createRedactor({
    includeIdentifiers: false,
    secrets: ['s3cret-pass'],
    identifiers: ['153931628201396'],
    hosts: ['192.0.2.10'],
  });
  assert.equal(
    redactor.scrub('id 153931628201396 at 192.0.2.10 and 198.51.100.7, password s3cret-pass'),
    `id 15…96 at ${MASKED_HOST} and ${MASKED_HOST}, password <redacted>`,
  );
  const full = createRedactor({ includeIdentifiers: true, secrets: ['s3cret-pass'] });
  assert.equal(full.scrub('192.0.2.10 s3cret-pass'), '192.0.2.10 <redacted>');
});

test('a long report is cut at a line, with a note', () => {
  const text = Array.from({ length: 400 }, (_, index) => `line ${index} ${'x'.repeat(50)}`).join(
    '\n',
  );
  const cut = truncateReport(text, 2000);
  assert.ok(cut.length <= 2000);
  assert.match(cut, /report truncated/);
});

test('fleet diagnostic: every unit, masked, without any secret', async (t) => {
  const ac = new FakeMidea({ host: '192.0.2.10' });
  const pump = new FakeHeatPump({ host: '192.0.2.40', version: 3 });
  const dehumidifier = new FakeMidea({ host: '192.0.2.20', type: 0xa1 });
  const other = new FakeHeatPump({ host: '192.0.2.41', version: 3 });
  const created = await world(t, {
    units: [ac, pump, dehumidifier],
    config: {
      language: 'fr',
      cloud_account: 'someone@example.com',
      cloud_password: 'hunter2-pass',
      v3_keys: `${other.credentials.token}:${other.credentials.key}`,
    },
  });
  await created.hub.pollAll({ force: true });
  const text = report(await created.fake.action('fleet_diagnostic', {}));

  assert.match(text, /Midea diagnostic/);
  assert.match(text, /Units known: 2/);
  assert.match(text, /Climatiseur|Air conditioner/);
  assert.match(text, /\(heat pump 0xC3, V3, model/);
  assert.match(text, /keys: present \(cloud\)/);
  assert.match(text, /keys: not needed \(V2\)/);
  assert.match(text, /not supported: appliance 0xA1/);
  assert.match(text, /own NetHome Plus account: yes, typed token\/key pairs: 1/);
  assert.match(text, /"zoneTargets":\[50,25\]/);
  assert.match(text, /answering: yes, last read \d+ s ago/);
  assertNoSecret(text, [ac, pump, other], ['someone@example.com', 'hunter2-pass']);
  assert.ok(!/192\.0\.2\./.test(text), 'a local address leaked');
  assert.ok(!text.includes(String(pump.id)), 'a full id leaked');
  assert.match(text, new RegExp(maskIdentifier(pump.id)));
  // The intro says what to do with it, in every language.
  const ack = await created.fake.action('fleet_diagnostic', {});
  assert.match(ack.data.message.fr, /^Rapport ci-dessous/);
});

test('fleet diagnostic: one unit, and its identifiers in full when asked', async (t) => {
  const ac = new FakeMidea({ host: '192.0.2.10' });
  const pump = new FakeHeatPump({ host: '192.0.2.40', version: 3 });
  const created = await world(t, { units: [ac, pump] });
  const device = heatPumpIds(created.gladys, pump.id).device;
  const text = report(
    await created.fake.action('fleet_diagnostic', { device, include_identifiers: true }),
  );
  assert.match(text, /Units known: 2 \(one shown\)/);
  assert.match(text, /WARNING: this report shows full ids/);
  assert.ok(text.includes('192.0.2.40'));
  assert.ok(text.includes(String(pump.id)));
  assert.ok(!text.includes('192.0.2.10:'), 'only the unit asked for');
  assertNoSecret(text, [pump]);
});

test('unit test: a heat pump is read with every query, serial numbers cut, no command', async (t) => {
  const pump = new FakeHeatPump({ host: '192.0.2.40', version: 3 });
  const created = await world(t, { units: [pump] });
  const before = pump.frames.length;
  const device = heatPumpIds(created.gladys, pump.id).device;
  const text = report(await created.fake.action('test_device', { device }));

  assert.match(text, /Midea unit test/);
  assert.match(text, /appliance \(0xA0\): sent aa1dc3/);
  assert.match(text, /body hidden/);
  assert.match(text, /basic state \(0x01\): sent aa0bc3/);
  assert.match(text, /decoded: \{"kind":"basic"/);
  assert.match(text, /unit parameters \(0x10\)[\s\S]*serial numbers cut/);
  assert.match(text, /silent mode \(0x05\)[\s\S]*"silentLevel":0/);
  assert.match(text, /eco mode \(0x07\)[\s\S]*no answer within the timeout/);
  const sent = pump.frames.slice(before);
  assert.equal(sent.length, 5);
  assert.ok(
    sent.every((frame) => frame[9] !== 0x02),
    'the test sends queries only',
  );
  assertNoSecret(text, [pump]);
});

test('unit test: an air conditioner is read without any control frame', async (t) => {
  const ac = new FakeMidea({ host: '192.0.2.10' });
  const created = await world(t, { units: [ac] });
  const text = report(
    await created.fake.action('test_device', { device: deviceId(created.gladys, ac) }),
  );
  assert.match(text, /capabilities \(0xB5\): sent aa/);
  assert.match(text, /decoded: \{"kind":"capabilities"/);
  assert.match(text, /state \(0x41\)[\s\S]*"kind":"state"/);
  assert.deepEqual(ac.controls, []);
});

test('unit test: a typed address of an unsupported appliance gives its discovery answer', async (t) => {
  const dehumidifier = new FakeMidea({ host: '192.0.2.20', type: 0xa1 });
  const created = await world(t, { units: [dehumidifier], scan: false });
  const text = report(await created.fake.action('test_device', { device_ref: '192.0.2.20' }));
  assert.match(text, /Discovery answer from <local-ip>: appliance 0xA1, V2/);
  assert.match(text, /not supported yet: paste this report in a GitHub issue/);
  assert.ok(!text.includes('192.0.2.20'));

  const none = report(await created.fake.action('test_device', { device_ref: '192.0.2.99' }));
  assert.match(none, /No Midea answer from <local-ip>/);
  const unknown = report(await created.fake.action('test_device', { device_ref: 'garage' }));
  assert.match(unknown, /No known unit matches "garage"/);
});

test('unit test: a V3 unit without keys is not read, and a unit is required', async (t) => {
  const pump = new FakeHeatPump({ host: '192.0.2.40', version: 3 });
  const created = await createWorld({
    units: [pump],
    cloud: { calls: [], getToken: async () => Promise.reject(new Error('no token')) },
  });
  t.after(() => created.app.stop());
  const text = report(await created.fake.action('test_device', { device_ref: '192.0.2.40' }));
  assert.match(text, /keys: missing/);
  assert.match(text, /skipped: this V3 unit has no token and key yet/);

  const ack = await created.fake.action('test_device', {});
  assert.deepEqual(ack.data.message, DEVICE_REQUIRED);
});
