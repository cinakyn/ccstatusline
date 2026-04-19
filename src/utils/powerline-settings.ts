import type { Line } from '../types/Group';
import type { Settings } from '../types/Settings';
import type { WidgetItem } from '../types/Widget';

import { getDefaultPowerlineTheme } from './colors';

function resolveEnabledPowerlineTheme(theme: string | undefined): string {
    if (!theme || theme === 'custom') {
        return getDefaultPowerlineTheme();
    }

    return theme;
}

/**
 * Rebuild a line, keeping only widgets that satisfy the filter predicate.
 *
 * Preserves per-group `gap` and `continuousColor` on the original groups.
 * Empty groups are removed so renderer invariants around slot counting
 * are unaffected.
 */
function filterLineWidgets(line: Line, keep: (w: WidgetItem) => boolean): Line {
    const filteredGroups = line.groups
        .map(group => ({
            ...group,
            widgets: group.widgets.filter(keep)
        }))
        .filter(group => group.widgets.length > 0);

    return { ...line, groups: filteredGroups };
}

export function buildEnabledPowerlineSettings(settings: Settings, removeManualSeparators: boolean): Settings {
    const powerlineConfig = settings.powerline;
    const lines = removeManualSeparators
        ? settings.lines.map(line => filterLineWidgets(
            line,
            item => item.type !== 'separator' && item.type !== 'flex-separator'
        ))
        : settings.lines;

    return {
        ...settings,
        powerline: {
            ...powerlineConfig,
            enabled: true,
            theme: resolveEnabledPowerlineTheme(powerlineConfig.theme),
            // Separators are initialized by schema defaults, preserve existing values.
            separators: powerlineConfig.separators,
            separatorInvertBackground: powerlineConfig.separatorInvertBackground
        },
        defaultPadding: ' ',
        lines
    };
}