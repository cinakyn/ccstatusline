import type {
    TagStyle,
    WidgetItem
} from '../../../types/Widget';
import { getWidget } from '../../../utils/widgets';

export function updateWidgetById(
    widgets: WidgetItem[],
    widgetId: string,
    updater: (widget: WidgetItem) => WidgetItem
): WidgetItem[] {
    return widgets.map(widget => widget.id === widgetId ? updater(widget) : widget);
}

/**
 * Merge `patch` into `widget.tags[tagKey]`, creating the tag entry when
 * absent. An `undefined` field in `patch` clears the corresponding field on
 * the stored `TagStyle`. Returns a new widget; the original is untouched.
 *
 * Used by {@link setWidgetColor}, {@link toggleWidgetBold}, and related
 * helpers when ColorMenu is operating in "tag variant" mode via its
 * optional `tagKey` prop.
 */
function patchTagStyle(
    widget: WidgetItem,
    tagKey: string,
    patch: Partial<TagStyle>
): WidgetItem {
    const tags = { ...(widget.tags ?? {}) };
    const current = tags[tagKey] ?? {};
    const merged: TagStyle = {
        color: 'color' in patch ? patch.color : current.color,
        backgroundColor: 'backgroundColor' in patch ? patch.backgroundColor : current.backgroundColor,
        bold: 'bold' in patch ? patch.bold : current.bold
    };
    const next: TagStyle = {};
    if (merged.color !== undefined)
        next.color = merged.color;
    if (merged.backgroundColor !== undefined)
        next.backgroundColor = merged.backgroundColor;
    if (merged.bold !== undefined)
        next.bold = merged.bold;
    tags[tagKey] = next;
    return { ...widget, tags };
}

export function setWidgetColor(
    widgets: WidgetItem[],
    widgetId: string,
    color: string,
    editingBackground: boolean,
    tagKey?: string
): WidgetItem[] {
    return updateWidgetById(widgets, widgetId, (widget) => {
        if (tagKey) {
            return patchTagStyle(widget, tagKey, editingBackground
                ? { backgroundColor: color }
                : { color });
        }
        if (editingBackground) {
            return {
                ...widget,
                backgroundColor: color
            };
        }

        return {
            ...widget,
            color
        };
    });
}

export function toggleWidgetBold(widgets: WidgetItem[], widgetId: string, tagKey?: string): WidgetItem[] {
    return updateWidgetById(widgets, widgetId, (widget) => {
        if (tagKey) {
            const current = widget.tags?.[tagKey]?.bold ?? false;
            return patchTagStyle(widget, tagKey, { bold: !current });
        }
        return {
            ...widget,
            bold: !widget.bold
        };
    });
}

export function resetWidgetStyling(widgets: WidgetItem[], widgetId: string, tagKey?: string): WidgetItem[] {
    return updateWidgetById(widgets, widgetId, (widget) => {
        if (tagKey) {
            return patchTagStyle(widget, tagKey, { color: undefined, backgroundColor: undefined, bold: undefined });
        }
        const {
            color,
            backgroundColor,
            bold,
            ...restWidget
        } = widget;
        void color; // Intentionally unused
        void backgroundColor; // Intentionally unused
        void bold; // Intentionally unused
        return restWidget;
    });
}

export function clearAllWidgetStyling(widgets: WidgetItem[], tagKey?: string): WidgetItem[] {
    return widgets.map((widget) => {
        if (tagKey) {
            return patchTagStyle(widget, tagKey, { color: undefined, backgroundColor: undefined, bold: undefined });
        }
        const {
            color,
            backgroundColor,
            bold,
            ...restWidget
        } = widget;
        void color; // Intentionally unused
        void backgroundColor; // Intentionally unused
        void bold; // Intentionally unused
        return restWidget;
    });
}

function getDefaultForegroundColor(widget: WidgetItem): string {
    if (widget.type === 'separator' || widget.type === 'flex-separator') {
        return 'white';
    }

    const widgetImpl = getWidget(widget.type);
    return widgetImpl ? widgetImpl.getDefaultColor() : 'white';
}

function getNextIndex(currentIndex: number, length: number, direction: 'left' | 'right'): number {
    if (direction === 'right') {
        return (currentIndex + 1) % length;
    }

    return currentIndex === 0 ? length - 1 : currentIndex - 1;
}

export interface CycleWidgetColorOptions {
    widgets: WidgetItem[];
    widgetId: string;
    direction: 'left' | 'right';
    editingBackground: boolean;
    colors: string[];
    backgroundColors: string[];
    tagKey?: string;
}

export function cycleWidgetColor({
    widgets,
    widgetId,
    direction,
    editingBackground,
    colors,
    backgroundColors,
    tagKey
}: CycleWidgetColorOptions): WidgetItem[] {
    return updateWidgetById(widgets, widgetId, (widget) => {
        if (editingBackground) {
            if (backgroundColors.length === 0) {
                return widget;
            }

            const currentBgColor = (tagKey
                ? widget.tags?.[tagKey]?.backgroundColor
                : widget.backgroundColor) ?? '';
            let currentBgColorIndex = backgroundColors.indexOf(currentBgColor);
            if (currentBgColorIndex === -1) {
                currentBgColorIndex = 0;
            }

            const nextBgColorIndex = getNextIndex(currentBgColorIndex, backgroundColors.length, direction);
            const nextBgColor = backgroundColors[nextBgColorIndex];
            const nextValue = nextBgColor === '' ? undefined : nextBgColor;

            if (tagKey) {
                return patchTagStyle(widget, tagKey, { backgroundColor: nextValue });
            }
            return {
                ...widget,
                backgroundColor: nextValue
            };
        }

        if (colors.length === 0) {
            return widget;
        }

        const defaultColor = getDefaultForegroundColor(widget);
        const sourceColor = tagKey ? widget.tags?.[tagKey]?.color : widget.color;
        let currentColor = sourceColor ?? defaultColor;
        if (currentColor === 'dim') {
            currentColor = defaultColor;
        }

        let currentColorIndex = colors.indexOf(currentColor);
        if (currentColorIndex === -1) {
            currentColorIndex = 0;
        }

        const nextColorIndex = getNextIndex(currentColorIndex, colors.length, direction);
        const nextColor = colors[nextColorIndex];

        if (tagKey) {
            return patchTagStyle(widget, tagKey, { color: nextColor });
        }
        return {
            ...widget,
            color: nextColor
        };
    });
}