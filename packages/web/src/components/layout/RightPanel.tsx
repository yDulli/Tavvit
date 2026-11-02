import React from 'react';
import { useLocation, useNavigate } from 'react-router-dom';
import { MemberSidebar } from './MemberSidebar';
import { ActivityPanel } from './ActivityPanel';
import { DmRosterPanel } from './DmRosterPanel';
import { useUIStore } from '../../stores/uiStore';
import { selectPeoplePanelOpen } from '../../stores/peoplePanel';
import { useSpaceStore } from '../../stores/spaceStore';
import { useChatStore } from '../../stores/chatStore';
import { FRIENDS_ADD_PATH, showsHomeDashboard } from '../../utils/homeNav';

export function RightPanel() {
  const showDms = useUIStore((s) => s.showDms);
  const memberListOpen = useUIStore(selectPeoplePanelOpen);
  const currentSpaceId = useSpaceStore((s) => s.currentSpaceId);
  const dmChannels = useSpaceStore((s) => s.dmChannels);
  const currentChannelId = useChatStore((s) => s.currentChannelId);
  const { pathname } = useLocation();
  const navigate = useNavigate();

  // The Home dashboard has its own column of who is online, in voice and
  // asking to be friends; the activity panel beside it would say it twice and
  // take the room the dashboard uses on a wide screen.
  if (showsHomeDashboard({ pathname, showDms, currentSpaceId, currentChannelId })) return null;

  // In the DM view (showDms or no current space), the right column is normally
  // the activity panel. The exception is group DMs while the user has the
  // member list toggled on — then we swap in DmRosterPanel, which itself
  // returns null if any of its preconditions are unmet.
  if (showDms || !currentSpaceId) {
    const dmChannel = dmChannels.find((dm) => dm.id === currentChannelId);
    const isGroupDm = !!dmChannel?.ownerId;
    if (isGroupDm && memberListOpen) {
      return <DmRosterPanel />;
    }
    return <ActivityPanel onAddFriends={() => navigate(FRIENDS_ADD_PATH)} />;
  }

  return <MemberSidebar />;
}
