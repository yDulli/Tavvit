import React, { useEffect, useRef } from 'react';
import { createPortal } from 'react-dom';
import { useTranslation } from 'react-i18next';
import { usePortalContainer } from '../../hooks/usePortalContainer';
import { useVoiceStore } from '../../stores/voiceStore';
import { useSpaceStore } from '../../stores/spaceStore';
import { parseFederatedUsername } from '../../utils/identity';
import { sendDmCallReject } from '../../utils/dmCall';
import { acceptIncomingDmCall } from '../../utils/voiceActions';
import { useCanonicalUserView } from '../../utils/userViewLookup';
import { Icon } from '../ui/Icon';
import { Avatar } from '../ui/Avatar';
import type { User } from '@backspace/shared';

/**
 * Decline the call ringing in: the decline goes where the ring came from,
 * with the ids it came with, and only the ring's slot clears. A call the
 * client is in keeps its own ids and origin.
 */
function declineRing(): void {
  const { incomingCall, setIncomingCall } = useVoiceStore.getState();
  if (!incomingCall) return;
  sendDmCallReject(incomingCall);
  setIncomingCall(null);
}

export function IncomingCallModal() {
  const { t } = useTranslation(['voice', 'common']);
  const incomingCall = useVoiceStore((s) => s.incomingCall);
  const timerRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  // A call that rings during a fullscreen voice room has to draw inside that
  // fullscreen element, or nobody sees it.
  const portalContainer = usePortalContainer();

  // Auto-dismiss after 30 seconds
  useEffect(() => {
    if (incomingCall) {
      // Auto-reject after timeout
      timerRef.current = setTimeout(declineRing, 30000);
    }
    return () => {
      if (timerRef.current) {
        clearTimeout(timerRef.current);
        timerRef.current = null;
      }
    };
  }, [incomingCall]);

  const dmChannels = useSpaceStore((s) => s.dmChannels);

  const _FALLBACK_USER = { id: '', username: '', createdAt: 0, isAdmin: false, replicatedInstances: [] } as unknown as User;
  // Look up caller member before the early return so useCanonicalUserView is always called
  const _rawCallerMember = (() => {
    if (!incomingCall) return null;
    const dmChannel = dmChannels.find(d => d.id === incomingCall.dmChannelId);
    return dmChannel?.members.find(m => m.id === incomingCall.callerId) ?? null;
  })();
  const _callerOrigin = useSpaceStore((s) => (incomingCall?.dmChannelId ? s.channelOriginMap.get(incomingCall.dmChannelId) ?? '' : ''));
  const _canonicalCaller = useCanonicalUserView((_rawCallerMember as User | null) ?? _FALLBACK_USER, _callerOrigin);
  const callerMember = _rawCallerMember ? _canonicalCaller : null;

  if (!incomingCall) return null;

  const callerAvatarId = callerMember?.homeUserId ?? incomingCall.callerId;
  const { baseName: callerBaseName } = parseFederatedUsername(incomingCall.callerName);

  // Accepting arms the microphone and connects inside this tap (iOS needs
  // the gesture), and the call becomes active at once (`acceptIncomingDmCall`).
  const handleAccept = () => {
    if (timerRef.current) clearTimeout(timerRef.current);
    acceptIncomingDmCall();
  };

  const handleDecline = () => {
    if (timerRef.current) clearTimeout(timerRef.current);
    declineRing();
  };

  return createPortal(
    <div className="fixed inset-0 z-[100] flex items-center justify-center">
      {/* Backdrop */}
      <div className="modal-scrim absolute inset-0" />

      {/* Call card: who is calling, then the two answers */}
      <div role="dialog" aria-label={callerBaseName} className="relative glass-modal rounded-lg w-[320px] overflow-hidden animate-slide-up">
        <div className="flex items-center gap-3 p-4">
          <Avatar
            src={callerMember?.avatar}
            avatarColor={callerMember?.avatarColor}
            userId={callerAvatarId}
            name={callerBaseName}
            size={44}
          />
          <div className="min-w-0">
            <h3 className="truncate text-lead font-semibold text-txt-primary">{callerBaseName}</h3>
            <p className="mt-0.5 flex items-center gap-1.5 text-meta text-txt-tertiary">
              <span aria-hidden className="call-ring-dot h-1.5 w-1.5 rounded-full bg-accent-primary" />
              {t('voice:incomingCall.status')}
            </p>
          </div>
        </div>

        <div className="grid grid-cols-2 gap-2 border-t border-border-hard p-3">
          <button
            onClick={handleDecline}
            className="btn-outline hover:!border-txt-danger/60 hover:!text-txt-danger"
            title={t('common:actions.decline')}
          >
            <Icon name="phone" size={15} className="rotate-[135deg]" />
            {t('common:actions.decline')}
          </button>
          <button
            onClick={handleAccept}
            className="btn-primary"
            title={t('common:actions.accept')}
          >
            <Icon name="phone" size={15} />
            {t('common:actions.accept')}
          </button>
        </div>
      </div>
    </div>,
    portalContainer,
  );
}
