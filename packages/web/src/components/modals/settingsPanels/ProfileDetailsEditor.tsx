import { useId } from 'react';
import { useTranslation } from 'react-i18next';
import { PROFILE_LAYOUTS, PROFILE_LIMITS, type ProfileLayout, type ProfileLink } from '@backspace/shared';
import { normalizeProfileLinkUrl } from '@backspace/shared/src/profileFields';
import { Icon } from '../../ui/Icon';
import { OptionCards, SettingsField } from './_shared/SettingsControls';

/** One link row while it is edited; `id` keeps the row's inputs stable while rows come and go. */
export interface ProfileLinkDraft {
  id: number;
  url: string;
  label: string;
}

let nextDraftId = 0;

export function linkDrafts(links: readonly ProfileLink[] | undefined): ProfileLinkDraft[] {
  return (links ?? []).map((link) => ({ id: nextDraftId++, url: link.url, label: link.label ?? '' }));
}

/** The rows as the account stores them: empty rows dropped, the rest trimmed. */
export function linksOfDrafts(drafts: readonly ProfileLinkDraft[]): ProfileLink[] {
  return drafts
    .filter((draft) => draft.url.trim() !== '')
    .map((draft) => ({ url: draft.url.trim(), label: draft.label.trim() || null }));
}

/** The rows whose address is not a plain web address, which the instance would refuse. */
export function invalidLinkDrafts(drafts: readonly ProfileLinkDraft[]): Set<number> {
  return new Set(drafts.filter((draft) => draft.url.trim() !== '' && !normalizeProfileLinkUrl(draft.url)).map((draft) => draft.id));
}

/** A small drawing of each layout: where the banner, the picture and the name sit. */
function LayoutSketch({ layout }: { layout: ProfileLayout }) {
  if (layout === 'compact') {
    return (
      <span aria-hidden="true" className="flex h-11 w-16 items-center gap-1.5 rounded-[4px] bg-surface-input px-2">
        <span className="h-4 w-4 flex-shrink-0 rounded-full bg-white/[0.22]" />
        <span className="h-1.5 flex-1 rounded-sm bg-white/[0.14]" />
      </span>
    );
  }
  return (
    <span aria-hidden="true" className="flex h-11 w-16 flex-col overflow-hidden rounded-[4px] bg-surface-input">
      <span className="h-4 w-full bg-white/[0.12]" />
      <span className={`-mt-2 flex flex-col gap-1 px-2 ${layout === 'centered' ? 'items-center' : 'items-start'}`}>
        <span className="h-4 w-4 rounded-full bg-white/[0.22] ring-2 ring-surface-input" />
        <span className="h-1 w-7 rounded-sm bg-white/[0.14]" />
      </span>
    </span>
  );
}

interface ProfileDetailsEditorProps {
  pronouns: string;
  onPronouns: (next: string) => void;
  links: ProfileLinkDraft[];
  onLinks: (next: ProfileLinkDraft[]) => void;
  /** Rows the last save attempt found invalid. */
  invalidLinks: ReadonlySet<number>;
  layout: ProfileLayout;
  onLayout: (next: ProfileLayout) => void;
}

/**
 * The profile card's own fields (docs/systems/auth.md, "Profile fields"):
 * pronouns, up to five links and the card's layout. Nothing is saved here; the
 * account panel saves with the rest of the profile, and the instance checks
 * every field by the same rules again.
 */
export function ProfileDetailsEditor({ pronouns, onPronouns, links, onLinks, invalidLinks, layout, onLayout }: ProfileDetailsEditorProps) {
  const { t } = useTranslation(['settings']);
  const layoutLabelId = useId();

  const updateLink = (id: number, change: Partial<Pick<ProfileLinkDraft, 'url' | 'label'>>) => {
    onLinks(links.map((link) => (link.id === id ? { ...link, ...change } : link)));
  };
  const layoutName = (option: ProfileLayout): string => {
    switch (option) {
      case 'standard': return t('settings:account.profile.layout.standard');
      case 'centered': return t('settings:account.profile.layout.centered');
      case 'compact': return t('settings:account.profile.layout.compact');
    }
  };

  return (
    <>
      {/* Pronouns */}
      <SettingsField label={t('settings:account.profile.pronouns.label')} htmlFor="profile-pronouns">
        <div className="relative">
          <input
            id="profile-pronouns"
            type="text"
            value={pronouns}
            onChange={(e) => onPronouns(e.target.value.slice(0, PROFILE_LIMITS.MAX_PRONOUNS_LENGTH))}
            maxLength={PROFILE_LIMITS.MAX_PRONOUNS_LENGTH}
            placeholder={t('settings:account.profile.pronouns.placeholder')}
            className="input-standard w-full pr-14"
          />
          <span className="pointer-events-none absolute right-2.5 top-1/2 -translate-y-1/2 font-mono text-2xs tabular text-txt-tertiary">
            {t('settings:account.profile.pronouns.counter', { used: pronouns.length, max: PROFILE_LIMITS.MAX_PRONOUNS_LENGTH })}
          </span>
        </div>
      </SettingsField>

      {/* Links */}
      <SettingsField
        label={t('settings:account.profile.links.label')}
        hint={t('settings:account.profile.links.hint', { max: PROFILE_LIMITS.MAX_LINKS })}
      >
        {links.length > 0 && (
          <ul className="mb-2 space-y-2">
            {links.map((link) => {
              const invalid = invalidLinks.has(link.id);
              return (
                <li key={link.id}>
                  <div className="flex items-center gap-2">
                    <input
                      type="url"
                      inputMode="url"
                      value={link.url}
                      onChange={(e) => updateLink(link.id, { url: e.target.value })}
                      maxLength={PROFILE_LIMITS.MAX_LINK_URL_LENGTH}
                      placeholder={t('settings:account.profile.links.urlPlaceholder')}
                      aria-label={t('settings:account.profile.links.url')}
                      aria-invalid={invalid}
                      spellCheck={false}
                      className="input-standard min-w-0 flex-[3]"
                    />
                    <input
                      type="text"
                      value={link.label}
                      onChange={(e) => updateLink(link.id, { label: e.target.value.slice(0, PROFILE_LIMITS.MAX_LINK_LABEL_LENGTH) })}
                      maxLength={PROFILE_LIMITS.MAX_LINK_LABEL_LENGTH}
                      placeholder={t('settings:account.profile.links.labelPlaceholder')}
                      aria-label={t('settings:account.profile.links.labelField')}
                      className="input-standard min-w-0 flex-[2]"
                    />
                    <button
                      type="button"
                      onClick={() => onLinks(links.filter((other) => other.id !== link.id))}
                      aria-label={t('settings:account.profile.links.remove')}
                      title={t('settings:account.profile.links.remove')}
                      className="icon-btn flex-shrink-0"
                    >
                      <Icon name="x" size={14} />
                    </button>
                  </div>
                  {invalid && <p role="alert" className="mt-1 text-meta text-txt-danger">{t('settings:account.profile.links.invalid', { max: PROFILE_LIMITS.MAX_LINK_URL_LENGTH })}</p>}
                </li>
              );
            })}
          </ul>
        )}
        {links.length < PROFILE_LIMITS.MAX_LINKS && (
          <button
            type="button"
            onClick={() => onLinks([...links, { id: nextDraftId++, url: '', label: '' }])}
            className="btn-outline btn-sm"
          >
            <Icon name="plus" size={14} />
            {t('settings:account.profile.links.add')}
          </button>
        )}
      </SettingsField>

      {/* Card layout */}
      <SettingsField
        label={t('settings:account.profile.layout.label')}
        hint={t('settings:account.profile.layout.hint')}
        labelId={layoutLabelId}
      >
        <OptionCards
          labelledBy={layoutLabelId}
          value={layout}
          onChange={onLayout}
          options={PROFILE_LAYOUTS.map((option) => ({ id: option, label: layoutName(option), preview: <LayoutSketch layout={option} /> }))}
        />
      </SettingsField>
    </>
  );
}
