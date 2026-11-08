import React, { useMemo, useRef, useState } from 'react';
import { useNavigate } from 'react-router-dom';
import { useTranslation } from 'react-i18next';
import { useShallow } from 'zustand/react/shallow';
import { appearanceSettingsOf, useAppearanceStore } from '../../stores/appearanceStore';
import { SAVED_LOOKS_MAX, savedLookOf, useLooksStore, type SavedLook } from '../../stores/looksStore';
import { useContextMenuStore } from '../../stores/contextMenuStore';
import { useUIStore } from '../../stores/uiStore';
import { LOOK_NAME_MAX, lookAddress, lookOfAppearance, sameLook, type Look } from '../../utils/looks';
import { AccentSection } from '../modals/settingsPanels/AccentSection';
import { ThemeSection } from '../modals/settingsPanels/ThemeSection';
import {
  AvatarShapeSetting,
  CornersSetting,
  DensitySetting,
  FontSetting,
  LightSetting,
  MessageStyleSetting,
  SpaceLooksSetting,
} from '../modals/settingsPanels/LookSections';
import { SettingsSection } from '../modals/settingsPanels/_shared/SettingsControls';
import { Icon } from '../ui/Icon';
import { SurfaceSwatch } from '../ui/SurfaceSwatch';
import { LookPreview } from './LookPreview';

/**
 * The theme studio (docs/systems/design-system.md, "Looks"), at `/studio` under the app's frame.
 * Every change applies to the whole app at once, so the sidebar beside it and the conversation in
 * the preview show the look as it is; nothing waits for a save. A look can be kept under a name
 * and put on again with one click, and shared as a link that holds the whole look. While the
 * studio is open, a space's own colours stand aside (`AppearanceController`), so what is shaped
 * here is the person's own look.
 */
export function LookStudio() {
  const { t } = useTranslation(['settings', 'common']);
  const navigate = useNavigate();
  const isMobile = useUIStore((s) => s.isMobile);
  const appearance = useAppearanceStore(useShallow(appearanceSettingsOf));
  const look = useMemo(() => lookOfAppearance(appearance), [appearance]);
  const looks = useLooksStore((s) => s.looks);
  const kept = savedLookOf(looks, look);

  const leave = () => {
    const index = (window.history.state as { idx?: number } | null)?.idx ?? 0;
    if (index > 0) navigate(-1);
    else navigate('/channels/@me');
  };

  return (
    <div className="flex min-h-0 min-w-0 flex-1">
      <div className="min-h-0 min-w-0 flex-1 overflow-y-auto">
        <div className="mx-auto w-full max-w-2xl space-y-8 px-4 py-6 desktop:px-8 desktop:py-8">
          <header className="flex items-start gap-3">
            {isMobile && (
              <button type="button" onClick={leave} aria-label={t('common:actions.back')} className="icon-btn -ml-2 mt-0.5 flex-shrink-0">
                <Icon name="chevron-left" size={20} />
              </button>
            )}
            <div className="min-w-0 flex-1">
              <h1 className="page-title">{t('settings:studio.title')}</h1>
              <p className="mt-1.5 text-ui leading-relaxed text-txt-secondary">{t('settings:studio.lead')}</p>
            </div>
            {!isMobile && (
              <button type="button" onClick={leave} className="btn-outline btn-sm flex-shrink-0">{t('settings:studio.done')}</button>
            )}
          </header>

          <KeepLook look={look} kept={kept} />

          {isMobile && <LookPreview />}

          <SavedLooks looks={looks} current={look} />

          <ThemeSection />
          <AccentSection />
          <SettingsSection title={t('settings:studio.sections.shape')}>
            <CornersSetting />
            <AvatarShapeSetting />
          </SettingsSection>
          <SettingsSection title={t('settings:studio.sections.messages')}>
            <MessageStyleSetting />
            <DensitySetting />
          </SettingsSection>
          <SettingsSection title={t('settings:studio.sections.typeface')}>
            <FontSetting />
          </SettingsSection>
          <SettingsSection title={t('settings:studio.sections.light')}>
            <LightSetting />
          </SettingsSection>
          <SettingsSection title={t('settings:studio.sections.spaces')}>
            <SpaceLooksSetting />
          </SettingsSection>
          <p className="pb-4 text-meta leading-snug text-txt-tertiary">{t('settings:studio.yours')}</p>
        </div>
      </div>

      {!isMobile && (
        <aside className="w-[min(440px,40%)] flex-shrink-0 overflow-y-auto border-l border-border-hard p-6" aria-label={t('settings:studio.preview.title')}>
          <div className="sticky top-0 space-y-2">
            <div className="label-mono">{t('settings:studio.preview.title')}</div>
            <LookPreview />
          </div>
        </aside>
      )}
    </div>
  );
}

/** Keeping the look as it is now under a name, and sharing it as a link. */
function KeepLook({ look, kept }: { look: Look; kept: SavedLook | null }) {
  const { t } = useTranslation('settings');
  const save = useLooksStore((s) => s.save);
  const full = useLooksStore((s) => s.looks.length >= SAVED_LOOKS_MAX);
  const [name, setName] = useState('');

  const keep = (event: React.FormEvent) => {
    event.preventDefault();
    const saved = save(name, look);
    if (!saved) return;
    setName('');
    useUIStore.getState().addToast(t('studio.keep.saved', { name: saved.name }), 'success', 3000);
  };

  return (
    <section className="surface-card space-y-3 rounded-lg p-4" aria-label={t('studio.keep.title')}>
      {kept ? (
        <div className="flex items-center gap-2 text-ui text-txt-secondary">
          <Icon name="check" size={16} className="flex-shrink-0 text-accent-soft" />
          <span className="min-w-0 truncate">{t('studio.keep.isKept', { name: kept.name })}</span>
        </div>
      ) : (
        <form onSubmit={keep} className="flex flex-wrap items-center gap-2">
          <label htmlFor="look-name" className="sr-only">{t('studio.keep.nameLabel')}</label>
          <input
            id="look-name"
            value={name}
            maxLength={LOOK_NAME_MAX}
            onChange={(event) => setName(event.target.value)}
            placeholder={t('studio.keep.namePlaceholder')}
            className="input-standard min-w-0 flex-1"
            disabled={full}
          />
          <button type="submit" disabled={full || name.trim().length === 0} className="btn-primary btn-sm">
            {t('studio.keep.save')}
          </button>
        </form>
      )}
      {full && !kept && <p className="text-meta text-txt-tertiary">{t('studio.keep.full', { max: SAVED_LOOKS_MAX })}</p>}
      <div className="flex flex-wrap items-center gap-2 border-t border-border-hard pt-3">
        <CopyLookLink look={look} name={kept?.name ?? t('studio.unnamed')} />
        <span className="text-meta text-txt-tertiary">{t('studio.keep.linkHint')}</span>
      </div>
    </section>
  );
}

function CopyLookLink({ look, name }: { look: Look; name: string }) {
  const { t } = useTranslation('settings');
  const copy = async () => {
    try {
      await navigator.clipboard.writeText(lookAddress(look, name));
      useUIStore.getState().addToast(t('studio.linkCopied'), 'success', 3000);
    } catch {
      useUIStore.getState().addToast(t('studio.linkFailed'), 'warning', 3000);
    }
  };
  return (
    <button type="button" onClick={() => void copy()} className="btn-outline btn-sm">
      <Icon name="link" size={14} />
      {t('studio.copyLink')}
    </button>
  );
}

/** The looks kept on this device: one click puts one on. */
function SavedLooks({ looks, current }: { looks: readonly SavedLook[]; current: Look }) {
  const { t } = useTranslation('settings');
  const putLook = useAppearanceStore((s) => s.putLook);

  return (
    <SettingsSection title={t('studio.looks.title')} aside={looks.length > 0 ? <span className="label-mono">{looks.length}/{SAVED_LOOKS_MAX}</span> : undefined}>
      {looks.length === 0 ? (
        <p className="text-ui text-txt-tertiary">{t('studio.looks.empty')}</p>
      ) : (
        <ul className="grid grid-cols-2 gap-2 desktop:grid-cols-3">
          {looks.map((saved, index) => (
            <SavedLookCard key={saved.id} saved={saved} index={index} inUse={sameLook(saved.look, current)} onPut={() => putLook(saved.look)} />
          ))}
        </ul>
      )}
    </SettingsSection>
  );
}

function SavedLookCard({ saved, index, inUse, onPut }: { saved: SavedLook; index: number; inUse: boolean; onPut: () => void }) {
  const { t } = useTranslation('settings');
  const rename = useLooksStore((s) => s.rename);
  const remove = useLooksStore((s) => s.remove);
  const restore = useLooksStore((s) => s.restore);
  const [renaming, setRenaming] = useState(false);
  const [draft, setDraft] = useState(saved.name);
  const moreRef = useRef<HTMLButtonElement>(null);

  const finishRename = () => {
    if (draft.trim() && draft !== saved.name) rename(saved.id, draft);
    setRenaming(false);
  };

  const copyLink = async () => {
    try {
      await navigator.clipboard.writeText(lookAddress(saved.look, saved.name));
      useUIStore.getState().addToast(t('studio.linkCopied'), 'success', 3000);
    } catch {
      useUIStore.getState().addToast(t('studio.linkFailed'), 'warning', 3000);
    }
  };

  const openMenu = () => {
    const rect = moreRef.current?.getBoundingClientRect();
    useContextMenuStore.getState().open({ x: rect?.left ?? 0, y: rect?.bottom ?? 0 }, [
      { key: 'link', type: 'action', label: t('studio.copyLink'), icon: <Icon name="link" size={16} />, onClick: () => void copyLink() },
      { key: 'rename', type: 'action', label: t('studio.looks.rename'), icon: <Icon name="edit" size={16} />, onClick: () => { setDraft(saved.name); setRenaming(true); } },
      {
        key: 'delete',
        type: 'action',
        label: t('studio.looks.delete'),
        icon: <Icon name="trash" size={16} />,
        danger: true,
        onClick: () => {
          remove(saved.id);
          useUIStore.getState().addToast(t('studio.looks.deleted', { name: saved.name }), 'info', 6000, {
            label: t('studio.looks.undo'),
            onClick: () => restore(saved, index),
          });
        },
      },
    ]);
  };

  return (
    <li className="relative">
      <button
        type="button"
        onClick={onPut}
        aria-pressed={inUse}
        className={`w-full rounded-lg border p-2 text-left transition-colors duration-100 ${
          inUse ? 'border-accent-primary bg-accent-primary/[0.06]' : 'border-border-hard hover:border-interactive-muted hover:bg-interactive-hover active:bg-interactive-active'
        }`}
      >
        <SurfaceSwatch settings={saved.look.surface} accent={saved.look.accent} />
        <span className="mt-2 flex items-center gap-1.5 px-0.5 pr-6">
          <span aria-hidden="true" className={`h-2 w-2 flex-shrink-0 rounded-full border ${inUse ? 'border-accent-primary bg-accent-primary' : 'border-interactive-muted'}`} />
          {renaming ? null : <span className="min-w-0 truncate text-ui font-medium text-txt-primary">{saved.name}</span>}
        </span>
      </button>
      {renaming && (
        <input
          autoFocus
          value={draft}
          maxLength={LOOK_NAME_MAX}
          aria-label={t('studio.looks.rename')}
          onChange={(event) => setDraft(event.target.value)}
          onBlur={finishRename}
          onKeyDown={(event) => {
            if (event.key === 'Enter') finishRename();
            if (event.key === 'Escape') setRenaming(false);
          }}
          className="input-standard absolute bottom-1.5 left-1.5 right-1.5 h-7 py-0 text-ui"
        />
      )}
      {!renaming && (
        <button
          ref={moreRef}
          type="button"
          onClick={openMenu}
          aria-label={t('studio.looks.more', { name: saved.name })}
          data-tooltip={t('studio.looks.more', { name: saved.name })}
          className="icon-btn absolute bottom-1.5 right-1.5 h-6 w-6"
        >
          <Icon name="more" size={14} />
        </button>
      )}
    </li>
  );
}
