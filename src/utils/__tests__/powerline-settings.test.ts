import {
    describe,
    expect,
    it
} from 'vitest';

import { DEFAULT_SETTINGS } from '../../types/Settings';
import type { WidgetItem } from '../../types/Widget';
import { lineWidgets } from '../groups';
import { buildEnabledPowerlineSettings } from '../powerline-settings';

describe('powerline settings helpers', () => {
    it('enables powerline with default theme and default padding', () => {
        const settings = {
            ...DEFAULT_SETTINGS,
            powerline: {
                ...DEFAULT_SETTINGS.powerline,
                enabled: false,
                theme: undefined
            }
        };

        const updated = buildEnabledPowerlineSettings(settings, false);

        expect(updated.powerline.enabled).toBe(true);
        expect(updated.powerline.theme).toBe('nord-aurora');
        expect(updated.defaultPadding).toBe(' ');
    });

    it('preserves non-custom theme when enabling powerline', () => {
        const settings = {
            ...DEFAULT_SETTINGS,
            powerline: {
                ...DEFAULT_SETTINGS.powerline,
                enabled: false,
                theme: 'catppuccin'
            }
        };

        const updated = buildEnabledPowerlineSettings(settings, false);
        expect(updated.powerline.theme).toBe('catppuccin');
    });

    it('removes manual separators when requested', () => {
        const widgets: WidgetItem[] = [
            { id: '1', type: 'model' },
            { id: '2', type: 'separator' },
            { id: '3', type: 'context-length' },
            { id: '4', type: 'flex-separator' }
        ];
        const settings = {
            ...DEFAULT_SETTINGS,
            lines: [{ groups: [{ continuousColor: true, widgets }] }]
        };

        const updated = buildEnabledPowerlineSettings(settings, true);
        const firstLine = updated.lines[0];
        expect(firstLine).toBeDefined();
        if (!firstLine) {
            throw new Error('Expected first line to exist');
        }
        expect(lineWidgets(firstLine).map(item => item.type)).toEqual(['model', 'context-length']);
    });

    it('keeps manual separators when removal is not requested', () => {
        const widgets: WidgetItem[] = [
            { id: '1', type: 'model' },
            { id: '2', type: 'separator' },
            { id: '3', type: 'context-length' }
        ];
        const settings = {
            ...DEFAULT_SETTINGS,
            lines: [{ groups: [{ continuousColor: true, widgets }] }]
        };

        const updated = buildEnabledPowerlineSettings(settings, false);
        const firstLine = updated.lines[0];
        expect(firstLine).toBeDefined();
        if (!firstLine) {
            throw new Error('Expected first line to exist');
        }
        expect(lineWidgets(firstLine).map(item => item.type)).toEqual(['model', 'separator', 'context-length']);
    });
});