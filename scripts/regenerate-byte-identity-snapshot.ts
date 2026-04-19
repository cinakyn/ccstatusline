import chalk from 'chalk';
import {
    readFileSync,
    writeFileSync
} from 'node:fs';
import { join } from 'node:path';

import type { Line } from '../src/types/Group';
import type { PowerlineConfig } from '../src/types/PowerlineConfig';
import type { RenderContext } from '../src/types/RenderContext';
import {
    DEFAULT_SETTINGS,
    SettingsSchema,
    type Settings
} from '../src/types/Settings';
import type { WidgetItem } from '../src/types/Widget';
import { updateColorMap } from '../src/utils/colors';
import { lineWidgets } from '../src/utils/groups';
import {
    calculateMaxWidthsFromPreRendered,
    preRenderAllWidgets,
    renderStatusLine
} from '../src/utils/renderer';

// Regenerate src/utils/__tests__/__snapshots__/byte-identity-snapshot.json by
// re-rendering every fixture against the CURRENT renderer and overwriting
// each fixture's `outputs` array. Run this whenever an intentional renderer
// change (e.g. the bold-before-sep/cap fix) shifts the expected bytes, so the
// snapshot continues to pin *our* intended output.

interface SnapshotFixture {
    name: string;
    lines: WidgetItem[][];
    settingsOverrides: Partial<Settings>;
    terminalWidth: number;
    outputs: string[];
}

const SNAPSHOT_PATH = join(
    __dirname,
    '..',
    'src',
    'utils',
    '__tests__',
    '__snapshots__',
    'byte-identity-snapshot.json'
);

function wrapFlatAsV4(flatLines: WidgetItem[][]): Line[] {
    return flatLines.map(widgets => ({ groups: [{ continuousColor: true, widgets }] }));
}

function buildBranchSettings(fix: SnapshotFixture): Settings {
    const lines = wrapFlatAsV4(fix.lines);
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

function main(): void {
    chalk.level = 2;
    updateColorMap();

    const raw = readFileSync(SNAPSHOT_PATH, 'utf8');
    const fixtures = JSON.parse(raw) as SnapshotFixture[];

    let changed = 0;
    for (const fix of fixtures) {
        const before = JSON.stringify(fix.outputs);
        fix.outputs = renderBranch(fix);
        const after = JSON.stringify(fix.outputs);
        if (before !== after) {
            changed += 1;
            console.error(`[updated] ${fix.name}`);
        }
    }

    writeFileSync(SNAPSHOT_PATH, JSON.stringify(fixtures, null, 2) + '\n', 'utf8');
    console.error(`Wrote ${fixtures.length} fixtures (${changed} changed) to ${SNAPSHOT_PATH}`);
}

main();