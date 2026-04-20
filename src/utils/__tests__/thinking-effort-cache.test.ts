import {
    mkdtempSync,
    rmSync
} from 'node:fs';
import * as os from 'node:os';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import {
    afterEach,
    beforeEach,
    describe,
    expect,
    it,
    vi
} from 'vitest';

import {
    readCachedThinkingEffort,
    writeCachedThinkingEffort
} from '../thinking-effort-cache';

describe('thinking-effort cache', () => {
    let fakeHome: string;

    beforeEach(() => {
        fakeHome = mkdtempSync(join(tmpdir(), 'tec-'));
        vi.spyOn(os, 'homedir').mockReturnValue(fakeHome);
    });

    afterEach(() => {
        vi.restoreAllMocks();
        rmSync(fakeHome, { recursive: true, force: true });
    });

    it('round-trips a known effort under a given session_id', () => {
        writeCachedThinkingEffort('sess-1', undefined, { value: 'max', known: true });
        expect(readCachedThinkingEffort('sess-1', undefined)).toEqual({ value: 'max', known: true });
    });

    it('returns undefined for a missing session_id', () => {
        expect(readCachedThinkingEffort('unknown', undefined)).toBeUndefined();
    });

    it('returns undefined when both sessionId and cwd are missing on read or write', () => {
        writeCachedThinkingEffort(undefined, undefined, { value: 'high', known: true });
        expect(readCachedThinkingEffort(undefined, undefined)).toBeUndefined();
    });

    it('keeps separate cache files per session_id', () => {
        writeCachedThinkingEffort('sess-a', undefined, { value: 'max', known: true });
        writeCachedThinkingEffort('sess-b', undefined, { value: 'high', known: true });
        expect(readCachedThinkingEffort('sess-a', undefined)).toEqual({ value: 'max', known: true });
        expect(readCachedThinkingEffort('sess-b', undefined)).toEqual({ value: 'high', known: true });
    });

    it('expires entries older than the TTL', () => {
        const now = Date.now();
        vi.spyOn(Date, 'now').mockReturnValue(now);
        writeCachedThinkingEffort('sess-old', undefined, { value: 'max', known: true });

        // Advance past 30-day TTL.
        vi.spyOn(Date, 'now').mockReturnValue(now + 31 * 24 * 60 * 60 * 1000);
        expect(readCachedThinkingEffort('sess-old', undefined)).toBeUndefined();
    });

    it('sanitises session ids so malformed values cannot escape the cache dir', () => {
        // The sanitiser replaces everything that is not [A-Za-z0-9_-] with
        // underscore. Two malicious ids that share a sanitised form must
        // collide to exactly one cache file rather than traversing up.
        writeCachedThinkingEffort('../evil', undefined, { value: 'max', known: true });
        expect(readCachedThinkingEffort('..\\evil', undefined)).toEqual({ value: 'max', known: true });
    });

    it('falls back to cwd-keyed entry when session_id rotates (survives /clear)', () => {
        // Simulate the pre-/clear render: write under session A + cwd.
        writeCachedThinkingEffort('sess-A', '/Users/me/proj', { value: 'max', known: true });
        // Simulate the post-/clear render: Claude Code rotates session_id to B
        // but cwd is unchanged. The transcript read missed (no /effort line
        // in the new session), so the widget consults the cache with (B, cwd).
        expect(readCachedThinkingEffort('sess-B', '/Users/me/proj')).toEqual({ value: 'max', known: true });
    });

    it('prefers session_id cache over cwd fallback when both exist for the same session', () => {
        // Two sessions in the same cwd set different efforts. Session A should
        // keep seeing its own value via session_id cache, not the most recent
        // cwd write.
        writeCachedThinkingEffort('sess-A', '/Users/me/proj', { value: 'max', known: true });
        writeCachedThinkingEffort('sess-B', '/Users/me/proj', { value: 'high', known: true });
        expect(readCachedThinkingEffort('sess-A', '/Users/me/proj')).toEqual({ value: 'max', known: true });
        expect(readCachedThinkingEffort('sess-B', '/Users/me/proj')).toEqual({ value: 'high', known: true });
    });

    it('writes under cwd alone when session_id is missing', () => {
        writeCachedThinkingEffort(undefined, '/Users/me/proj', { value: 'xhigh', known: true });
        expect(readCachedThinkingEffort('any-sess', '/Users/me/proj')).toEqual({ value: 'xhigh', known: true });
    });

    it('writes under session_id alone when cwd is missing', () => {
        writeCachedThinkingEffort('sess-lone', undefined, { value: 'low', known: true });
        expect(readCachedThinkingEffort('sess-lone', undefined)).toEqual({ value: 'low', known: true });
    });

    it('cwd keys cannot collide with session_id values that happen to equal a cwd string', () => {
        // A malicious/coincidental session_id that equals the cwd string must
        // not accidentally read the cwd-keyed entry.
        writeCachedThinkingEffort(undefined, '/a/b', { value: 'max', known: true });
        // "/a/b" as a session_id sanitises to "_a_b.json", which is a different
        // file than "cwd-_a_b.json".
        expect(readCachedThinkingEffort('/a/b', undefined)).toBeUndefined();
    });

    it('cwd fallback respects TTL independently of session_id entries', () => {
        const now = Date.now();
        vi.spyOn(Date, 'now').mockReturnValue(now);
        writeCachedThinkingEffort(undefined, '/Users/me/proj', { value: 'max', known: true });

        vi.spyOn(Date, 'now').mockReturnValue(now + 31 * 24 * 60 * 60 * 1000);
        expect(readCachedThinkingEffort('fresh-sess', '/Users/me/proj')).toBeUndefined();
    });
});