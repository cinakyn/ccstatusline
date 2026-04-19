import {
    describe,
    expect,
    it
} from 'vitest';

import type { Line } from '../../types/Group';
import {
    lineWidgets,
    writeAllGroupsWidgets,
    writeFlatWidgets
} from '../groups';

describe('lineWidgets', () => {
    it('returns an empty array when the line has no groups', () => {
        const line: Line = { groups: [] };
        expect(lineWidgets(line)).toEqual([]);
    });

    it('returns an empty array when every group is empty', () => {
        const line: Line = {
            groups: [
                { continuousColor: true, widgets: [] },
                { continuousColor: true, widgets: [] }
            ]
        };
        expect(lineWidgets(line)).toEqual([]);
    });

    it('returns the widgets of a single group in order', () => {
        const line: Line = {
            groups: [
                {
                    continuousColor: true,
                    widgets: [
                        { id: '1', type: 'model' },
                        { id: '2', type: 'separator' },
                        { id: '3', type: 'git-branch' }
                    ]
                }
            ]
        };

        expect(lineWidgets(line).map(w => w.id)).toEqual(['1', '2', '3']);
    });

    it('concatenates widgets across multiple groups preserving order', () => {
        const line: Line = {
            groups: [
                {
                    continuousColor: true,
                    widgets: [
                        { id: 'a1', type: 'model' },
                        { id: 'a2', type: 'separator' }
                    ]
                },
                {
                    continuousColor: false,
                    gap: '    ',
                    widgets: [
                        { id: 'b1', type: 'git-branch' }
                    ]
                },
                {
                    continuousColor: true,
                    widgets: [
                        { id: 'c1', type: 'git-changes' },
                        { id: 'c2', type: 'context-length' }
                    ]
                }
            ]
        };

        expect(lineWidgets(line).map(w => w.id)).toEqual(['a1', 'a2', 'b1', 'c1', 'c2']);
    });
});

describe('writeFlatWidgets', () => {
    it('creates a single-group line when existing is undefined', () => {
        const result = writeFlatWidgets(undefined, [
            { id: 'w1', type: 'model' }
        ]);

        expect(result.groups).toHaveLength(1);
        expect(result.groups[0]?.widgets.map(w => w.id)).toEqual(['w1']);
        expect(result.groups[0]?.continuousColor).toBe(true);
    });

    it('creates a single-group line when existing has no groups', () => {
        const result = writeFlatWidgets({ groups: [] }, [
            { id: 'w1', type: 'model' }
        ]);

        expect(result.groups).toHaveLength(1);
        expect(result.groups[0]?.widgets.map(w => w.id)).toEqual(['w1']);
    });

    it('preserves groups[0].continuousColor from existing line', () => {
        const existing: Line = { groups: [{ continuousColor: false, widgets: [{ id: 'old', type: 'model' }] }] };

        const result = writeFlatWidgets(existing, [{ id: 'new', type: 'model' }]);

        expect(result.groups[0]?.continuousColor).toBe(false);
    });

    it('preserves groups[0].gap from existing line', () => {
        const existing: Line = { groups: [{ continuousColor: true, gap: '----', widgets: [] }] };

        const result = writeFlatWidgets(existing, [{ id: 'w1', type: 'model' }]);

        expect(result.groups[0]?.gap).toBe('----');
    });

    it('does not invent a gap when existing groups[0] has none', () => {
        const existing: Line = { groups: [{ continuousColor: true, widgets: [] }] };

        const result = writeFlatWidgets(existing, [{ id: 'w1', type: 'model' }]);

        expect(result.groups[0]?.gap).toBeUndefined();
    });

    it('preserves groups[1..N] verbatim on a multi-group line', () => {
        // This is the Stage C1 round-trip invariant:
        // editing widgets in flat mode must NOT collapse or modify groups[1..N].
        const existing: Line = {
            groups: [
                { continuousColor: true, widgets: [{ id: 'g0-w1', type: 'model' }] },
                {
                    continuousColor: false,
                    gap: '   ',
                    widgets: [
                        { id: 'g1-w1', type: 'git-branch' },
                        { id: 'g1-w2', type: 'git-changes' }
                    ]
                },
                { continuousColor: true, widgets: [{ id: 'g2-w1', type: 'context-length' }] }
            ]
        };

        const newFlatWidgets = [
            { id: 'g0-w1-edited', type: 'model' as const }
        ];

        const result = writeFlatWidgets(existing, newFlatWidgets);

        // groups[0] is rewritten with the new widgets
        expect(result.groups).toHaveLength(3);
        expect(result.groups[0]?.widgets.map(w => w.id)).toEqual(['g0-w1-edited']);
        // groups[1] is preserved verbatim
        expect(result.groups[1]?.continuousColor).toBe(false);
        expect(result.groups[1]?.gap).toBe('   ');
        expect(result.groups[1]?.widgets.map(w => w.id)).toEqual(['g1-w1', 'g1-w2']);
        // groups[2] is preserved verbatim
        expect(result.groups[2]?.continuousColor).toBe(true);
        expect(result.groups[2]?.widgets.map(w => w.id)).toEqual(['g2-w1']);
    });

    it('round-trip: flat-mode delete then toggle-on preserves non-zero groups', () => {
        // Simulate the full user flow:
        //   1. user has 3 groups (from groupsEnabled=true editing)
        //   2. user toggles groupsEnabled off
        //   3. user deletes a widget in flat mode (which edits only groups[0])
        //   4. user toggles groupsEnabled back on
        //   5. groups[1] and groups[2] must still be present and unchanged
        const original: Line = {
            groups: [
                {
                    continuousColor: true,
                    widgets: [
                        { id: 'g0-a', type: 'model' },
                        { id: 'g0-b', type: 'separator' }
                    ]
                },
                {
                    continuousColor: false,
                    gap: '---',
                    widgets: [{ id: 'g1-a', type: 'git-branch' }]
                },
                { continuousColor: true, widgets: [{ id: 'g2-a', type: 'context-length' }] }
            ]
        };

        // Flat mode feed: only groups[0].widgets is visible
        const flatFeed = original.groups[0]?.widgets ?? [];
        expect(flatFeed.map(w => w.id)).toEqual(['g0-a', 'g0-b']);

        // Flat-mode delete: remove 'g0-b'
        const afterDelete = flatFeed.filter(w => w.id !== 'g0-b');

        // Write back through writeFlatWidgets
        const roundTripped = writeFlatWidgets(original, afterDelete);

        // Toggle back on and verify groups[1..N] untouched
        expect(roundTripped.groups).toHaveLength(3);
        expect(roundTripped.groups[0]?.widgets.map(w => w.id)).toEqual(['g0-a']);
        expect(roundTripped.groups[1]).toEqual(original.groups[1]);
        expect(roundTripped.groups[2]).toEqual(original.groups[2]);
    });
});

describe('writeAllGroupsWidgets', () => {
    it('creates a single-group line when existing is undefined', () => {
        const result = writeAllGroupsWidgets(undefined, [{ id: 'w1', type: 'model' }]);

        expect(result.groups).toHaveLength(1);
        expect(result.groups[0]?.widgets.map(w => w.id)).toEqual(['w1']);
        expect(result.groups[0]?.continuousColor).toBe(true);
    });

    it('creates a single-group line when existing has no groups', () => {
        const result = writeAllGroupsWidgets({ groups: [] }, [{ id: 'w1', type: 'model' }]);

        expect(result.groups).toHaveLength(1);
        expect(result.groups[0]?.widgets.map(w => w.id)).toEqual(['w1']);
    });

    it('preserves multi-group structure when updating by id (ColorMenu round-trip)', () => {
        // ColorMenu flattens groups via lineWidgets(), edits colors in place,
        // and hands the flat array back. writeAllGroupsWidgets must put each
        // widget back into its original group — never duplicate, never drop.
        const existing: Line = {
            groups: [
                { continuousColor: true, widgets: [{ id: 'g0-a', type: 'model' }] },
                {
                    continuousColor: false,
                    gap: '  ',
                    widgets: [
                        { id: 'g1-a', type: 'git-branch' },
                        { id: 'g1-b', type: 'git-changes' }
                    ]
                },
                { continuousColor: true, widgets: [{ id: 'g2-a', type: 'context-length' }] }
            ]
        };
        const updated = [
            { id: 'g0-a', type: 'model' as const, color: 'red' },
            { id: 'g1-a', type: 'git-branch' as const, color: 'red' },
            { id: 'g1-b', type: 'git-changes' as const, color: 'red' },
            { id: 'g2-a', type: 'context-length' as const, color: 'red' }
        ];

        const result = writeAllGroupsWidgets(existing, updated);

        expect(result.groups).toHaveLength(3);
        expect(result.groups[0]?.widgets.map(w => w.id)).toEqual(['g0-a']);
        expect(result.groups[1]?.widgets.map(w => w.id)).toEqual(['g1-a', 'g1-b']);
        expect(result.groups[2]?.widgets.map(w => w.id)).toEqual(['g2-a']);
        expect(result.groups[1]?.continuousColor).toBe(false);
        expect(result.groups[1]?.gap).toBe('  ');
        // Every widget got the new color
        for (const g of result.groups) {
            for (const w of g.widgets) {
                expect(w).toMatchObject({ color: 'red' });
            }
        }
    });

    it('leaves widgets not in the incoming map untouched', () => {
        const existing: Line = {
            groups: [
                { continuousColor: true, widgets: [{ id: 'a', type: 'model' }] },
                { continuousColor: true, widgets: [{ id: 'b', type: 'git-branch', color: 'green' }] }
            ]
        };

        // Incoming only updates `a` — `b` must survive unchanged.
        const result = writeAllGroupsWidgets(existing, [{ id: 'a', type: 'model', color: 'blue' }]);

        expect(result.groups[0]?.widgets[0]).toMatchObject({ id: 'a', color: 'blue' });
        expect(result.groups[1]?.widgets[0]).toMatchObject({ id: 'b', color: 'green' });
    });
});