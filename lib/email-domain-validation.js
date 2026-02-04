/**
 * Email domain validation utilities
 * Supports both client-side validation and server-side enforcement
 * 
 * Domains are stored in the database (allowed_email_domains table) and fetched dynamically.
 * This ensures a single source of truth and eliminates sync issues.
 */

import { supabase } from "./supabase";

// Cache for allowed domains to avoid repeated database calls
let allowedDomainsCache = null;
let cacheTimestamp = 0;
const CACHE_TTL = 5 * 60 * 1000; // 5 minutes

/**
 * Fetch allowed domains from the database
 * @returns {Promise<string[]>} - Array of allowed domain strings
 */
async function fetchAllowedDomainsFromDatabase() {
    try {
        const { data, error } = await supabase.rpc('get_allowed_email_domains');

        if (error) {
            console.error('[EMAIL_VALIDATION] Error fetching allowed domains from database:', error);
            // Return empty array on error - validation will allow all (backward compatibility)
            return [];
        }

        return data || [];
    } catch (error) {
        console.error('[EMAIL_VALIDATION] Exception fetching allowed domains:', error);
        return [];
    }
}

/**
 * Get allowed domains (with caching)
 * @returns {Promise<string[]>} - Array of allowed domain strings
 */
export async function getAllowedDomains() {
    const now = Date.now();

    // Return cached data if still valid
    if (allowedDomainsCache && (now - cacheTimestamp) < CACHE_TTL) {
        return allowedDomainsCache;
    }

    // Fetch from database
    const domains = await fetchAllowedDomainsFromDatabase();

    // Update cache
    allowedDomainsCache = domains;
    cacheTimestamp = now;

    return domains;
}

/**
 * Clear the allowed domains cache (useful after updating domains in database)
 */
export function clearAllowedDomainsCache() {
    allowedDomainsCache = null;
    cacheTimestamp = 0;
}

/**
 * Extract domain from email address
 * @param {string} email - Email address
 * @returns {string|null} - Domain or null if invalid
 */
export function extractDomain(email) {
    if (!email || typeof email !== 'string') {
        return null;
    }

    const trimmedEmail = email.trim().toLowerCase();
    const atIndex = trimmedEmail.indexOf('@');

    if (atIndex === -1 || atIndex === 0 || atIndex === trimmedEmail.length - 1) {
        return null;
    }

    return trimmedEmail.substring(atIndex + 1);
}

/**
 * Check if email domain is allowed
 * @param {string} email - Email address to validate
 * @param {string[]} allowedDomains - Array of allowed domains (optional, will fetch from DB if not provided)
 * @returns {Promise<boolean>} - True if domain is allowed
 */
export async function isDomainAllowed(email, allowedDomains = null) {
    // If domains not provided, fetch from database
    const domains = allowedDomains || await getAllowedDomains();

    // If no domains are configured, allow all (backward compatibility)
    if (!domains || domains.length === 0) {
        console.warn('[EMAIL_VALIDATION] No allowed domains configured. Allowing all emails.');
        return true;
    }

    const domain = extractDomain(email);

    if (!domain) {
        return false;
    }

    // Check if domain matches any allowed domain (case-insensitive)
    return domains.some(allowedDomain =>
        domain === allowedDomain.toLowerCase().trim()
    );
}

/**
 * Get validation error message
 * @param {string} email - Email address that failed validation
 * @param {string[]} allowedDomains - Array of allowed domains (optional, will fetch from DB if not provided)
 * @returns {Promise<string>} - User-friendly error message
 */
export async function getDomainValidationError(email, allowedDomains = null) {
    const domains = allowedDomains || await getAllowedDomains();

    if (!domains || domains.length === 0) {
        return 'Email domain validation is not configured.';
    }

    if (domains.length === 1) {
        return `Only emails from ${domains[0]} are allowed.`;
    }

    return `Only emails from the following domains are allowed: ${domains.join(', ')}`;
}

/**
 * Validate email format and domain using Edge Function (server-side)
 * Falls back to client-side validation if Edge Function is not available
 * @param {string} email - Email address to validate
 * @param {boolean} useEdgeFunction - Whether to use Edge Function (default: true)
 * @returns {Promise<{valid: boolean, error: string|null}>} - Validation result
 */
export async function validateEmailDomain(email, useEdgeFunction = true) {
    if (!email || typeof email !== 'string' || !email.trim()) {
        return {
            valid: false,
            error: 'Email is required',
        };
    }

    // Basic email format validation
    const emailRegex = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;
    if (!emailRegex.test(email.trim())) {
        return {
            valid: false,
            error: 'Please enter a valid email address',
        };
    }

    // Try Edge Function first (more secure)
    if (useEdgeFunction) {
        try {
            const { data, error } = await supabase.functions.invoke('validate-email-domain', {
                body: { email: email.trim() }
            });

            if (error) {
                console.warn('[EMAIL_VALIDATION] Edge Function error, falling back to client-side:', error);
                // Fall through to client-side validation
            } else if (data) {
                if (data.allowed === false) {
                    return {
                        valid: false,
                        error: data.error || 'Email domain is not allowed',
                    };
                }
                if (data.allowed === true) {
                    return {
                        valid: true,
                        error: null,
                    };
                }
            }
        } catch (edgeError) {
            // Edge Function not deployed or unavailable, fall back to client-side
            console.warn('[EMAIL_VALIDATION] Edge Function not available, using client-side validation:', edgeError);
        }
    }

    // Fallback to client-side validation (for development or if Edge Function unavailable)
    const isAllowed = await isDomainAllowed(email);
    if (!isAllowed) {
        const errorMessage = await getDomainValidationError(email);
        return {
            valid: false,
            error: errorMessage,
        };
    }

    return {
        valid: true,
        error: null,
    };
}

