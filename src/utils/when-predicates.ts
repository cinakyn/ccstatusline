import type { RenderContext } from '../types/RenderContext';
import type { WhenPredicate } from '../types/When';

import { isInsideGitWorkTree } from './git';
import {
    getForkStatus,
    getUpstreamRemoteInfo
} from './git-remote';

export function evaluatePredicate(
    predicate: WhenPredicate,
    context: RenderContext,
    renderedText: string
): boolean {
    switch (predicate) {
        case 'no-git':
            return !isInsideGitWorkTree(context);
        case 'no-remote':
            return getUpstreamRemoteInfo(context) === null;
        case 'not-fork':
            return !getForkStatus(context).isFork;
        case 'empty':
            return renderedText.length === 0;
    }
}

export function predicateNeedsRenderedText(predicate: WhenPredicate): boolean {
    return predicate === 'empty';
}