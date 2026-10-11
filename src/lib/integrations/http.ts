import { IntegrationError } from './types';

export type Fetcher = typeof fetch;
let fetcher: Fetcher = (...a) => fetch(...a);
/** Tests inject a fake HTTP layer here. */
export function setFetcher(f: Fetcher | null) {
  fetcher = f ?? ((...a) => fetch(...a));
}

/**
 * JSON HTTP with timeout and bounded retries on 429 / 5xx / network errors (exponential backoff,
 * honours Retry-After). Error messages never include credentials.
 */
export async function requestJson<T = any>(url: string, init: RequestInit & { timeoutMs?: number; retries?: number; label?: string } = {}): Promise<T> {
  const retries = init.retries ?? 3;
  const label = init.label ?? new URL(url).host;
  let lastErr: unknown;
  for (let attempt = 0; attempt <= retries; attempt++) {
    const ctl = new AbortController();
    const t = setTimeout(() => ctl.abort(), init.timeoutMs ?? 20000);
    try {
      const res = await fetcher(url, { ...init, signal: ctl.signal });
      const text = await res.text();
      if (res.ok) return (text ? JSON.parse(text) : {}) as T;
      const retryable = res.status === 429 || res.status >= 500;
      const detail = text.slice(0, 300).replace(/(token|secret|key)["':=\s]+[^"&\s,}]+/gi, '$1=***');
      lastErr = new IntegrationError(`${label} responded ${res.status}: ${detail}`, res.status, retryable);
      if (!retryable || attempt === retries) throw lastErr;
      const ra = Number(res.headers.get('retry-after'));
      await sleep(Number.isFinite(ra) && ra > 0 ? Math.min(ra * 1000, 10000) : 500 * 2 ** attempt);
    } catch (e: any) {
      if (e instanceof IntegrationError && !e.retryable) throw e;
      lastErr = e instanceof IntegrationError ? e : new IntegrationError(`${label}: ${e?.name === 'AbortError' ? 'request timed out' : e?.message ?? 'network error'}`, undefined, true);
      if (attempt === retries) throw lastErr;
      await sleep(500 * 2 ** attempt);
    } finally {
      clearTimeout(t);
    }
  }
  throw lastErr;
}

const sleep = (ms: number) => new Promise((r) => setTimeout(r, process.env.VITEST ? 1 : ms));

export const iso = (d: string | number | Date) => new Date(d).toISOString();
export const money = (v: unknown) => {
  const s = v === null || v === undefined || v === '' ? '0' : String(v);
  return /^-?\d+(\.\d+)?$/.test(s) ? s : '0';
};
