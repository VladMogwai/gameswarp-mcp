import { existsSync, readFileSync } from 'node:fs';
import { dirname, join } from 'node:path';

/**
 * Walks up from the working directory looking for .env. Without this the file is
 * only found when a process happens to start at the repository root - the web app
 * starts in web/ and would silently fall back to a different database.
 */
function findEnvFile(from: string): string | undefined {
  let directory = from;
  for (let depth = 0; depth < 5; depth++) {
    const candidate = join(directory, '.env');
    if (existsSync(candidate)) return candidate;
    const parent = dirname(directory);
    if (parent === directory) break;
    directory = parent;
  }
  return undefined;
}

/**
 * Loads .env if there is one, without overriding variables already set. The
 * precedence matters: CI passes secrets through the real environment and must
 * never be shadowed by a file that happens to be lying around, while locally a
 * one-off `DATABASE_URL=… npm run tick` should still win over the file.
 *
 * Node can do this with --env-file, but that has to be repeated on every entry
 * point and fails outright when the file is absent.
 */
export function loadEnvFile(explicit?: string): void {
  const path = explicit ?? findEnvFile(process.cwd());
  if (path === undefined || !existsSync(path)) return;

  for (const line of readFileSync(path, 'utf8').split('\n')) {
    const trimmed = line.trim();
    if (trimmed.length === 0 || trimmed.startsWith('#')) continue;

    const eq = trimmed.indexOf('=');
    if (eq <= 0) continue;

    const key = trimmed.slice(0, eq).trim();
    if (process.env[key] !== undefined) continue;

    let value = trimmed.slice(eq + 1).trim();
    if (
      (value.startsWith('"') && value.endsWith('"')) ||
      (value.startsWith("'") && value.endsWith("'"))
    ) {
      value = value.slice(1, -1);
    }
    process.env[key] = value;
  }
}
