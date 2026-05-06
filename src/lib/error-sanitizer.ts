/**
 * Error Sanitization Utility
 *
 * Removes sensitive information from error messages before logging or returning to users.
 * Prevents exposure of API keys, tokens, file paths, internal structure, and user data.
 */

/**
 * Patterns that indicate sensitive information
 */
const SENSITIVE_PATTERNS = [
  // API Keys and Tokens
  /\b(sk|pk)_live_[a-zA-Z0-9]{24,}/gi, // Stripe keys
  /\b(sk|pk)_test_[a-zA-Z0-9]{24,}/gi, // Stripe test keys
  /\b[a-f0-9]{8}-[a-f0-9]{4}-[a-f0-9]{4}-[a-f0-9]{4}-[a-f0-9]{12}\b/gi, // UUIDs (user IDs, session IDs)
  /Bearer\s+[a-zA-Z0-9\-._~+\/]+=*/gi, // Bearer tokens
  /api[_-]?key[=:]\s*['"]*([a-zA-Z0-9_\-]+)/gi, // API keys
  /secret[=:]\s*['"]*([a-zA-Z0-9_\-]+)/gi, // Secrets

  // File paths (absolute paths reveal system structure)
  /\/Users\/[^\s]+/g, // macOS paths
  /\/home\/[^\s]+/g, // Linux paths
  /C:\\Users\\[^\s]+/g, // Windows paths
  /\/var\/[^\s]+/g, // System paths
  /\/tmp\/[^\s]+/g, // Temp paths

  // Email addresses (PII)
  /\b[A-Za-z0-9._%+-]+@[A-Za-z0-9.-]+\.[A-Z|a-z]{2,}\b/g,

  // Connection strings
  /postgres:\/\/[^\s]+/g,
  /mongodb:\/\/[^\s]+/g,
  /redis:\/\/[^\s]+/g,

  // Environment variable names that might contain values
  /process\.env\.[A-Z_]+/g,
];

/**
 * Redaction replacement text
 */
const REDACTED = '[REDACTED]';

/**
 * Sanitize error message for logging
 * Removes sensitive patterns but keeps enough context for debugging
 */
export function sanitizeErrorForLogging(error: unknown): {
  message: string;
  type: string;
  sanitized: boolean;
} {
  let message = '';
  let type = 'Error';
  let sanitized = false;

  // Extract error message
  if (error instanceof Error) {
    message = error.message;
    type = error.constructor.name;
  } else if (typeof error === 'string') {
    message = error;
  } else {
    message = String(error);
  }

  // Apply sanitization patterns
  let sanitizedMessage = message;
  for (const pattern of SENSITIVE_PATTERNS) {
    const originalMessage = sanitizedMessage;
    sanitizedMessage = sanitizedMessage.replace(pattern, REDACTED);
    if (originalMessage !== sanitizedMessage) {
      sanitized = true;
    }
  }

  return {
    message: sanitizedMessage,
    type,
    sanitized,
  };
}

/**
 * Get user-safe error message
 * Returns generic message for users, hiding internal details
 */
export function getUserSafeErrorMessage(error: unknown): string {
  // Map known error types to user-friendly messages
  if (error instanceof Error) {
    const errorName = error.constructor.name;
    const errorMessage = error.message.toLowerCase();

    // Database errors
    if (errorName.includes('Postgres') || errorMessage.includes('postgres')) {
      return 'A database error occurred. Please try again later.';
    }

    // Auth errors
    if (errorName.includes('Auth') || errorMessage.includes('unauthorized')) {
      return 'Authentication failed. Please log in and try again.';
    }

    // Network errors
    if (errorMessage.includes('fetch') || errorMessage.includes('network')) {
      return 'Network error. Please check your connection and try again.';
    }

    // File size errors
    if (errorMessage.includes('too large') || errorMessage.includes('size')) {
      return 'File is too large. Please use a smaller file.';
    }

    // Parse errors
    if (errorMessage.includes('parse') || errorMessage.includes('xml')) {
      return 'Failed to parse file. Please ensure it is a valid XMEML file.';
    }

    // Validation errors
    if (errorMessage.includes('invalid') || errorMessage.includes('validation')) {
      return 'Invalid request. Please check your input and try again.';
    }

    // Payment errors
    if (errorMessage.includes('stripe') || errorMessage.includes('payment')) {
      return 'Payment processing error. Please try again or contact support.';
    }
  }

  // Generic fallback
  return 'An unexpected error occurred. Please try again later.';
}

/**
 * Sanitize error object for API response
 * Returns both a safe message for users and sanitized details for debugging
 */
export function sanitizeErrorForAPI(error: unknown): {
  userMessage: string;
  debugInfo?: {
    type: string;
    message: string;
    sanitized: boolean;
  };
} {
  const userMessage = getUserSafeErrorMessage(error);

  // In development, include sanitized debug info
  if (process.env.NODE_ENV === 'development') {
    const debugInfo = sanitizeErrorForLogging(error);
    return { userMessage, debugInfo };
  }

  // In production, only return user message
  return { userMessage };
}

/**
 * Safe console logging wrapper
 * Automatically sanitizes errors before logging
 */
export function logError(context: string, error: unknown, additionalData?: Record<string, any>): void {
  const sanitized = sanitizeErrorForLogging(error);

  console.error(`[${context}]`, {
    type: sanitized.type,
    message: sanitized.message,
    sanitized: sanitized.sanitized,
    ...(additionalData && sanitizeObject(additionalData)),
  });
}

/**
 * Sanitize an object's values recursively
 * Useful for sanitizing additional context data
 */
export function sanitizeObject(obj: Record<string, any>): Record<string, any> {
  const sanitized: Record<string, any> = {};

  for (const [key, value] of Object.entries(obj)) {
    if (value === null || value === undefined) {
      sanitized[key] = value;
    } else if (typeof value === 'string') {
      // Sanitize string values
      let sanitizedValue = value;
      for (const pattern of SENSITIVE_PATTERNS) {
        sanitizedValue = sanitizedValue.replace(pattern, REDACTED);
      }
      sanitized[key] = sanitizedValue;
    } else if (typeof value === 'object' && !Array.isArray(value)) {
      // Recursively sanitize nested objects
      sanitized[key] = sanitizeObject(value);
    } else if (Array.isArray(value)) {
      // Sanitize arrays
      sanitized[key] = value.map(item =>
        typeof item === 'object' && item !== null
          ? sanitizeObject(item)
          : item
      );
    } else {
      // Keep other types as-is
      sanitized[key] = value;
    }
  }

  return sanitized;
}

/**
 * Create a sanitized error logger with context
 * Useful for creating domain-specific loggers
 */
export function createErrorLogger(context: string) {
  return {
    error: (error: unknown, additionalData?: Record<string, any>) => {
      logError(context, error, additionalData);
    },
    warn: (message: string, additionalData?: Record<string, any>) => {
      console.warn(`[${context}]`, message, additionalData && sanitizeObject(additionalData));
    },
    info: (message: string, additionalData?: Record<string, any>) => {
      console.log(`[${context}]`, message, additionalData && sanitizeObject(additionalData));
    },
  };
}
