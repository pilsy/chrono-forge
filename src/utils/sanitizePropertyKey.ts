/**
 * Sanitizes a property key by replacing special characters with underscores.
 * This ensures that property keys are safe to use as object keys and in paths.
 *
 * @param key - The property key to sanitize
 * @returns The sanitized property key
 *
 * @example
 * sanitizePropertyKey('searchResults_potato chips') // returns 'searchResults_potato_chips'
 * sanitizePropertyKey('user@email.com') // returns 'user_email_com'
 */
export function sanitizePropertyKey(key: string): string {
  return key.replace(/[^a-zA-Z0-9_]/g, '_');
}
