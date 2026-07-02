import * as fs from 'fs';
import * as path from 'path';

/**
 * Harness connection details resolved from the environment / .env file.
 */
export interface HarnessConfig {
  apiKey: string;
  baseUrl: string;
  accountId: string;
}

/**
 * Minimal .env parser (no external dependency).
 * Supports `KEY=value`, `export KEY=value`, comments (#), and optional quotes.
 */
function parseEnv(contents: string): Record<string, string> {
  const out: Record<string, string> = {};
  for (const rawLine of contents.split(/\r?\n/)) {
    const line = rawLine.trim();
    if (!line || line.startsWith('#')) continue;
    const withoutExport = line.replace(/^export\s+/, '');
    const eq = withoutExport.indexOf('=');
    if (eq === -1) continue;
    const key = withoutExport.slice(0, eq).trim();
    let value = withoutExport.slice(eq + 1).trim();
    // Strip surrounding quotes.
    if (
      (value.startsWith('"') && value.endsWith('"')) ||
      (value.startsWith("'") && value.endsWith("'"))
    ) {
      value = value.slice(1, -1);
    }
    if (key) out[key] = value;
  }
  return out;
}

/**
 * Look for a .env file starting at `startDir` and walking up to the filesystem
 * root. This lets the tool run from chaos-data/ while using the repo-root .env.
 */
function findEnvFile(startDir: string): string | null {
  let dir = path.resolve(startDir);
  // Safety bound on the number of parent directories to check.
  for (let i = 0; i < 8; i++) {
    const candidate = path.join(dir, '.env');
    if (fs.existsSync(candidate)) return candidate;
    const parent = path.dirname(dir);
    if (parent === dir) break;
    dir = parent;
  }
  return null;
}

/**
 * Load Harness config. Precedence:
 *   1. Real process environment variables (if already set).
 *   2. Values from the nearest .env file (searching up from cwd, then this file).
 */
export function loadConfig(): HarnessConfig {
  const fromFiles: Record<string, string> = {};

  const searchStarts = [process.cwd(), __dirname];
  for (const start of searchStarts) {
    const envPath = findEnvFile(start);
    if (envPath) {
      const parsed = parseEnv(fs.readFileSync(envPath, 'utf8'));
      // First file found wins; don't overwrite already-seen keys.
      for (const [k, v] of Object.entries(parsed)) {
        if (!(k in fromFiles)) fromFiles[k] = v;
      }
      break;
    }
  }

  const pick = (name: string): string | undefined =>
    process.env[name] ?? fromFiles[name];

  const apiKey = pick('HARNESS_API_KEY') ?? pick('HARNESS_TOKEN');
  const baseUrl =
    pick('HARNESS_BASE_URL') ?? 'https://app.harness.io';
  const accountId = pick('HARNESS_ACCOUNT_ID');

  const missing: string[] = [];
  if (!apiKey) missing.push('HARNESS_API_KEY');
  if (!accountId) missing.push('HARNESS_ACCOUNT_ID');
  if (missing.length) {
    throw new Error(
      `Missing required config: ${missing.join(', ')}. ` +
        `Set them in a .env file (checked cwd and parent directories) or the environment.`
    );
  }

  return {
    apiKey: apiKey as string,
    baseUrl: baseUrl.replace(/\/+$/, ''),
    accountId: accountId as string,
  };
}
