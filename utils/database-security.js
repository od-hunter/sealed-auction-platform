/**
 * Database Security Layer
 * Provides additional SQL injection protection, input validation, and query monitoring
 */

const validator = require('./validation');

class DatabaseSecurityLayer {
  constructor(database) {
    this.db = database;
    this.queryLog = [];
    this.maxQueryLog = 1000; // Keep last 1000 queries for monitoring
    this.suspiciousPatterns = [
      /--/,                           // SQL comment
      /\/\*.*\*\//,                   // Multi-line comment
      /\bUNION\b/i,                   // UNION injection
      /\bSELECT\b.*\bFROM\b/i,        // SELECT in wrong context
      /\bDROP\b/i,                    // DROP table
      /\bDELETE\b/i,                  // DELETE without WHERE
      /\bINSERT\b.*\bINTO\b/i,        // INSERT in wrong context
      /\bUPDATE\b.*\bSET\b/i,         // UPDATE in wrong context
      /;\s*\b(DROP|DELETE|UPDATE|INSERT)\b/i, // Stacked queries
      /\bEXEC\b|\bEXECUTE\b/i,        // Execute commands
      /xp_/i,                         // Extended stored procedures
      /sp_/i,                         // System stored procedures
      /0x[0-9a-fA-F]+/,              // Hex encoding
      /CHAR\(\d+\)/i,                 // CHAR function
      /CONCAT\(/i,                    // CONCAT function
      /SLEEP\(/i,                     // Time-based injection
      /BENCHMARK\(/i,                 // BENCHMARK function
      /WAITFOR\b/i,                   // WAITFOR delay
      /INFORMATION_SCHEMA/i,          // Schema enumeration
      /sys\./i,                       // System tables
      /pg_catalog\./i,                // PostgreSQL catalog
    ];
  }

  /**
   * Validate input for SQL injection attempts
   * @param {any} value - Value to validate
   * @returns {{valid: boolean, sanitized: any, error?: string}}
   */
  validateInput(value) {
    if (value === null || value === undefined) {
      return { valid: true, sanitized: value };
    }

    // Convert to string for pattern checking
    const stringValue = typeof value === 'string' ? value : String(value);

    // Check for suspicious patterns
    for (const pattern of this.suspiciousPatterns) {
      if (pattern.test(stringValue)) {
        return {
          valid: false,
          sanitized: null,
          error: 'Potentially malicious input detected'
        };
      }
    }

    // Sanitize based on type
    let sanitized;
    if (typeof value === 'number') {
      sanitized = value;
    } else if (typeof value === 'boolean') {
      sanitized = value;
    } else if (typeof value === 'string') {
      // Remove null bytes
      sanitized = value.replace(/\0/g, '');
      // Limit length
      if (sanitized.length > 10000) {
        sanitized = sanitized.substring(0, 10000);
      }
    } else {
      sanitized = value;
    }

    return { valid: true, sanitized };
  }

  /**
   * Validate multiple inputs
   * @param {Object} inputs - Key-value pairs of inputs to validate
   * @returns {{valid: boolean, sanitized?: Object, errors?: Array}}
   */
  validateInputs(inputs) {
    const validated = {};
    const errors = [];

    for (const [key, value] of Object.entries(inputs)) {
      const result = this.validateInput(value);
      if (!result.valid) {
        errors.push(`${key}: ${result.error}`);
      } else {
        validated[key] = result.sanitized;
      }
    }

    if (errors.length > 0) {
      return { valid: false, errors };
    }

    return { valid: true, sanitized: validated };
  }

  /**
   * Log query for security monitoring
   * @param {string} query - SQL query
   * @param {Array} params - Query parameters
   * @param {string} operation - Operation type
   */
  logQuery(query, params, operation) {
    const logEntry = {
      timestamp: new Date().toISOString(),
      query,
      params: params.map(p => typeof p === 'string' ? '[REDACTED]' : p),
      operation,
      duration: 0
    };

    this.queryLog.push(logEntry);

    // Maintain log size
    if (this.queryLog.length > this.maxQueryLog) {
      this.queryLog.shift();
    }

    return logEntry;
  }

  /**
   * Get query log for security analysis
   * @param {number} limit - Number of entries to return
   * @returns {Array}
   */
  getQueryLog(limit = 100) {
    return this.queryLog.slice(-limit);
  }

  /**
   * Clear query log
   */
  clearQueryLog() {
    this.queryLog = [];
  }

  /**
   * Detect suspicious query patterns
   * @param {string} query - SQL query to check
   * @returns {boolean}
   */
  isSuspiciousQuery(query) {
    const upperQuery = query.toUpperCase();
    
    for (const pattern of this.suspiciousPatterns) {
      if (pattern.test(upperQuery)) {
        console.warn('[SECURITY] Suspicious query pattern detected:', query);
        return true;
      }
    }

    return false;
  }

  /**
   * Safely execute a prepared statement
   * @param {string} sql - SQL statement
   * @param {Array} params - Parameters
   * @param {string} operation - Operation type
   * @returns {any}
   */
  safeExecute(sql, params = [], operation = 'query') {
    // Validate all parameters
    const validation = this.validateInputs(
      params.reduce((acc, param, index) => {
        acc[`param_${index}`] = param;
        return acc;
      }, {})
    );

    if (!validation.valid) {
      throw new Error(`SQL Injection attempt detected: ${validation.errors.join(', ')}`);
    }

    // Check query for suspicious patterns
    if (this.isSuspiciousQuery(sql)) {
      throw new Error('Suspicious query pattern detected');
    }

    // Log the query
    const logEntry = this.logQuery(sql, validation.sanitized, operation);

    try {
      const startTime = Date.now();
      const stmt = this.db.prepare(sql);
      let result;

      switch (operation) {
        case 'get':
          result = stmt.get(...Object.values(validation.sanitized));
          break;
        case 'all':
          result = stmt.all(...Object.values(validation.sanitized));
          break;
        case 'run':
          result = stmt.run(...Object.values(validation.sanitized));
          break;
        default:
          result = stmt.run(...Object.values(validation.sanitized));
      }

      logEntry.duration = Date.now() - startTime;
      return result;
    } catch (error) {
      logEntry.error = error.message;
      console.error('[DATABASE ERROR]', error.message);
      throw error;
    }
  }

  /**
   * Create a safe prepared statement
   * @param {string} sql - SQL statement
   * @returns {Object} Prepared statement wrapper
   */
  prepare(sql) {
    // Check for suspicious patterns in the SQL itself
    if (this.isSuspiciousQuery(sql)) {
      throw new Error('Suspicious SQL pattern detected in query structure');
    }

    const originalStmt = this.db.prepare(sql);

    // Return wrapped statement with safety checks
    return {
      get: (...params) => {
        const validation = this.validateInputs(
          params.reduce((acc, param, index) => {
            acc[`param_${index}`] = param;
            return acc;
          }, {})
        );

        if (!validation.valid) {
          throw new Error(`SQL Injection attempt detected: ${validation.errors.join(', ')}`);
        }

        this.logQuery(sql, params, 'get');
        return originalStmt.get(...params);
      },

      all: (...params) => {
        const validation = this.validateInputs(
          params.reduce((acc, param, index) => {
            acc[`param_${index}`] = param;
            return acc;
          }, {})
        );

        if (!validation.valid) {
          throw new Error(`SQL Injection attempt detected: ${validation.errors.join(', ')}`);
        }

        this.logQuery(sql, params, 'all');
        return originalStmt.all(...params);
      },

      run: (...params) => {
        const validation = this.validateInputs(
          params.reduce((acc, param, index) => {
            acc[`param_${index}`] = param;
            return acc;
          }, {})
        );

        if (!validation.valid) {
          throw new Error(`SQL Injection attempt detected: ${validation.errors.join(', ')}`);
        }

        this.logQuery(sql, params, 'run');
        return originalStmt.run(...params);
      },

      bind: (...params) => {
        const validation = this.validateInputs(
          params.reduce((acc, param, index) => {
            acc[`param_${index}`] = param;
            return acc;
          }, {})
        );

        if (!validation.valid) {
          throw new Error(`SQL Injection attempt detected: ${validation.errors.join(', ')}`);
        }

        return originalStmt.bind(...params);
      }
    };
  }

  /**
   * Safe transaction execution with validation
   * @param {Function} callback - Transaction callback
   * @returns {any}
   */
  transaction(callback) {
    return this.db.transaction((...args) => {
      // Validate transaction inputs
      const validation = this.validateInputs(
        args.reduce((acc, arg, index) => {
          acc[`arg_${index}`] = arg;
          return acc;
        }, {})
      );

      if (!validation.valid) {
        throw new Error(`SQL Injection attempt in transaction: ${validation.errors.join(', ')}`);
      }

      return callback(...args);
    });
  }

  /**
   * Export security statistics
   * @returns {Object}
   */
  getSecurityStats() {
    const totalQueries = this.queryLog.length;
    const suspiciousQueries = this.queryLog.filter(q => 
      this.suspiciousPatterns.some(p => p.test(q.query))
    ).length;

    const avgDuration = totalQueries > 0
      ? this.queryLog.reduce((sum, q) => sum + (q.duration || 0), 0) / totalQueries
      : 0;

    return {
      totalQueries,
      suspiciousQueries,
      averageQueryDuration: avgDuration.toFixed(2) + 'ms',
      logSize: this.queryLog.length,
      maxLogSize: this.maxQueryLog
    };
  }
}

module.exports = DatabaseSecurityLayer;
