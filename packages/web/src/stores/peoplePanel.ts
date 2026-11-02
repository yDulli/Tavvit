import type { UIState } from './uiStore';

/**
 * Whether the people column (members, friends' activity, a group's roster) is
 * showing: the persisted choice in a wide window, the floating column's own
 * state in a compact one. Every panel and its toggle read it through here.
 */
export function selectPeoplePanelOpen(state: Pick<UIState, 'memberListOpen'> & Partial<Pick<UIState, 'isCompact' | 'compactPanelOpen'>>): boolean {
  return state.isCompact ? state.compactPanelOpen === true : state.memberListOpen;
}
