import { z } from 'zod';

const bool = z.enum(['true', 'false']).transform((v) => v === 'true');

const envSchema = z
  .object({
    NODE_ENV: z.enum(['development', 'test', 'production']).default('development'),
    PORT: z.coerce.number().int().default(3100),
    APP_BASE_URL: z.url().default('http://localhost:5273'),
    LOG_LEVEL: z.enum(['fatal', 'error', 'warn', 'info', 'debug', 'trace', 'silent']).default('info'),
    TRUST_PROXY: bool.default(false),

    DATABASE_URL: z.string().min(1),
    DATABASE_URL_SYSTEM: z.string().min(1),
    REDIS_URL: z.string().min(1),
    /** Prepended to every key on the shared Redis client (and to pub/sub channels and BullMQ queues). Empty in production; tests use one per suite. */
    REDIS_KEY_PREFIX: z.string().default(''),

    JWT_ACCESS_SECRET: z.string().min(32, 'JWT_ACCESS_SECRET must be at least 32 characters'),
    TOTP_ENCRYPTION_KEY: z
      .string()
      .refine((v) => Buffer.from(v, 'base64').length === 32, 'TOTP_ENCRYPTION_KEY must be 32 bytes, base64-encoded'),
    ACCESS_TOKEN_TTL_SECONDS: z.coerce.number().int().min(60).default(900),
    REFRESH_TOKEN_TTL_DAYS: z.coerce.number().int().min(1).default(30),
    EMAIL_VERIFY_TTL_HOURS: z.coerce.number().int().min(1).default(48),
    PASSWORD_RESET_TTL_MINUTES: z.coerce.number().int().min(5).default(60),
    INVITATION_TTL_DAYS: z.coerce.number().int().min(1).default(7),

    EMAIL_PROVIDER: z.enum(['dev']).default('dev'),
    EMAIL_FROM: z.string().default('no-reply@gps.local'),

    THROTTLE_DEFAULT_LIMIT: z.coerce.number().int().min(1).default(120),
    THROTTLE_AUTH_LIMIT: z.coerce.number().int().min(1).default(10),

    SWAGGER_ENABLED: bool.optional(),

    // GPS engine (M2). 'fake' is for unit tests only and is refused in production.
    GPS_ENGINE: z.enum(['traccar', 'fake']).default('traccar'),
    TRACCAR_URL: z.url().default('http://localhost:58082'),
    TRACCAR_USER: z.string().default(''),
    TRACCAR_PASSWORD: z.string().default(''),
    TRACCAR_REQUEST_TIMEOUT_MS: z.coerce.number().int().min(500).default(5000),
    TRACCAR_REPORT_TIMEOUT_MS: z.coerce.number().int().min(1000).default(30000),
    /** History (M6a). How far back a customer may look until plans carry `history_days` (M10). */
    HISTORY_DAYS_DEFAULT: z.coerce.number().int().min(1).max(3650).default(30),
    /** Longest range of ONE trip-list request. */
    HISTORY_MAX_SPAN_TRIPS_DAYS: z.coerce.number().int().min(1).max(366).default(31),
    /** Longest range of ONE route (playback) request: route points are the heavy query. */
    HISTORY_MAX_SPAN_ROUTE_DAYS: z.coerce.number().int().min(1).max(31).default(7),
    /** A movement shorter than this is GPS drift while parked, not a trip (OQ-033): hidden from the list and counted. */
    HISTORY_MIN_TRIP_DISTANCE_M: z.coerce.number().int().min(0).max(5000).default(200),
    /** A trip whose own distance and duration imply a faster average than this is a bad-fix artefact (a swapped coordinate once gave an 11 642 km trip): hidden and counted. */
    HISTORY_MAX_PLAUSIBLE_SPEED_KMH: z.coerce.number().int().min(50).max(1000).default(250),
    /** Playback points returned at most; a longer route is thinned (and says so). */
    HISTORY_MAX_ROUTE_POINTS: z.coerce.number().int().min(100).max(50000).default(5000),
    /** Run the Traccar WebSocket consumer (single leader across instances). */
    INGESTION_ENABLED: bool.default(true),
    /** Run BullMQ workers (reconciliation, ...). */
    WORKERS_ENABLED: bool.default(true),
    /** A simulated position for a non-sandbox organization is dropped; this is the ONLY switch that allows simulated devices at all. */
    SIMULATOR_ENABLED: bool.default(true),
    /** Public host (or IP) that GPS devices connect to, shown in configuration instructions. Empty = not configured; instructions then say so instead of guessing. */
    GPS_SERVER_HOST: z.string().trim().default(''),
    /** When a consent notice is published, device registration needs the user's acknowledgement of the current version (ADR-0009). */
    DEVICE_CONSENT_REQUIRED: bool.default(true),

    // Vehicle status thresholds (platform defaults; per-organization overrides come later). Tests use small values.
    STATUS_OFFLINE_AFTER_SEC: z.coerce.number().int().min(5).default(600),
    STATUS_MOVING_SPEED_KMH: z.coerce.number().min(1).default(5),
    STATUS_IDLE_AFTER_SEC: z.coerce.number().int().min(1).default(180),
    STATUS_PARKED_AFTER_SEC: z.coerce.number().int().min(1).default(300),

    // Pipeline anomaly handling (skill gps-position-pipeline §3).
    /** serverTime - fixTime above this marks a fix as delayed/buffered: no real-time alerts. */
    PIPELINE_DELAYED_AFTER_SEC: z.coerce.number().int().min(5).default(120),
    /** Implied speed between consecutive fixes above this is treated as an implausible jump. */
    PIPELINE_MAX_PLAUSIBLE_SPEED_KMH: z.coerce.number().min(50).default(300),
    /** How often the leader scans for vehicles that crossed the offline threshold. */
    SWEEP_INTERVAL_SEC: z.coerce.number().int().min(1).default(30),
    /** How often changed live states are written through to PostgreSQL (status changes are written immediately). */
    STATE_PERSIST_INTERVAL_SEC: z.coerce.number().int().min(1).default(30),
    /**
     * How long a device's routing (device -> open assignment -> organization/vehicle) is cached in-process. Must exceed the
     * devices' reporting interval or every position misses (measured: 5 s TTL + 10 s reports = a 3-table query per position).
     * Changes are pushed to all instances over Redis, so a long TTL does not leave a stale-tenant window.
     */
    ROUTING_CACHE_TTL_SEC: z.coerce.number().int().min(1).default(300),
    /** How often the ingestion leader writes its in-memory live state to Redis in one atomic, lease-checked batch. */
    LIVE_STATE_REDIS_FLUSH_MS: z.coerce.number().int().min(20).default(250),
    /**
     * Map provider (M4, ADR-0008). `dev-osm` = OpenStreetMap raster tiles for DEVELOPMENT only (OSM's tile usage policy forbids
     * production use); `mapbox` = the production provider. The browser gets all of this from `GET /maps/config`.
     */
    MAP_PROVIDER: z.enum(['dev-osm', 'mapbox']).default('dev-osm'),
    /** A Mapbox PUBLIC token (pk.…). A secret token (sk.…) is refused: it must never be sent to a browser. */
    MAPBOX_PUBLIC_TOKEN: z.string().optional(),
    MAP_DEV_TILE_URL: z.string().default('https://tile.openstreetmap.org/{z}/{x}/{y}.png'),
    /** Most vehicles returned by GET /tracking/snapshot (the live map's starting point); the response says when it was cut. */
    TRACKING_SNAPSHOT_LIMIT: z.coerce.number().int().min(1).default(5000),
    /** Socket.IO delta coalescing window per organization. */
    FANOUT_FLUSH_MS: z.coerce.number().int().min(50).default(1000),
    /** How often connected sockets are re-validated (revoked session / removed membership => disconnect). */
    SOCKET_REVALIDATE_SEC: z.coerce.number().int().min(1).default(30),
  })
  .superRefine((env, ctx) => {
    if (env.GPS_ENGINE === 'traccar' && (!env.TRACCAR_USER || !env.TRACCAR_PASSWORD) && env.NODE_ENV !== 'test') {
      ctx.addIssue({ code: 'custom', path: ['TRACCAR_USER'], message: 'TRACCAR_USER and TRACCAR_PASSWORD are required when GPS_ENGINE=traccar' });
    }
    if (env.MAPBOX_PUBLIC_TOKEN && !env.MAPBOX_PUBLIC_TOKEN.startsWith('pk.')) {
      ctx.addIssue({ code: 'custom', path: ['MAPBOX_PUBLIC_TOKEN'], message: 'MAPBOX_PUBLIC_TOKEN must be a PUBLIC token (pk.…); a secret token must never be sent to a browser' });
    }
    if (env.MAP_PROVIDER === 'mapbox' && !env.MAPBOX_PUBLIC_TOKEN) {
      ctx.addIssue({ code: 'custom', path: ['MAPBOX_PUBLIC_TOKEN'], message: 'MAPBOX_PUBLIC_TOKEN is required when MAP_PROVIDER=mapbox' });
    }
    if (env.NODE_ENV === 'production') {
      if (env.MAP_PROVIDER === 'dev-osm') {
        ctx.addIssue({ code: 'custom', path: ['MAP_PROVIDER'], message: 'The development map (OpenStreetMap tiles) is not allowed in production; use MAP_PROVIDER=mapbox' });
      }
      if (env.EMAIL_PROVIDER === 'dev') {
        ctx.addIssue({
          code: 'custom',
          path: ['EMAIL_PROVIDER'],
          message: 'The development email adapter is not allowed in production',
        });
      }
      if (env.GPS_ENGINE === 'fake') {
        ctx.addIssue({ code: 'custom', path: ['GPS_ENGINE'], message: 'The fake GPS engine is not allowed in production' });
      }
      if (env.SIMULATOR_ENABLED) {
        ctx.addIssue({ code: 'custom', path: ['SIMULATOR_ENABLED'], message: 'SIMULATOR_ENABLED must be false in production' });
      }
      if (env.JWT_ACCESS_SECRET.includes('change-me')) {
        ctx.addIssue({ code: 'custom', path: ['JWT_ACCESS_SECRET'], message: 'Default secret in production' });
      }
    }
  });

export type Env = z.infer<typeof envSchema>;

/** Validates configuration at boot; the process refuses to start on invalid configuration. */
export function loadEnv(source: NodeJS.ProcessEnv = process.env): Env {
  const parsed = envSchema.safeParse(source);
  if (!parsed.success) {
    const lines = parsed.error.issues.map((i) => `  - ${i.path.join('.')}: ${i.message}`).join('\n');
    throw new Error(`Invalid environment configuration:\n${lines}`);
  }
  return parsed.data;
}

export const ENV = Symbol('ENV');
