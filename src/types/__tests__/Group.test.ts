import {
    describe,
    expect,
    it
} from 'vitest';

import {
    GroupSchema,
    LineSchema
} from '../Group';

describe('GroupSchema', () => {
    it('parses a valid group with widgets', () => {
        const parsed = GroupSchema.parse({
            widgets: [
                { id: '1', type: 'model' },
                { id: '2', type: 'git-branch' }
            ]
        });

        expect(parsed.widgets).toHaveLength(2);
        expect(parsed.widgets[0]?.id).toBe('1');
        expect(parsed.widgets[1]?.type).toBe('git-branch');
    });

    it('parses a group with optional gap and continuousColor', () => {
        const parsed = GroupSchema.parse({
            gap: '    ',
            continuousColor: false,
            widgets: [
                { id: 'a', type: 'model' }
            ]
        });

        expect(parsed.gap).toBe('    ');
        expect(parsed.continuousColor).toBe(false);
    });

    it('defaults continuousColor to true when omitted', () => {
        const parsed = GroupSchema.parse({
            widgets: [
                { id: '1', type: 'model' }
            ]
        });

        expect(parsed.continuousColor).toBe(true);
        expect(parsed.gap).toBeUndefined();
    });

    it('rejects a group whose widgets field is not an array', () => {
        const result = GroupSchema.safeParse({ widgets: 'nope' });
        expect(result.success).toBe(false);
    });

    it('rejects a group missing the widgets field entirely', () => {
        const result = GroupSchema.safeParse({});
        expect(result.success).toBe(false);
    });
});

describe('LineSchema', () => {
    it('parses a valid line with a single group', () => {
        const parsed = LineSchema.parse({
            groups: [
                { widgets: [{ id: '1', type: 'model' }] }
            ]
        });

        expect(parsed.groups).toHaveLength(1);
        expect(parsed.groups[0]?.widgets[0]?.id).toBe('1');
        expect(parsed.groups[0]?.continuousColor).toBe(true);
    });

    it('parses a line with multiple groups', () => {
        const parsed = LineSchema.parse({
            groups: [
                { widgets: [{ id: '1', type: 'model' }] },
                {
                    gap: '  ',
                    continuousColor: false,
                    widgets: [
                        { id: '2', type: 'git-branch' },
                        { id: '3', type: 'git-changes' }
                    ]
                }
            ]
        });

        expect(parsed.groups).toHaveLength(2);
        expect(parsed.groups[1]?.gap).toBe('  ');
        expect(parsed.groups[1]?.continuousColor).toBe(false);
        expect(parsed.groups[1]?.widgets).toHaveLength(2);
    });

    it('parses a line with an empty groups array', () => {
        const parsed = LineSchema.parse({ groups: [] });
        expect(parsed.groups).toEqual([]);
    });

    it('rejects a line whose groups field is not an array', () => {
        const result = LineSchema.safeParse({ groups: 'nope' });
        expect(result.success).toBe(false);
    });
});