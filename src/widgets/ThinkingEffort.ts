import type { RenderContext } from '../types/RenderContext';
import type { Settings } from '../types/Settings';
import type {
    StatefulWidget,
    WidgetEditorDisplay,
    WidgetItem
} from '../types/Widget';
import { loadClaudeSettingsSync } from '../utils/claude-settings';
import {
    getTranscriptThinkingEffort,
    normalizeThinkingEffort,
    type ResolvedThinkingEffort,
    type TranscriptThinkingEffort
} from '../utils/jsonl';
import {
    readCachedThinkingEffort,
    writeCachedThinkingEffort
} from '../utils/thinking-effort-cache';

export type ThinkingEffortLevel = TranscriptThinkingEffort;

function resolveThinkingEffortFromSettings(): ResolvedThinkingEffort | undefined {
    try {
        const settings = loadClaudeSettingsSync({ logErrors: false });
        return normalizeThinkingEffort(settings.effortLevel);
    } catch {
        // Settings unavailable, return undefined
    }

    return undefined;
}

function resolveCwd(context: RenderContext): string | undefined {
    if (typeof context.data?.cwd === 'string')
        return context.data.cwd;
    if (typeof context.data?.workspace?.current_dir === 'string')
        return context.data.workspace.current_dir;
    return undefined;
}

function resolveThinkingEffort(context: RenderContext): ResolvedThinkingEffort | null {
    const sessionId = typeof context.data?.session_id === 'string' ? context.data.session_id : undefined;
    const cwd = resolveCwd(context);

    // `/clear` wipes the `<local-command-stdout>Set effort level to …` entry
    // from the transcript, which would otherwise make the widget fall back to
    // the global `~/.claude/settings.json` default and mis-report the
    // in-memory effort Claude Code is still honouring. Claude Code rotates
    // session_id across /clear in practice, so we also persist the effort
    // keyed by cwd — the cwd-keyed fallback is what actually survives /clear
    // since the working directory is stable per project. Resolution order:
    // transcript → session_id cache → cwd cache → settings.
    const fromTranscript = getTranscriptThinkingEffort(context.data?.transcript_path);
    if (fromTranscript) {
        writeCachedThinkingEffort(sessionId, cwd, fromTranscript);
        return fromTranscript;
    }

    const fromCache = readCachedThinkingEffort(sessionId, cwd);
    if (fromCache)
        return fromCache;

    return resolveThinkingEffortFromSettings() ?? null;
}

function formatEffort(resolved: ResolvedThinkingEffort | null): string {
    if (!resolved) {
        return 'default';
    }
    return resolved.known ? resolved.value : `${resolved.value}?`;
}

export class ThinkingEffortWidget implements StatefulWidget {
    getDefaultColor(): string { return 'magenta'; }
    getDescription(): string { return 'Displays the current thinking effort level (low, medium, high, xhigh, max).\nUnknown levels are shown with a trailing "?" (e.g. "super-max?").\nMay be incorrect when multiple Claude Code sessions are running due to current Claude Code limitations.'; }
    getDisplayName(): string { return 'Thinking Effort'; }
    getCategory(): string { return 'Core'; }
    getEditorDisplay(item: WidgetItem): WidgetEditorDisplay {
        return { displayText: this.getDisplayName() };
    }

    render(item: WidgetItem, context: RenderContext, settings: Settings): string | null {
        if (context.isPreview) {
            return item.rawValue ? 'high' : 'Thinking: high';
        }

        const effort = formatEffort(resolveThinkingEffort(context));
        return item.rawValue ? effort : `Thinking: ${effort}`;
    }

    supportsRawValue(): boolean { return true; }
    supportsColors(item: WidgetItem): boolean { return true; }

    getStateKey(_item: WidgetItem, context: RenderContext): string | null {
        const resolved = resolveThinkingEffort(context);
        if (!resolved)
            return 'none';
        return resolved.value.toLowerCase();
    }

    getAllStates(): string[] {
        return ['none', 'low', 'medium', 'high', 'xhigh', 'max'];
    }
}