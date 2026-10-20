// -----------------------------------------------------------------------------
// The one cloud call of the integration: the token and key of a V3 device,
// from one of the two Midea clouds msmart-ng knows, "NetHome Plus" and
// "SmartHome" (the MSmartHome app, also used by Comfee and other brands).
// Ported from msmart-ng `cloud.py` (MIT). Once fetched they are kept under
// /data and everything else is local.
//
// A token is filed under the device ("udpid"), not under an account, but only
// in the cloud of the app the unit was set up with: a unit of the SmartHome app
// is unknown to NetHome Plus, whatever the account. msmart-ng ships public
// accounts, per app and per region, and so does this integration; users who
// prefer may give their own account. `cloudChain` tries the chosen app first,
// then the other one. The password never leaves this module unhashed, and
// nothing here is logged.
// -----------------------------------------------------------------------------

import { createHash, createHmac, randomBytes } from 'node:crypto';

export const CLOUD_APPS = ['nethome', 'smarthome'];
export const CLOUD_APP_NAMES = { nethome: 'NetHome Plus', smarthome: 'SmartHome' };

// --- NetHome Plus constants (msmart-ng NetHomePlusCloud) ---------------------

export const CLOUD_URL = 'https://mapp.appsmb.com';
const APP_ID = '1017';
const APP_KEY = '3742e9e5842d4ad59c2db887e12449f9';

// The public accounts of msmart-ng (NetHomePlusCloud.CLOUD_CREDENTIALS).
export const PUBLIC_ACCOUNTS = {
  DE: ['nethome+de@mailinator.com', 'password1'],
  US: ['nethome+us@mailinator.com', 'password1'],
  KR: ['nethome+sea@mailinator.com', 'password1'],
};
export const REGIONS = Object.keys(PUBLIC_ACCOUNTS);

// --- SmartHome constants (msmart-ng SmartHomeCloud and its _Security) ---------
// Only the international server: the Chinese one (other keys) is left out.

export const SMARTHOME_URL = 'https://mp-prod.appsmb.com';
const SMARTHOME_APP_ID = '1010';
const SMARTHOME_HMAC_KEY = 'PROD_VnoClJI9aikS8dyy';
const SMARTHOME_IOT_KEY = 'meicloud';
const SMARTHOME_LOGIN_KEY = 'ac21b9f9cbfe4ca5a88562ef25e2b768';

// The public accounts of msmart-ng (SmartHomeCloud.CLOUD_CREDENTIALS).
export const SMARTHOME_ACCOUNTS = {
  DE: ['midea_eu@mailinator.com', 'das_ist_passwort1'],
  US: ['midea@mailinator.com', 'this_is_a_password1'],
  KR: ['midea_sea@mailinator.com', 'password_for_sea1'],
};

const sha256Hex = (text) => createHash('sha256').update(text, 'utf8').digest('hex');
const md5Hex = (text) => createHash('md5').update(text, 'utf8').digest('hex');

export class CloudError extends Error {
  /**
   * @param {string} message
   * @param {object} [details]
   * @param {number|string} [details.code] the cloud's error code
   * @param {boolean} [details.network] the cloud could not be reached at all
   */
  constructor(message, { code, network = false } = {}) {
    super(message);
    this.name = 'CloudError';
    this.code = code;
    this.network = network;
  }
}

/** yyyyMMddHHmmss, UTC. */
export function stamp(now = new Date()) {
  return now.toISOString().replace(/[-:T]/g, '').slice(0, 14);
}

/**
 * The NetHome Plus request signature: SHA-256 of path + sorted `key=value`
 * pairs + app key.
 * @param {string} path
 * @param {Record<string, string|number>} body
 */
export function sign(path, body) {
  const query = Object.keys(body)
    .sort()
    .map((key) => `${key}=${body[key]}`)
    .join('&');
  return sha256Hex(`${path}${query}${APP_KEY}`);
}

/** The NetHome Plus password hash: SHA-256(loginId + SHA-256(password) + app key). */
export function hashPassword(loginId, password) {
  return sha256Hex(`${loginId}${sha256Hex(password)}${APP_KEY}`);
}

/** The SmartHome request signature: HMAC-SHA256(iot key + JSON body + random). */
export function smartHomeSign(contents, random) {
  return createHmac('sha256', SMARTHOME_HMAC_KEY)
    .update(`${SMARTHOME_IOT_KEY}${contents}${random}`, 'utf8')
    .digest('hex');
}

/** The SmartHome `password`: SHA-256(loginId + SHA-256(password) + login key). */
export function smartHomePassword(loginId, password) {
  return sha256Hex(`${loginId}${sha256Hex(password)}${SMARTHOME_LOGIN_KEY}`);
}

/** The SmartHome `iampwd`: SHA-256(loginId + MD5(MD5(password)) + login key). */
export function smartHomeIamPassword(loginId, password) {
  return sha256Hex(`${loginId}${md5Hex(md5Hex(password))}${SMARTHOME_LOGIN_KEY}`);
}

/** JSON as Python's `json.dumps` writes it (what msmart-ng signs and sends). */
export function pythonJson(value) {
  return JSON.stringify(value)
    .replace(/[\u0080-\uffff]/g, (char) => `\\u${char.charCodeAt(0).toString(16).padStart(4, '0')}`)
    .replace(/("(?:[^"\\]|\\.)*")|([,:])/g, (match, string, separator) =>
      string ? string : `${separator} `,
    );
}

/** One POST, its JSON answer, or a CloudError marked `network`. */
async function postJson(fetchImpl, url, init, timeoutMs) {
  let response;
  try {
    response = await fetchImpl(url, {
      method: 'POST',
      ...init,
      signal: AbortSignal.timeout(timeoutMs),
    });
  } catch (err) {
    throw new CloudError(`Midea cloud unreachable (${err.cause?.code ?? err.name})`, {
      network: true,
    });
  }
  if (!response.ok) {
    throw new CloudError(`Midea cloud answered HTTP ${response.status}`, { network: true });
  }
  try {
    return await response.json();
  } catch {
    throw new CloudError('Midea cloud answered something else than JSON', { network: true });
  }
}

/** The pair filed under `udpid` in a getToken answer. */
function pickToken(result, udpid) {
  const entry = (result?.tokenlist ?? []).find((item) => item?.udpId === udpid);
  if (!entry?.token || !entry?.key) {
    throw new CloudError('Midea cloud has no token for this device', { code: 'NO_TOKEN' });
  }
  return { token: entry.token, key: entry.key };
}

/** The base of both clients: credentials, and a login tried once per client. */
class BaseCloud {
  constructor(
    accounts,
    { region = 'DE', account, password, fetch: fetchImpl, timeoutMs = 10_000 },
  ) {
    if (account && password) {
      this.account = account;
      this.password = password;
    } else {
      [this.account, this.password] = accounts[region] ?? accounts.DE;
    }
    this.fetch = fetchImpl ?? globalThis.fetch;
    this.timeoutMs = timeoutMs;
    this.deviceId = randomBytes(8).toString('hex');
    this.loggedIn = false;
    this.loginError = null;
  }

  async login() {
    if (this.loggedIn) {
      return;
    }
    // A refused login (wrong password, account of the other app) is not asked
    // again for every udpid: a new client is made at the next search.
    if (this.loginError) {
      throw this.loginError;
    }
    try {
      await this.doLogin();
      this.loggedIn = true;
    } catch (err) {
      if (!err.network) {
        this.loginError = err;
      }
      throw err;
    }
  }

  /**
   * The token and key filed under a udpid.
   * @param {string} udpid
   * @param {number} [deviceId] the appliance id (the SmartHome cloud needs it)
   * @returns {Promise<{ token: string, key: string }>} hex strings
   */
  async getToken(udpid, deviceId) {
    await this.login();
    const data = { udpid };
    if (deviceId !== undefined) {
      data.applianceCodes = String(deviceId);
    }
    return pickToken(await this.request('/v1/iot/secure/getToken', this.body(data)), udpid);
  }
}

export class NetHomePlusCloud extends BaseCloud {
  /**
   * @param {object} options
   * @param {string} [options.region] DE, US or KR (public accounts)
   * @param {string} [options.account] own NetHome Plus account
   * @param {string} [options.password]
   * @param {typeof fetch} [options.fetch]
   * @param {number} [options.timeoutMs]
   */
  constructor(options = {}) {
    super(PUBLIC_ACCOUNTS, options);
    this.app = 'nethome';
    this.sessionId = '';
  }

  body(data) {
    return {
      appId: APP_ID,
      src: APP_ID,
      format: 2,
      clientType: 1,
      language: 'en_US',
      deviceId: this.deviceId,
      stamp: stamp(),
      sessionId: this.sessionId,
      ...data,
    };
  }

  async request(path, body) {
    const signed = { ...body, sign: sign(path, body) };
    const json = await postJson(
      this.fetch,
      `${CLOUD_URL}${path}`,
      {
        headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
        body: new URLSearchParams(
          Object.entries(signed).map(([k, v]) => [k, String(v)]),
        ).toString(),
      },
      this.timeoutMs,
    );
    const code = Number(json?.errorCode);
    if (code !== 0) {
      // The message of the cloud (e.g. "password error"), never the request.
      throw new CloudError(`Midea cloud refused: ${json?.msg ?? 'unknown error'} (${code})`, {
        code,
      });
    }
    return json.result ?? {};
  }

  async doLogin() {
    const { loginId } = await this.request(
      '/v1/user/login/id/get',
      this.body({ loginAccount: this.account }),
    );
    const session = await this.request(
      '/v1/user/login',
      this.body({ loginAccount: this.account, password: hashPassword(loginId, this.password) }),
    );
    if (!session.sessionId) {
      throw new CloudError('Midea cloud login gave no session');
    }
    this.sessionId = session.sessionId;
  }
}

export class SmartHomeCloud extends BaseCloud {
  /**
   * @param {object} options
   * @param {string} [options.region] DE, US or KR (public accounts)
   * @param {string} [options.account] own SmartHome (MSmartHome) account
   * @param {string} [options.password]
   * @param {typeof fetch} [options.fetch]
   * @param {number} [options.timeoutMs]
   */
  constructor(options = {}) {
    // Its login takes several seconds (5.7 s seen on 20/10/2026), sometimes
    // more than the 10 s msmart-ng waits before trying again.
    super(SMARTHOME_ACCOUNTS, { timeoutMs: 30_000, ...options });
    this.app = 'smarthome';
    this.accessToken = '';
  }

  body(data) {
    return {
      appId: SMARTHOME_APP_ID,
      src: SMARTHOME_APP_ID,
      format: 2,
      clientType: 1,
      language: 'en_US',
      deviceId: this.deviceId,
      stamp: stamp(),
      reqId: randomBytes(16).toString('hex'),
      ...data,
    };
  }

  async request(endpoint, body) {
    const contents = pythonJson(body);
    const random = randomBytes(16).toString('hex');
    const json = await postJson(
      this.fetch,
      `${SMARTHOME_URL}/mas/v5/app/proxy?alias=${endpoint}`,
      {
        headers: {
          'Content-Type': 'application/json',
          secretVersion: '1',
          sign: smartHomeSign(contents, random),
          random,
          accessToken: this.accessToken,
        },
        body: contents,
      },
      this.timeoutMs,
    );
    const code = Number(json?.code);
    if (code !== 0) {
      throw new CloudError(`Midea cloud refused: ${json?.msg ?? 'unknown error'} (${code})`, {
        code,
      });
    }
    return json.data ?? {};
  }

  async doLogin() {
    const { loginId } = await this.request(
      '/v1/user/login/id/get',
      this.body({ loginAccount: this.account }),
    );
    const session = await this.request('/mj/user/login', {
      data: { platform: 2, deviceId: this.deviceId },
      iotData: {
        appId: SMARTHOME_APP_ID,
        src: SMARTHOME_APP_ID,
        clientType: 1,
        loginAccount: this.account,
        iampwd: smartHomeIamPassword(loginId, this.password),
        password: smartHomePassword(loginId, this.password),
        pushToken: randomBytes(120).toString('base64url'),
        stamp: stamp(),
        reqId: randomBytes(16).toString('hex'),
      },
    });
    const accessToken = session?.mdata?.accessToken;
    if (!accessToken) {
      throw new CloudError('Midea cloud login gave no session');
    }
    this.accessToken = accessToken;
  }
}

/**
 * The clouds to ask, in order, for the configuration `{ app, region, account,
 * password }`: the chosen app first, then the other one. An own account is
 * tried on both apps (users often type their SmartHome account without
 * changing the app), then the public accounts of the region.
 * @returns {{ app: string, region: string, account?: string, password?: string }[]}
 */
export function cloudChain({ app = 'nethome', region = 'DE', account = '', password = '' } = {}) {
  const first = CLOUD_APPS.includes(app) ? app : 'nethome';
  const apps = [first, ...CLOUD_APPS.filter((other) => other !== first)];
  const own =
    account && password ? apps.map((each) => ({ app: each, region, account, password })) : [];
  return [...own, ...apps.map((each) => ({ app: each, region }))];
}

/** The client of one link of the chain. */
export function createCloudClient(spec, options = {}) {
  const Client = spec.app === 'smarthome' ? SmartHomeCloud : NetHomePlusCloud;
  return new Client({ ...spec, ...options });
}
