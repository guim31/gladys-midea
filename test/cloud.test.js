// -----------------------------------------------------------------------------
// The NetHome Plus and SmartHome clients against a fake fetch: the requests
// they send (signed, password hashed) and the errors they map; the order of
// the clouds asked. The real cloud is checked by
// scripts/probe.mjs, outside the tests (they never touch the network).
// -----------------------------------------------------------------------------

import { test } from 'node:test';
import assert from 'node:assert/strict';
import {
  NetHomePlusCloud,
  LOGIN_RETRY_MS,
  PUBLIC_ACCOUNTS,
  SMARTHOME_ACCOUNTS,
  SMARTHOME_URL,
  SmartHomeCloud,
  cloudChain,
  createCloudClient,
  hashPassword,
  sign,
  smartHomeIamPassword,
  smartHomePassword,
  smartHomeSign,
} from '../src/midea/cloud.js';

function fakeFetch(handler) {
  const requests = [];
  const fetch = async (url, init) => {
    const body = Object.fromEntries(new URLSearchParams(init.body));
    requests.push({ url, body });
    const reply = handler(new URL(url).pathname, body);
    if (reply instanceof Error) throw reply;
    return { ok: true, status: 200, json: async () => reply };
  };
  return { fetch, requests };
}

const ok = (result) => ({ errorCode: '0', msg: 'ok', result });

test('login then getToken: signed requests, hashed password, token matched by udpid', async () => {
  const { fetch, requests } = fakeFetch((path, body) => {
    if (path === '/v1/user/login/id/get') return ok({ loginId: 'L1' });
    if (path === '/v1/user/login') return ok({ sessionId: 'S1' });
    return ok({
      tokenlist: [
        { udpId: 'other', token: 'aa', key: 'bb' },
        { udpId: body.udpid, token: 'cc', key: 'dd' },
      ],
    });
  });
  const cloud = new NetHomePlusCloud({ account: 'me@example.com', password: 'pw', fetch });
  assert.deepEqual(await cloud.getToken('u1', 42), { token: 'cc', key: 'dd' });
  assert.deepEqual(
    requests.map((request) => new URL(request.url).pathname),
    ['/v1/user/login/id/get', '/v1/user/login', '/v1/iot/secure/getToken'],
  );
  for (const { url, body } of requests) {
    const { sign: signature, ...rest } = body;
    assert.equal(signature, sign(new URL(url).pathname, rest));
    assert.equal(body.appId, '1017');
  }
  assert.equal(requests[1].body.password, hashPassword('L1', 'pw'));
  assert.ok(!JSON.stringify(requests).includes('"pw"'), 'the password never travels in clear');
  assert.equal(requests[2].body.sessionId, 'S1');
  assert.equal(requests[2].body.applianceCodes, '42');
});

test('the public account of the region is used without an own account', async () => {
  const { fetch, requests } = fakeFetch(() => ok({ loginId: 'L', sessionId: 'S', tokenlist: [] }));
  const cloud = new NetHomePlusCloud({ region: 'US', fetch });
  await assert.rejects(cloud.getToken('u1'), { code: 'NO_TOKEN' });
  assert.equal(requests[0].body.loginAccount, PUBLIC_ACCOUNTS.US[0]);
});

test('errors: refused login, unreachable cloud', async () => {
  const refused = fakeFetch(() => ({ errorCode: '3101', msg: 'password error' }));
  await assert.rejects(new NetHomePlusCloud({ fetch: refused.fetch }).getToken('u'), {
    name: 'CloudError',
    code: 3101,
    message: /password error/,
  });
  const down = fakeFetch(() =>
    Object.assign(new TypeError('fetch failed'), { cause: { code: 'ENOTFOUND' } }),
  );
  await assert.rejects(new NetHomePlusCloud({ fetch: down.fetch }).getToken('u'), {
    network: true,
    message: /unreachable \(ENOTFOUND\)/,
  });
});

test('a login refused by the cloud is not asked again for an hour; other failures are', async () => {
  let clock = 0;
  const refused = fakeFetch(() => ({ errorCode: '3101', msg: 'password error' }));
  const cloud = new NetHomePlusCloud({
    account: 'me@example.com',
    password: 'pw',
    fetch: refused.fetch,
    now: () => clock,
  });
  await assert.rejects(cloud.getToken('u1'), { code: 3101 });
  await assert.rejects(cloud.getToken('u2'), { code: 3101 });
  assert.equal(refused.requests.length, 1);
  clock += LOGIN_RETRY_MS;
  await assert.rejects(cloud.getToken('u3'), { code: 3101 });
  assert.equal(refused.requests.length, 2, 'asked again after an hour');

  // A login without session (no code from the cloud) is asked again at once.
  const odd = fakeFetch((path) =>
    path === '/v1/user/login/id/get' ? ok({ loginId: 'L' }) : ok({}),
  );
  const again = new NetHomePlusCloud({ fetch: odd.fetch });
  await assert.rejects(again.getToken('u1'), { message: /gave no session/ });
  await assert.rejects(again.getToken('u2'), { message: /gave no session/ });
  assert.equal(odd.requests.length, 4);
});

test('an answer without code shows no NaN; no Internet is told apart from a slow server', async () => {
  const bare = fakeFetch(() => ({ msg: 'odd' }));
  await assert.rejects(new NetHomePlusCloud({ fetch: bare.fetch }).getToken('u'), (err) => {
    assert.equal(err.message, 'Midea cloud refused: odd');
    assert.equal(err.code, undefined);
    return true;
  });
  const failing = (cause) =>
    fakeFetch(() => Object.assign(new TypeError('fetch failed'), { cause: { code: cause } }));
  for (const cause of ['ENOTFOUND', 'EAI_AGAIN', 'ECONNREFUSED', 'ENETUNREACH']) {
    await assert.rejects(new NetHomePlusCloud({ fetch: failing(cause).fetch }).getToken('u'), {
      network: true,
      offline: true,
    });
  }
  const slow = fakeFetch(() => Object.assign(new Error('timed out'), { name: 'TimeoutError' }));
  await assert.rejects(new SmartHomeCloud({ fetch: slow.fetch }).getToken('u'), {
    network: true,
    offline: false,
  });
});

// --- SmartHome ------------------------------------------------------------------

function fakeSmartHome(handler) {
  const requests = [];
  const fetch = async (url, init) => {
    const parsed = new URL(url);
    const body = JSON.parse(init.body);
    requests.push({
      url,
      alias: parsed.searchParams.get('alias'),
      headers: init.headers,
      raw: init.body,
      body,
    });
    const reply = handler(parsed.searchParams.get('alias'), body);
    if (reply instanceof Error) throw reply;
    return { ok: true, status: 200, json: async () => reply };
  };
  return { fetch, requests };
}

const done = (data) => ({ code: '0', msg: 'ok', data });

test('SmartHome: login then getToken through the proxy, signed, hashed passwords, access token', async () => {
  const { fetch, requests } = fakeSmartHome((alias, body) => {
    if (alias === '/v1/user/login/id/get') return done({ loginId: 'L1' });
    if (alias === '/mj/user/login') return done({ mdata: { accessToken: 'T1' } });
    return done({ tokenlist: [{ udpId: body.udpid, token: 'cc', key: 'dd' }] });
  });
  const cloud = new SmartHomeCloud({ account: 'me@example.com', password: 'pw', fetch });
  assert.deepEqual(await cloud.getToken('u1', 42), { token: 'cc', key: 'dd' });
  assert.deepEqual(
    requests.map((request) => request.alias),
    ['/v1/user/login/id/get', '/mj/user/login', '/v1/iot/secure/getToken'],
  );
  for (const { url, headers, raw } of requests) {
    assert.ok(url.startsWith(`${SMARTHOME_URL}/mas/v5/app/proxy?alias=`));
    assert.equal(headers['Content-Type'], 'application/json');
    assert.equal(headers.secretVersion, '1');
    assert.match(headers.random, /^[0-9a-f]{32}$/);
    assert.equal(headers.sign, smartHomeSign(raw, headers.random));
  }
  assert.equal(requests[0].body.appId, '1010');
  assert.equal(requests[0].body.loginAccount, 'me@example.com');
  const { iotData, data } = requests[1].body;
  assert.equal(iotData.password, smartHomePassword('L1', 'pw'));
  assert.equal(iotData.iampwd, smartHomeIamPassword('L1', 'pw'));
  assert.equal(data.platform, 2);
  assert.ok(
    !requests.some((request) => request.raw.includes('"pw"')),
    'the password never travels in clear',
  );
  assert.equal(requests[0].headers.accessToken, '');
  assert.equal(requests[2].headers.accessToken, 'T1');
  // The SmartHome cloud answers 3004 to getToken without the appliance id.
  assert.equal(requests[2].body.udpid, 'u1');
  assert.equal(requests[2].body.applianceCodes, '42');
});

test('SmartHome: public account of the region, errors of the cloud and of the network', async () => {
  const empty = fakeSmartHome((alias) =>
    alias === '/mj/user/login'
      ? done({ mdata: { accessToken: 'T' } })
      : done({ loginId: 'L', tokenlist: [] }),
  );
  await assert.rejects(new SmartHomeCloud({ region: 'US', fetch: empty.fetch }).getToken('u1', 1), {
    code: 'NO_TOKEN',
  });
  assert.equal(empty.requests[0].body.loginAccount, SMARTHOME_ACCOUNTS.US[0]);

  const refused = fakeSmartHome(() => ({ code: 3201, msg: 'You have no permissions.' }));
  await assert.rejects(new SmartHomeCloud({ fetch: refused.fetch }).getToken('u'), {
    name: 'CloudError',
    code: 3201,
    message: /no permissions/,
  });
  const down = fakeSmartHome(() =>
    Object.assign(new TypeError('fetch failed'), { cause: { code: 'ECONNRESET' } }),
  );
  await assert.rejects(new SmartHomeCloud({ fetch: down.fetch }).getToken('u'), { network: true });
});

test('cloud chain: the chosen app first, then the other; an own account before the public ones', () => {
  assert.deepEqual(cloudChain({ app: 'nethome', region: 'DE' }), [
    { app: 'nethome', region: 'DE' },
    { app: 'smarthome', region: 'DE' },
  ]);
  assert.deepEqual(cloudChain({ app: 'smarthome', region: 'US', account: 'a', password: 'p' }), [
    { app: 'smarthome', region: 'US', account: 'a', password: 'p' },
    { app: 'nethome', region: 'US', account: 'a', password: 'p' },
    { app: 'smarthome', region: 'US' },
    { app: 'nethome', region: 'US' },
  ]);
  assert.ok(createCloudClient({ app: 'smarthome', region: 'DE' }) instanceof SmartHomeCloud);
  assert.ok(createCloudClient({ app: 'nethome', region: 'DE' }) instanceof NetHomePlusCloud);
});
