import { createHash } from 'node:crypto';
import { mkdir, readFile, writeFile } from 'node:fs/promises';
import { join } from 'node:path';

const CACHE_DIR = join(process.cwd(), '.cache');
const USER_AGENT = 'gameswarp (https://github.com/vladarefiev/gameswarp)';
const MIN_INTERVAL_MS = 1500;
const TIMEOUT_MS = 30_000;

export class HttpError extends Error {
  constructor(
    readonly status: number,
    readonly url: string,
  ) {
    super(`HTTP ${status} for ${url}`);
    this.name = 'HttpError';
  }
}

let lastRequestAt = 0;

async function sleep(ms: number): Promise<void> {
  await new Promise((resolve) => setTimeout(resolve, ms));
}

async function pace(): Promise<void> {
  const wait = lastRequestAt + MIN_INTERVAL_MS - Date.now();
  if (wait > 0) await sleep(wait);
  lastRequestAt = Date.now();
}

function cachePath(url: string): string {
  return join(CACHE_DIR, `${createHash('sha256').update(url).digest('hex')}.json`);
}

async function readCache(url: string): Promise<string | undefined> {
  try {
    return await readFile(cachePath(url), 'utf8');
  } catch {
    return undefined;
  }
}

async function writeCache(url: string, body: string): Promise<void> {
  await mkdir(CACHE_DIR, { recursive: true });
  await writeFile(cachePath(url), body, 'utf8');
}

async function fetchOnce(url: string): Promise<string> {
  const response = await fetch(url, {
    headers: { 'User-Agent': USER_AGENT },
    signal: AbortSignal.timeout(TIMEOUT_MS),
  });
  if (!response.ok) throw new HttpError(response.status, url);
  return response.text();
}

/**
  * Steam does not publish its rate limits but starts refusing frequent requests,
  * hence the fixed gap between calls and the growing backoff on failure.
  * 4xx is never retried: 403 means the appid does not exist, so retrying is waste.
  */
export async function getText(url: string, retries = 3): Promise<string> {
  const cached = await readCache(url);
  if (cached !== undefined) return cached;

  let lastError: unknown;
  for (let attempt = 0; attempt <= retries; attempt++) {
    if (attempt > 0) await sleep(MIN_INTERVAL_MS * 2 ** attempt);
    await pace();
    try {
      const body = await fetchOnce(url);
      await writeCache(url, body);
      return body;
    } catch (error) {
      if (error instanceof HttpError && error.status < 500) throw error;
      lastError = error;
    }
  }
  throw lastError;
}

export async function getJson<T>(url: string, retries = 3): Promise<T> {
  return JSON.parse(await getText(url, retries)) as T;
}
