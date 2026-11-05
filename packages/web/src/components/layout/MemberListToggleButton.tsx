import React from 'react';
import { useTranslation } from 'react-i18next';
import { useUIStore } from '../../stores/uiStore';
import { selectPeoplePanelOpen } from '../../stores/peoplePanel';
import { Icon } from '../ui/Icon';

/** The header button that shows or hides the people column on the right; it reads as pressed while the column is open. */
export function MemberListToggleButton() {
  const { t } = useTranslation('common');
  const toggleMemberList = useUIStore((s) => s.toggleMemberList);
  const memberListOpen = useUIStore(selectPeoplePanelOpen);

  return (
    <button
      type="button"
      onClick={toggleMemberList}
      data-people-toggle
      data-active={memberListOpen}
      className="icon-btn icon-btn-lg"
      aria-label={t('chrome.toggleMemberList')}
      aria-pressed={memberListOpen}
    >
      <Icon name="users" size={18} />
    </button>
  );
}
