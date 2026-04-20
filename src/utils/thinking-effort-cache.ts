import {
    existsSync,
    mkdirSync,
    readFileSync,
    writeFileSync
} from 'node:fs';
import * as os from 'node:os';
import * as path from 'node:path';

import type { ResolvedThinkingEffort } from './jsonl-metadata';

// Keep cached effort for 30 days. Long enough that a session paused overnight
// retains its effort after `/clear`; short enough that stale cache files
// eventually age out for abandoned sessions.
const CACHE_TTL_MS = 30 * 24 * 60 * 60 * 1000;

interface CachedEnvelope {
    value: string;
    known: boolean;
    updated: number;
}

function getCacheDir(): string {
    return path.join(os.homedir(), '.cache', 'ccstatusline', 'thinking-effort');
}

function cacheFile(key: string): string {
    // Keys come from Claude Code (session_id) or from the cwd-derived fallback
    // ("cwd-<cwd>"). Both are scrubbed conservatively to avoid path traversal
    // even though session_id should be UUID-shaped in practice.
    const safe = key.replace(/[^a-zA-Z0-9_-]/g, '_');
    return path.join(getCacheDir(), `${safe}.json`);
}

function cwdCacheKey(cwd: string | undefined): string | undefined {
    if (!cwd)
        return undefined;
    // Prefixed so it cannot collide with a session_id value that happens to
    // equal a cwd string.
    return `cwd-${cwd}`;
}

function tryRead(key: string): ResolvedThinkingEffort | undefined {
    try {
        const raw = readFileSync(cacheFile(key), 'utf8');
        const parsed = JSON.parse(raw) as Partial<CachedEnvelope>;
        if (typeof parsed.updated !== 'number')
            return undefined;
        if (Date.now() - parsed.updated > CACHE_TTL_MS)
            return undefined;
        if (typeof parsed.value !== 'string' || typeof parsed.known !== 'boolean')
            return undefined;
        return { value: parsed.value, known: parsed.known };
    } catch {
        return undefined;
    }
}

export function writeCachedThinkingEffort(
    sessionId: string | undefined,
    cwd: string | undefined,
    effort: ResolvedThinkingEffort
): void {
    const cwdKey = cwdCacheKey(cwd);
    const keys: string[] = [];
    if (sessionId)
        keys.push(sessionId);
    if (cwdKey)
        keys.push(cwdKey);
    if (keys.length === 0)
        return;

    const envelope: CachedEnvelope = {
        value: effort.value,
        known: effort.known,
        updated: Date.now()
    };
    const serialized = JSON.stringify(envelope);

    try {
        const dir = getCacheDir();
        if (!existsSync(dir))
            mkdirSync(dir, { recursive: true });
    } catch {
        // Cache writes are best-effort — the statusline should never fail
        // because the cache dir is read-only or out of space.
        return;
    }

    for (const key of keys) {
        try {
            writeFileSync(cacheFile(key), serialized);
        } catch {
            // Continue to the next key if one write fails.
        }
    }
}

export function readCachedThinkingEffort(
    sessionId: string | undefined,
    cwd: string | undefined
): ResolvedThinkingEffort | undefined {
    // Session_id is checked first for per-session isolation when Claude Code
    // keeps the same id across renders. In practice session_id rotates across
    // `/clear`, so the cwd fallback is what actually catches that case — a
    // user who had /effort max active before /clear continues to see max
    // because the cwd-keyed entry survives the session_id rotation.
    if (sessionId) {
        const fromSession = tryRead(sessionId);
        if (fromSession)
            return fromSession;
    }
    const cwdKey = cwdCacheKey(cwd);
    if (cwdKey) {
        const fromCwd = tryRead(cwdKey);
        if (fromCwd)
            return fromCwd;
    }
    return undefined;
}