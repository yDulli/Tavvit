import { useEffect, useState } from 'react';
import { useTranslation } from 'react-i18next';
import { useNavigate } from 'react-router-dom';
import { describeError } from '../../i18n/errors';
import { useAuthStore } from '../../stores/authStore';
import { getApiForOrigin, useSpaceStore } from '../../stores/spaceStore';
import { useUIStore } from '../../stores/uiStore';
import { useWelcomeStore, welcomeKey } from '../../stores/welcomeStore';
import { MarkdownRenderer } from '../chat/MarkdownRenderer';
import { Modal } from '../ui/Modal';

const seenKey = (userId: string, origin: string, spaceId: string) => `tavvit:welcome-seen:${userId}:${origin}:${spaceId}`;

function wasSeen(key: string): boolean {
  try {
    return window.localStorage.getItem(key) !== null;
  } catch {
    return false;
  }
}

function markSeen(key: string): void {
  try {
    window.localStorage.setItem(key, '1');
  } catch {
    // A browser that keeps nothing shows the welcome again next time.
  }
}

/**
 * Opens a space's welcome the first time someone comes to it, and each visit while its
 * rules still wait for an answer, until they put it off for this session. The server is
 * what holds them to it (`memberActionRefusal`); this only says so.
 */
export function SpaceWelcomeGate() {
  const { t } = useTranslation(['spaces', 'common']);
  const navigate = useNavigate();
  const spaceId = useSpaceStore((state) => state.currentSpaceId);
  const space = useSpaceStore((state) => state.spaces.find((item) => item.id === state.currentSpaceId));
  const origin = space?._instanceOrigin ?? '';
  const isMember = space !== undefined;
  const userId = useAuthStore((state) => state.user?.id);
  const dialog = useWelcomeStore((state) => state.dialog);
  const closeDialog = useWelcomeStore((state) => state.closeDialog);
  const welcome = useWelcomeStore((state) => (dialog ? state.bySpace.get(welcomeKey(dialog.origin, dialog.spaceId)) : undefined));
  const [putOff] = useState(() => new Set<string>());
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState('');

  useEffect(() => {
    if (!spaceId || !isMember || !userId) return undefined;
    let cancelled = false;
    useWelcomeStore.getState().load(origin, spaceId).then((loaded) => {
      if (cancelled) return;
      const key = welcomeKey(origin, spaceId);
      const hasSomething = Boolean(loaded.welcomeText || loaded.rulesText || loaded.channels.length > 0);
      const firstTime = hasSomething && !wasSeen(seenKey(userId, origin, spaceId));
      if ((loaded.mustAccept && !putOff.has(key)) || firstTime) useWelcomeStore.getState().openDialog(origin, spaceId);
    }).catch(() => {
      // Nothing to show; a refused action names the rules itself.
    });
    return () => {
      cancelled = true;
    };
  }, [spaceId, isMember, origin, userId, putOff]);

  if (!dialog || !welcome) return null;

  const dismiss = () => {
    if (userId) markSeen(seenKey(userId, dialog.origin, dialog.spaceId));
    putOff.add(welcomeKey(dialog.origin, dialog.spaceId));
    setError('');
    closeDialog();
  };

  const accept = async () => {
    setBusy(true);
    setError('');
    try {
      const updated = await getApiForOrigin(dialog.origin).welcome.accept(dialog.spaceId);
      useWelcomeStore.getState().store(dialog.origin, dialog.spaceId, updated);
      dismiss();
    } catch (err) {
      setError(describeError(err));
    } finally {
      setBusy(false);
    }
  };

  const openChannel = (channelId: string) => {
    const { spaceId: target } = dialog;
    dismiss();
    const ui = useUIStore.getState();
    if (ui.isMobile) ui.pushMobileScreen('channel-chat', { channelId, spaceId: target });
    navigate(`/channels/${target}/${channelId}`);
  };

  return (
    <Modal isOpen onClose={dismiss} title={t('spaces:welcome.title', { space: space?.name ?? '' })} maxWidth="max-w-lg" mobileStyle="fullscreen">
      <div className="flex flex-col gap-5">
        {welcome.welcomeText && <div className="break-words text-body text-txt-secondary"><MarkdownRenderer content={welcome.welcomeText} /></div>}

        {welcome.rulesText && (
          <section className="flex flex-col gap-2">
            <h3 className="label-mono">{t('spaces:welcome.rules')}</h3>
            <div className="max-h-64 overflow-y-auto break-words text-body text-txt-secondary"><MarkdownRenderer content={welcome.rulesText} /></div>
          </section>
        )}

        {welcome.channels.length > 0 && (
          <section className="flex flex-col gap-1">
            <h3 className="label-mono mb-1">{t('spaces:welcome.startHere')}</h3>
            {welcome.channels.map((channel) => (
              <button key={channel.id} type="button" onClick={() => openChannel(channel.id)} className="nav-item w-full text-left">
                <span aria-hidden="true" className="w-4 flex-shrink-0 text-center opacity-60">#</span>
                <span className="min-w-0 flex-1 truncate">{channel.name}</span>
              </button>
            ))}
          </section>
        )}

        {welcome.mustAccept && <p className="text-meta text-txt-secondary">{t('spaces:welcome.mustAccept')}</p>}
        {error && <p role="alert" className="text-meta text-txt-danger">{error}</p>}

        <div className="flex justify-end gap-2">
          {welcome.mustAccept ? (
            <>
              <button type="button" onClick={dismiss} className="btn-quiet">{t('spaces:welcome.later')}</button>
              <button type="button" onClick={() => void accept()} disabled={busy} aria-busy={busy} className="btn-primary">{t('spaces:welcome.agree')}</button>
            </>
          ) : (
            <button type="button" onClick={dismiss} className="btn-primary">{t('spaces:welcome.gotIt')}</button>
          )}
        </div>
      </div>
    </Modal>
  );
}
