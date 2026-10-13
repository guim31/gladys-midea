// -----------------------------------------------------------------------------
// The discovery request sent in unicast to an address typed by the user: a
// unicast crosses the NAT of the container's bridge network, and the unit
// answers to the sender (the broadcast search goes through the Gladys core,
// see src/hub.js).
// -----------------------------------------------------------------------------

import { createSocket as createUdpSocket } from 'node:dgram';
import { DISCOVERY_PORTS, DISCOVERY_REQUEST, parseDiscoveryReply } from './discovery.js';

/**
 * Ask one address for its description.
 * @param {string} host
 * @param {object} [options]
 * @param {number} [options.timeoutMs]
 * @param {Function} [options.createSocket] dgram.createSocket (tests)
 * @returns {Promise<object|null>} parseDiscoveryReply's result, null without answer
 */
export function probeHost(host, { timeoutMs = 3000, createSocket = createUdpSocket } = {}) {
  return new Promise((resolve) => {
    const socket = createSocket('udp4');
    let done = false;
    const finish = (result) => {
      if (done) return;
      done = true;
      clearTimeout(timer);
      try {
        socket.close();
      } catch {
        // already closed
      }
      resolve(result);
    };
    const timer = setTimeout(() => finish(null), timeoutMs);
    socket.on('error', () => finish(null));
    socket.on('message', (message, remote) => {
      if (remote.address !== host) return;
      const info = parseDiscoveryReply(message, host);
      if (info) finish(info);
    });
    socket.bind(0, () => {
      for (const port of DISCOVERY_PORTS) {
        socket.send(DISCOVERY_REQUEST, port, host, () => {});
      }
    });
  });
}
