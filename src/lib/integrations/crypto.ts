import { createCipheriv, createDecipheriv, createHash, createHmac, randomBytes, timingSafeEqual } from 'node:crypto';

/**
 * AES-256-GCM for integration credentials. Key: INTEGRATIONS_ENCRYPTION_KEY (32 bytes, base64 or hex).
 * In development only, a key is derived from AUTH_SECRET so the app works out of the box.
 */
function key(): Buffer {
  const k = process.env.INTEGRATIONS_ENCRYPTION_KEY;
  if (k) {
    const buf = /^[0-9a-f]{64}$/i.test(k) ? Buffer.from(k, 'hex') : Buffer.from(k, 'base64');
    if (buf.length !== 32) throw new Error('INTEGRATIONS_ENCRYPTION_KEY must be 32 bytes (base64 or 64 hex chars)');
    return buf;
  }
  if (process.env.NODE_ENV === 'production') throw new Error('INTEGRATIONS_ENCRYPTION_KEY is required in production');
  return createHash('sha256').update(`beaufinance-dev:${process.env.AUTH_SECRET ?? 'dev'}`).digest();
}

export function encryptJson(value: unknown): string {
  const iv = randomBytes(12);
  const c = createCipheriv('aes-256-gcm', key(), iv);
  const enc = Buffer.concat([c.update(JSON.stringify(value), 'utf8'), c.final()]);
  return `v1.${iv.toString('base64')}.${c.getAuthTag().toString('base64')}.${enc.toString('base64')}`;
}

export function decryptJson<T = any>(blob: string | null | undefined): T {
  if (!blob) return {} as T;
  const [v, iv, tag, data] = blob.split('.');
  if (v !== 'v1') throw new Error('Unknown credential format');
  const d = createDecipheriv('aes-256-gcm', key(), Buffer.from(iv, 'base64'));
  d.setAuthTag(Buffer.from(tag, 'base64'));
  return JSON.parse(Buffer.concat([d.update(Buffer.from(data, 'base64')), d.final()]).toString('utf8'));
}

export const hmacBase64 = (secret: string, data: string | Buffer) => createHmac('sha256', secret).update(data).digest('base64');
export const hmacHex = (secret: string, data: string | Buffer) => createHmac('sha256', secret).update(data).digest('hex');

export function safeEqual(a: string | null | undefined, b: string | null | undefined) {
  if (!a || !b) return false;
  const x = Buffer.from(a);
  const y = Buffer.from(b);
  return x.length === y.length && timingSafeEqual(x, y);
}

export const randomSecret = (bytes = 24) => randomBytes(bytes).toString('base64url');

export function stableHash(value: unknown): string {
  const norm = (v: any): any => (Array.isArray(v) ? v.map(norm) : v && typeof v === 'object' ? Object.fromEntries(Object.keys(v).sort().filter((k) => k !== 'raw').map((k) => [k, norm(v[k])])) : v);
  return createHash('sha256').update(JSON.stringify(norm(value))).digest('hex');
}

/** Signed, expiring state for OAuth redirects (prevents CSRF / connection hijacking). */
export function signState(payload: Record<string, unknown>, ttlSeconds = 900) {
  const body = Buffer.from(JSON.stringify({ ...payload, exp: Math.floor(Date.now() / 1000) + ttlSeconds, n: randomSecret(8) })).toString('base64url');
  return `${body}.${hmacHex(key().toString('hex'), body)}`;
}
export function verifyState<T = any>(state: string | null): T | null {
  if (!state) return null;
  const [body, sig] = state.split('.');
  if (!body || !safeEqual(sig, hmacHex(key().toString('hex'), body))) return null;
  const p = JSON.parse(Buffer.from(body, 'base64url').toString('utf8'));
  if (p.exp < Date.now() / 1000) return null;
  return p as T;
}

export function hint(secret: string | null | undefined) {
  return secret ? `••••${secret.slice(-4)}` : null;
}
