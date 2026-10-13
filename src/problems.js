// -----------------------------------------------------------------------------
// Repeated failures write one line when they start (or change) and one when
// they end, never one per attempt: the debug level keeps the rest.
// -----------------------------------------------------------------------------

import { createLogger } from '@gladysassistant/integration-sdk';

const logger = createLogger({ name: 'midea' });

export class ProblemLog {
  /** @param {object} [log] a logger with debug/info/warn/error */
  constructor(log = logger) {
    this.log = log;
    /** @type {Map<string, { message: string, logged: boolean }>} active problems, by key */
    this.active = new Map();
  }

  /**
   * A failure: logged at `level` the first time (or when the message changes),
   * debug after. `details` (an error, for its stack) go with the first line.
   * Returns true when logged.
   */
  fail(key, message, level = 'warn', ...details) {
    const previous = this.active.get(key);
    if (previous?.message === message) {
      this.log.debug(`${message} (again)`);
      return false;
    }
    const logged = level !== 'debug';
    this.active.set(key, { message, logged: logged || previous?.logged === true });
    this.log[level](message, ...details);
    return logged;
  }

  /** The problem is over: `message` (info) when one was logged, nothing otherwise. Returns true if it was active. */
  recover(key, message) {
    const problem = this.active.get(key);
    if (!problem) {
      return false;
    }
    this.active.delete(key);
    if (problem.logged && message) {
      this.log.info(message);
    } else if (message) {
      this.log.debug(message);
    }
    return true;
  }
}
