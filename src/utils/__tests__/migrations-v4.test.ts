import {
    describe,
    expect,
    it
} from 'vitest';

import { SettingsSchema } from '../../types/Settings';
import { migrateConfig } from '../migrations';

interface GroupShape {
    continuousColor?: boolean;
    gap?: unknown;
    widgets: Record<string, unknown>[];
}
interface LineShape { groups: GroupShape[] }

describe('migrations v3 → v4', () => {
    it('wraps a single v3 line with multiple widgets into one group', () => {
        const migrated = migrateConfig({
            version: 3,
            lines: [[
                { id: 'w-1', type: 'model', color: 'cyan' },
                { id: 'w-2', type: 'separator' },
                { id: 'w-3', type: 'git-branch' }
            ]]
        }, 4) as Record<string, unknown>;

        const lines = migrated.lines as LineShape[];
        expect(lines).toHaveLength(1);
        expect(lines[0]?.groups).toHaveLength(1);
        expect(lines[0]?.groups[0]?.widgets).toHaveLength(3);
        expect(lines[0]?.groups[0]?.widgets.map(w => w.type)).toEqual([
            'model',
            'separator',
            'git-branch'
        ]);
    });

    it('migrates multiple v3 lines each into a single-group v4 line', () => {
        const migrated = migrateConfig({
            version: 3,
            lines: [
                [{ id: 'a-1', type: 'model' }],
                [
                    { id: 'b-1', type: 'git-branch' },
                    { id: 'b-2', type: 'git-changes' }
                ],
                []
            ]
        }, 4) as Record<string, unknown>;

        const lines = migrated.lines as LineShape[];
        expect(lines).toHaveLength(3);
        expect(lines[0]?.groups).toHaveLength(1);
        expect(lines[0]?.groups[0]?.widgets).toHaveLength(1);
        expect(lines[1]?.groups).toHaveLength(1);
        expect(lines[1]?.groups[0]?.widgets).toHaveLength(2);
        expect(lines[2]?.groups).toHaveLength(1);
        expect(lines[2]?.groups[0]?.widgets).toHaveLength(0);
    });

    it('handles empty lines array', () => {
        const migrated = migrateConfig({
            version: 3,
            lines: []
        }, 4) as Record<string, unknown>;

        expect(migrated.lines).toEqual([]);
    });

    it('handles undefined lines by producing an empty lines array', () => {
        const migrated = migrateConfig({ version: 3 }, 4) as Record<string, unknown>;

        expect(migrated.lines).toEqual([]);
    });

    it('updates version field from 3 to 4', () => {
        const migrated = migrateConfig({
            version: 3,
            lines: [[{ id: 'w-1', type: 'model' }]]
        }, 4) as Record<string, unknown>;

        expect(migrated.version).toBe(4);
    });

    it('sets continuousColor: true on every migrated group', () => {
        const migrated = migrateConfig({
            version: 3,
            lines: [
                [{ id: 'a', type: 'model' }],
                [{ id: 'b', type: 'git-branch' }],
                [{ id: 'c', type: 'git-changes' }]
            ]
        }, 4) as Record<string, unknown>;

        const lines = migrated.lines as LineShape[];
        for (const line of lines) {
            for (const group of line.groups) {
                expect(group.continuousColor).toBe(true);
            }
        }
    });

    it('does not set gap so defaultGroupGap applies', () => {
        const migrated = migrateConfig({
            version: 3,
            lines: [[{ id: 'a', type: 'model' }]]
        }, 4) as Record<string, unknown>;

        const lines = migrated.lines as LineShape[];
        expect(lines[0]?.groups[0]).toBeDefined();
        expect(Object.prototype.hasOwnProperty.call(lines[0]?.groups[0] ?? {}, 'gap')).toBe(false);
    });

    it('passes through non-lines top-level fields unchanged', () => {
        const input = {
            version: 3,
            lines: [[{ id: 'w-1', type: 'model' }]],
            flexMode: 'full' as const,
            compactThreshold: 75,
            defaultSeparator: ' | ',
            powerline: {
                enabled: true,
                separators: ['\uE0B0'],
                separatorInvertBackground: [false],
                startCaps: ['\uE0B2'],
                endCaps: ['\uE0B0'],
                theme: 'custom',
                autoAlign: false,
                continueThemeAcrossLines: false
            },
            updatemessage: {
                message: 'previous message',
                remaining: 7
            }
        };

        const migrated = migrateConfig(input, 4) as Record<string, unknown>;

        expect(migrated.flexMode).toBe('full');
        expect(migrated.compactThreshold).toBe(75);
        expect(migrated.defaultSeparator).toBe(' | ');
        // B2: migration adds new vocabulary fields to powerline — verify old fields preserved
        const pl = migrated.powerline as Record<string, unknown>;
        expect(pl.enabled).toBe(true);
        expect(pl.separators).toEqual(['\uE0B0']);
        expect(pl.separatorInvertBackground).toEqual([false]);
        expect(pl.startCaps).toEqual(['\uE0B2']);
        expect(pl.endCaps).toEqual(['\uE0B0']);
        expect(pl.theme).toBe('custom');
        expect(pl.autoAlign).toBe(false);
        expect(pl.continueThemeAcrossLines).toBe(false);
        expect(migrated.updatemessage).toEqual({
            message: 'previous message',
            remaining: 7
        });
    });

    it('preserves separator widgets inside the migrated group', () => {
        const migrated = migrateConfig({
            version: 3,
            lines: [[
                { id: 'w-1', type: 'model' },
                { id: 'w-2', type: 'separator', character: '|' },
                { id: 'w-3', type: 'git-branch' }
            ]]
        }, 4) as Record<string, unknown>;

        const lines = migrated.lines as LineShape[];
        const widgets = lines[0]?.groups[0]?.widgets ?? [];
        expect(widgets).toHaveLength(3);
        expect(widgets[1]).toEqual({ id: 'w-2', type: 'separator', character: '|' });
    });

    it('preserves flex-separator widgets inside the migrated group', () => {
        const migrated = migrateConfig({
            version: 3,
            lines: [[
                { id: 'w-1', type: 'model' },
                { id: 'w-2', type: 'flex-separator' },
                { id: 'w-3', type: 'git-branch' }
            ]]
        }, 4) as Record<string, unknown>;

        const lines = migrated.lines as LineShape[];
        const widgets = lines[0]?.groups[0]?.widgets ?? [];
        expect(widgets).toHaveLength(3);
        expect(widgets[1]).toEqual({ id: 'w-2', type: 'flex-separator' });
    });

    it('preserves powerline.startCaps and powerline.endCaps', () => {
        const migrated = migrateConfig({
            version: 3,
            lines: [[{ id: 'w-1', type: 'model' }]],
            powerline: {
                enabled: true,
                separators: ['\uE0B0', '\uE0B1'],
                separatorInvertBackground: [false, false],
                startCaps: ['\uE0B2', '\uE0B6'],
                endCaps: ['\uE0B0', '\uE0B4'],
                theme: 'fire',
                autoAlign: true,
                continueThemeAcrossLines: true
            }
        }, 4) as Record<string, unknown>;

        // B2: migration adds new vocabulary fields; old fields must be preserved intact
        const pl = migrated.powerline as Record<string, unknown>;
        expect(pl.enabled).toBe(true);
        expect(pl.separators).toEqual(['\uE0B0', '\uE0B1']);
        expect(pl.separatorInvertBackground).toEqual([false, false]);
        expect(pl.startCaps).toEqual(['\uE0B2', '\uE0B6']);
        expect(pl.endCaps).toEqual(['\uE0B0', '\uE0B4']);
        expect(pl.theme).toBe('fire');
        expect(pl.autoAlign).toBe(true);
        expect(pl.continueThemeAcrossLines).toBe(true);
    });

    it('preserves the merge field on migrated widgets', () => {
        const migrated = migrateConfig({
            version: 3,
            lines: [[
                { id: 'w-1', type: 'model', merge: true },
                { id: 'w-2', type: 'custom-text', customText: 'hello', merge: 'no-padding' }
            ]]
        }, 4) as Record<string, unknown>;

        const lines = migrated.lines as LineShape[];
        const widgets = lines[0]?.groups[0]?.widgets ?? [];
        expect(widgets[0]?.merge).toBe(true);
        expect(widgets[1]?.merge).toBe('no-padding');
    });

    it('migrates a v1 config all the way through to v4 shape', () => {
        const v1 = {
            lines: [[
                { type: 'model', color: 'cyan' },
                { type: 'git-branch' }
            ]]
        };

        const migrated = migrateConfig(v1, 4) as Record<string, unknown>;

        expect(migrated.version).toBe(4);
        const lines = migrated.lines as LineShape[];
        expect(Array.isArray(lines)).toBe(true);
        for (const line of lines) {
            expect(line.groups).toHaveLength(1);
            expect(line.groups[0]?.continuousColor).toBe(true);
            expect(Array.isArray(line.groups[0]?.widgets)).toBe(true);
        }
        // v2 migration assigns ids to widgets; ensure they survived v3 and v4.
        expect(lines[0]?.groups[0]?.widgets[0]?.type).toBe('model');
        expect(lines[0]?.groups[0]?.widgets[1]?.type).toBe('git-branch');
    });

    it('produces output that validates against SettingsSchema', () => {
        const migrated = migrateConfig({
            version: 3,
            lines: [[
                { id: 'w-1', type: 'model', color: 'cyan' },
                { id: 'w-2', type: 'separator' },
                { id: 'w-3', type: 'git-branch' }
            ]]
        }, 4);

        const result = SettingsSchema.safeParse(migrated);
        expect(result.success).toBe(true);
    });
});