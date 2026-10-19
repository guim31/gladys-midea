#!/usr/bin/env node
// -----------------------------------------------------------------------------
// Read-only check of the real world, outside the tests (which never touch the
// network): the Midea cloud and, optionally, a real unit on the local network.
//
//   node scripts/probe.mjs --cloud [--region DE|US|KR]
//       Logs in to the NetHome Plus cloud with the public account of the
//       region and asks for the token of an invented udpid: proves the login,
//       the signature and the token endpoint work (no token is expected).
//
//   node scripts/probe.mjs --host 192.168.1.60 [--region DE]
//       Sends the discovery request to the unit, then reads (never writes) its
//       capabilities and state; a V3 unit gets its key from the cloud first.
//       An air conditioner (0xAC) and a heat pump (0xC3) are both read.
//
//   MIDEA_TOKEN=… MIDEA_KEY=… node scripts/probe.mjs --host 192.168.1.61
//       A V3 unit with the token and key known elsewhere (e.g. Home
//       Assistant's Midea AC LAN), without the cloud. Environment variables,
//       not options, to keep them out of the shell history.
//
// Nothing sensitive is printed: no password, token, key, full serial or id.
// -----------------------------------------------------------------------------

import { parseArgs } from 'node:util';
import { NetHomePlusCloud } from '../src/midea/cloud.js';
import {
  decodeResponse,
  getCapabilitiesCommand,
  getStateCommand,
  summarizeCapabilities,
} from '../src/midea/ac.js';
import {
  BODY_TYPE,
  answersBody,
  decodeC3Response,
  getApplianceCommand,
  getQueryCommand,
  isApplianceAnswer,
} from '../src/midea/c3.js';
import { APPLIANCE } from '../src/midea/frame.js';
import { MideaLan } from '../src/midea/lan.js';
import { udpId } from '../src/midea/security.js';
import { probeHost } from '../src/midea/udp.js';

const { values } = parseArgs({
  options: {
    cloud: { type: 'boolean', default: false },
    host: { type: 'string' },
    region: { type: 'string', default: 'DE' },
  },
});

const mask = (text) => (text.length > 6 ? `${text.slice(0, 2)}…${text.slice(-2)}` : '…');
const say = (line) => process.stdout.write(`${line}\n`);

async function probeCloud() {
  const cloud = new NetHomePlusCloud({ region: values.region });
  await cloud.login();
  say(`cloud ${values.region}: login OK`);
  try {
    await cloud.getToken(udpId(0x1e0000c0ffee, 'little'), 0x1e0000c0ffee);
    say('cloud: unexpected token for an invented device');
  } catch (err) {
    say(
      `cloud: getToken answered (${err.code === 'NO_TOKEN' ? 'no token, as expected' : err.message})`,
    );
  }
}

async function probeUnit(host) {
  const info = await probeHost(host, { timeoutMs: 5000 });
  if (!info) {
    say(`${host}: no answer to the discovery request (UDP 6445/20086)`);
    return;
  }
  say(
    `${host}: type 0x${info.type.toString(16)}, protocol V${info.version}, port ${info.port}, ` +
      `ssid ${info.ssid}, model ${info.model || '?'}, serial ${mask(info.serial)}, id ${mask(String(info.deviceId))}`,
  );
  const heatPump = info.type === APPLIANCE.HEAT_PUMP;
  if (!heatPump && info.type !== APPLIANCE.AIR_CONDITIONER) {
    say('not an air conditioner nor a heat pump: not supported');
    return;
  }
  // The read that proves a session works, by kind of unit.
  const check = (lan) =>
    heatPump
      ? lan.request(getQueryCommand(BODY_TYPE.BASIC), answersBody(BODY_TYPE.BASIC))
      : lan.request(getStateCommand(), (frame) => frame[10] === 0xc0);
  let credentials = null;
  const { MIDEA_TOKEN: token, MIDEA_KEY: key } = process.env;
  if (info.version === 3 && token && key) {
    credentials = { token: token.toLowerCase(), key: key.toLowerCase() };
    say('keys: taken from MIDEA_TOKEN and MIDEA_KEY');
  } else if (info.version === 3) {
    const cloud = new NetHomePlusCloud({ region: values.region });
    for (const endian of ['little', 'big']) {
      try {
        credentials = await cloud.getToken(udpId(info.deviceId, endian), info.deviceId);
        say(`cloud: key found (${endian} udpid)`);
        const lan = new MideaLan({ ...info, credentials });
        try {
          await check(lan);
          lan.close();
          break;
        } catch (err) {
          lan.close();
          say(`unit: refused this key (${err.message})`);
          credentials = null;
        }
      } catch (err) {
        say(`cloud: ${endian} udpid: ${err.message}`);
      }
    }
    if (!credentials) return;
  }
  const lan = new MideaLan({ ...info, credentials });
  if (heatPump) {
    try {
      await probeHeatPump(lan);
    } finally {
      lan.close();
    }
    return;
  }
  try {
    let raw = null;
    try {
      raw = decodeResponse(
        await lan.request(getCapabilitiesCommand(), (frame) => frame[10] === 0xb5),
      ).raw;
    } catch (err) {
      say(`capabilities: no answer (${err.message})`);
    }
    say(`capabilities: ${JSON.stringify(summarizeCapabilities(raw))}`);
    const { state } = decodeResponse(
      await lan.request(getStateCommand(), (frame) => frame[10] === 0xc0),
    );
    say(`state: ${JSON.stringify(state)}`);
  } finally {
    lan.close();
  }
}

/** A heat pump: appliance answer, basic state, unit parameters (all queries). */
async function probeHeatPump(lan) {
  const optional = { optional: true, retries: 1 };
  const appliance = await lan.request(getApplianceCommand(), isApplianceAnswer, optional);
  const protocol = appliance ? decodeC3Response(appliance).protocol : 0;
  say(`appliance: ${appliance ? `message protocol ${protocol}` : 'no answer, protocol 0'}`);
  const basic = decodeC3Response(
    await lan.request(getQueryCommand(BODY_TYPE.BASIC, { protocol }), answersBody(BODY_TYPE.BASIC)),
  );
  say(`state: ${JSON.stringify(basic.state)}`);
  const unit = await lan.request(
    getQueryCommand(BODY_TYPE.UNIT, { protocol }),
    answersBody(BODY_TYPE.UNIT),
    optional,
  );
  // The two 32-bit counters (totalElectricity, totalThermal) have no unit
  // midea-local vouches for: compare them with the energy consumed shown
  // by the unit's own controller or app.
  say(`unit parameters: ${unit ? JSON.stringify(decodeC3Response(unit).unit) : 'no answer'}`);
  const silence = await lan.request(
    getQueryCommand(BODY_TYPE.SILENCE, { protocol }),
    answersBody(BODY_TYPE.SILENCE),
    optional,
  );
  say(`silent level: ${silence ? decodeC3Response(silence).silentLevel : 'no answer'}`);
}

try {
  if (values.cloud) await probeCloud();
  if (values.host) await probeUnit(values.host);
  if (!values.cloud && !values.host) say('usage: node scripts/probe.mjs --cloud | --host <ip>');
} catch (err) {
  say(`failed: ${err.message}`);
  process.exitCode = 1;
}
