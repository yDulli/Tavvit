import { useTranslation } from 'react-i18next';
import { useSpaceJoin } from '../../hooks/useSpaceJoin';
import { getSpaceGradient } from '../../utils/gradients';
import type { TaggedExploreSpace } from '../../stores/exploreStore';
import { GatedPicture } from '../ui/ExternalMedia';

export function ExploreSpacePreviewCard({
  space,
  onJoinSuccess,
}: {
  space: TaggedExploreSpace;
  onJoinSuccess: (spaceId: string) => void;
}) {
  const { t } = useTranslation(['spaces', 'common']);
  const {
    isPublic,
    isPending,
    joining,
    joinError,
    showRequestForm,
    requestMessage,
    setRequestMessage,
    openRequestForm,
    cancelRequestForm,
    join,
    sendRequest,
  } = useSpaceJoin(space);

  const fallbackGradient = getSpaceGradient(space.id, space.name, space.avatarColor).gradient;
  const iconUrl = space.icon
    ? (space.icon.startsWith('http') || space.icon.startsWith('/') ? space.icon : `/api/uploads/${space.icon}`)
    : null;
  const originLabel = space._instanceOrigin
    ? (() => { try { return new URL(space._instanceOrigin).host; } catch { return space._instanceOrigin; } })()
    : null;

  const handleJoin = async () => {
    const full = await join();
    if (full) onJoinSuccess(full.id);
  };

  return (
    <div className="surface-card rounded-lg transition-colors hover:border-border-soft px-3 py-2.5">
      <div className="flex items-center gap-3">
        {/* Icon */}
        {(() => {
          const letter = (
            <div
              className="w-10 h-10 rounded-lg flex-shrink-0 flex items-center justify-center text-body font-semibold text-white/90"
              style={{ background: fallbackGradient }}
            >
              {space.name.charAt(0).toUpperCase()}
            </div>
          );
          return iconUrl
            ? <GatedPicture src={iconUrl} alt={space.name} className="w-10 h-10 rounded-lg object-cover flex-shrink-0" whileBlocked={letter} />
            : letter;
        })()}

        {/* Name + meta */}
        <div className="min-w-0 flex-1">
          <div className="text-ui font-semibold text-txt-primary truncate">{space.name}</div>
          <div className="mt-0.5 flex min-w-0 items-center gap-1.5 text-meta text-txt-tertiary">
            <span className="flex-shrink-0">{t('spaces:explore.memberCount', { count: space.memberCount })}</span>
            {originLabel && <span className="truncate">· {originLabel}</span>}
          </div>
        </div>

        {/* Action */}
        <div className="flex-shrink-0">
          {isPublic ? (
            <button
              type="button"
              onClick={handleJoin}
              disabled={joining}
              aria-busy={joining}
              className="btn-outline btn-sm"
            >
              {joining ? t('spaces:explore.preview.joining') : t('spaces:explore.preview.join')}
            </button>
          ) : isPending ? (
            <span className="px-2.5 text-meta font-medium text-txt-tertiary">{t('spaces:explore.preview.pending')}</span>
          ) : (
            <button
              type="button"
              onClick={openRequestForm}
              className="btn-outline btn-sm"
            >
              {t('spaces:explore.preview.request')}
            </button>
          )}
        </div>
      </div>

      {/* Inline request form */}
      {showRequestForm && (
        <div className="mt-2.5 space-y-2">
          <textarea
            value={requestMessage}
            onChange={(e) => setRequestMessage(e.target.value.slice(0, 200))}
            placeholder={t('spaces:explore.requestMessagePlaceholder')}
            rows={2}
            className="input-standard w-full resize-none"
          />
          <div className="flex gap-2">
            <button
              type="button"
              onClick={sendRequest}
              disabled={joining}
              aria-busy={joining}
              className="btn-primary btn-sm flex-1"
            >
              {joining ? t('spaces:explore.preview.sending') : t('spaces:explore.sendRequest')}
            </button>
            <button
              type="button"
              onClick={cancelRequestForm}
              className="btn-quiet btn-sm"
            >
              {t('common:actions.cancel')}
            </button>
          </div>
        </div>
      )}

      {joinError && <div role="alert" className="mt-2 text-meta text-txt-danger">{joinError}</div>}
    </div>
  );
}
