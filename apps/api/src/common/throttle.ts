// Read at import time because @Throttle() arguments are static. Defaults mirror env.ts.
export const DEFAULT_LIMIT = Number(process.env['THROTTLE_DEFAULT_LIMIT'] ?? 120);
export const AUTH_LIMIT = Number(process.env['THROTTLE_AUTH_LIMIT'] ?? 10);
export const THROTTLE_TTL_MS = 60_000;

/** Stricter limit for credential-handling and token-consuming public routes. */
export const AUTH_THROTTLE = { default: { limit: AUTH_LIMIT, ttl: THROTTLE_TTL_MS } };
