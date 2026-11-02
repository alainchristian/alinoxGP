import { loadEnv } from './env';

const valid = (): NodeJS.ProcessEnv => ({
  NODE_ENV: 'development',
  DATABASE_URL: 'postgresql://a',
  DATABASE_URL_SYSTEM: 'postgresql://b',
  REDIS_URL: 'redis://x',
  JWT_ACCESS_SECRET: 'x'.repeat(40),
  TOTP_ENCRYPTION_KEY: Buffer.alloc(32, 1).toString('base64'),
  TRACCAR_USER: 'svc@example.test',
  TRACCAR_PASSWORD: 'pw',
});

describe('loadEnv', () => {
  it('applies defaults to a valid configuration', () => {
    const env = loadEnv(valid());
    expect(env.PORT).toBe(3100);
    expect(env.ACCESS_TOKEN_TTL_SECONDS).toBe(900);
    expect(env.EMAIL_PROVIDER).toBe('dev');
    expect(env.GPS_ENGINE).toBe('traccar');
    expect(env.INGESTION_ENABLED).toBe(true);
  });

  it('requires Traccar credentials unless the fake engine is selected', () => {
    const { TRACCAR_USER: _u, TRACCAR_PASSWORD: _p, ...rest } = valid();
    expect(() => loadEnv(rest as NodeJS.ProcessEnv)).toThrow(/TRACCAR_USER/);
    expect(loadEnv({ ...rest, GPS_ENGINE: 'fake' } as NodeJS.ProcessEnv).GPS_ENGINE).toBe('fake');
  });

  it.each([
    ['JWT_ACCESS_SECRET too short', { JWT_ACCESS_SECRET: 'short' }, /JWT_ACCESS_SECRET/],
    ['TOTP key of wrong length', { TOTP_ENCRYPTION_KEY: Buffer.alloc(16).toString('base64') }, /TOTP_ENCRYPTION_KEY/],
    ['missing database url', { DATABASE_URL: undefined }, /DATABASE_URL/],
    ['non-numeric port', { PORT: 'abc' }, /PORT/],
  ])('rejects %s', (_name, patch, message) => {
    expect(() => loadEnv({ ...valid(), ...patch } as NodeJS.ProcessEnv)).toThrow(message);
  });

  it('refuses the fake engine and an enabled simulator in production', () => {
    const prod = { ...valid(), NODE_ENV: 'production', EMAIL_PROVIDER: undefined } as NodeJS.ProcessEnv;
    expect(() => loadEnv({ ...prod, GPS_ENGINE: 'fake' })).toThrow(/fake GPS engine/);
    expect(() => loadEnv({ ...prod, SIMULATOR_ENABLED: 'true' })).toThrow(/SIMULATOR_ENABLED/);
  });

  it('refuses the development email adapter and the placeholder secret in production', () => {
    expect(() => loadEnv({ ...valid(), NODE_ENV: 'production' })).toThrow(/development email adapter/);
    const prod = { ...valid(), NODE_ENV: 'production', JWT_ACCESS_SECRET: 'change-me-'.repeat(5) };
    expect(() => loadEnv(prod)).toThrow(/Default secret/);
  });

  describe('map provider (ADR-0008)', () => {
    it('defaults to the development map', () => {
      expect(loadEnv(valid()).MAP_PROVIDER).toBe('dev-osm');
    });

    it('refuses the development map in production', () => {
      const prod = { ...valid(), NODE_ENV: 'production' } as NodeJS.ProcessEnv; // (also fails on the email adapter: the message lists every problem)
      expect(() => loadEnv(prod)).toThrow(/development map/);
    });

    it('the Mapbox provider needs a token, and only a PUBLIC one: a secret token must never reach a browser', () => {
      expect(() => loadEnv({ ...valid(), MAP_PROVIDER: 'mapbox' })).toThrow(/MAPBOX_PUBLIC_TOKEN is required/);
      expect(() => loadEnv({ ...valid(), MAP_PROVIDER: 'mapbox', MAPBOX_PUBLIC_TOKEN: 'sk.secret' })).toThrow(/PUBLIC token/);
      expect(() => loadEnv({ ...valid(), MAPBOX_PUBLIC_TOKEN: 'sk.secret' })).toThrow(/PUBLIC token/); // refused even when unused
      expect(loadEnv({ ...valid(), MAP_PROVIDER: 'mapbox', MAPBOX_PUBLIC_TOKEN: 'pk.abc' }).MAP_PROVIDER).toBe('mapbox');
    });
  });
});
