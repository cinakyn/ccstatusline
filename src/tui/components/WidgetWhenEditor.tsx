import {
    Box,
    Text,
    useInput
} from 'ink';
import React, {
    useMemo,
    useState
} from 'react';

import type { WhenRule } from '../../types/When';
import type { WidgetItem } from '../../types/Widget';
import { shouldInsertInput } from '../../utils/input-guards';
import {
    getEntry,
    listCategories,
    listPredicates,
    type WhenPredicateEntry
} from '../../utils/when-catalog';
import { getWidget } from '../../utils/widgets';

import { ConfirmDialog } from './ConfirmDialog';
import {
    addTag,
    countTagReferences,
    deleteTag,
    makeAutoTagName,
    renameTag,
    validateTagRename
} from './items-editor/tag-mutations';

export interface WidgetWhenEditorProps {
    widget: WidgetItem;
    onUpdate: (widget: WidgetItem) => void;
    onBack: () => void;
    /** Upstream path like "Edit Line 1 › Group 2 › Widget 3" — extended with " › Conditional actions". */
    breadcrumbPrefix?: string;
}

// ---------------------------------------------------------------------------
// Screen state — a small state machine drives the nested pickers.
//   list          → top-level rule list with Add / Edit / Delete affordances.
//   category      → pick category (with "All" search); mirrors widget picker.
//   predicate     → pick predicate within a category.
//   action        → choose Hide or Set tag.
//   tag           → pick a tag (Set tag only); supports add/rename/Del.
//   deleteRule    → confirm dialog for removing an existing rule.
//   deleteTag     → confirm dialog for removing a tag (shows refcount).
// ---------------------------------------------------------------------------

type Mode = 'list' | 'category' | 'predicate' | 'args' | 'action' | 'tag' | 'deleteRule' | 'deleteTag';

interface DraftRule {
    /** Index into `widget.when` when editing an existing rule; null when adding. */
    editingIndex: number | null;
    category: string | null;
    predicateKey: string | null;
    action: 'hide' | 'setTag' | null;
    tag: string | null;
    args: Record<string, string>;
}

const EMPTY_DRAFT: DraftRule = {
    editingIndex: null,
    category: null,
    predicateKey: null,
    action: null,
    tag: null,
    args: {}
};

interface TagRenameState {
    tagName: string;
    input: string;
    error: string | null;
}

interface DeleteRuleState { ruleIndex: number }

/**
 * Tag deletion flow is reached from two places:
 *   - the in-flow tag picker while adding/editing a setTag rule (`returnMode`
 *     = 'tag' so the user lands back on the picker)
 *   - the list-mode tag row ('returnMode' = 'list' so the user lands back on
 *     the main rules+tags list)
 */
interface DeleteTagState {
    tagName: string;
    refCount: number;
    returnMode: 'list' | 'tag';
}

type ListEntry
    = | { kind: 'rule'; ruleIndex: number }
        | { kind: 'noRules' }
        | { kind: 'tag'; tagName: string }
        | { kind: 'addTag' };

/**
 * Inline subsection editor for a widget's `when` rules. Accessible from the
 * ItemsEditor via the `w` keybind on a widget row. All nested pickers
 * (category → predicate → action → tag) reuse the keyboard semantics of the
 * widget-picker in ItemsEditor: ↑↓ navigation, `Enter` to continue,
 * `ESC` to back out, and number shortcuts `1..9` to jump to a row.
 *
 * The editor mutates a shadow copy of the widget and calls `onUpdate` on
 * every commit (new rule saved, rule edited, rule/tag deleted). It never
 * mutates the `when` array or `tags` map in place.
 */
export const WidgetWhenEditor: React.FC<WidgetWhenEditorProps> = ({ widget, onUpdate, onBack, breadcrumbPrefix }) => {
    const [mode, setMode] = useState<Mode>('list');
    const [listIndex, setListIndex] = useState(0);
    const [moveMode, setMoveMode] = useState(false);
    const [draft, setDraft] = useState<DraftRule>(EMPTY_DRAFT);
    const [pickerIndex, setPickerIndex] = useState(0);
    const [tagRename, setTagRename] = useState<TagRenameState | null>(null);
    const [deleteRuleState, setDeleteRuleState] = useState<DeleteRuleState | null>(null);
    const [deleteTagState, setDeleteTagState] = useState<DeleteTagState | null>(null);

    const rules: readonly WhenRule[] = useMemo(() => widget.when ?? [], [widget.when]);
    const widgetImpl = getWidget(widget.type);
    const widgetDisplayName = widgetImpl?.getDisplayName() ?? widget.type;

    const categories = useMemo(() => {
        const base = listCategories(widget);
        return ['All', ...base];
    }, [widget]);

    const predicateEntries = useMemo(() => {
        if (!draft.category)
            return [] as WhenPredicateEntry[];
        if (draft.category === 'All') {
            const all: WhenPredicateEntry[] = [];
            for (const c of listCategories(widget)) {
                for (const e of listPredicates(widget, c))
                    all.push(e);
            }
            return all;
        }
        return listPredicates(widget, draft.category);
    }, [widget, draft.category]);

    const tagNames = useMemo(() => (widget.tags ? Object.keys(widget.tags) : []), [widget.tags]);

    /**
     * Flat rows for list mode: every rule, then every tag, then a trailing
     * `+ Add tag…` row. The list always includes the addTag row so users can
     * mint the first tag without leaving this screen.
     */
    const listEntries = useMemo<ListEntry[]>(() => {
        const entries: ListEntry[] = [];
        if (rules.length === 0) {
            entries.push({ kind: 'noRules' });
        } else {
            for (let i = 0; i < rules.length; i++)
                entries.push({ kind: 'rule', ruleIndex: i });
        }
        for (const name of tagNames)
            entries.push({ kind: 'tag', tagName: name });
        entries.push({ kind: 'addTag' });
        return entries;
    }, [rules, tagNames]);
    const clampedListIndex = Math.min(Math.max(0, listIndex), Math.max(0, listEntries.length - 1));
    const selectedListEntry = listEntries[clampedListIndex];

    const commitWidget = (next: WidgetItem) => {
        onUpdate(next);
    };

    const commitRule = (rule: WhenRule, editingIndex: number | null) => {
        const nextWhen = [...rules];
        if (editingIndex !== null) {
            nextWhen[editingIndex] = rule;
        } else {
            nextWhen.push(rule);
        }
        commitWidget({ ...widget, when: nextWhen });
    };

    const enterAdd = () => {
        setDraft(EMPTY_DRAFT);
        setPickerIndex(0);
        setMode('category');
    };

    const enterEdit = (index: number) => {
        const rule = rules[index];
        if (!rule)
            return;
        const entry = getEntry(rule.on);
        setDraft({
            editingIndex: index,
            category: entry?.category ?? null,
            predicateKey: rule.on,
            action: rule.do,
            tag: rule.do === 'setTag' ? rule.tag : null,
            args: rule.args ? { ...rule.args } : {}
        });
        setPickerIndex(0);
        setMode('action');
    };

    const enterDeleteRule = (index: number) => {
        setDeleteRuleState({ ruleIndex: index });
        setMode('deleteRule');
    };

    const backToList = () => {
        setDraft(EMPTY_DRAFT);
        setPickerIndex(0);
        setTagRename(null);
        setDeleteRuleState(null);
        setDeleteTagState(null);
        setMode('list');
    };

    // -----------------------------------------------------------------------
    // Input handlers per mode
    // -----------------------------------------------------------------------

    useInput((input, key) => {
        if (mode === 'deleteRule' || mode === 'deleteTag')
            return; // ConfirmDialog handles input
        if (tagRename) {
            handleTagRenameInput(input, key);
            return;
        }

        switch (mode) {
            case 'list':
                handleListInput(input, key);
                return;
            case 'category':
                handlePickerNavigation(input, key, categories.length, {
                    onEnter: () => {
                        const selected = categories[pickerIndex];
                        if (!selected)
                            return;
                        setDraft(prev => ({ ...prev, category: selected, predicateKey: null }));
                        setPickerIndex(0);
                        setMode('predicate');
                    },
                    onBack: backToList
                });
                return;
            case 'predicate':
                handlePickerNavigation(input, key, predicateEntries.length, {
                    onEnter: () => {
                        const entry = predicateEntries[pickerIndex];
                        if (!entry)
                            return;
                        // core.empty may only pair with hide; skip action picker in that case.
                        if (entry.key === 'core.empty') {
                            commitRule({ on: entry.key, do: 'hide' }, draft.editingIndex);
                            backToList();
                            return;
                        }
                        setDraft(prev => ({ ...prev, predicateKey: entry.key, args: {} }));
                        setPickerIndex(0);
                        if (entry.requiredArgs && entry.requiredArgs.length > 0) {
                            setMode('args');
                            return;
                        }
                        setMode('action');
                    },
                    onBack: () => {
                        setPickerIndex(0);
                        setMode('category');
                    }
                });
                return;
            case 'args':
                handleArgsInput(input, key);
                return;
            case 'action':
                handlePickerNavigation(input, key, 2, {
                    onEnter: () => {
                        const choice: 'hide' | 'setTag' = pickerIndex === 0 ? 'hide' : 'setTag';
                        if (!draft.predicateKey)
                            return;
                        const argsPayload = Object.keys(draft.args).length > 0 ? { ...draft.args } : undefined;
                        if (choice === 'hide') {
                            commitRule({
                                on: draft.predicateKey,
                                do: 'hide',
                                ...(argsPayload ? { args: argsPayload } : {})
                            }, draft.editingIndex);
                            backToList();
                            return;
                        }
                        setDraft(prev => ({ ...prev, action: 'setTag' }));
                        setPickerIndex(0);
                        setMode('tag');
                    },
                    onBack: () => {
                        if (draft.editingIndex !== null) {
                            backToList();
                            return;
                        }
                        setPickerIndex(0);
                        const entry = draft.predicateKey ? getEntry(draft.predicateKey) : null;
                        if (entry?.requiredArgs && entry.requiredArgs.length > 0) {
                            setMode('args');
                            return;
                        }
                        setMode('predicate');
                    }
                });
                return;
            case 'tag':
                handleTagPickerInput(input, key);
                return;
        }
    });

    function handleListInput(input: string, key: InkKey) {
        if (moveMode) {
            handleMoveModeInput(key);
            return;
        }
        if (key.escape) {
            onBack();
            return;
        }
        if (key.upArrow) {
            setListIndex(Math.max(0, clampedListIndex - 1));
            return;
        }
        if (key.downArrow) {
            setListIndex(Math.min(listEntries.length - 1, clampedListIndex + 1));
            return;
        }
        const entry = selectedListEntry;
        if (!entry)
            return;
        // Enter: rules enter move-mode, addTag mints a tag, tag rows are inert.
        if (key.return) {
            if (entry.kind === 'rule') {
                setMoveMode(true);
                return;
            }
            if (entry.kind === 'addTag') {
                addNewTag();
            }
            return;
        }
        if (input === 'a' || input === 'A') {
            // Context-sensitive: rule / noRules rows add a rule; tag /
            // addTag rows mint a tag. This mirrors the ItemsEditor convention
            // where `a` means "add whatever is on this line's axis".
            if (entry.kind === 'tag' || entry.kind === 'addTag') {
                addNewTag();
                return;
            }
            enterAdd();
            return;
        }
        if (entry.kind === 'rule') {
            if (input === 'e' || input === 'E') {
                enterEdit(entry.ruleIndex);
                return;
            }
            if (key.delete || input === 'd' || input === 'D') {
                enterDeleteRule(entry.ruleIndex);
                return;
            }
        }
        if (entry.kind === 'tag') {
            if (input === 'r' || input === 'R') {
                setTagRename({ tagName: entry.tagName, input: entry.tagName, error: null });
                return;
            }
            if (key.delete || input === 'd' || input === 'D') {
                const refCount = countTagReferences(widget, entry.tagName);
                setDeleteTagState({ tagName: entry.tagName, refCount, returnMode: 'list' });
                setMode('deleteTag');
                return;
            }
        }
    }

    /**
     * Add a fresh auto-named tag from the list view. Selection jumps to the
     * new tag so follow-up rename / delete keybinds operate on it without
     * another scroll.
     */
    function addNewTag() {
        const name = makeAutoTagName(widget.tags);
        commitWidget(addTag(widget, name));
        // Rules block contributes `rules.length` entries, or a single
        // `noRules` row when empty. The new tag lands at the end of the tag
        // block so we jump to position `rulesBlockLen + tagNames.length`.
        const rulesBlockLen = rules.length === 0 ? 1 : rules.length;
        setListIndex(rulesBlockLen + tagNames.length);
    }

    function handleMoveModeInput(key: InkKey) {
        if (key.escape || key.return) {
            setMoveMode(false);
            return;
        }
        const entry = selectedListEntry;
        // Move-mode is rule-only; swap with the adjacent rule. Tag rows and
        // the addTag row are pinned below the rules block and never move.
        if (entry?.kind !== 'rule')
            return;
        if (rules.length < 2)
            return;
        const i = entry.ruleIndex;
        if (key.upArrow && i > 0) {
            const next = [...rules];
            const curr = next[i];
            const prev = next[i - 1];
            if (curr && prev) {
                next[i - 1] = curr;
                next[i] = prev;
                commitWidget({ ...widget, when: next });
                setListIndex(clampedListIndex - 1);
            }
            return;
        }
        if (key.downArrow && i < rules.length - 1) {
            const next = [...rules];
            const curr = next[i];
            const below = next[i + 1];
            if (curr && below) {
                next[i] = below;
                next[i + 1] = curr;
                commitWidget({ ...widget, when: next });
                setListIndex(clampedListIndex + 1);
            }
            return;
        }
    }

    function handleArgsInput(input: string, key: InkKey) {
        if (!draft.predicateKey)
            return;
        const entry = getEntry(draft.predicateKey);
        const argKey = entry?.requiredArgs?.[0];
        if (!argKey)
            return;
        if (key.escape) {
            setPickerIndex(0);
            setMode('predicate');
            return;
        }
        if (key.return) {
            const value = (draft.args[argKey] ?? '').trim();
            if (value.length === 0)
                return;
            // Validate that pattern is a well-formed regex before moving on,
            // so the user catches typos at edit time rather than at render.
            if (argKey === 'pattern') {
                try {
                    new RegExp(value);
                } catch {
                    return;
                }
            }
            setDraft(prev => ({ ...prev, args: { ...prev.args, [argKey]: value } }));
            setPickerIndex(0);
            setMode('action');
            return;
        }
        if (key.backspace || key.delete) {
            setDraft((prev) => {
                const current = prev.args[argKey] ?? '';
                return { ...prev, args: { ...prev.args, [argKey]: current.slice(0, -1) } };
            });
            return;
        }
        if (shouldInsertInput(input, key)) {
            setDraft((prev) => {
                const current = prev.args[argKey] ?? '';
                return { ...prev, args: { ...prev.args, [argKey]: current + input } };
            });
        }
    }

    function handlePickerNavigation(
        input: string,
        key: InkKey,
        length: number,
        handlers: { onEnter: () => void; onBack: () => void }
    ) {
        if (key.escape) {
            handlers.onBack();
            return;
        }
        if (key.upArrow) {
            setPickerIndex(Math.max(0, pickerIndex - 1));
            return;
        }
        if (key.downArrow) {
            setPickerIndex(Math.min(Math.max(0, length - 1), pickerIndex + 1));
            return;
        }
        if (key.return) {
            handlers.onEnter();
            return;
        }
        if (input && /^[1-9]$/.test(input)) {
            const n = parseInt(input, 10) - 1;
            if (n < length) {
                setPickerIndex(n);
            }
        }
    }

    function handleTagPickerInput(input: string, key: InkKey) {
        if (key.escape) {
            setPickerIndex(0);
            setMode('action');
            return;
        }
        if (key.upArrow) {
            setPickerIndex(Math.max(0, pickerIndex - 1));
            return;
        }
        if (key.downArrow) {
            setPickerIndex(Math.min(Math.max(0, tagNames.length - 1), pickerIndex + 1));
            return;
        }
        if (key.return) {
            const chosen = tagNames[pickerIndex];
            if (!chosen || !draft.predicateKey)
                return;
            const argsPayload = Object.keys(draft.args).length > 0 ? { ...draft.args } : undefined;
            commitRule({
                on: draft.predicateKey,
                do: 'setTag',
                tag: chosen,
                ...(argsPayload ? { args: argsPayload } : {})
            }, draft.editingIndex);
            backToList();
            return;
        }
        if (input === 'a' || input === 'A') {
            const name = makeAutoTagName(widget.tags);
            commitWidget(addTag(widget, name));
            // Stay in tag mode so the user can rename/delete/select the new tag.
            setPickerIndex(tagNames.length);
            return;
        }
        if (input === 'r' || input === 'R') {
            const target = tagNames[pickerIndex];
            if (!target)
                return;
            setTagRename({ tagName: target, input: target, error: null });
            return;
        }
        if (key.delete || input === 'd' || input === 'D') {
            const target = tagNames[pickerIndex];
            if (!target)
                return;
            const refCount = countTagReferences(widget, target);
            setDeleteTagState({ tagName: target, refCount, returnMode: 'tag' });
            setMode('deleteTag');
            return;
        }
        if (input && /^[1-9]$/.test(input)) {
            const n = parseInt(input, 10) - 1;
            if (n < tagNames.length) {
                setPickerIndex(n);
            }
        }
    }

    function handleTagRenameInput(input: string, key: InkKey) {
        if (!tagRename)
            return;
        if (key.escape) {
            setTagRename(null);
            return;
        }
        if (key.return) {
            const proposed = tagRename.input.trim();
            const err = validateTagRename(widget, tagRename.tagName, proposed);
            if (err === null) {
                if (proposed !== tagRename.tagName) {
                    commitWidget(renameTag(widget, tagRename.tagName, proposed));
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
    }

    // -----------------------------------------------------------------------
    // Render helpers
    // -----------------------------------------------------------------------

    /**
     * Keybind hint tailored to the currently-focused list row. Rules show the
     * rule verbs; tags show the tag verbs; the addTag affordance shows the
     * create verb. Falls back to the rules hint while the list is empty so
     * users still see a viable starting keystroke.
     */
    const listHelpText = (entry: ListEntry | undefined): string => {
        if (!entry || entry.kind === 'rule')
            return '↑↓ select, Enter to move, (a)dd rule, (e)dit, (d)elete, ESC back';
        if (entry.kind === 'noRules')
            return '↑↓ select, (a)dd rule, ESC back';
        if (entry.kind === 'tag')
            return '↑↓ select, (a)dd tag, (r)ename, (d)elete, ESC back';
        return '↑↓ select, Enter/a create tag, ESC back';
    };

    const renderRuleLabel = (rule: WhenRule): string => {
        const entry = getEntry(rule.on);
        const baseLabel = entry ? `${entry.category}: ${entry.label}` : rule.on;
        const argSuffix = rule.args?.pattern ? ` /${rule.args.pattern}/` : '';
        const label = `${baseLabel}${argSuffix}`;
        if (rule.do === 'hide')
            return `${label} → Hide Widget`;
        return `${label} → Set tag: ${rule.tag}`;
    };

    if (mode === 'deleteRule' && deleteRuleState) {
        const rule = rules[deleteRuleState.ruleIndex];
        return (
            <Box flexDirection='column'>
                <Text bold color='yellow'>Remove conditional action?</Text>
                <Box marginTop={1}><Text>{rule ? renderRuleLabel(rule) : ''}</Text></Box>
                <Box marginTop={1}>
                    <ConfirmDialog
                        inline={true}
                        onConfirm={() => {
                            const nextWhen = rules.filter((_, i) => i !== deleteRuleState.ruleIndex);
                            const nextWidget: WidgetItem = { ...widget };
                            if (nextWhen.length > 0)
                                nextWidget.when = nextWhen;
                            else
                                delete nextWidget.when;
                            commitWidget(nextWidget);
                            backToList();
                        }}
                        onCancel={backToList}
                    />
                </Box>
            </Box>
        );
    }

    if (mode === 'deleteTag' && deleteTagState) {
        const returnMode = deleteTagState.returnMode;
        return (
            <Box flexDirection='column'>
                <Text bold color='yellow'>
                    Remove tag '
                    {deleteTagState.tagName}
                    '?
                </Text>
                <Box marginTop={1}>
                    <Text>
                        {deleteTagState.refCount === 0
                            ? 'No conditional actions reference this tag.'
                            : `${deleteTagState.refCount} conditional action(s) reference this tag and will be removed.`}
                    </Text>
                </Box>
                <Box marginTop={1}>
                    <ConfirmDialog
                        inline={true}
                        onConfirm={() => {
                            commitWidget(deleteTag(widget, deleteTagState.tagName));
                            setDeleteTagState(null);
                            setPickerIndex(0);
                            setMode(returnMode);
                        }}
                        onCancel={() => {
                            setDeleteTagState(null);
                            setMode(returnMode);
                        }}
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

    const modeSuffix = mode === 'category'
        ? ' › Select condition category'
        : mode === 'predicate'
            ? ' › Select condition'
            : mode === 'args'
                ? ' › Enter pattern'
                : mode === 'action'
                    ? ' › Select action'
                    : mode === 'tag'
                        ? ' › Tags'
                        : '';
    const breadcrumb = breadcrumbPrefix
        ? `${breadcrumbPrefix} › Conditional actions${modeSuffix}`
        : `Conditional actions — ${widgetDisplayName}${modeSuffix}`;

    return (
        <Box flexDirection='column'>
            <Text bold>
                {breadcrumb}
            </Text>
            {mode === 'list' && (
                <>
                    {moveMode ? (
                        <Text color='blue'>[MOVE MODE] ↑↓ move, Enter/ESC done</Text>
                    ) : (
                        <Text dimColor>{listHelpText(selectedListEntry)}</Text>
                    )}
                    <Text dimColor>Priority: rule 1 is highest — first match wins per field.</Text>
                    <Box marginTop={1} flexDirection='column'>
                        <Text bold>Rules</Text>
                        {rules.length === 0 ? (() => {
                            const isSelected = selectedListEntry?.kind === 'noRules';
                            const color = isSelected ? 'green' : undefined;
                            const marker = isSelected ? '▶ ' : '  ';
                            return (
                                <Box flexDirection='row' flexWrap='nowrap'>
                                    <Box width={3}><Text color={color}>{marker}</Text></Box>
                                    <Text color={color} dimColor={!isSelected}>No conditional actions. Press 'a' to add one.</Text>
                                </Box>
                            );
                        })() : (
                            rules.map((rule, i) => {
                                const isSelected = clampedListIndex === i && selectedListEntry?.kind === 'rule';
                                const color = isSelected ? (moveMode ? 'blue' : 'green') : undefined;
                                const marker = isSelected ? (moveMode ? '◆ ' : '▶ ') : '  ';
                                return (
                                    <Box key={i} flexDirection='row' flexWrap='nowrap'>
                                        <Box width={3}><Text color={color}>{marker}</Text></Box>
                                        <Text color={color}>
                                            {`${i + 1}. ${renderRuleLabel(rule)}`}
                                        </Text>
                                    </Box>
                                );
                            })
                        )}
                    </Box>
                    <Box marginTop={1} flexDirection='column'>
                        <Text bold>Tags</Text>
                        <Text dimColor>Tags override the widget's color / style — edit a tag's colors via the Colors menu.</Text>
                        {(() => {
                            const rulesBlockLen = rules.length === 0 ? 1 : rules.length;
                            return (
                                <>
                                    {tagNames.map((name, i) => {
                                        const entryIndex = rulesBlockLen + i;
                                        const isSelected = clampedListIndex === entryIndex && selectedListEntry?.kind === 'tag';
                                        const color = isSelected ? 'green' : undefined;
                                        const marker = isSelected ? '▶ ' : '  ';
                                        return (
                                            <Box key={name} flexDirection='row' flexWrap='nowrap'>
                                                <Box width={3}><Text color={color}>{marker}</Text></Box>
                                                <Text color={color} dimColor={!isSelected}>{`· ${name}`}</Text>
                                            </Box>
                                        );
                                    })}
                                    {(() => {
                                        const entryIndex = rulesBlockLen + tagNames.length;
                                        const isSelected = clampedListIndex === entryIndex && selectedListEntry?.kind === 'addTag';
                                        const color = isSelected ? 'green' : undefined;
                                        const marker = isSelected ? '▶ ' : '  ';
                                        return (
                                            <Box flexDirection='row' flexWrap='nowrap'>
                                                <Box width={3}><Text color={color}>{marker}</Text></Box>
                                                <Text color={color} dimColor={!isSelected}>+ Add tag…</Text>
                                            </Box>
                                        );
                                    })()}
                                </>
                            );
                        })()}
                    </Box>
                </>
            )}
            {mode === 'category' && (
                <>
                    <Text dimColor>↑↓ select category, Enter continue, ESC cancel</Text>
                    <Box marginTop={1} flexDirection='column'>
                        {categories.map((cat, i) => {
                            const isSelected = i === pickerIndex;
                            return (
                                <Box key={cat} flexDirection='row' flexWrap='nowrap'>
                                    <Box width={3}><Text color={isSelected ? 'green' : undefined}>{isSelected ? '▶ ' : '  '}</Text></Box>
                                    <Text color={isSelected ? 'green' : undefined}>{`${i + 1}. ${cat}`}</Text>
                                </Box>
                            );
                        })}
                    </Box>
                </>
            )}
            {mode === 'predicate' && (
                <>
                    <Text dimColor>
                        ↑↓ select condition, Enter continue, ESC back
                    </Text>
                    <Box marginTop={1} flexDirection='column'>
                        {predicateEntries.length === 0 ? (
                            <Text dimColor>No conditions available for this widget.</Text>
                        ) : (
                            predicateEntries.map((entry, i) => {
                                const isSelected = i === pickerIndex;
                                return (
                                    <Box key={entry.key} flexDirection='row' flexWrap='nowrap'>
                                        <Box width={3}><Text color={isSelected ? 'green' : undefined}>{isSelected ? '▶ ' : '  '}</Text></Box>
                                        <Text color={isSelected ? 'green' : undefined}>
                                            {`${i + 1}. ${entry.label}`}
                                        </Text>
                                        <Text dimColor>
                                            {`   (${entry.category})`}
                                        </Text>
                                    </Box>
                                );
                            })
                        )}
                    </Box>
                </>
            )}
            {mode === 'args' && (() => {
                const entry = draft.predicateKey ? getEntry(draft.predicateKey) : null;
                const argKey = entry?.requiredArgs?.[0] ?? '';
                const value = draft.args[argKey] ?? '';
                const isPattern = argKey === 'pattern';
                let regexError: string | null = null;
                if (isPattern && value.length > 0) {
                    try {
                        new RegExp(value);
                    } catch (err) {
                        regexError = err instanceof Error ? err.message : 'Invalid regex';
                    }
                }
                return (
                    <>
                        <Text dimColor>
                            {isPattern
                                ? 'Type a regex. Enter to confirm (matches against the widget\'s rendered text), ESC to cancel.'
                                : `Enter value for ${argKey}. Enter to confirm, ESC to cancel.`}
                        </Text>
                        <Box marginTop={1}>
                            <Text>
                                {isPattern ? 'Pattern: ' : `${argKey}: `}
                            </Text>
                            <Text color='cyan'>{value.length > 0 ? value : '(empty)'}</Text>
                        </Box>
                        {regexError && (
                            <Box marginTop={1}>
                                <Text color='red'>{regexError}</Text>
                            </Box>
                        )}
                    </>
                );
            })()}
            {mode === 'action' && (
                <>
                    <Text dimColor>↑↓ select action, Enter continue, ESC back</Text>
                    <Box marginTop={1} flexDirection='column'>
                        {([
                            { label: 'Hide Widget', hint: 'hide the widget from the status line' },
                            { label: 'Set Tag…', hint: 'apply a tag to override widget color / style' }
                        ] as const).map((entry, i) => {
                            const isSelected = i === pickerIndex;
                            return (
                                <Box key={entry.label} flexDirection='row' flexWrap='nowrap'>
                                    <Box width={3}><Text color={isSelected ? 'green' : undefined}>{isSelected ? '▶ ' : '  '}</Text></Box>
                                    <Text color={isSelected ? 'green' : undefined}>{`${i + 1}. ${entry.label}`}</Text>
                                    <Text dimColor>{`   (${entry.hint})`}</Text>
                                </Box>
                            );
                        })}
                    </Box>
                </>
            )}
            {mode === 'tag' && (
                <>
                    <Text dimColor>Enter bind selected tag to this rule, (a)dd tag, (r)ename, (d)elete, ESC back</Text>
                    <Text dimColor>Tags override the widget's color / style — edit a tag's colors via the Colors menu.</Text>
                    <Box marginTop={1} flexDirection='column'>
                        {tagNames.length === 0 ? (
                            <Text dimColor>No tags yet. Press 'a' to add one.</Text>
                        ) : (
                            tagNames.map((name, i) => {
                                const isSelected = i === pickerIndex;
                                return (
                                    <Box key={name} flexDirection='row' flexWrap='nowrap'>
                                        <Box width={3}><Text color={isSelected ? 'green' : undefined}>{isSelected ? '▶ ' : '  '}</Text></Box>
                                        <Text color={isSelected ? 'green' : undefined}>{`${i + 1}. ${name}`}</Text>
                                    </Box>
                                );
                            })
                        )}
                    </Box>
                </>
            )}
        </Box>
    );
};

interface InkKey {
    upArrow?: boolean;
    downArrow?: boolean;
    return?: boolean;
    escape?: boolean;
    backspace?: boolean;
    delete?: boolean;
    ctrl?: boolean;
    meta?: boolean;
    tab?: boolean;
    shift?: boolean;
}