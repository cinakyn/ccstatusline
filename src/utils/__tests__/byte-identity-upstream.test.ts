import chalk from 'chalk';
import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import {
    beforeAll,
    describe,
    expect,
    it
} from 'vitest';

import type { Line } from '../../types/Group';
import type { PowerlineConfig } from '../../types/PowerlineConfig';
import type { RenderContext } from '../../types/RenderContext';
import {
    DEFAULT_SETTINGS,
    SettingsSchema,
    type Settings
} from '../../types/Settings';
import type { WidgetItem } from '../../types/Widget';
import { updateColorMap } from '../colors';
import { lineWidgets } from '../groups';
import {
    calculateMaxWidthsFromPreRendered,
    preRenderAllWidgets,
    renderStatusLine
} from '../renderer';

// Snapshot file captured against upstream/main by
// scripts/capture-byte-identity.ts (run from an upstream worktree). Regenerate
// whenever upstream/main moves and the maintainers' renderer semantics change.
interface SnapshotFixture {
    name: string;
    lines: WidgetItem[][];
    settingsOverrides: Partial<Settings>;
    terminalWidth: number;
    outputs: string[];
}

const SNAPSHOT_PATH = join(
    __dirname,
    '__snapshots__',
    'byte-identity-snapshot.json'
);

function loadFixtures(): SnapshotFixture[] {
    const raw = readFileSync(SNAPSHOT_PATH, 'utf8');
    return JSON.parse(raw) as SnapshotFixture[];
}

function wrapFlatAsV4(flatLines: WidgetItem[][]): Line[] {
    return flatLines.map(widgets => ({ groups: [{ continuousColor: true, widgets }] }));
}

function buildBranchSettings(fix: SnapshotFixture): Settings {
    const lines = wrapFlatAsV4(fix.lines);
    // Spread overrides first, then force groupsEnabled:false and the v4 lines
    // so the renderer takes the flat path (no grouped dispatch, no autoAlign
    // grouping math). powerline needs a deep merge so fixture-level overrides
    // don't drop fields that DEFAULT_SETTINGS.powerline supplies.
    const powerlineOverride = (fix.settingsOverrides.powerline ?? {}) as Partial<PowerlineConfig>;
    const powerline: PowerlineConfig = {
        ...DEFAULT_SETTINGS.powerline,
        ...powerlineOverride
    };
    const merged: Settings = {
        ...DEFAULT_SETTINGS,
        ...fix.settingsOverrides,
        lines,
        powerline,
        groupsEnabled: false
    };
    // Round-trip through zod so derived defaults (e.g. defaultGroupGap) match
    // what a freshly loaded v4 config would carry.
    return SettingsSchema.parse(merged);
}

function renderBranch(fix: SnapshotFixture): string[] {
    const settings = buildBranchSettings(fix);
    const context: RenderContext = {
        isPreview: false,
        terminalWidth: fix.terminalWidth,
        minimalist: settings.minimalistMode
    };
    const pre = preRenderAllWidgets(settings.lines, settings, context);
    const flat = calculateMaxWidthsFromPreRendered(pre, settings);

    const outputs: string[] = [];
    const globalSeparatorIndex = 0;
    const globalPowerlineThemeIndex = 0;
    for (let i = 0; i < settings.lines.length; i++) {
        const line = settings.lines[i];
        if (!line) {
            outputs.push('');
            continue;
        }
        const widgets = lineWidgets(line);
        const lineContext: RenderContext = {
            ...context,
            lineIndex: i,
            globalSeparatorIndex,
            globalPowerlineThemeIndex
        };
        outputs.push(renderStatusLine(
            widgets,
            settings,
            lineContext,
            pre[i] ?? [],
            flat,
            line
        ));
    }
    return outputs;
}

describe('byte-identity vs upstream/main (groupsEnabled:false)', () => {
    // Force the exact chalk state that ccstatusline.ts sets in production and
    // that the capture script used. Without this, chalk auto-detects piped
    // stdout and drops color codes, masking divergence.
    beforeAll(() => {
        chalk.level = 2;
        updateColorMap();
    });

    const fixtures = loadFixtures();

    for (const fix of fixtures) {
        it(`${fix.name}: per-line bytes match upstream/main`, () => {
            const actual = renderBranch(fix);
            expect(actual).toEqual(fix.outputs);
        });
    }
});