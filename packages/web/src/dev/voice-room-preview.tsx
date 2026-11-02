// Dev-only workbench for a voice room. Nothing in the app imports this file;
// `dev-voice-room.html` is its only entry. It renders the real `VoiceGrid` and
// `VoiceControlBar` with seeded stores, so the room can be looked at and
// screenshotted (the product page's picture, see scripts/landing-shots) without
// a LiveKit server or a call. `?lang=de` picks the interface language.
import { createRoot } from 'react-dom/client';
import { useTranslation } from 'react-i18next';
import type { MemberWithUser } from '@backspace/shared';
import { Icon } from '../components/ui/Icon';
import { VoiceControlBar } from '../components/voice/VoiceControlBar';
import { VoiceGrid } from '../components/voice/VoiceGrid';
import { initI18n } from '../i18n';
import type { ParticipantInfo } from '../hooks/useLiveKit';
import { initializeInterfaceScale } from '../platform/interfaceScale';
import { useAppearanceStore } from '../stores/appearanceStore';
import { useSpaceStore } from '../stores/spaceStore';
import { useVoiceStore } from '../stores/voiceStore';
import { applyAppearance } from '../utils/appTheme';
import { PermissionBits, permissionsToString } from '../utils/permissions';
import '../styles/globals.css';

const PEOPLE = [
  { id: 'jonas', name: 'Jonas Weber', color: 'sky', muted: false, deafened: false, speaking: false },
  { id: 'lena', name: 'Lena Hoffmann', color: 'rose', muted: false, deafened: false, speaking: true },
  { id: 'noor', name: 'Noor Haddad', color: 'rose', muted: true, deafened: false, speaking: false },
  { id: 'theo', name: 'Theo Marchetti', color: 'mint', muted: false, deafened: false, speaking: false },
  { id: 'yuki', name: 'Yuki Tanaka', color: 'amber', muted: false, deafened: false, speaking: false },
  { id: 'sam', name: 'Sam Okafor', color: 'coral', muted: true, deafened: true, speaking: false },
] as const;

const participants: ParticipantInfo[] = PEOPLE.map((person) => ({
  identity: person.id,
  userId: person.id,
  username: person.id,
  homeUserId: null,
  isMuted: person.muted,
  isDeafened: person.deafened,
  isCameraOn: false,
  isScreenSharing: false,
  isLocal: person.id === 'jonas',
  audioTrack: null,
  videoTrack: null,
  screenTrack: null,
  screenAudioTrack: null,
  lkVideoTrack: null,
  lkScreenTrack: null,
  cachedUser: null,
}));

const members = PEOPLE.map((person) => ({
  userId: person.id,
  spaceId: 'space',
  roles: [],
  user: { id: person.id, username: person.id, displayName: person.name, avatarColor: person.color, avatar: null },
})) as unknown as MemberWithUser[];

function VoiceRoomPreview() {
  const { t } = useTranslation(['spaces']);
  return (
    <div className="group/voice flex h-screen flex-col bg-surface-base">
      <div className="panel-bar flex items-center gap-3 px-5">
        <Icon name="volume" size={19} className="text-txt-tertiary" />
        <span className="text-lead font-semibold tracking-[-0.01em] text-txt-primary">lounge</span>
        <span className="ml-2 text-meta font-medium text-status-online">{t('spaces:main.voice.connected')}</span>
        <span className="ml-1 text-meta text-txt-tertiary">{t('spaces:main.voice.participants', { count: participants.length })}</span>
      </div>
      <div className="relative flex min-h-0 flex-1 pb-20">
        <VoiceGrid participants={participants} />
        <VoiceControlBar />
      </div>
    </div>
  );
}

initializeInterfaceScale();
applyAppearance(document.documentElement, useAppearanceStore.getState());
useSpaceStore.setState({
  members,
  // Without these the bar leaves out the camera and the screen share.
  channelPermissions: new Map([['lounge', permissionsToString(PermissionBits.SPEAK | PermissionBits.STREAM)]]),
});
useVoiceStore.setState({
  currentVoiceChannelId: 'lounge',
  speakingParticipantIds: new Set(PEOPLE.filter((person) => person.speaking).map((person) => person.id)),
});

void initI18n().finally(() => {
  const root = document.getElementById('root');
  if (root) createRoot(root).render(<VoiceRoomPreview />);
});
