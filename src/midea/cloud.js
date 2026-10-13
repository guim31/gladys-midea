// -----------------------------------------------------------------------------
// The one cloud call of the integration: the token and key of a V3 device,
// from the Midea "NetHome Plus" cloud. Ported from msmart-ng `cloud.py`
// (MIT). Once fetched they are kept under /data and everything else is local.
//
// A token is filed under the device ("udpid"), not under an account: any
// account can fetch it. msmart-ng therefore ships public accounts, one per
// region, and so does this integration; users who prefer may give their own
// NetHome Plus account. The password never leaves this module unhashed, and
// nothing here is logged.
// -----------------------------------------------------------------------------

import { createHash, randomBytes } from 'node:crypto';

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

const sha256Hex = (text) => createHash('sha256').update(text, 'utf8').digest('hex');

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
 * The request signature: SHA-256 of path + sorted `key=value` pairs + app key.
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

/** The login password hash: SHA-256(loginId + SHA-256(password) + app key). */
export function hashPassword(loginId, password) {
  return sha256Hex(`${loginId}${sha256Hex(password)}${APP_KEY}`);
}

export class NetHomePlusCloud {
  /**
   * @param {object} options
   * @param {string} [options.region] DE, US or KR (public accounts)
   * @param {string} [options.account] own NetHome Plus account
   * @param {string} [options.password]
   * @param {typeof fetch} [options.fetch]
   * @param {number} [options.timeoutMs]
   */
  constructor({ region = 'DE', account, password, fetch: fetchImpl, timeoutMs = 10_000 } = {}) {
    if (account && password) {
      this.account = account;
      this.password = password;
    } else {
      [this.account, this.password] = PUBLIC_ACCOUNTS[region] ?? PUBLIC_ACCOUNTS.DE;
    }
    this.fetch = fetchImpl ?? globalThis.fetch;
    this.timeoutMs = timeoutMs;
    this.deviceId = randomBytes(8).toString('hex');
    this.sessionId = '';
  }

  async request(path, data) {
    const body = {
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
    body.sign = sign(path, body);
    let response;
    try {
      response = await this.fetch(`${CLOUD_URL}${path}`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
        body: new URLSearchParams(Object.entries(body).map(([k, v]) => [k, String(v)])).toString(),
        signal: AbortSignal.timeout(this.timeoutMs),
      });
    } catch (err) {
      throw new CloudError(`Midea cloud unreachable (${err.cause?.code ?? err.name})`, {
        network: true,
      });
    }
    if (!response.ok) {
      throw new CloudError(`Midea cloud answered HTTP ${response.status}`, { network: true });
    }
    let json;
    try {
      json = await response.json();
    } catch {
      throw new CloudError('Midea cloud answered something else than JSON', { network: true });
    }
    const code = Number(json?.errorCode);
    if (code !== 0) {
      // The message of the cloud (e.g. "password error"), never the request.
      throw new CloudError(`Midea cloud refused: ${json?.msg ?? 'unknown error'} (${code})`, {
        code,
      });
    }
    return json.result ?? {};
  }

  async login() {
    if (this.sessionId) {
      return;
    }
    const { loginId } = await this.request('/v1/user/login/id/get', {
      loginAccount: this.account,
    });
    const session = await this.request('/v1/user/login', {
      loginAccount: this.account,
      password: hashPassword(loginId, this.password),
    });
    if (!session.sessionId) {
      throw new CloudError('Midea cloud login gave no session');
    }
    this.sessionId = session.sessionId;
  }

  /**
   * The token and key filed under a udpid.
   * @param {string} udpid
   * @param {number} [deviceId]
   * @returns {Promise<{ token: string, key: string }>} hex strings
   */
  async getToken(udpid, deviceId) {
    await this.login();
    const data = { udpid };
    if (deviceId !== undefined) {
      data.applianceCodes = String(deviceId);
    }
    const result = await this.request('/v1/iot/secure/getToken', data);
    const entry = (result.tokenlist ?? []).find((item) => item?.udpId === udpid);
    if (!entry?.token || !entry?.key) {
      throw new CloudError('Midea cloud has no token for this device', { code: 'NO_TOKEN' });
    }
    return { token: entry.token, key: entry.key };
  }
}
