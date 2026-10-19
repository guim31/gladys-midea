// -----------------------------------------------------------------------------
// Registers every SDK handler on a GladysIntegration (or the SDK's fake) and
// returns the hub, so index.js stays a few lines and the tests drive the very
// same wiring.
// -----------------------------------------------------------------------------

import { createLogger } from '@gladysassistant/integration-sdk';
import { normalizeConfig } from './config.js';
import { MideaHub } from './hub.js';
import { SCENE_ACTIONS } from './scenes.js';
import { Store } from './store.js';
import { buildFleetReport, buildTestReport, findRecord } from './diagnostic.js';
import { DEVICE_REQUIRED, INIT_FAILED, reportMessage, searchMessage } from './texts.js';
import { WIDGETS } from './widgets.js';

const logger = createLogger({ name: 'midea-app' });

/**
 * @param {object} gladys GladysIntegration instance
 * @param {object} [options] test seams: store, timers, timings, createLan, createCloud, probeHost
 */
export function registerHandlers(gladys, options = {}) {
  const hub = new MideaHub({
    gladys,
    store: options.store ?? new Store(),
    timers: options.timers ?? true,
    timings: options.timings,
    createLan: options.createLan,
    createCloud: options.createCloud,
    probeHost: options.probeHost,
  });

  // Resolved once the hub has started; every handler waits for it, so a
  // command arriving during the first discovery is not lost.
  let resolveReady;
  const ready = new Promise((resolve) => {
    resolveReady = resolve;
  });
  let started = false;
  const whenReady =
    (fn) =>
    async (...args) => {
      await ready;
      return fn(...args);
    };

  gladys.on('connected', async () => {
    try {
      const config = normalizeConfig(await gladys.getConfig());
      if (started) {
        // A reconnection (Gladys restarted): re-sync what Gladys may have lost.
        await hub.resync(config);
        return;
      }
      started = true;
      await hub.start(config);
    } catch (err) {
      logger.error('Initialization failed', err);
      await gladys.setConnectionStatus(false, INIT_FAILED).catch(() => {});
    } finally {
      resolveReady();
    }
  });

  gladys.onScanRequest(whenReady(() => hub.rediscover()));

  gladys.onSetValue(whenReady((device, feature, value) => hub.setValue(device, feature, value)));

  // Fallback of the container's own timer (src/hub.js), skipped while it runs.
  gladys.onPoll(whenReady((device) => hub.pollFromCore(device)));

  gladys.onDeviceCreated(whenReady((device) => hub.onDeviceCreated(device)));

  gladys.onConfigUpdated(
    whenReady(async (newConfig) => {
      logger.info('Configuration updated');
      await hub.reconfigure(normalizeConfig(newConfig));
    }),
  );

  gladys.onAction(
    'search',
    whenReady(async () => {
      logger.info('Action: search for air conditioners');
      await hub.search();
      return searchMessage(hub.summary());
    }),
  );

  // --- Diagnostics: read-only reports to paste into a GitHub issue ----------

  /** A form boolean: true, or "true" / "1" / "on". */
  const checked = (value) => value === true || ['true', '1', 'on'].includes(String(value));
  /** The unit an action designates: picked in the list, or typed. */
  const reference = (fields = {}) =>
    String(fields.device ?? '').trim() || String(fields.device_ref ?? '').trim();

  gladys.onAction(
    'fleet_diagnostic',
    whenReady(async (fields = {}) => {
      logger.info('Action: diagnostic');
      const includeIdentifiers = checked(fields.include_identifiers);
      const ref = reference(fields);
      const only = ref ? findRecord(hub, ref) : null;
      const report = buildFleetReport(hub, { includeIdentifiers, only });
      // The logs only ever keep the masked version.
      logger.info(`[diagnostic]\n${buildFleetReport(hub, { only })}`);
      return reportMessage(report, includeIdentifiers);
    }),
  );

  gladys.onAction(
    'test_device',
    whenReady(async (fields = {}) => {
      const ref = reference(fields);
      if (!ref) {
        return DEVICE_REQUIRED;
      }
      logger.info('Action: test a unit');
      const includeIdentifiers = checked(fields.include_identifiers);
      const report = await buildTestReport(hub, ref, { includeIdentifiers });
      // A full report stays out of the logs; testing the unit again only to
      // log a masked copy would send every query twice.
      logger.info(
        includeIdentifiers
          ? '[diagnostic] unit test with full identifiers: not logged'
          : `[diagnostic]\n${report}`,
      );
      return reportMessage(report, includeIdentifiers);
    }),
  );

  for (const [key, handler] of Object.entries(SCENE_ACTIONS)) {
    gladys.onSceneAction(
      key,
      whenReady((fields) => {
        logger.info(`Scene action: ${key}`);
        return handler(hub, { fields });
      }),
    );
  }

  for (const [key, widget] of Object.entries(WIDGETS)) {
    gladys.onWidgetGet(
      key,
      whenReady((request) => widget.get(hub, request)),
    );
    gladys.onWidgetAction(
      key,
      whenReady((actionKey, params, context = {}) => {
        logger.info(`Widget action: ${actionKey}`);
        return widget.action(hub, { actionKey, params, ...context });
      }),
    );
  }

  return {
    hub,
    ready,
    stop: () => hub.stop(),
  };
}
