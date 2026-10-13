// -----------------------------------------------------------------------------
// The NetHome Plus client against a fake fetch: the requests it sends (signed,
// password hashed) and the errors it maps. The real cloud is checked by
// scripts/probe.mjs, outside the tests (they never touch the network).
// -----------------------------------------------------------------------------

import { test } from 'node:test';
import assert from 'node:assert/strict';
import { NetHomePlusCloud, PUBLIC_ACCOUNTS, hashPassword, sign } from '../src/midea/cloud.js';

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
