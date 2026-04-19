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
import {
    createMockStdin,
    createMockStdout,
    flushInk
} from '../../__tests__/helpers/ink-test-utils';
import {
    PowerlineSetup,
    buildPowerlineSetupMenuItems,
    getCapDisplay,
    getSeparatorDisplay,
    getThemeDisplay,
    type PowerlineSetupProps
} from '../PowerlineSetup';

describe('PowerlineSetup helpers', () => {
    afterEach(() => {
        vi.restoreAllMocks();
    });

    it('formats separator, cap, and theme display values', () => {
        const config = {
            ...DEFAULT_SETTINGS.powerline,
            enabled: true,
            separators: ['\uE0B4'],
            startCaps: ['\uE0B2'],
            endCaps: ['\uE0B0'],
            theme: 'gruvbox'
        };

        expect(getSeparatorDisplay(config)).toBe('\uE0B4 - Round Right');
        expect(getCapDisplay(config, 'start')).toBe('\uE0B2 - Triangle');
        expect(getCapDisplay(config, 'end')).toBe('\uE0B0 - Triangle');
        expect(getThemeDisplay(config)).toBe('Gruvbox');
    });

    it('builds powerline setup items with disabled states and sublabels', () => {
        const disabledItems = buildPowerlineSetupMenuItems({
            ...DEFAULT_SETTINGS.powerline,
            enabled: false
        });

        expect(disabledItems.every(item => item.disabled)).toBe(true);

        const enabledItems = buildPowerlineSetupMenuItems({
            ...DEFAULT_SETTINGS.powerline,
            enabled: true,
            separators: ['\uE0B0', '\uE0B4'],
            startCaps: [],
            endCaps: ['\uE0BC'],
            theme: undefined
        });

        expect(enabledItems[0]).toMatchObject({
            label: 'Separator  ',
            sublabel: '(multiple)',
            disabled: false
        });
        expect(enabledItems[1]).toMatchObject({
            label: 'Start Cap  ',
            sublabel: '(none)'
        });
        expect(enabledItems[2]).toMatchObject({
            label: 'End Cap    ',
            sublabel: '(\uE0BC - Diagonal)'
        });
        expect(enabledItems[3]).toMatchObject({
            label: 'Themes     ',
            sublabel: '(Custom)'
        });
    });

    async function mountSetup(settingsOverrides: Partial<typeof DEFAULT_SETTINGS> = {}) {
        const stdin = createMockStdin();
        const stdout = createMockStdout();
        const stderr = createMockStdout();
        const onUpdate = vi.fn<PowerlineSetupProps['onUpdate']>();
        const instance = render(
            React.createElement(PowerlineSetup, {
                settings: {
                    ...DEFAULT_SETTINGS,
                    ...settingsOverrides,
                    powerline: {
                        ...DEFAULT_SETTINGS.powerline,
                        enabled: true,
                        ...(settingsOverrides.powerline ?? {})
                    }
                },
                powerlineFontStatus: { installed: true },
                onUpdate,
                onBack: vi.fn(),
                onInstallFonts: vi.fn(),
                installingFonts: false,
                fontInstallMessage: null,
                onClearMessage: vi.fn()
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
        await flushInk();
        return {
            stdin, stdout, stderr, onUpdate, instance,
            cleanup() {
                instance.unmount();
                instance.cleanup();
                stdin.destroy();
                stdout.destroy();
                stderr.destroy();
            }
        };
    }

    it('shows the Groups Enabled row when powerline is on', async () => {
        const h = await mountSetup({ groupsEnabled: false });
        try {
            expect(h.stdout.getOutput()).toContain('Groups Enabled:');
            expect(h.stdout.getOutput()).toContain('✗ Disabled');
        } finally {
            h.cleanup();
        }
    });

    it('toggles groupsEnabled on when (g) is pressed', async () => {
        const h = await mountSetup({ groupsEnabled: false });
        try {
            h.stdin.write('g');
            await flushInk();
            expect(h.onUpdate).toHaveBeenCalledWith(expect.objectContaining({ groupsEnabled: true }));
        } finally {
            h.cleanup();
        }
    });

    it('toggles groupsEnabled off when (g) is pressed while enabled', async () => {
        const h = await mountSetup({ groupsEnabled: true });
        try {
            h.stdin.write('g');
            await flushInk();
            expect(h.onUpdate).toHaveBeenCalledWith(expect.objectContaining({ groupsEnabled: false }));
        } finally {
            h.cleanup();
        }
    });

    it('shows the Group Gap row only when groupsEnabled is true', async () => {
        const on = await mountSetup({ groupsEnabled: true, defaultGroupGap: '  ' });
        try {
            expect(on.stdout.getOutput()).toContain('Group Gap:');
        } finally {
            on.cleanup();
        }
        const off = await mountSetup({ groupsEnabled: false });
        try {
            expect(off.stdout.getOutput()).not.toContain('Group Gap:');
        } finally {
            off.cleanup();
        }
    });

    it('enters the group-gap editor when (p) is pressed and saves on Enter', async () => {
        const h = await mountSetup({ groupsEnabled: true, defaultGroupGap: '' });
        try {
            h.stdin.write('p');
            await flushInk();
            expect(h.stdout.getOutput()).toContain('Enter default group gap');

            h.stdin.write(' ');
            await flushInk();
            h.stdin.write('\r');
            await flushInk();

            expect(h.onUpdate).toHaveBeenCalledWith(expect.objectContaining({ defaultGroupGap: ' ' }));
        } finally {
            h.cleanup();
        }
    });

    it('cancels the group-gap editor on Esc without updating', async () => {
        const h = await mountSetup({ groupsEnabled: true, defaultGroupGap: 'orig' });
        try {
            h.stdin.write('p');
            await flushInk();
            h.stdin.write('x');
            await flushInk();
            h.stdin.write('\x1B');
            await flushInk();

            expect(h.onUpdate).not.toHaveBeenCalled();
            // returns to main view
            expect(h.stdout.getOutput()).toContain('Group Gap:');
        } finally {
            h.cleanup();
        }
    });

    it('does not react to (g) or (p) while powerline is disabled', async () => {
        const h = await mountSetup({
            groupsEnabled: false,
            powerline: { ...DEFAULT_SETTINGS.powerline, enabled: false }
        });
        try {
            h.stdin.write('g');
            h.stdin.write('p');
            await flushInk();
            expect(h.onUpdate).not.toHaveBeenCalled();
        } finally {
            h.cleanup();
        }
    });

    it('toggles continue theme across lines when (c) is pressed', async () => {
        const stdin = createMockStdin();
        const stdout = createMockStdout();
        const stderr = createMockStdout();
        const onUpdate = vi.fn<PowerlineSetupProps['onUpdate']>();
        const onBack = vi.fn();
        const onInstallFonts = vi.fn();
        const onClearMessage = vi.fn();
        const instance = render(
            React.createElement(PowerlineSetup, {
                settings: {
                    ...DEFAULT_SETTINGS,
                    powerline: {
                        ...DEFAULT_SETTINGS.powerline,
                        enabled: true,
                        continueThemeAcrossLines: false
                    }
                },
                powerlineFontStatus: { installed: true },
                onUpdate,
                onBack,
                onInstallFonts,
                installingFonts: false,
                fontInstallMessage: null,
                onClearMessage
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
            expect(stdout.getOutput()).toContain('Continue Theme:');

            stdin.write('c');
            await flushInk();

            const updatedSettings = onUpdate.mock.calls[0]?.[0];
            expect(updatedSettings).toBeDefined();
            expect(updatedSettings?.powerline.continueThemeAcrossLines).toBe(true);
        } finally {
            instance.unmount();
            instance.cleanup();
            stdin.destroy();
            stdout.destroy();
            stderr.destroy();
        }
    });
});