/**
 * Input Validation and Sanitization Utility
 * Provides comprehensive input validation and sanitization for API endpoints
 */

const validator = {
  /**
   * Sanitize string input by removing potentially dangerous characters
   * @param {string} str - String to sanitize
   * @returns {string} - Sanitized string
   */
  sanitizeString(str) {
    if (typeof str !== 'string') return '';
    
    // Remove HTML tags
    let sanitized = str.replace(/<[^>]*>/g, '');
    
    // Remove script tags and javascript protocols
    sanitized = sanitized.replace(/<script\b[^<]*(?:(?!<\/script>)<[^<]*)*<\/script>/gi, '');
    sanitized = sanitized.replace(/javascript:/gi, '');
    
    // Remove null bytes and control characters (except newlines and tabs)
    sanitized = sanitized.replace(/[\x00-\x08\x0B\x0C\x0E-\x1F\x7F]/g, '');
    
    // Trim whitespace
    sanitized = sanitized.trim();
    
    return sanitized;
  },

  /**
   * Sanitize HTML content while preserving safe formatting
   * @param {string} html - HTML content to sanitize
   * @returns {string} - Sanitized HTML
   */
  sanitizeHTML(html) {
    if (typeof html !== 'string') return '';
    
    // Allowed tags regex (can be customized)
    const allowedTags = ['b', 'i', 'em', 'strong', 'p', 'br', 'ul', 'ol', 'li'];
    const allowedTagsPattern = new RegExp(`</?(?:${allowedTags.join('|')})\\b[^>]*>`, 'gi');
    
    // Remove all tags except allowed ones
    let sanitized = html.replace(/<(?!\/?(?:b|i|em|strong|p|br|ul|ol|li)\\b)[^>]*>/gi, '');
    
    // Remove event handlers
    sanitized = sanitized.replace(/\s*on\w+\s*=\s*["'][^"']*["']/gi, '');
    
    return sanitized;
  },

  /**
   * Validate and sanitize email address
   * @param {string} email - Email to validate
   * @returns {string|null} - Sanitized email or null if invalid
   */
  validateEmail(email) {
    if (typeof email !== 'string') return null;
    
    const sanitized = this.sanitizeString(email).toLowerCase();
    const emailRegex = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;
    
    if (!emailRegex.test(sanitized)) return null;
    if (sanitized.length > 254) return null;
    
    return sanitized;
  },

  /**
   * Validate username
   * Rules: alphanumeric, underscores, 3-30 characters
   * @param {string} username - Username to validate
   * @returns {{valid: boolean, message: string}}
   */
  validateUsername(username) {
    if (typeof username !== 'string') {
      return { valid: false, message: 'Username must be a string' };
    }
    
    const sanitized = this.sanitizeString(username);
    
    if (sanitized.length < 3) {
      return { valid: false, message: 'Username must be at least 3 characters' };
    }
    
    if (sanitized.length > 30) {
      return { valid: false, message: 'Username must not exceed 30 characters' };
    }
    
    const usernameRegex = /^[a-zA-Z0-9_]+$/;
    if (!usernameRegex.test(sanitized)) {
      return { 
        valid: false, 
        message: 'Username can only contain letters, numbers, and underscores' 
      };
    }
    
    return { valid: true, value: sanitized };
  },

  /**
   * Validate password strength
   * @param {string} password - Password to validate
   * @returns {{valid: boolean, message: string}}
   */
  validatePassword(password) {
    if (typeof password !== 'string') {
      return { valid: false, message: 'Password must be a string' };
    }
    
    if (password.length < 8) {
      return { valid: false, message: 'Password must be at least 8 characters' };
    }
    
    if (password.length > 128) {
      return { valid: false, message: 'Password must not exceed 128 characters' };
    }
    
    // Check for at least one letter and one number
    const hasLetter = /[a-zA-Z]/.test(password);
    const hasNumber = /[0-9]/.test(password);
    
    if (!hasLetter || !hasNumber) {
      return { 
        valid: false, 
        message: 'Password must contain at least one letter and one number' 
      };
    }
    
    return { valid: true, value: password };
  },

  /**
   * Validate positive number
   * @param {any} value - Value to validate
   * @param {number} min - Minimum value
   * @param {number} max - Maximum value
   * @returns {{valid: boolean, value: number|null, message: string}}
   */
  validatePositiveNumber(value, min = 0, max = Number.MAX_SAFE_INTEGER) {
    const num = parseFloat(value);
    
    if (isNaN(num)) {
      return { valid: false, value: null, message: 'Value must be a number' };
    }
    
    if (num <= 0) {
      return { valid: false, value: null, message: 'Value must be positive' };
    }
    
    if (num < min || num > max) {
      return { 
        valid: false, 
        value: null, 
        message: `Value must be between ${min} and ${max}` 
      };
    }
    
    return { valid: true, value: num };
  },

  /**
   * Validate UUID format
   * @param {string} id - ID to validate
   * @returns {{valid: boolean, value: string|null, message: string}}
   */
  validateUUID(id) {
    if (typeof id !== 'string') {
      return { valid: false, value: null, message: 'ID must be a string' };
    }
    
    const uuidRegex = /^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;
    
    if (!uuidRegex.test(id)) {
      return { valid: false, value: null, message: 'Invalid UUID format' };
    }
    
    return { valid: true, value: id };
  },

  /**
   * Validate date string
   * @param {string} dateString - Date string to validate
   * @param {boolean} allowPast - Allow past dates
   * @returns {{valid: boolean, value: Date|null, message: string}}
   */
  validateDate(dateString, allowPast = false) {
    if (typeof dateString !== 'string') {
      return { valid: false, value: null, message: 'Date must be a string' };
    }
    
    const date = new Date(dateString);
    
    if (isNaN(date.getTime())) {
      return { valid: false, value: null, message: 'Invalid date format' };
    }
    
    if (!allowPast && date.getTime() <= Date.now()) {
      return { valid: false, value: null, message: 'Date must be in the future' };
    }
    
    return { valid: true, value: date };
  },

  /**
   * Validate auction title
   * @param {string} title - Title to validate
   * @returns {{valid: boolean, value: string|null, message: string}}
   */
  validateTitle(title) {
    if (typeof title !== 'string') {
      return { valid: false, value: null, message: 'Title must be a string' };
    }
    
    const sanitized = this.sanitizeString(title);
    
    if (sanitized.length < 3) {
      return { valid: false, value: null, message: 'Title must be at least 3 characters' };
    }
    
    if (sanitized.length > 200) {
      return { valid: false, value: null, message: 'Title must not exceed 200 characters' };
    }
    
    return { valid: true, value: sanitized };
  },

  /**
   * Validate description text
   * @param {string} description - Description to validate
   * @returns {{valid: boolean, value: string|null, message: string}}
   */
  validateDescription(description) {
    if (typeof description !== 'string') {
      return { valid: false, value: null, message: 'Description must be a string' };
    }
    
    const sanitized = this.sanitizeHTML(description);
    
    if (sanitized.length < 10) {
      return { valid: false, value: null, message: 'Description must be at least 10 characters' };
    }
    
    if (sanitized.length > 2000) {
      return { valid: false, value: null, message: 'Description must not exceed 2000 characters' };
    }
    
    return { valid: true, value: sanitized };
  },

  /**
   * Validate pagination parameters
   * @param {any} page - Page number
   * @param {any} limit - Limit per page
   * @returns {{page: number, limit: number}}
   */
  validatePagination(page, limit) {
    const pageNum = parseInt(page);
    const limitNum = parseInt(limit);
    
    return {
      page: isNaN(pageNum) || pageNum < 1 ? 1 : pageNum,
      limit: isNaN(limitNum) || limitNum < 1 || limitNum > 100 ? 10 : Math.min(limitNum, 100)
    };
  },

  /**
   * Validate status parameter
   * @param {string} status - Status to validate
   * @returns {string|null}
   */
  validateStatus(status) {
    const validStatuses = ['active', 'closed', 'cancelled'];
    
    if (typeof status !== 'string') return null;
    
    const sanitized = this.sanitizeString(status).toLowerCase();
    
    if (!validStatuses.includes(sanitized)) return null;
    
    return sanitized;
  },

  /**
   * Escape special regex characters
   * @param {string} string - String to escape
   * @returns {string}
   */
  escapeRegExp(string) {
    return string.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
  },

  /**
   * Validate and sanitize bid amount
   * @param {any} amount - Amount to validate
   * @param {number} minimumBid - Minimum bid amount
   * @returns {{valid: boolean, value: number|null, message: string}}
   */
  validateBidAmount(amount, minimumBid = 0) {
    const result = this.validatePositiveNumber(amount, 0.01, 1000000000);
    
    if (!result.valid) return result;
    
    if (result.value <= minimumBid) {
      return { 
        valid: false, 
        value: null, 
        message: `Bid must be higher than ${minimumBid}` 
      };
    }
    
    // Ensure 2 decimal places precision
    const rounded = Math.round(result.value * 100) / 100;
    
    return { valid: true, value: rounded };
  },

  /**
   * Validate secret key for encrypted bids
   * @param {string} secretKey - Secret key to validate
   * @returns {{valid: boolean, value: string|null, message: string}}
   */
  validateSecretKey(secretKey) {
    if (typeof secretKey !== 'string') {
      return { valid: false, value: null, message: 'Secret key must be a string' };
    }
    
    if (secretKey.length < 8) {
      return { valid: false, value: null, message: 'Secret key must be at least 8 characters' };
    }
    
    if (secretKey.length > 256) {
      return { valid: false, value: null, message: 'Secret key is too long' };
    }
    
    return { valid: true, value: secretKey };
  }
};

// Express middleware for request validation
const validateRequest = {
  /**
   * Middleware to validate request body fields
   * @param {Object} rules - Validation rules for each field
   * @returns {Function} Express middleware
   */
  body(rules) {
    return (req, res, next) => {
      const errors = [];
      const sanitized = {};
      
      for (const [field, rule] of Object.entries(rules)) {
        const value = req.body[field];
        
        // Check if required
        if (rule.required && (value === undefined || value === null || value === '')) {
          errors.push(`${field} is required`);
          continue;
        }
        
        // Skip validation if optional and not provided
        if (!rule.required && (value === undefined || value === null || value === '')) {
          continue;
        }
        
        // Apply validation based on type
        let validationResult;
        
        switch (rule.type) {
          case 'string':
            validationResult = rule.sanitizeHTML 
              ? validator.validateDescription(value)
              : { valid: true, value: validator.sanitizeString(value) };
            break;
            
          case 'email':
            validationResult = { 
              valid: !!validator.validateEmail(value), 
              value: validator.validateEmail(value),
              message: 'Invalid email format'
            };
            break;
            
          case 'username':
            validationResult = validator.validateUsername(value);
            break;
            
          case 'password':
            validationResult = validator.validatePassword(value);
            break;
            
          case 'number':
            validationResult = validator.validatePositiveNumber(
              value, 
              rule.min || 0, 
              rule.max || Number.MAX_SAFE_INTEGER
            );
            break;
            
          case 'uuid':
            validationResult = validator.validateUUID(value);
            break;
            
          case 'date':
            validationResult = validator.validateDate(value, rule.allowPast || false);
            break;
            
          case 'title':
            validationResult = validator.validateTitle(value);
            break;
            
          case 'description':
            validationResult = validator.validateDescription(value);
            break;
            
          case 'bidAmount':
            validationResult = validator.validateBidAmount(value, rule.minimumBid || 0);
            break;
            
          case 'secretKey':
            validationResult = validator.validateSecretKey(value);
            break;
            
          default:
            validationResult = { valid: true, value };
        }
        
        if (!validationResult.valid) {
          errors.push(validationResult.message || `${field} is invalid`);
        } else {
          sanitized[field] = validationResult.value;
        }
      }
      
      if (errors.length > 0) {
        return res.status(400).json({ 
          error: 'Validation failed',
          details: errors 
        });
      }
      
      // Attach sanitized data to request
      req.sanitizedBody = sanitized;
      next();
    };
  },

  /**
   * Middleware to validate query parameters
   * @param {Object} rules - Validation rules
   * @returns {Function} Express middleware
   */
  query(rules) {
    return (req, res, next) => {
      const errors = [];
      const sanitized = {};
      
      for (const [field, rule] of Object.entries(rules)) {
        const value = req.query[field];
        
        if (rule.required && !value) {
          errors.push(`${field} is required`);
          continue;
        }
        
        if (!value) continue;
        
        if (rule.type === 'number') {
          const num = parseInt(value);
          if (isNaN(num)) {
            errors.push(`${field} must be a number`);
          } else {
            sanitized[field] = num;
          }
        } else if (rule.type === 'string') {
          sanitized[field] = validator.sanitizeString(value);
        } else if (rule.type === 'status') {
          const status = validator.validateStatus(value);
          if (!status && rule.required) {
            errors.push(`${field} must be one of: active, closed, cancelled`);
          } else if (status) {
            sanitized[field] = status;
          }
        }
      }
      
      if (errors.length > 0) {
        return res.status(400).json({ 
          error: 'Validation failed',
          details: errors 
        });
      }
      
      req.sanitizedQuery = sanitized;
      next();
    };
  },

  /**
   * Middleware to validate URL parameters
   * @param {Object} rules - Validation rules
   * @returns {Function} Express middleware
   */
  params(rules) {
    return (req, res, next) => {
      const errors = [];
      const sanitized = {};
      
      for (const [field, rule] of Object.entries(rules)) {
        const value = req.params[field];
        
        if (rule.required && !value) {
          errors.push(`${field} is required`);
          continue;
        }
        
        if (!value) continue;
        
        if (rule.type === 'uuid') {
          const result = validator.validateUUID(value);
          if (!result.valid) {
            errors.push(result.message);
          } else {
            sanitized[field] = result.value;
          }
        } else if (rule.type === 'string') {
          sanitized[field] = validator.sanitizeString(value);
        }
      }
      
      if (errors.length > 0) {
        return res.status(400).json({ 
          error: 'Validation failed',
          details: errors 
        });
      }
      
      req.sanitizedParams = sanitized;
      next();
    };
  }
};

module.exports = {
  validator,
  validateRequest
};
