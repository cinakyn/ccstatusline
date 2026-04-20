import {
    Box,
    Text,
    useInput
} from 'ink';
import * as os from 'os';
import React, { useState } from 'react';

import type { PowerlineConfig } from '../../types/PowerlineConfig';
import type { Settings } from '../../types/Settings';
import { lineWidgets } from '../../utils/groups';
import { shouldInsertInput } from '../../utils/input-guards';
import { type PowerlineFontStatus } from '../../utils/powerline';
import { buildEnabledPowerlineSettings } from '../../utils/powerline-settings';

import { ConfirmDialog } from './ConfirmDialog';
import {
    List,
    type ListEntry
} from './List';
import { PowerlineSeparatorEditor } from './PowerlineSeparatorEditor';
import { PowerlineThemeSelector } from './PowerlineThemeSelector';

type PowerlineMenuValue
    = | 'separator'
        | 'startCap'
        | 'endCap'
        | 'themes'
        | 'widgetSeparator'
        | 'groupStartCap'
        | 'groupEndCap'
        | 'lineStartCap'
        | 'lineEndCap';
type Screen = 'menu' | PowerlineMenuValue;
const POWERLINE_MENU_LABEL_WIDTH = 18;

function formatPowerlineMenuLabel(label: string): string {
    return label.padEnd(POWERLINE_MENU_LABEL_WIDTH, ' ');
}

export function getSeparatorDisplay(powerlineConfig: PowerlineConfig): string {
    const seps = powerlineConfig.separators;

    if (seps.length > 1) {
        return 'multiple';
    }

    const sep = seps[0] ?? '\uE0B0';
    const presets = [
        { char: '\uE0B0', name: 'Triangle Right' },
        { char: '\uE0B2', name: 'Triangle Left' },
        { char: '\uE0B4', name: 'Round Right' },
        { char: '\uE0B6', name: 'Round Left' }
    ];
    const preset = presets.find(item => item.char === sep);

    if (preset) {
        return `${preset.char} - ${preset.name}`;
    }

    return `${sep} - Custom`;
}

export function getCapDisplay(
    powerlineConfig: PowerlineConfig,
    type: 'start' | 'end'
): string {
    const caps = type === 'start'
        ? powerlineConfig.startCaps
        : powerlineConfig.endCaps;

    if (caps.length === 0) {
        return 'none';
    }

    if (caps.length > 1) {
        return 'multiple';
    }

    const cap = caps[0];

    if (!cap) {
        return 'none';
    }

    const presets = type === 'start' ? [
        { char: '\uE0B2', name: 'Triangle' },
        { char: '\uE0B6', name: 'Round' },
        { char: '\uE0BA', name: 'Lower Triangle' },
        { char: '\uE0BE', name: 'Diagonal' }
    ] : [
        { char: '\uE0B0', name: 'Triangle' },
        { char: '\uE0B4', name: 'Round' },
        { char: '\uE0B8', name: 'Lower Triangle' },
        { char: '\uE0BC', name: 'Diagonal' }
    ];
    const preset = presets.find(item => item.char === cap);

    if (preset) {
        return `${preset.char} - ${preset.name}`;
    }

    return `${cap} - Custom`;
}

/**
 * Display helper for the group-mode fields (widgetSeparator / groupStartCap /
 * groupEndCap / lineStartCap / lineEndCap).  An empty array renders as "none"
 * because the grouped renderer treats an empty cap array as "do not emit this
 * cap at all", which is a meaningfully different state from "single default
 * glyph".
 */
function getGroupFieldDisplay(
    caps: readonly string[],
    kind: 'separator' | 'startCap' | 'endCap'
): string {
    if (caps.length === 0) {
        return 'none';
    }
    if (caps.length > 1) {
        return 'multiple';
    }
    const cap = caps[0];
    if (!cap) {
        return 'none';
    }
    const separatorPresets = [
        { char: '\uE0B0', name: 'Triangle Right' },
        { char: '\uE0B2', name: 'Triangle Left' },
        { char: '\uE0B4', name: 'Round Right' },
        { char: '\uE0B6', name: 'Round Left' }
    ];
    const startPresets = [
        { char: '\uE0B2', name: 'Triangle' },
        { char: '\uE0B6', name: 'Round' },
        { char: '\uE0BA', name: 'Lower Triangle' },
        { char: '\uE0BE', name: 'Diagonal' }
    ];
    const endPresets = [
        { char: '\uE0B0', name: 'Triangle' },
        { char: '\uE0B4', name: 'Round' },
        { char: '\uE0B8', name: 'Lower Triangle' },
        { char: '\uE0BC', name: 'Diagonal' }
    ];
    const presets = kind === 'separator' ? separatorPresets : kind === 'startCap' ? startPresets : endPresets;
    const preset = presets.find(item => item.char === cap);
    if (preset) {
        return `${preset.char} - ${preset.name}`;
    }
    return `${cap} - Custom`;
}

export function getThemeDisplay(powerlineConfig: PowerlineConfig): string {
    const theme = powerlineConfig.theme;

    if (!theme || theme === 'custom') {
        return 'Custom';
    }

    return theme.charAt(0).toUpperCase() + theme.slice(1);
}

export function buildPowerlineSetupMenuItems(
    powerlineConfig: PowerlineConfig,
    groupsEnabled: boolean
): ListEntry<PowerlineMenuValue>[] {
    const disabled = !powerlineConfig.enabled;
    const legacyDisabled = disabled || groupsEnabled;
    const groupModeDisabled = disabled || !groupsEnabled;

    const flatGroup: ListEntry<PowerlineMenuValue>[] = [
        {
            label: formatPowerlineMenuLabel('Separator'),
            sublabel: `(${getSeparatorDisplay(powerlineConfig)})`,
            value: 'separator',
            disabled: legacyDisabled,
            description: 'Flat-mode: glyph used between powerline widgets when Groups Enabled is off.'
        },
        {
            label: formatPowerlineMenuLabel('Start Cap'),
            sublabel: `(${getCapDisplay(powerlineConfig, 'start')})`,
            value: 'startCap',
            disabled: legacyDisabled,
            description: 'Flat-mode: cap glyph at the start of each powerline line when Groups Enabled is off.'
        },
        {
            label: formatPowerlineMenuLabel('End Cap'),
            sublabel: `(${getCapDisplay(powerlineConfig, 'end')})`,
            value: 'endCap',
            disabled: legacyDisabled,
            description: 'Flat-mode: cap glyph at the end of each powerline line when Groups Enabled is off.'
        }
    ];

    const groupModeItems: ListEntry<PowerlineMenuValue>[] = [
        {
            label: formatPowerlineMenuLabel('Widget Separator'),
            sublabel: `(${getGroupFieldDisplay(powerlineConfig.widgetSeparator, 'separator')})`,
            value: 'widgetSeparator',
            disabled: groupModeDisabled,
            description: 'Grouped mode: glyph between widgets within a group.'
        },
        {
            label: formatPowerlineMenuLabel('Group Start Cap'),
            sublabel: `(${getGroupFieldDisplay(powerlineConfig.groupStartCap, 'startCap')})`,
            value: 'groupStartCap',
            disabled: groupModeDisabled,
            description: 'Grouped mode: cap glyph at the start of each widget group.'
        },
        {
            label: formatPowerlineMenuLabel('Group End Cap'),
            sublabel: `(${getGroupFieldDisplay(powerlineConfig.groupEndCap, 'endCap')})`,
            value: 'groupEndCap',
            disabled: groupModeDisabled,
            description: 'Grouped mode: cap glyph at the end of each widget group.'
        },
        {
            label: formatPowerlineMenuLabel('Line Start Cap'),
            sublabel: `(${getGroupFieldDisplay(powerlineConfig.lineStartCap, 'startCap')})`,
            value: 'lineStartCap',
            disabled: groupModeDisabled,
            description: 'Grouped mode: cap glyph at the very start of the line (outside the first group).'
        },
        {
            label: formatPowerlineMenuLabel('Line End Cap'),
            sublabel: `(${getGroupFieldDisplay(powerlineConfig.lineEndCap, 'endCap')})`,
            value: 'lineEndCap',
            disabled: groupModeDisabled,
            description: 'Grouped mode: cap glyph at the very end of the line (outside the last group).'
        }
    ];

    return [
        ...flatGroup,
        ...groupModeItems,
        {
            label: formatPowerlineMenuLabel('Themes'),
            sublabel: `(${getThemeDisplay(powerlineConfig)})`,
            value: 'themes',
            disabled,
            description: 'Preview built-in powerline themes or copy a theme into custom widget colors.'
        }
    ];
}

export interface PowerlineSetupProps {
    settings: Settings;
    powerlineFontStatus: PowerlineFontStatus;
    onUpdate: (settings: Settings) => void;
    onBack: () => void;
    onInstallFonts: () => void;
    installingFonts: boolean;
    fontInstallMessage: string | null;
    onClearMessage: () => void;
}

export const PowerlineSetup: React.FC<PowerlineSetupProps> = ({
    settings,
    powerlineFontStatus,
    onUpdate,
    onBack,
    onInstallFonts,
    installingFonts,
    fontInstallMessage,
    onClearMessage
}) => {
    const powerlineConfig = settings.powerline;
    const groupsEnabled = settings.groupsEnabled;
    const [screen, setScreen] = useState<Screen>('menu');
    const [selectedMenuItem, setSelectedMenuItem] = useState(0);
    const [confirmingEnable, setConfirmingEnable] = useState(false);
    const [confirmingFontInstall, setConfirmingFontInstall] = useState(false);
    const [editingGroupGap, setEditingGroupGap] = useState(false);
    const [groupGapInput, setGroupGapInput] = useState(settings.defaultGroupGap);

    const hasSeparatorItems = settings.lines.some(line => lineWidgets(line).some(
        item => item.type === 'separator' || item.type === 'flex-separator'
    ));

    useInput((input, key) => {
        if (fontInstallMessage || installingFonts) {
            if (fontInstallMessage && !key.escape) {
                onClearMessage();
            }
            return;
        }

        if (confirmingFontInstall || confirmingEnable) {
            return;
        }

        if (editingGroupGap) {
            if (key.return) {
                onUpdate({
                    ...settings,
                    defaultGroupGap: groupGapInput
                });
                setEditingGroupGap(false);
            } else if (key.escape) {
                setGroupGapInput(settings.defaultGroupGap);
                setEditingGroupGap(false);
            } else if (key.backspace) {
                setGroupGapInput(groupGapInput.slice(0, -1));
            } else if (key.delete) {
                // No-op: simple inputs without cursor.
            } else if (shouldInsertInput(input, key)) {
                setGroupGapInput(groupGapInput + input);
            }
            return;
        }

        if (screen === 'menu') {
            if (key.escape) {
                onBack();
            } else if (input === 't' || input === 'T') {
                if (!powerlineConfig.enabled) {
                    if (hasSeparatorItems) {
                        setConfirmingEnable(true);
                    } else {
                        onUpdate(buildEnabledPowerlineSettings(settings, false));
                    }
                } else {
                    onUpdate({
                        ...settings,
                        powerline: {
                            ...powerlineConfig,
                            enabled: false
                        }
                    });
                }
            } else if (input === 'i' || input === 'I') {
                setConfirmingFontInstall(true);
            } else if ((input === 'a' || input === 'A') && powerlineConfig.enabled) {
                onUpdate({
                    ...settings,
                    powerline: {
                        ...powerlineConfig,
                        autoAlign: !powerlineConfig.autoAlign
                    }
                });
            } else if ((input === 'c' || input === 'C') && powerlineConfig.enabled) {
                onUpdate({
                    ...settings,
                    powerline: {
                        ...powerlineConfig,
                        continueThemeAcrossLines: !powerlineConfig.continueThemeAcrossLines
                    }
                });
            } else if ((input === 'n' || input === 'N') && powerlineConfig.enabled) {
                // Toggle group mode (powerline-only feature)
                onUpdate({
                    ...settings,
                    groupsEnabled: !groupsEnabled
                });
            } else if ((input === 'g' || input === 'G') && powerlineConfig.enabled) {
                // Edit default group gap
                setGroupGapInput(settings.defaultGroupGap);
                setEditingGroupGap(true);
            }
        }
    });

    if (screen === 'separator') {
        return (
            <PowerlineSeparatorEditor
                settings={settings}
                mode='separator'
                onUpdate={onUpdate}
                onBack={() => { setScreen('menu'); }}
            />
        );
    }

    if (screen === 'startCap') {
        return (
            <PowerlineSeparatorEditor
                settings={settings}
                mode='startCap'
                onUpdate={onUpdate}
                onBack={() => { setScreen('menu'); }}
            />
        );
    }

    if (screen === 'endCap') {
        return (
            <PowerlineSeparatorEditor
                settings={settings}
                mode='endCap'
                onUpdate={onUpdate}
                onBack={() => { setScreen('menu'); }}
            />
        );
    }

    if (screen === 'widgetSeparator') {
        return (
            <PowerlineSeparatorEditor
                settings={settings}
                mode='widgetSeparator'
                onUpdate={onUpdate}
                onBack={() => { setScreen('menu'); }}
            />
        );
    }

    if (screen === 'groupStartCap') {
        return (
            <PowerlineSeparatorEditor
                settings={settings}
                mode='groupStartCap'
                onUpdate={onUpdate}
                onBack={() => { setScreen('menu'); }}
            />
        );
    }

    if (screen === 'groupEndCap') {
        return (
            <PowerlineSeparatorEditor
                settings={settings}
                mode='groupEndCap'
                onUpdate={onUpdate}
                onBack={() => { setScreen('menu'); }}
            />
        );
    }

    if (screen === 'lineStartCap') {
        return (
            <PowerlineSeparatorEditor
                settings={settings}
                mode='lineStartCap'
                onUpdate={onUpdate}
                onBack={() => { setScreen('menu'); }}
            />
        );
    }

    if (screen === 'lineEndCap') {
        return (
            <PowerlineSeparatorEditor
                settings={settings}
                mode='lineEndCap'
                onUpdate={onUpdate}
                onBack={() => { setScreen('menu'); }}
            />
        );
    }

    if (screen === 'themes') {
        return (
            <PowerlineThemeSelector
                settings={settings}
                onUpdate={onUpdate}
                onBack={() => { setScreen('menu'); }}
            />
        );
    }

    return (
        <Box flexDirection='column'>
            {!confirmingFontInstall && !installingFonts && !fontInstallMessage && (
                <Text bold>Powerline Setup</Text>
            )}

            {confirmingFontInstall ? (
                <Box flexDirection='column'>
                    <Box marginBottom={1}>
                        <Text color='cyan' bold>Font Installation</Text>
                    </Box>

                    <Box marginBottom={1} flexDirection='column'>
                        <Text bold>What will happen:</Text>
                        <Text>
                            <Text dimColor>• Clone fonts from </Text>
                            <Text color='blue'>https://github.com/powerline/fonts</Text>
                        </Text>
                        {os.platform() === 'darwin' && (
                            <>
                                <Text dimColor>• Run install.sh script which will:</Text>
                                <Text dimColor>  - Copy all .ttf/.otf files to ~/Library/Fonts</Text>
                                <Text dimColor>  - Register fonts with macOS</Text>
                            </>
                        )}
                        {os.platform() === 'linux' && (
                            <>
                                <Text dimColor>• Run install.sh script which will:</Text>
                                <Text dimColor>  - Copy all .ttf/.otf files to ~/.local/share/fonts</Text>
                                <Text dimColor>  - Run fc-cache to update font cache</Text>
                            </>
                        )}
                        {os.platform() === 'win32' && (
                            <>
                                <Text dimColor>• Copy Powerline .ttf/.otf files to:</Text>
                                <Text dimColor>  AppData\Local\Microsoft\Windows\Fonts</Text>
                            </>
                        )}
                        <Text dimColor>• Clean up temporary files</Text>
                    </Box>

                    <Box marginBottom={1}>
                        <Text color='yellow' bold>Requirements: </Text>
                        <Text dimColor>Git installed, Internet connection, Write permissions</Text>
                    </Box>

                    <Box marginBottom={1} flexDirection='column'>
                        <Text color='green' bold>After install:</Text>
                        <Text dimColor>• Restart terminal</Text>
                        <Text dimColor>• Select a Powerline font</Text>
                        <Text dimColor>  (e.g. "Meslo LG S for Powerline")</Text>
                    </Box>

                    <Box marginTop={1}>
                        <Text>Proceed? </Text>
                    </Box>
                    <Box marginTop={1}>
                        <ConfirmDialog
                            inline={true}
                            onConfirm={() => {
                                setConfirmingFontInstall(false);
                                onInstallFonts();
                            }}
                            onCancel={() => {
                                setConfirmingFontInstall(false);
                            }}
                        />
                    </Box>
                </Box>
            ) : confirmingEnable ? (
                <Box flexDirection='column' marginTop={1}>
                    {hasSeparatorItems && (
                        <>
                            <Box>
                                <Text color='yellow'>⚠ Warning: Enabling Powerline mode will remove all existing separators and flex-separators from your status lines.</Text>
                            </Box>
                            <Box marginBottom={1}>
                                <Text dimColor>Powerline mode uses its own separator system and is incompatible with manual separators.</Text>
                            </Box>
                        </>
                    )}
                    <Box marginTop={hasSeparatorItems ? 1 : 0}>
                        <Text>Do you want to continue? </Text>
                    </Box>
                    <Box marginTop={1}>
                        <ConfirmDialog
                            inline={true}
                            onConfirm={() => {
                                onUpdate(buildEnabledPowerlineSettings(settings, true));
                                setConfirmingEnable(false);
                            }}
                            onCancel={() => {
                                setConfirmingEnable(false);
                            }}
                        />
                    </Box>
                </Box>
            ) : installingFonts ? (
                <Box>
                    <Text color='yellow'>Installing Powerline fonts... This may take a moment.</Text>
                </Box>
            ) : fontInstallMessage ? (
                <Box flexDirection='column'>
                    <Text color={fontInstallMessage.includes('success') ? 'green' : 'red'}>
                        {fontInstallMessage}
                    </Text>
                    <Box marginTop={1}>
                        <Text dimColor>Press any key to continue...</Text>
                    </Box>
                </Box>
            ) : editingGroupGap ? (
                <Box flexDirection='column' marginTop={1}>
                    <Box>
                        <Text>Enter default group gap (placed between groups): </Text>
                        <Text color='cyan'>{groupGapInput ? `"${groupGapInput}"` : '(empty)'}</Text>
                    </Box>
                    <Text dimColor>Press Enter to save, ESC to cancel</Text>
                </Box>
            ) : (
                <>
                    <Box flexDirection='column'>
                        <Text>
                            {'    Font Status: '}
                            {powerlineFontStatus.installed ? (
                                <>
                                    <Text color='green'>✓ Installed</Text>
                                    <Text dimColor> - Ensure fonts are active in your terminal</Text>
                                </>
                            ) : (
                                <>
                                    <Text color='yellow'>✗ Not Installed</Text>
                                    <Text dimColor> - Press (i) to install Powerline fonts</Text>
                                </>
                            )}
                        </Text>
                    </Box>

                    <Box>
                        <Text>   Powerline Mode: </Text>
                        <Text color={powerlineConfig.enabled ? 'green' : 'red'}>
                            {powerlineConfig.enabled ? '✓ Enabled  ' : '✗ Disabled '}
                        </Text>
                        <Text dimColor> - Press (t) to toggle</Text>
                    </Box>

                    {powerlineConfig.enabled && (
                        <>
                            <Box>
                                <Text>    Align Widgets: </Text>
                                <Text color={powerlineConfig.autoAlign ? 'green' : 'red'}>
                                    {powerlineConfig.autoAlign ? '✓ Enabled  ' : '✗ Disabled '}
                                </Text>
                                <Text dimColor> - Press (a) to toggle</Text>
                            </Box>

                            <Box>
                                <Text>   Continue Theme: </Text>
                                <Text color={powerlineConfig.continueThemeAcrossLines ? 'green' : 'red'}>
                                    {powerlineConfig.continueThemeAcrossLines ? '✓ Enabled  ' : '✗ Disabled '}
                                </Text>
                                <Text dimColor> - Press (c) to toggle</Text>
                            </Box>

                            <Box>
                                <Text>   Groups Enabled: </Text>
                                <Text color={groupsEnabled ? 'green' : 'red'}>
                                    {groupsEnabled ? '✓ Enabled  ' : '✗ Disabled '}
                                </Text>
                                <Text dimColor> - Press (n) to toggle</Text>
                            </Box>

                            <Box>
                                <Text>Default Group Gap: </Text>
                                <Text color='cyan'>{settings.defaultGroupGap ? `"${settings.defaultGroupGap}"` : '(empty)'}</Text>
                                <Text dimColor> - Press (g) to edit</Text>
                            </Box>

                            <Box flexDirection='column' marginTop={1}>
                                <Text dimColor>
                                    Continue Theme keeps the Powerline color sequence running across lines.
                                </Text>
                                <Text dimColor>
                                    Groups Enabled switches to the grouped render path (Widget Separator, Group/Line caps below).
                                </Text>
                                <Text dimColor>
                                    The flat and grouped fields are independent — toggling Groups Enabled does not copy values between them.
                                </Text>
                            </Box>
                        </>
                    )}

                    {!powerlineConfig.enabled && (
                        <Box marginTop={1}>
                            <Text dimColor>Enable Powerline mode to configure separators, caps, groups, and themes.</Text>
                        </Box>
                    )}

                    <List
                        marginTop={1}
                        items={buildPowerlineSetupMenuItems(powerlineConfig, groupsEnabled)}
                        onSelect={(value) => {
                            if (value === 'back') {
                                onBack();
                                return;
                            }

                            setScreen(value);
                        }}
                        onSelectionChange={(_, index) => {
                            setSelectedMenuItem(index);
                        }}
                        initialSelection={selectedMenuItem}
                        showBackButton={true}
                    />
                </>
            )}
        </Box>
    );
};