import type { WhenRule } from '../../../types/When';
import type {
    TagStyle,
    WidgetItem
} from '../../../types/Widget';

/**
 * Returns a name of the form `New Tag (N)` where N is the smallest positive
 * integer that is not already a key in `existing`. Used when the UI mints a
 * new tag without prompting for a name — both the ItemsEditor `a` keybind
 * and the Conditional actions tag picker rely on this helper.
 */
export function makeAutoTagName(existing: Readonly<Record<string, TagStyle>> | undefined): string {
    const taken = new Set(Object.keys(existing ?? {}));
    for (let n = 1; n < 10_000; n++) {
        const candidate = `New Tag (${n})`;
        if (!taken.has(candidate))
            return candidate;
    }
    // Fallback — practically unreachable.
    return `New Tag (${Date.now()})`;
}

/** Count of `when` rules on `item` that reference `tagName` via `setTag`. */
export function countTagReferences(item: WidgetItem, tagName: string): number {
    if (!item.when)
        return 0;
    return item.when.filter(rule => rule.do === 'setTag' && rule.tag === tagName).length;
}

/** Return `item` with `tagName` added to `tags` and no other changes. */
export function addTag(item: WidgetItem, tagName: string, style: TagStyle = {}): WidgetItem {
    return {
        ...item,
        tags: { ...(item.tags ?? {}), [tagName]: style }
    };
}

/**
 * Delete `tagName` from `item.tags` and prune any `when` rules that refer to
 * it via `setTag`. Returns the same reference when the tag does not exist.
 */
export function deleteTag(item: WidgetItem, tagName: string): WidgetItem {
    if (!item.tags || !(tagName in item.tags))
        return item;
    const nextTags: Record<string, TagStyle> = {};
    for (const [k, v] of Object.entries(item.tags)) {
        if (k !== tagName)
            nextTags[k] = v;
    }
    const nextWhen = item.when
        ? item.when.filter(rule => !(rule.do === 'setTag' && rule.tag === tagName))
        : undefined;
    const result: WidgetItem = { ...item };
    if (Object.keys(nextTags).length > 0)
        result.tags = nextTags;
    else
        delete result.tags;
    if (nextWhen && nextWhen.length > 0)
        result.when = nextWhen;
    else
        delete result.when;
    return result;
}

export type RenameTagError = 'empty' | 'duplicate' | 'missing';

/**
 * Validate a proposed rename of `oldName` to `newName` within `item.tags`.
 * Returns an error string for one of the known failure modes, or `null` if
 * the rename is valid. An unchanged name (`oldName === newName`) is valid
 * (the caller may no-op).
 */
export function validateTagRename(item: WidgetItem, oldName: string, newName: string): RenameTagError | null {
    const trimmed = newName.trim();
    if (trimmed.length === 0)
        return 'empty';
    if (!item.tags || !(oldName in item.tags))
        return 'missing';
    if (trimmed === oldName)
        return null;
    if (trimmed in item.tags)
        return 'duplicate';
    return null;
}

/**
 * Rename `oldName` to `newName` in `item.tags`, rewriting any `when` rules
 * that reference the old tag via `setTag`. Caller should run
 * {@link validateTagRename} first; this helper assumes the names are valid
 * and the rename is safe.
 */
export function renameTag(item: WidgetItem, oldName: string, newName: string): WidgetItem {
    if (oldName === newName || !item.tags || !(oldName in item.tags))
        return item;
    const tags = item.tags;
    const style = tags[oldName];
    const nextTags: Record<string, TagStyle> = {};
    for (const [k, v] of Object.entries(tags)) {
        if (k === oldName)
            continue;
        nextTags[k] = v;
    }
    if (style !== undefined)
        nextTags[newName] = style;
    const nextWhen: WhenRule[] | undefined = item.when?.map((rule) => {
        if (rule.do === 'setTag' && rule.tag === oldName)
            return { ...rule, tag: newName };
        return rule;
    });
    const result: WidgetItem = { ...item, tags: nextTags };
    if (nextWhen)
        result.when = nextWhen;
    return result;
}