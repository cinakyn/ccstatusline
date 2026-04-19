import {
    mkdtempSync,
    rmSync,
    writeFileSync
} from 'fs';
import { tmpdir } from 'os';
import { join } from 'path';
import {
    afterEach,
    beforeEach,
    describe,
    expect,
    it
} from 'vitest';

import {
    getTranscriptThinkingEffort,
    normalizeThinkingEffort
} from '../jsonl-metadata';

function makeTranscript(lines: Record<string, unknown>[]): string {
    return lines.map(obj => JSON.stringify(obj)).join('\n') + '\n';
}

describe('normalizeThinkingEffort', () => {
    it('returns undefined for empty input', () => {
        expect(normalizeThinkingEffort(undefined)).toBeUndefined();
        expect(normalizeThinkingEffort('')).toBeUndefined();
    });

    it('marks known efforts (low, medium, high, xhigh, max) as known', () => {
        for (const k of ['low', 'medium', 'high', 'xhigh', 'max']) {
            expect(normalizeThinkingEffort(k)).toEqual({ value: k, known: true });
        }
    });

    it('marks plausible-looking unknown values as unknown', () => {
        expect(normalizeThinkingEffort('turbo')).toEqual({ value: 'turbo', known: false });
    });

    it('rejects clearly garbage values', () => {
        expect(normalizeThinkingEffort('!!!')).toBeUndefined();
        // too short
        expect(normalizeThinkingEffort('a')).toBeUndefined();
    });

    it('lowercases before matching', () => {
        expect(normalizeThinkingEffort('MAX')).toEqual({ value: 'max', known: true });
    });
});

describe('getTranscriptThinkingEffort — /effort slash command', () => {
    let dir: string;

    beforeEach(() => {
        dir = mkdtempSync(join(tmpdir(), 'jsonl-md-'));
    });

    afterEach(() => {
        rmSync(dir, { recursive: true, force: true });
    });

    function write(name: string, content: string): string {
        const p = join(dir, name);
        writeFileSync(p, content);
        return p;
    }

    it('detects `/effort max` command output', () => {
        const transcript = write('t.jsonl', makeTranscript([{ message: { content: '<local-command-stdout>Set effort level to max (this session only): ...</local-command-stdout>' } }]));
        expect(getTranscriptThinkingEffort(transcript)).toEqual({ value: 'max', known: true });
    });

    it('detects `/effort xhigh`', () => {
        const transcript = write('t.jsonl', makeTranscript([{ message: { content: '<local-command-stdout>Set effort level to xhigh</local-command-stdout>' } }]));
        expect(getTranscriptThinkingEffort(transcript)).toEqual({ value: 'xhigh', known: true });
    });

    it('prefers the most recent command (scans backward)', () => {
        const transcript = write('t.jsonl', makeTranscript([
            { message: { content: '<local-command-stdout>Set effort level to low</local-command-stdout>' } },
            { message: { content: '<local-command-stdout>Set effort level to high</local-command-stdout>' } }
        ]));
        expect(getTranscriptThinkingEffort(transcript)).toEqual({ value: 'high', known: true });
    });

    it('still reads `Set model to <id> with <effort> effort` when no /effort command is present', () => {
        const transcript = write('t.jsonl', makeTranscript([{ message: { content: '<local-command-stdout>Set model to Opus with max effort</local-command-stdout>' } }]));
        expect(getTranscriptThinkingEffort(transcript)).toEqual({ value: 'max', known: true });
    });

    it('returns undefined when no command matches', () => {
        const transcript = write('t.jsonl', makeTranscript([
            { message: { content: 'some user message' } },
            { message: { content: 'some assistant reply' } }
        ]));
        expect(getTranscriptThinkingEffort(transcript)).toBeUndefined();
    });

    it('returns undefined for missing transcript path', () => {
        expect(getTranscriptThinkingEffort(undefined)).toBeUndefined();
    });
});