import {
    Box,
    Text,
    useInput
} from 'ink';
import React, {
    useMemo,
    useState
} from 'react';

import type { Settings } from '../../types/Settings';
import type {
    CustomKeybind,
    Widget,
    WidgetItem,
    WidgetItemType
} from '../../types/Widget';
import { getBackgroundColorsForPowerline } from '../../utils/colors';
import { generateGuid } from '../../utils/guid';
import { shouldInsertInput } from '../../utils/input-guards';
import { canDetectTerminalWidth } from '../../utils/terminal';
import {
    filterWidgetCatalog,
    getMatchSegments,
    getWidget,
    getWidgetCatalog,
    getWidgetCatalogCategories
} from '../../utils/widgets';

import { ColorMenu } from './ColorMenu';
import { ConfirmDialog } from './ConfirmDialog';
import { WidgetWhenEditor } from './WidgetWhenEditor';
import {
    handleMoveInputMode,
    handlePickerInputMode,
    normalizePickerState,
    type CustomEditorWidgetState,
    type InputKey,
    type WidgetPickerAction,
    type WidgetPickerState
} from './items-editor/input-handlers';
import {
    addTag,
    countTagReferences,
    deleteTag,
    makeAutoTagName,
    renameTag,
    validateTagRename
} from './items-editor/tag-mutations';
import {
    buildWidgetRows,
    findWidgetRowIndex,
    type WidgetRow
} from './items-editor/widget-rows';

export interface ItemsEditorProps {
    widgets: WidgetItem[];
    onUpdate: (widgets: WidgetItem[]) => void;
    onBack: () => void;
    lineNumber: number;
    /** When set, the editor is operating on a specific group (groupsEnabled=true). */
    groupNumber?: number;
    settings: Settings;
}

interface ColorMenuContext {
    widgetId: string;
    tagKey?: string;
}

interface TagRenameContext {
    widgetIndex: number;
    tagName: string;
    input: string;
    error: string | null;
}

interface TagDeleteContext {
    widgetIndex: number;
    tagName: string;
    refCount: number;
}

interface WhenEditorContext { widgetIndex: number }

export const ItemsEditor: React.FC<ItemsEditorProps> = ({ widgets, onUpdate, onBack, lineNumber, groupNumber, settings }) => {
    // `selectedIndex` indexes into the flat `rows` list (widgets + tag variants
    // + add-tag affordances), not `widgets` directly. `activeWidgetIndex`
    // converts back to the widget-level selection and is what widget-scoped
    // operations (move, delete, merge, raw-value toggle, …) key off of.
    const [selectedIndex, setSelectedIndex] = useState(0);
    const [moveMode, setMoveMode] = useState(false);
    const [customEditorWidget, setCustomEditorWidget] = useState<CustomEditorWidgetState | null>(null);
    const [widgetPicker, setWidgetPicker] = useState<WidgetPickerState | null>(null);
    const [showClearConfirm, setShowClearConfirm] = useState(false);
    const [colorMenuContext, setColorMenuContext] = useState<ColorMenuContext | null>(null);
    const [tagRename, setTagRename] = useState<TagRenameContext | null>(null);
    const [tagDelete, setTagDelete] = useState<TagDeleteContext | null>(null);
    const [whenEditor, setWhenEditor] = useState<WhenEditorContext | null>(null);
    const separatorChars = ['|', '-', ',', ' '];

    const rows = useMemo(() => buildWidgetRows(widgets), [widgets]);
    const selectedRow: WidgetRow | undefined = rows[Math.min(selectedIndex, Math.max(rows.length - 1, 0))];
    const activeWidgetIndex = selectedRow?.widgetIndex ?? 0;

    const widgetCatalog = getWidgetCatalog(settings);
    const widgetCategories = ['All', ...getWidgetCatalogCategories(widgetCatalog)];

    // Get a unique background color for powerline mode
    const getUniqueBackgroundColor = (insertIndex: number): string | undefined => {
        // Only apply background colors if powerline is enabled and NOT using custom theme
        if (!settings.powerline.enabled || settings.powerline.theme === 'custom') {
            return undefined;
        }

        // Get all available background colors (excluding black for better visibility)
        const bgColors = getBackgroundColorsForPowerline();

        // Get colors of adjacent items
        const prevWidget = insertIndex > 0 ? widgets[insertIndex - 1] : null;
        const nextWidget = insertIndex < widgets.length ? widgets[insertIndex] : null;

        const prevBg = prevWidget?.backgroundColor;
        const nextBg = nextWidget?.backgroundColor;

        // Filter out colors that match neighbors
        const availableColors = bgColors.filter(color => color !== prevBg && color !== nextBg);

        // If we have available colors, pick one randomly
        if (availableColors.length > 0) {
            const randomIndex = Math.floor(Math.random() * availableColors.length);
            return availableColors[randomIndex];
        }

        // Fallback: if somehow both neighbors use all 14 colors (impossible with 2 neighbors),
        // just pick any color that's different from the previous
        return bgColors.find(c => c !== prevBg) ?? bgColors[0];
    };

    const handleEditorComplete = (updatedWidget: WidgetItem) => {
        const newWidgets = [...widgets];
        newWidgets[activeWidgetIndex] = updatedWidget;
        onUpdate(newWidgets);
        setCustomEditorWidget(null);
    };

    const handleEditorCancel = () => {
        setCustomEditorWidget(null);
    };

    const getCustomKeybindsForWidget = (widgetImpl: Widget, widget: WidgetItem): CustomKeybind[] => {
        if (!widgetImpl.getCustomKeybinds) {
            return [];
        }

        return widgetImpl.getCustomKeybinds(widget);
    };

    const openWidgetPicker = (action: WidgetPickerAction) => {
        if (widgetCatalog.length === 0) {
            return;
        }

        const currentType = widgets[activeWidgetIndex]?.type;
        const selectedType = action === 'change' ? currentType ?? null : null;

        setWidgetPicker(normalizePickerState({
            action,
            level: 'category',
            selectedCategory: 'All',
            categoryQuery: '',
            widgetQuery: '',
            selectedType
        }, widgetCatalog, widgetCategories));
    };

    const applyWidgetPickerSelection = (selectedType: WidgetItemType) => {
        if (!widgetPicker) {
            return;
        }

        if (widgetPicker.action === 'change') {
            const currentWidget = widgets[activeWidgetIndex];
            if (currentWidget) {
                const newWidgets = [...widgets];
                newWidgets[activeWidgetIndex] = { ...currentWidget, type: selectedType };
                onUpdate(newWidgets);
            }
        } else {
            const insertIndex = widgetPicker.action === 'add'
                ? (widgets.length > 0 ? activeWidgetIndex + 1 : 0)
                : activeWidgetIndex;
            const backgroundColor = getUniqueBackgroundColor(insertIndex);
            const newWidget: WidgetItem = {
                id: generateGuid(),
                type: selectedType,
                ...(backgroundColor && { backgroundColor })
            };
            const newWidgets = [...widgets];
            newWidgets.splice(insertIndex, 0, newWidget);
            onUpdate(newWidgets);
            // Place selection on the new widget row in the rebuilt row list.
            const nextRows = buildWidgetRows(newWidgets);
            const targetRow = findWidgetRowIndex(nextRows, insertIndex);
            setSelectedIndex(targetRow >= 0 ? targetRow : 0);
        }

        setWidgetPicker(null);
    };

    const handleTagRenameInput = (input: string, key: InputKey) => {
        if (!tagRename)
            return;
        if (key.escape) {
            setTagRename(null);
            return;
        }
        if (key.return) {
            const currentItem = widgets[tagRename.widgetIndex];
            if (!currentItem) {
                setTagRename(null);
                return;
            }
            const proposed = tagRename.input.trim();
            const err = validateTagRename(currentItem, tagRename.tagName, proposed);
            if (err === null) {
                if (proposed !== tagRename.tagName) {
                    const newWidgets = [...widgets];
                    newWidgets[tagRename.widgetIndex] = renameTag(currentItem, tagRename.tagName, proposed);
                    onUpdate(newWidgets);
                }
                setTagRename(null);
            } else {
                const message = err === 'empty'
                    ? 'Name cannot be empty'
                    : err === 'duplicate'
                        ? 'A tag with that name already exists'
                        : 'Tag no longer exists';
                setTagRename({ ...tagRename, error: message });
            }
            return;
        }
        if (key.backspace || key.delete) {
            setTagRename({ ...tagRename, input: tagRename.input.slice(0, -1), error: null });
            return;
        }
        if (shouldInsertInput(input, key)) {
            setTagRename({ ...tagRename, input: tagRename.input + input, error: null });
        }
    };

    const handleRowInput = (input: string, key: InputKey) => {
        if (!selectedRow) {
            if (key.escape) {
                onBack();
                return;
            }
            if (input === 'a') {
                openWidgetPicker('add');
                return;
            }
            if (input === 'i') {
                openWidgetPicker('insert');
            }
            return;
        }

        const moveUp = () => { setSelectedIndex(Math.max(0, selectedIndex - 1)); };
        const moveDown = () => { setSelectedIndex(Math.min(rows.length - 1, selectedIndex + 1)); };

        if (key.upArrow) {
            moveUp();
            return;
        }
        if (key.downArrow) {
            moveDown();
            return;
        }
        if (key.escape) {
            onBack();
            return;
        }

        if (selectedRow.kind === 'widget') {
            handleWidgetRowInput(input, key, selectedRow);
            return;
        }
        if (selectedRow.kind === 'tag') {
            handleTagRowInput(input, key, selectedRow);
            return;
        }
        // addTag row
        if (key.return || input === 'a') {
            createAndEditNewTag(selectedRow.widgetIndex);
        }
    };

    const handleWidgetRowInput = (input: string, key: InputKey, row: Extract<WidgetRow, { kind: 'widget' }>) => {
        const currentWidget = row.widget;
        const isSeparator = currentWidget.type === 'separator';
        const isFlexSeparator = currentWidget.type === 'flex-separator';

        if (key.leftArrow || key.rightArrow) {
            openWidgetPicker('change');
            return;
        }
        if (key.return) {
            setMoveMode(true);
            return;
        }
        if (input === 'a') {
            openWidgetPicker('add');
            return;
        }
        if (input === 'i') {
            openWidgetPicker('insert');
            return;
        }
        if (input === 'n' && !isSeparator && !isFlexSeparator) {
            setWhenEditor({ widgetIndex: row.widgetIndex });
            return;
        }
        if (input === 'd') {
            const newWidgets = widgets.filter((_, i) => i !== row.widgetIndex);
            onUpdate(newWidgets);
            const nextRows = buildWidgetRows(newWidgets);
            // Clamp selection to the closest remaining widget row.
            const clamped = Math.min(selectedIndex, Math.max(nextRows.length - 1, 0));
            setSelectedIndex(Math.max(0, clamped));
            return;
        }
        if (input === 'c') {
            if (widgets.length > 0) {
                setShowClearConfirm(true);
            }
            return;
        }
        if (input === ' ' && isSeparator) {
            const currentChar = currentWidget.character ?? '|';
            const currentCharIndex = separatorChars.indexOf(currentChar);
            const nextChar = separatorChars[(currentCharIndex + 1) % separatorChars.length];
            const newWidgets = [...widgets];
            newWidgets[row.widgetIndex] = { ...currentWidget, character: nextChar };
            onUpdate(newWidgets);
            return;
        }
        if (input === 'r' && !isSeparator && !isFlexSeparator) {
            const widgetImpl = getWidget(currentWidget.type);
            if (!widgetImpl?.supportsRawValue()) {
                return;
            }
            const newWidgets = [...widgets];
            newWidgets[row.widgetIndex] = { ...currentWidget, rawValue: !currentWidget.rawValue };
            onUpdate(newWidgets);
            return;
        }
        if (input === 'm' && !isSeparator && !isFlexSeparator) {
            if (row.widgetIndex < widgets.length - 1) {
                const newWidgets = [...widgets];
                let nextMergeState: boolean | 'no-padding' | undefined;
                if (currentWidget.merge === undefined) {
                    nextMergeState = true;
                } else if (currentWidget.merge === true) {
                    nextMergeState = 'no-padding';
                } else {
                    nextMergeState = undefined;
                }
                if (nextMergeState === undefined) {
                    const { merge, ...rest } = currentWidget;
                    void merge;
                    newWidgets[row.widgetIndex] = rest;
                } else {
                    newWidgets[row.widgetIndex] = { ...currentWidget, merge: nextMergeState };
                }
                onUpdate(newWidgets);
            }
            return;
        }

        // Custom keybinds from the widget implementation.
        if (!isSeparator && !isFlexSeparator) {
            const widgetImpl = getWidget(currentWidget.type);
            if (!widgetImpl?.getCustomKeybinds)
                return;
            const customKeybinds = getCustomKeybindsForWidget(widgetImpl, currentWidget);
            const matchedKeybind = customKeybinds.find(kb => kb.key === input);
            if (matchedKeybind && !key.ctrl) {
                if (widgetImpl.handleEditorAction) {
                    const updatedWidget = widgetImpl.handleEditorAction(matchedKeybind.action, currentWidget);
                    if (updatedWidget) {
                        const newWidgets = [...widgets];
                        newWidgets[row.widgetIndex] = updatedWidget;
                        onUpdate(newWidgets);
                    } else if (widgetImpl.renderEditor) {
                        setCustomEditorWidget({ widget: currentWidget, impl: widgetImpl, action: matchedKeybind.action });
                    }
                } else if (widgetImpl.renderEditor) {
                    setCustomEditorWidget({ widget: currentWidget, impl: widgetImpl, action: matchedKeybind.action });
                }
            }
        }
    };

    const handleTagRowInput = (input: string, key: InputKey, row: Extract<WidgetRow, { kind: 'tag' }>) => {
        if (key.return || input === 'e') {
            setColorMenuContext({ widgetId: row.widget.id, tagKey: row.tagName });
            return;
        }
        if (input === 'r') {
            setTagRename({
                widgetIndex: row.widgetIndex,
                tagName: row.tagName,
                input: row.tagName,
                error: null
            });
            return;
        }
        if (key.delete || input === 'd') {
            const refCount = countTagReferences(row.widget, row.tagName);
            setTagDelete({ widgetIndex: row.widgetIndex, tagName: row.tagName, refCount });
            return;
        }
        if (input === 'a') {
            createAndEditNewTag(row.widgetIndex);
        }
    };

    const createAndEditNewTag = (widgetIndex: number) => {
        const target = widgets[widgetIndex];
        if (!target)
            return;
        const tagName = makeAutoTagName(target.tags);
        const newWidgets = [...widgets];
        newWidgets[widgetIndex] = addTag(target, tagName);
        onUpdate(newWidgets);
        setColorMenuContext({ widgetId: target.id, tagKey: tagName });
    };

    useInput((input, key) => {
        // Skip input if custom editor or nested editor is active.
        if (customEditorWidget)
            return;
        if (showClearConfirm)
            return;
        if (colorMenuContext)
            return; // ColorMenu owns input
        if (whenEditor)
            return; // WidgetWhenEditor owns input
        if (tagDelete)
            return; // ConfirmDialog owns input

        if (tagRename) {
            handleTagRenameInput(input, key);
            return;
        }

        if (widgetPicker) {
            handlePickerInputMode({
                input,
                key,
                widgetPicker,
                widgetCatalog,
                widgetCategories,
                setWidgetPicker,
                applyWidgetPickerSelection
            });
            return;
        }

        if (moveMode) {
            handleMoveInputMode({
                key,
                widgets,
                selectedIndex: activeWidgetIndex,
                onUpdate,
                setSelectedIndex: (nextWidgetIndex: number) => {
                    const nextRows = buildWidgetRows(widgets);
                    const targetRow = findWidgetRowIndex(nextRows, nextWidgetIndex);
                    setSelectedIndex(targetRow >= 0 ? targetRow : 0);
                },
                setMoveMode
            });
            return;
        }

        handleRowInput(input, key);
    });

    const getWidgetDisplay = (widget: WidgetItem) => {
        // Special handling for separators (not widgets)
        if (widget.type === 'separator') {
            const char = widget.character ?? '|';
            const charDisplay = char === ' ' ? '(space)' : char;
            return `Separator ${charDisplay}`;
        }
        if (widget.type === 'flex-separator') {
            return 'Flex Separator';
        }

        // Handle regular widgets - delegate to widget for display
        const widgetImpl = getWidget(widget.type);
        if (widgetImpl) {
            const { displayText, modifierText } = widgetImpl.getEditorDisplay(widget);
            // Return plain text without colors
            return displayText + (modifierText ? ` ${modifierText}` : '');
        }
        // Unknown widget type
        return `Unknown: ${widget.type}`;
    };

    const hasFlexSeparator = widgets.some(widget => widget.type === 'flex-separator');
    const widthDetectionAvailable = canDetectTerminalWidth();
    const pickerCategories = widgetPicker
        ? [...widgetCategories]
        : [];
    const selectedPickerCategory = widgetPicker
        ? (widgetPicker.selectedCategory && pickerCategories.includes(widgetPicker.selectedCategory)
            ? widgetPicker.selectedCategory
            : (pickerCategories[0] ?? null))
        : null;
    const topLevelSearchEntries = widgetPicker?.level === 'category' && widgetPicker.categoryQuery.trim().length > 0
        ? filterWidgetCatalog(widgetCatalog, 'All', widgetPicker.categoryQuery)
        : [];
    const selectedTopLevelSearchEntry = widgetPicker
        ? (topLevelSearchEntries.find(entry => entry.type === widgetPicker.selectedType) ?? topLevelSearchEntries[0])
        : null;
    const pickerEntries = widgetPicker
        ? filterWidgetCatalog(widgetCatalog, selectedPickerCategory ?? 'All', widgetPicker.widgetQuery)
        : [];
    const selectedPickerEntry = widgetPicker
        ? (pickerEntries.find(entry => entry.type === widgetPicker.selectedType) ?? pickerEntries[0])
        : null;

    // Build dynamic help text based on selected item
    const currentWidget = widgets[activeWidgetIndex];
    const isSeparator = currentWidget?.type === 'separator';
    const isFlexSeparator = currentWidget?.type === 'flex-separator';
    const isTagRow = selectedRow?.kind === 'tag';
    const isAddTagRow = selectedRow?.kind === 'addTag';
    const isWidgetRow = selectedRow?.kind === 'widget';

    // Check if widget supports raw value using registry
    let canToggleRaw = false;
    let customKeybinds: CustomKeybind[] = [];
    if (currentWidget && !isSeparator && !isFlexSeparator) {
        const widgetImpl = getWidget(currentWidget.type);
        if (widgetImpl) {
            canToggleRaw = widgetImpl.supportsRawValue();
            // Get custom keybinds from the widget
            customKeybinds = getCustomKeybindsForWidget(widgetImpl, currentWidget);
        } else {
            canToggleRaw = false;
        }
    }

    const canMerge = currentWidget && activeWidgetIndex < widgets.length - 1 && !isSeparator && !isFlexSeparator;
    const hasWidgets = widgets.length > 0;

    // Build main help text (without custom keybinds)
    let helpText = hasWidgets
        ? '↑↓ select, ←→ open type picker'
        : '(a)dd via picker, (i)nsert via picker';
    if (isSeparator) {
        helpText += ', Space edit separator';
    }
    if (isTagRow) {
        helpText = '↑↓ select, Enter/e edit color, (a)dd tag, (r)ename, (d)elete';
    } else if (isAddTagRow) {
        helpText = '↑↓ select, Enter/a create new tag';
    } else if (hasWidgets && isWidgetRow) {
        helpText += ', Enter to move, (a)dd, (i)nsert, (d)elete, (c)lear line, co(n)ditional actions';
    }
    if (canToggleRaw) {
        helpText += ', (r)aw value';
    }
    if (canMerge) {
        helpText += ', (m)erge';
    }
    helpText += ', ESC back';

    // Build custom keybinds text
    const customKeybindsText = customKeybinds.map(kb => kb.label).join(', ');
    const pickerActionLabel = widgetPicker?.action === 'add'
        ? 'Add Widget'
        : widgetPicker?.action === 'insert'
            ? 'Insert Widget'
            : 'Change Widget Type';

    // If custom editor is active, render it instead of the normal UI
    if (customEditorWidget?.impl.renderEditor) {
        return customEditorWidget.impl.renderEditor({
            widget: customEditorWidget.widget,
            onComplete: handleEditorComplete,
            onCancel: handleEditorCancel,
            action: customEditorWidget.action
        });
    }

    if (colorMenuContext) {
        const targetWidget = widgets.find(w => w.id === colorMenuContext.widgetId);
        if (!targetWidget) {
            setColorMenuContext(null);
        } else {
            const title = colorMenuContext.tagKey
                ? `Configure Tag Color — ${colorMenuContext.tagKey}`
                : undefined;
            return (
                <ColorMenu
                    widgets={[targetWidget]}
                    settings={settings}
                    tagKey={colorMenuContext.tagKey}
                    title={title}
                    onUpdate={(updated) => {
                        const patched = updated[0];
                        if (!patched)
                            return;
                        const newWidgets = widgets.map(w => w.id === patched.id ? patched : w);
                        onUpdate(newWidgets);
                    }}
                    onBack={() => { setColorMenuContext(null); }}
                />
            );
        }
    }

    if (whenEditor) {
        const target = widgets[whenEditor.widgetIndex];
        if (!target) {
            setWhenEditor(null);
        } else {
            const widgetLabel = `Widget ${whenEditor.widgetIndex + 1}`;
            const whenBreadcrumbPrefix = groupNumber !== undefined
                ? `Edit Line ${lineNumber} › Group ${groupNumber} › ${widgetLabel}`
                : `Edit Line ${lineNumber} › ${widgetLabel}`;
            return (
                <WidgetWhenEditor
                    widget={target}
                    breadcrumbPrefix={whenBreadcrumbPrefix}
                    onUpdate={(updated) => {
                        const newWidgets = [...widgets];
                        newWidgets[whenEditor.widgetIndex] = updated;
                        onUpdate(newWidgets);
                    }}
                    onBack={() => { setWhenEditor(null); }}
                />
            );
        }
    }

    if (tagDelete) {
        return (
            <Box flexDirection='column'>
                <Text bold color='yellow'>
                    Remove tag '
                    {tagDelete.tagName}
                    '?
                </Text>
                <Box marginTop={1}>
                    <Text>
                        {tagDelete.refCount === 0
                            ? 'No rules reference this tag.'
                            : `${tagDelete.refCount} rule(s) reference this tag and will be removed.`}
                    </Text>
                </Box>
                <Box marginTop={1}>
                    <ConfirmDialog
                        inline={true}
                        onConfirm={() => {
                            const target = widgets[tagDelete.widgetIndex];
                            if (target) {
                                const newWidgets = [...widgets];
                                newWidgets[tagDelete.widgetIndex] = deleteTag(target, tagDelete.tagName);
                                onUpdate(newWidgets);
                            }
                            setTagDelete(null);
                        }}
                        onCancel={() => { setTagDelete(null); }}
                    />
                </Box>
            </Box>
        );
    }

    if (tagRename) {
        return (
            <Box flexDirection='column'>
                <Text bold>
                    Rename tag '
                    {tagRename.tagName}
                    '
                </Text>
                <Box marginTop={1}>
                    <Text>New name: </Text>
                    <Text color='cyan'>{tagRename.input || '(empty)'}</Text>
                </Box>
                {tagRename.error && (
                    <Box marginTop={1}>
                        <Text color='red'>{tagRename.error}</Text>
                    </Box>
                )}
                <Box marginTop={1}><Text dimColor>Enter to save, ESC to cancel</Text></Box>
            </Box>
        );
    }

    if (showClearConfirm) {
        return (
            <Box flexDirection='column'>
                <Text bold color='yellow'>⚠ Confirm Clear Line</Text>
                <Box marginTop={1} flexDirection='column'>
                    <Text>
                        This will remove all widgets from Line
                        {' '}
                        {lineNumber}
                        .
                    </Text>
                    <Text color='red'>This action cannot be undone!</Text>
                </Box>
                <Box marginTop={2}>
                    <Text>Continue?</Text>
                </Box>
                <Box marginTop={1}>
                    <ConfirmDialog
                        inline={true}
                        onConfirm={() => {
                            onUpdate([]);
                            setSelectedIndex(0);
                            setShowClearConfirm(false);
                        }}
                        onCancel={() => {
                            setShowClearConfirm(false);
                        }}
                    />
                </Box>
            </Box>
        );
    }

    // Breadcrumb: "Edit Line N › [Group M ›] Widget K" (spec requires 3-depth
    // when groupsEnabled). Use "Widget -" when the list is empty so the depth
    // marker is still visible at this navigation level.
    const widgetDepthLabel = widgets.length > 0
        ? `Widget ${selectedIndex + 1}`
        : 'Widget -';
    const breadcrumb = groupNumber !== undefined
        ? `Edit Line ${lineNumber} › Group ${groupNumber} › ${widgetDepthLabel} `
        : `Edit Line ${lineNumber} › ${widgetDepthLabel} `;

    return (
        <Box flexDirection='column'>
            <Box>
                <Text bold>
                    {breadcrumb}
                </Text>
                {moveMode && <Text color='blue'>[MOVE MODE]</Text>}
                {widgetPicker && <Text color='cyan'>{`[${pickerActionLabel.toUpperCase()}]`}</Text>}
                {(settings.powerline.enabled || Boolean(settings.defaultSeparator)) && (
                    <Box marginLeft={2}>
                        <Text color='yellow'>
                            ⚠
                            {' '}
                            {settings.powerline.enabled
                                ? 'Powerline mode active: manual separators disabled'
                                : 'Default separator active: manual separators disabled'}
                        </Text>
                    </Box>
                )}
            </Box>
            {moveMode ? (
                <Box flexDirection='column' marginBottom={1}>
                    <Text dimColor>↑↓ to move widget, ESC or Enter to exit move mode</Text>
                </Box>
            ) : widgetPicker ? (
                <Box flexDirection='column'>
                    {widgetPicker.level === 'category' ? (
                        <>
                            {widgetPicker.categoryQuery.trim().length > 0 ? (
                                <Text dimColor>↑↓ select widget match, Enter apply, ESC clear/cancel</Text>
                            ) : (
                                <Text dimColor>↑↓ select category, type to search all widgets, Enter continue, ESC cancel</Text>
                            )}
                            <Box>
                                <Text dimColor>Search: </Text>
                                <Text color='cyan'>{widgetPicker.categoryQuery || '(none)'}</Text>
                            </Box>
                        </>
                    ) : (
                        <>
                            <Text dimColor>↑↓ select widget, type to search widgets, Enter apply, ESC back</Text>
                            <Box>
                                <Text dimColor>
                                    Category:
                                    {' '}
                                    {selectedPickerCategory ?? '(none)'}
                                    {' '}
                                    | Search:
                                    {' '}
                                </Text>
                                <Text color='cyan'>{widgetPicker.widgetQuery || '(none)'}</Text>
                            </Box>
                        </>
                    )}
                </Box>
            ) : (
                <Box flexDirection='column'>
                    <Text dimColor>{helpText}</Text>
                    <Text dimColor>{customKeybindsText || ' '}</Text>
                </Box>
            )}
            {hasFlexSeparator && !widthDetectionAvailable && (
                <Box marginTop={1}>
                    <Text color='yellow'>⚠ Note: Terminal width detection is currently unavailable in your environment.</Text>
                    <Text dimColor>  Flex separators will act as normal separators until width detection is available.</Text>
                </Box>
            )}
            {widgetPicker && (
                <Box marginTop={1} flexDirection='column'>
                    {widgetPicker.level === 'category' ? (
                        widgetPicker.categoryQuery.trim().length > 0 ? (
                            topLevelSearchEntries.length === 0 ? (
                                <Text dimColor>No widgets match the search.</Text>
                            ) : (
                                <>
                                    {topLevelSearchEntries.map((entry, index) => {
                                        const isSelected = entry.type === selectedTopLevelSearchEntry?.type;
                                        const segments = getMatchSegments(entry.displayName, widgetPicker.categoryQuery);
                                        return (
                                            <Box key={entry.type} flexDirection='row' flexWrap='nowrap'>
                                                <Box width={3}>
                                                    <Text color={isSelected ? 'green' : undefined}>
                                                        {isSelected ? '▶ ' : '  '}
                                                    </Text>
                                                </Box>
                                                <Text color={isSelected ? 'green' : undefined}>{`${index + 1}. `}</Text>
                                                {segments.map((seg, i) => (
                                                    <Text
                                                        key={i}
                                                        color={isSelected ? 'green' : seg.matched ? 'yellowBright' : undefined}
                                                        bold={isSelected ? true : seg.matched}
                                                    >
                                                        {seg.text}
                                                    </Text>
                                                ))}
                                            </Box>
                                        );
                                    })}
                                    {selectedTopLevelSearchEntry && (
                                        <Box marginTop={1} paddingLeft={2}>
                                            <Text dimColor>{selectedTopLevelSearchEntry.description}</Text>
                                        </Box>
                                    )}
                                </>
                            )
                        ) : (
                            pickerCategories.length === 0 ? (
                                <Text dimColor>No categories available.</Text>
                            ) : (
                                <>
                                    {pickerCategories.map((category, index) => {
                                        const isSelected = category === selectedPickerCategory;
                                        return (
                                            <Box key={category} flexDirection='row' flexWrap='nowrap'>
                                                <Box width={3}>
                                                    <Text color={isSelected ? 'green' : undefined}>
                                                        {isSelected ? '▶ ' : '  '}
                                                    </Text>
                                                </Box>
                                                <Text color={isSelected ? 'green' : undefined}>
                                                    {`${index + 1}. ${category}`}
                                                </Text>
                                            </Box>
                                        );
                                    })}
                                    {selectedPickerCategory === 'All' && (
                                        <Box marginTop={1} paddingLeft={2}>
                                            <Text dimColor>Search across all widget categories.</Text>
                                        </Box>
                                    )}
                                </>
                            )
                        )
                    ) : (
                        pickerEntries.length === 0 ? (
                            <Text dimColor>No widgets match the current category/search.</Text>
                        ) : (
                            <>
                                {pickerEntries.map((entry, index) => {
                                    const isSelected = entry.type === selectedPickerEntry?.type;
                                    const segments = getMatchSegments(entry.displayName, widgetPicker.widgetQuery);
                                    return (
                                        <Box key={entry.type} flexDirection='row' flexWrap='nowrap'>
                                            <Box width={3}>
                                                <Text color={isSelected ? 'green' : undefined}>
                                                    {isSelected ? '▶ ' : '  '}
                                                </Text>
                                            </Box>
                                            <Text color={isSelected ? 'green' : undefined}>{`${index + 1}. `}</Text>
                                            {segments.map((seg, i) => (
                                                <Text
                                                    key={i}
                                                    color={isSelected ? 'green' : (seg.matched ? 'yellowBright' : undefined)}
                                                    bold={seg.matched}
                                                >
                                                    {seg.text}
                                                </Text>
                                            ))}
                                        </Box>
                                    );
                                })}
                                {selectedPickerEntry && (
                                    <Box marginTop={1} paddingLeft={2}>
                                        <Text dimColor>{selectedPickerEntry.description}</Text>
                                    </Box>
                                )}
                            </>
                        )
                    )}
                </Box>
            )}
            {!widgetPicker && (
                <Box marginTop={1} flexDirection='column'>
                    {rows.length === 0 ? (
                        <Text dimColor>No widgets. Press 'a' to add one.</Text>
                    ) : (
                        <>
                            {rows.map((row, rowIndex) => {
                                const isSelected = rowIndex === selectedIndex;
                                if (row.kind === 'widget') {
                                    const widget = row.widget;
                                    const widgetImpl = widget.type !== 'separator' && widget.type !== 'flex-separator' ? getWidget(widget.type) : null;
                                    const { displayText, modifierText } = widgetImpl?.getEditorDisplay(widget) ?? { displayText: getWidgetDisplay(widget) };
                                    const supportsRawValue = widgetImpl?.supportsRawValue() ?? false;
                                    return (
                                        <Box key={widget.id} flexDirection='row' flexWrap='nowrap'>
                                            <Box width={3}>
                                                <Text color={isSelected ? (moveMode ? 'blue' : 'green') : undefined}>
                                                    {isSelected ? (moveMode ? '◆ ' : '▶ ') : '  '}
                                                </Text>
                                            </Box>
                                            <Text color={isSelected ? (moveMode ? 'blue' : 'green') : undefined}>
                                                {`${row.widgetIndex + 1}. ${displayText || getWidgetDisplay(widget)}`}
                                            </Text>
                                            {modifierText && (
                                                <Text dimColor>
                                                    {' '}
                                                    {modifierText}
                                                </Text>
                                            )}
                                            {supportsRawValue && widget.rawValue && <Text dimColor> (raw value)</Text>}
                                            {widget.merge === true && <Text dimColor> (merged→)</Text>}
                                            {widget.merge === 'no-padding' && <Text dimColor> (merged-no-pad→)</Text>}
                                        </Box>
                                    );
                                }
                                if (row.kind === 'tag') {
                                    return (
                                        <Box key={`${row.widget.id}-tag-${row.tagName}`} flexDirection='row' flexWrap='nowrap'>
                                            <Box width={3}>
                                                <Text color={isSelected ? 'green' : undefined}>
                                                    {isSelected ? '▶ ' : '  '}
                                                </Text>
                                            </Box>
                                            <Text dimColor={!isSelected} color={isSelected ? 'green' : undefined}>
                                                {`    · ${row.tagName}`}
                                            </Text>
                                        </Box>
                                    );
                                }
                                // addTag
                                return (
                                    <Box key={`${row.widget.id}-addtag`} flexDirection='row' flexWrap='nowrap'>
                                        <Box width={3}>
                                            <Text color={isSelected ? 'green' : undefined}>
                                                {isSelected ? '▶ ' : '  '}
                                            </Text>
                                        </Box>
                                        <Text dimColor={!isSelected} color={isSelected ? 'green' : undefined}>
                                            {'    + Add tag…'}
                                        </Text>
                                    </Box>
                                );
                            })}
                            {/* Display description for selected widget */}
                            {currentWidget && (
                                <Box marginTop={1} paddingLeft={2}>
                                    <Text dimColor>
                                        {(() => {
                                            if (currentWidget.type === 'separator') {
                                                return 'A separator character between status line widgets';
                                            } else if (currentWidget.type === 'flex-separator') {
                                                return 'Expands to fill available terminal width';
                                            } else {
                                                const widgetImpl = getWidget(currentWidget.type);
                                                return widgetImpl ? widgetImpl.getDescription() : 'Unknown widget type';
                                            }
                                        })()}
                                    </Text>
                                </Box>
                            )}
                        </>
                    )}
                </Box>
            )}
        </Box>
    );
};