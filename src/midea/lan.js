// -----------------------------------------------------------------------------
// One TCP session with a Midea unit (port 6444), after msmart-ng `lan.py`
// (MIT): connect, authenticate a V3 unit (handshake with its token, session
// key valid 12 h), send command frames and wait for the answer.
//
// Requests are serialized: the modules handle one conversation at a time.
// The connection is kept between requests and reopened when the unit
// closes it; a request without answer is sent again twice, then the
// connection is dropped and the caller gets an "unreachable" error.
// Nothing here logs the token, the key or the session key.
// -----------------------------------------------------------------------------

import { connect as tcpConnect } from 'node:net';
import {
  V3Codec,
  V3_TYPE,
  decodePacket,
  encodePacket,
  packetLength,
  v3PacketLength,
} from './packet.js';

export const LAN_TIMINGS = {
  connectTimeoutMs: 5000,
  answerTimeoutMs: 3000,
  retries: 3,
  // A V3 session key expires after 12 hours (msmart-ng).
  sessionLifetimeMs: 12 * 3600_000,
  // msmart-ng waits a second after the handshake before the first request.
  afterHandshakeMs: 1000,
};

export class LanError extends Error {
  constructor(message, { unreachable = false, auth = false, cause } = {}) {
    super(message, { cause });
    this.name = 'LanError';
    this.unreachable = unreachable;
    this.auth = auth;
  }
}

const sleep = (ms) => new Promise((resolve) => setTimeout(resolve, ms));

export class MideaLan {
  /**
   * @param {object} options
   * @param {string} options.host
   * @param {number} [options.port]
   * @param {number} options.deviceId
   * @param {2|3} options.version
   * @param {{ token: string, key: string }|null} [options.credentials] hex, V3 only
   * @param {Function} [options.connect] net.connect (tests)
   * @param {object} [options.timings] LAN_TIMINGS overrides
   * @param {object} [options.logger]
   */
  constructor({
    host,
    port = 6444,
    deviceId,
    version,
    credentials = null,
    connect,
    timings,
    logger,
  }) {
    this.host = host;
    this.port = port;
    this.deviceId = deviceId;
    this.version = version;
    this.credentials = credentials;
    this.connectImpl = connect ?? tcpConnect;
    this.timings = { ...LAN_TIMINGS, ...timings };
    this.logger = logger;
    this.socket = null;
    this.codec = null;
    this.authenticatedAt = 0;
    this.buffer = Buffer.alloc(0);
    this.waiters = [];
    this.queue = Promise.resolve();
  }

  /** New address (DHCP) or credentials: the next request reconnects. */
  update({ host, port, credentials }) {
    const changed =
      (host && host !== this.host) ||
      (port && port !== this.port) ||
      (credentials !== undefined && credentials !== this.credentials);
    if (host) this.host = host;
    if (port) this.port = port;
    if (credentials !== undefined) this.credentials = credentials;
    if (changed) {
      this.close();
    }
  }

  close() {
    const socket = this.socket;
    this.socket = null;
    this.codec = null;
    this.authenticatedAt = 0;
    this.buffer = Buffer.alloc(0);
    this.fail(new LanError(`connection to ${this.host} closed`, { unreachable: true }));
    socket?.destroy();
  }

  /**
   * Send a command frame and resolve with the first answer frame `accept`
   * takes (every frame by default). Serialized with the other requests.
   * @param {Buffer} frame
   * @param {(frame: Buffer) => boolean} [accept]
   * @returns {Promise<Buffer>}
   */
  request(frame, accept = () => true) {
    const run = this.queue.then(() => this.exchange(frame, accept));
    this.queue = run.catch(() => {});
    return run;
  }

  async exchange(frame, accept) {
    await this.ensureSession();
    const packet = encodePacket(this.deviceId, frame);
    const wire = this.version === 3 ? this.codec.encrypt(packet) : packet;
    for (let attempt = 1; ; attempt += 1) {
      const answer = this.waitFor((item) => item.frame && accept(item.frame));
      this.write(wire);
      try {
        return (await answer).frame;
      } catch (err) {
        if (err.timeout && attempt < this.timings.retries && this.socket) {
          this.logger?.debug(`${this.host}: no answer, sending again`);
          continue;
        }
        this.close();
        throw err.timeout
          ? new LanError(`${this.host} does not answer`, { unreachable: true, cause: err })
          : err;
      }
    }
  }

  async ensureSession() {
    const expired =
      this.version === 3 && Date.now() - this.authenticatedAt > this.timings.sessionLifetimeMs;
    if (this.socket && !expired) {
      return;
    }
    this.close();
    await this.open();
    if (this.version === 3) {
      await this.handshake();
    }
  }

  open() {
    return new Promise((resolve, reject) => {
      const socket = this.connectImpl({ host: this.host, port: this.port });
      const timer = setTimeout(() => {
        socket.destroy();
        reject(
          new LanError(`${this.host}:${this.port} does not answer (connect timeout)`, {
            unreachable: true,
          }),
        );
      }, this.timings.connectTimeoutMs);
      socket.once('connect', () => {
        clearTimeout(timer);
        socket.setNoDelay?.(true);
        this.socket = socket;
        this.codec = this.version === 3 ? new V3Codec() : null;
        resolve();
      });
      socket.on('error', (err) => {
        clearTimeout(timer);
        if (this.socket === socket) {
          this.close();
        } else {
          reject(
            new LanError(
              `${this.host}:${this.port} refused the connection (${err.code ?? err.message})`,
              { unreachable: true, cause: err },
            ),
          );
        }
      });
      socket.on('data', (chunk) => {
        if (this.socket === socket) {
          this.receive(chunk);
        }
      });
      socket.on('close', () => {
        if (this.socket === socket) {
          this.close();
        }
      });
    });
  }

  async handshake() {
    const { token, key } = this.credentials ?? {};
    if (!token || !key) {
      this.close();
      throw new LanError('this unit (protocol V3) needs a token and a key', { auth: true });
    }
    const answer = this.waitFor((item) => item.handshake);
    this.write(this.codec.handshake(Buffer.from(token, 'hex')));
    try {
      const { handshake } = await answer;
      this.codec.authenticate(Buffer.from(key, 'hex'), handshake.subarray(0, 64));
    } catch (err) {
      this.close();
      throw new LanError(
        err.timeout
          ? `${this.host} does not answer the handshake`
          : `${this.host} refused the token and key`,
        { unreachable: Boolean(err.timeout), auth: !err.timeout, cause: err },
      );
    }
    this.authenticatedAt = Date.now();
    await sleep(this.timings.afterHandshakeMs);
  }

  write(data) {
    this.socket?.write(data);
  }

  /** Wait for an incoming item (`{ frame }` or `{ handshake }`) `match` accepts. */
  waitFor(match) {
    return new Promise((resolve, reject) => {
      const waiter = { match, resolve, reject };
      waiter.timer = setTimeout(() => {
        this.waiters = this.waiters.filter((item) => item !== waiter);
        reject(Object.assign(new Error('timeout'), { timeout: true }));
      }, this.timings.answerTimeoutMs);
      this.waiters.push(waiter);
    });
  }

  deliver(item) {
    const waiter = this.waiters.find((candidate) => candidate.match(item));
    if (!waiter) {
      this.logger?.debug(
        `${this.host}: unsolicited ${item.frame ? item.frame.toString('hex') : 'packet'}`,
      );
      return;
    }
    clearTimeout(waiter.timer);
    this.waiters = this.waiters.filter((candidate) => candidate !== waiter);
    waiter.resolve(item);
  }

  fail(err) {
    const waiters = this.waiters;
    this.waiters = [];
    for (const waiter of waiters) {
      clearTimeout(waiter.timer);
      waiter.reject(err);
    }
  }

  receive(chunk) {
    this.buffer = Buffer.concat([this.buffer, chunk]);
    try {
      for (;;) {
        const length = this.version === 3 ? v3PacketLength(this.buffer) : packetLength(this.buffer);
        if (length === null) {
          if (this.version !== 3 && this.buffer.length >= 6) {
            // Garbage before a packet: skip to the next 0x5A5A.
            const start = this.buffer.indexOf(Buffer.from([0x5a, 0x5a]), 1);
            this.buffer = start === -1 ? Buffer.alloc(0) : this.buffer.subarray(start);
            continue;
          }
          return;
        }
        if (this.buffer.length < length) {
          return;
        }
        const packet = this.buffer.subarray(0, length);
        this.buffer = this.buffer.subarray(length);
        this.handlePacket(packet);
      }
    } catch (err) {
      // A packet that does not decode: the session is out of step, start over.
      this.logger?.debug(`${this.host}: ${err.message}`);
      this.fail(new LanError(`${this.host}: ${err.message}`, { auth: err.kind === 'v3-error' }));
      this.close();
    }
  }

  handlePacket(packet) {
    let v2 = packet;
    if (this.version === 3) {
      const { type, payload } = this.codec.decode(packet);
      if (type === V3_TYPE.HANDSHAKE_RESPONSE) {
        this.deliver({ handshake: payload });
        return;
      }
      v2 = payload;
    }
    if (v2.length === 5 && v2.toString('ascii') === 'ERROR') {
      throw new Error('the unit answered ERROR');
    }
    const frame = decodePacket(v2);
    if (frame) {
      this.deliver({ frame });
    }
  }
}
