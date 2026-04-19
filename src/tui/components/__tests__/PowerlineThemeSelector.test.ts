import { render } from 'ink';
import React from 'react';
import {
    afterEach,
    describe,
    expect,
    it,
    vi
} from 'vitest';

import { DEFAULT_SETTINGS } from '../../../types/Settings';
import { getPowerlineThemes } from '../../../utils/colors';
import { lineWidgets } from '../../../utils/groups';
import {
    createMockStdin,
    createMockStdout,
    flushInk
} from '../../__tests__/helpers/ink-test-utils';
import {
    PowerlineThemeSelector,
    applyCustomPowerlineTheme,
    buildPowerlineThemeItems,
    type PowerlineThemeSelectorProps
} from '../PowerlineThemeSelector';

describe('PowerlineThemeSelector helpers', () => {
    afterEach(() => {
        vi.restoreAllMocks();
    });

    it('builds powerline theme list items with original theme sublabels', () => {
        const items = buildPowerlineThemeItems(['gruvbox', 'onedark'], 'onedark');

        expect(items).toHaveLength(2);
        expect(items[0]).toMatchObject({
            label: 'Gruvbox',
            value: 'gruvbox'
        });
        expect(items[1]).toMatchObject({
            label: 'One Dark',
            sublabel: '(original)',
            value: 'onedark'
        });
    });

    it('copies a built-in theme into widget colors and switches to custom mode', () => {
        const settings = {
            ...DEFAULT_SETTINGS,
            colorLevel: 2 as const,
            powerline: {
                ...DEFAULT_SETTINGS.powerline,
                theme: 'gruvbox'
            }
        };

        const updatedSettings = applyCustomPowerlineTheme(settings, 'gruvbox');

        expect(updatedSettings).not.toBeNull();
        expect(updatedSettings?.powerline.theme).toBe('custom');
        const updatedFirstLine = updatedSettings?.lines[0];
        const originalFirstLine = settings.lines[0];
        expect(updatedFirstLine).toBeDefined();
        expect(originalFirstLine).toBeDefined();
        if (!updatedFirstLine || !originalFirstLine) {
            throw new Error('Expected first line to exist in both original and updated settings');
        }
        const updatedWidgets = lineWidgets(updatedFirstLine);
        const originalWidgets = lineWidgets(originalFirstLine);
        expect(updatedWidgets[0]).toMatchObject({
            color: 'ansi256:16',
            backgroundColor: 'ansi256:167'
        });
        expect(updatedWidgets[1]).toEqual(originalWidgets[1]);
        expect(updatedWidgets[2]).toMatchObject({
            color: 'ansi256:235',
            backgroundColor: 'ansi256:214'
        });
    });

    it('returns null when the requested theme cannot be customized', () => {
        expect(applyCustomPowerlineTheme(DEFAULT_SETTINGS, 'custom')).toBeNull();
        expect(applyCustomPowerlineTheme(DEFAULT_SETTINGS, 'missing-theme')).toBeNull();
    });

    it('does not advance the color index across a merge chain (chain shares slot)', () => {
        // `merge: true` on widget N suppresses index advance so the NEXT widget
        // inherits the same slot — the whole chain paints in one color block.
        // If applyCustomPowerlineTheme advanced on every widget instead, the
        // copied colors would disagree with what renderer produces from the
        // same theme.
        const settings = {
            ...DEFAULT_SETTINGS,
            colorLevel: 2 as const,
            lines: [{
                groups: [{
                    continuousColor: true,
                    widgets: [
                        { id: 'a', type: 'custom-text' as const, customText: 'A', merge: true },
                        { id: 'b', type: 'custom-text' as const, customText: 'B' },
                        { id: 'c', type: 'custom-text' as const, customText: 'C' }
                    ]
                }]
            }],
            powerline: { ...DEFAULT_SETTINGS.powerline, theme: 'gruvbox' }
        };

        const updated = applyCustomPowerlineTheme(settings, 'gruvbox');
        const widgets = updated?.lines[0]?.groups[0]?.widgets ?? [];

        expect(widgets).toHaveLength(3);
        // a(merge) + b share slot 0; c advances to slot 1
        expect(widgets[0]?.backgroundColor).toBe(widgets[1]?.backgroundColor);
        expect(widgets[0]?.color).toBe(widgets[1]?.color);
        expect(widgets[2]?.backgroundColor).not.toBe(widgets[0]?.backgroundColor);
    });

    it('resets the color index at a group with continuousColor=false', () => {
        const settings = {
            ...DEFAULT_SETTINGS,
            colorLevel: 2 as const,
            lines: [{
                groups: [
                    {
                        continuousColor: true,
                        widgets: [
                            { id: 'a', type: 'custom-text' as const, customText: 'A' },
                            { id: 'b', type: 'custom-text' as const, customText: 'B' }
                        ]
                    },
                    {
                        continuousColor: false,
                        widgets: [
                            { id: 'c', type: 'custom-text' as const, customText: 'C' }
                        ]
                    }
                ]
            }],
            powerline: { ...DEFAULT_SETTINGS.powerline, theme: 'gruvbox' }
        };

        const updated = applyCustomPowerlineTheme(settings, 'gruvbox');
        const g0 = updated?.lines[0]?.groups[0]?.widgets ?? [];
        const g1 = updated?.lines[0]?.groups[1]?.widgets ?? [];

        // continuousColor=false group restarts at slot 0 → same colors as widget a
        expect(g1[0]).toMatchObject({ color: g0[0]?.color, backgroundColor: g0[0]?.backgroundColor });
    });

    it('carries the color index across lines when continueThemeAcrossLines=true', () => {
        const settings = {
            ...DEFAULT_SETTINGS,
            colorLevel: 2 as const,
            lines: [
                {
                    groups: [{
                        continuousColor: true,
                        widgets: [
                            { id: 'a', type: 'custom-text' as const, customText: 'A' },
                            { id: 'b', type: 'custom-text' as const, customText: 'B' }
                        ]
                    }]
                },
                {
                    groups: [{
                        continuousColor: true,
                        widgets: [
                            { id: 'c', type: 'custom-text' as const, customText: 'C' }
                        ]
                    }]
                }
            ],
            powerline: { ...DEFAULT_SETTINGS.powerline, theme: 'gruvbox', continueThemeAcrossLines: true }
        };

        const updated = applyCustomPowerlineTheme(settings, 'gruvbox');
        const l0 = updated?.lines[0]?.groups[0]?.widgets ?? [];
        const l1 = updated?.lines[1]?.groups[0]?.widgets ?? [];

        // Line 2's first widget should land on slot 2 (after a=0, b=1) — not slot 0.
        expect(l1[0]?.backgroundColor).not.toBe(l0[0]?.backgroundColor);
        expect(l1[0]?.backgroundColor).not.toBe(l0[1]?.backgroundColor);
    });

    it('previews the highlighted theme once without triggering update-depth warnings', async () => {
        const themes = getPowerlineThemes();

        expect(themes.length).toBeGreaterThan(1);

        const stdin = createMockStdin();
        const stdout = createMockStdout();
        const stderr = createMockStdout();
        const onUpdate = vi.fn<PowerlineThemeSelectorProps['onUpdate']>();
        const onBack = vi.fn();
        const consoleErrorSpy = vi.spyOn(console, 'error').mockImplementation(() => undefined);
        const instance = render(
            React.createElement(PowerlineThemeSelector, {
                settings: {
                    ...DEFAULT_SETTINGS,
                    powerline: {
                        ...DEFAULT_SETTINGS.powerline,
                        enabled: true,
                        theme: themes[0]
                    }
                },
                onUpdate,
                onBack
            }),
            {
                stdin,
                stdout,
                stderr,
                debug: true,
                exitOnCtrlC: false,
                patchConsole: false
            }
        );

        try {
            await flushInk();
            expect(onUpdate).not.toHaveBeenCalled();

            stdin.write('\u001B[B');
            await flushInk();

            expect(onUpdate).toHaveBeenCalledTimes(1);
            expect(onUpdate.mock.calls[0]?.[0]?.powerline.theme).toBe(themes[1]);

            const maximumUpdateDepthWarnings = consoleErrorSpy.mock.calls.filter((call) => {
                return call.some(arg => typeof arg === 'string' && arg.includes('Maximum update depth exceeded'));
            });

            expect(maximumUpdateDepthWarnings).toHaveLength(0);
        } finally {
            instance.unmount();
            instance.cleanup();
            stdin.destroy();
            stdout.destroy();
            stderr.destroy();
        }
    });
});