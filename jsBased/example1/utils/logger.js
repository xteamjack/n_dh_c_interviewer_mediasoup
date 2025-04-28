/**
 * Enhanced logging utility for the application
 * Provides consistent logging format with different log levels
 */
const log = {
  /**
   * Log informational messages
   * @param {string} msg - The message to log
   * @param {...any} args - Additional arguments to log
   */
  info: (msg, ...args) => console.log(`[INFO] ${msg}`, ...args),
  
  /**
   * Log error messages
   * @param {string} msg - The message to log
   * @param {...any} args - Additional arguments to log
   */
  error: (msg, ...args) => console.error(`[ERROR] ${msg}`, ...args),
  
  /**
   * Log debug messages
   * @param {string} msg - The message to log
   * @param {...any} args - Additional arguments to log
   */
  debug: (msg, ...args) => console.log(`[DEBUG] ${msg}`, ...args),
  
  /**
   * Log warning messages
   * @param {string} msg - The message to log
   * @param {...any} args - Additional arguments to log
   */
  warn: (msg, ...args) => console.warn(`[WARN] ${msg}`, ...args),
};

export default log;