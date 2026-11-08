import { useInRouterContext, useNavigate } from 'react-router-dom';
import { useTranslation } from 'react-i18next';
import { useAuthStore } from '../../../stores/authStore';
import { useUIStore } from '../../../stores/uiStore';
import { Icon } from '../../ui/Icon';
import { ThemeSection } from './ThemeSection';
import { AccentSection } from './AccentSection';
import { MessagesSection, ShapeSection, SpaceLooksSetting, TypefaceSection } from './LookSections';
import { SettingsPage, SettingsSection } from './_shared/SettingsControls';

/**
 * Presentation preferences that belong to this browser or app rather than to
 * the account: they are stored locally and they apply on the login screen,
 * before there is an account at all. The theme studio (`/studio`) is the larger
 * place for the same choices, with a preview, kept looks and links to share.
 */
export function AppearancePanel() {
  const { t } = useTranslation(['settings']);

  return (
    <SettingsPage title={t('settings:appearance.title')}>
      <StudioEntry />
      <ThemeSection />
      <AccentSection />
      <MessagesSection />
      <ShapeSection />
      <TypefaceSection />
      <SettingsSection title={t('settings:studio.sections.spaces')}>
        <SpaceLooksSetting />
      </SettingsSection>
    </SettingsPage>
  );
}

/** The way into the theme studio, for someone signed in (it is a page of the app, behind its router). */
function StudioEntry() {
  const signedIn = useAuthStore((s) => s.token !== null);
  const inRouter = useInRouterContext();
  return signedIn && inRouter ? <StudioEntryCard /> : null;
}

function StudioEntryCard() {
  const { t } = useTranslation('settings');
  const navigate = useNavigate();
  const open = () => {
    useUIStore.getState().closeModal();
    navigate('/studio');
  };
  return (
    <div className="surface-card flex items-center gap-3 rounded-lg p-4">
      <span aria-hidden="true" className="flex h-9 w-9 flex-shrink-0 items-center justify-center rounded-md border border-border-soft bg-surface-input text-txt-secondary">
        <Icon name="palette" size={18} />
      </span>
      <div className="min-w-0 flex-1">
        <div className="text-ui font-medium text-txt-primary">{t('studio.entry.title')}</div>
        <p className="text-meta leading-snug text-txt-tertiary">{t('studio.entry.text')}</p>
      </div>
      <button type="button" onClick={open} className="btn-outline btn-sm flex-shrink-0">{t('studio.entry.open')}</button>
    </div>
  );
}
