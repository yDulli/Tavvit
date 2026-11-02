import { useEffect, useId, useState } from 'react';
import { useTranslation } from 'react-i18next';
import type {
  DiscoveryStatus,
  ReviewEvent,
  SpaceCategory,
  VerificationStatus,
} from '@backspace/shared/src/platform';
import type { SpaceBadgeId } from '@backspace/shared/src/badges';
import type { AvatarColor } from '@backspace/shared';
import { useFormatters } from '../../i18n/formatters';
import { describeError } from '../../i18n/errors';
import {
  discoveryStatusKey,
  reviewActionKey,
  reviewTone,
  spaceCategoryKey,
  verificationStatusKey,
  type ReviewTone,
} from '../../i18n/review';
import { Modal } from '../ui/Modal';
import { Avatar } from '../ui/Avatar';
import { GatedPicture } from '../ui/ExternalMedia';
import { BadgeList } from '../../badges/BadgeList';

// The pieces both sides of the platform's reviews show (docs/systems/
// admin.md): a space owner in their space's settings, an instance admin in
// the admin area. A status chip, the history of a review, the dialog an
// admin decides in, and the preview of a Discovery listing.

const TONE_CLASS: Record<ReviewTone, string> = {
  positive: 'bg-accent-mint/10 text-accent-mint',
  waiting: 'bg-accent-amber/10 text-accent-amber',
  negative: 'bg-accent-rose/10 text-accent-rose',
  neutral: 'bg-white/[0.06] text-txt-secondary',
};

type StatusChipProps =
  | { process: 'verification'; status: VerificationStatus | null }
  | { process: 'discovery'; status: DiscoveryStatus | null };

/** A review's status as a small chip: green when settled well, amber while waiting, rose when refused. */
export function ReviewStatusChip(props: StatusChipProps) {
  const { t } = useTranslation(['common']);
  const label = props.process === 'verification'
    ? t(verificationStatusKey(props.status))
    : t(discoveryStatusKey(props.status));
  return (
    <span className={`inline-flex flex-shrink-0 items-center rounded px-1.5 py-px font-mono text-label uppercase tracking-[0.04em] ${TONE_CLASS[reviewTone(props.status)]}`}>
      {label}
    </span>
  );
}

/** A review's steps, newest first, each with who took it and the reason they gave. */
export function ReviewHistory({ events }: { events: readonly ReviewEvent[] }) {
  const { t } = useTranslation(['common']);
  const f = useFormatters();
  if (events.length === 0) return <p className="text-meta text-txt-tertiary">{t('common:review.noHistory')}</p>;
  return (
    <ol className="surface-card divide-y divide-border-hard rounded-lg">
      {[...events].reverse().map((event) => (
        <li key={event.id} className="px-3 py-2">
          <div className="flex flex-wrap items-baseline gap-x-2 gap-y-0.5 text-meta">
            <span className="font-medium text-txt-primary">{t(reviewActionKey(event.action))}</span>
            <span className="min-w-0 truncate text-txt-tertiary">
              {event.actor ? (event.actor.displayName || `@${event.actor.username}`) : t('common:review.unknownActor')}
            </span>
            <span className="ml-auto font-mono text-label text-txt-tertiary">{f.formatDateTime(event.createdAt)}</span>
          </div>
          {event.note && <p className="mt-1 whitespace-pre-wrap break-words text-meta text-txt-secondary">{event.note}</p>}
        </li>
      ))}
    </ol>
  );
}

interface DecisionDialogProps {
  isOpen: boolean;
  onClose: () => void;
  /** Resolves when the decision went through; a rejection is shown in the dialog. */
  onConfirm: (note: string) => Promise<void>;
  title: string;
  description: string;
  /** Whether a reason must be given; the owner reads it either way. */
  noteRequired: boolean;
  confirmLabel: string;
  variant: 'primary' | 'danger';
  /** Where the note goes, when it is not to a space's owner (a lifted suspension's reason). */
  noteLabel?: string;
  notePlaceholder?: string;
  /** The longest note the route takes; a review note's by default. */
  noteMaxLength?: number;
}

const NOTE_MAX_LENGTH = 1000;

/** The dialog an admin decides in: what the decision does, a reason, and confirm. */
export function ReviewDecisionDialog({
  isOpen,
  onClose,
  onConfirm,
  title,
  description,
  noteRequired,
  confirmLabel,
  variant,
  noteLabel,
  notePlaceholder,
  noteMaxLength = NOTE_MAX_LENGTH,
}: DecisionDialogProps) {
  const { t } = useTranslation(['admin', 'common']);
  const noteId = useId();
  const [note, setNote] = useState('');
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState('');

  useEffect(() => {
    if (isOpen) {
      setNote('');
      setError('');
      setBusy(false);
    }
  }, [isOpen]);

  const missingNote = noteRequired && note.trim().length === 0;

  const confirm = async () => {
    if (missingNote || busy) return;
    setBusy(true);
    setError('');
    try {
      await onConfirm(note.trim());
    } catch (err) {
      setError(describeError(err));
      setBusy(false);
    }
  };

  return (
    <Modal isOpen={isOpen} onClose={busy ? () => undefined : onClose} title={title} maxWidth="max-w-lg" mobileStyle="sheet">
      <div className="space-y-3">
        <p className="text-ui text-txt-secondary">{description}</p>
        <div>
          <label htmlFor={noteId} className="field-label">
            {noteLabel ?? (noteRequired ? t('admin:platform.decision.noteRequired') : t('admin:platform.decision.noteOptional'))}
          </label>
          <textarea
            id={noteId}
            value={note}
            onChange={(e) => setNote(e.target.value.slice(0, noteMaxLength))}
            rows={4}
            placeholder={notePlaceholder ?? t('admin:platform.decision.notePlaceholder')}
            className="input-standard w-full resize-none"
          />
          <div className="tabular mt-1 text-right font-mono text-label text-txt-tertiary">
            {t('admin:platform.decision.counter', { length: note.length, max: noteMaxLength })}
          </div>
        </div>
        {error && <p role="alert" className="rounded-md border border-accent-rose/30 bg-accent-rose/10 px-3 py-2 text-ui text-txt-danger">{error}</p>}
        <div className="flex justify-end gap-2 pt-1">
          <button type="button" onClick={onClose} disabled={busy} className="btn-quiet">{t('common:actions.cancel')}</button>
          <button
            type="button"
            onClick={() => void confirm()}
            disabled={busy || missingNote}
            aria-busy={busy}
            className={variant === 'danger' ? 'btn-danger' : 'btn-primary'}
          >
            {busy ? t('common:states.saving') : confirmLabel}
          </button>
        </div>
      </div>
    </Modal>
  );
}

export interface ListingPreviewProps {
  spaceId: string;
  name: string;
  description: string | null;
  icon: string | null;
  banner: string | null;
  avatarColor: AvatarColor | null;
  memberCount: number | null;
  category: SpaceCategory | null;
  badges: readonly SpaceBadgeId[];
}

function pictureUrl(value: string | null): string | null {
  if (!value) return null;
  return value.startsWith('http') || value.startsWith('/') || value.startsWith('blob:') ? value : `/api/uploads/${value}`;
}

/** What a space's Discovery card would show: banner, icon, name, badges, category, description, members. */
export function ListingPreview({ spaceId, name, description, icon, banner, avatarColor, memberCount, category, badges }: ListingPreviewProps) {
  const { t } = useTranslation(['common']);
  const bannerUrl = pictureUrl(banner);
  return (
    <div className="surface-card max-w-[320px] overflow-hidden rounded-lg">
      <div className={`relative ${bannerUrl ? 'h-20' : 'h-10'} bg-white/[0.03]`}>
        {/* A banner stored before pictures had to be uploads can name another server: it waits for a yes (useGatedPicture). */}
        {bannerUrl && <GatedPicture src={bannerUrl} alt="" className="absolute inset-0 h-full w-full object-cover" whileBlocked={null} />}
      </div>
      <div className="relative z-10 -mt-6 px-3.5">
        <Avatar
          src={pictureUrl(icon)}
          name={name}
          size={44}
          userId={spaceId}
          avatarColor={avatarColor}
          palette="space"
          ring={{ width: 3, color: 'rgb(var(--bg-channel))' }}
        />
      </div>
      <div className="px-3.5 pb-3.5 pt-2">
        <div className="flex min-w-0 items-center gap-1.5">
          <h4 className="min-w-0 truncate text-body font-semibold text-txt-primary">{name}</h4>
          <BadgeList badges={[...badges]} size="sm" />
        </div>
        {category && <div className="mt-0.5 font-mono text-label text-txt-tertiary">{t(spaceCategoryKey(category))}</div>}
        <p className="mt-1.5 line-clamp-3 text-meta text-txt-secondary">{description || t('common:review.noDescription')}</p>
        {memberCount !== null && (
          <div className="mt-2 font-mono text-label text-txt-tertiary">{t('common:review.members', { count: memberCount })}</div>
        )}
      </div>
    </div>
  );
}
