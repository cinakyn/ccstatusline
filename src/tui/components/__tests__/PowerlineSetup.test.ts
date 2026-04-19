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