import { useTranslation } from 'react-i18next';
import { useNavigate } from 'react-router-dom';
import { BOT_LIMITS } from '@backspace/shared/src/bots';
import { useUIStore } from '../../../stores/uiStore';
import { Icon } from '../../ui/Icon';
import { SettingsPage, SettingsSection } from './_shared/SettingsControls';

/** The way to the developer portal, which has more to show than a settings page has room for. */
export function DevelopersPanel() {
  const { t } = useTranslation(['settings']);
  const navigate = useNavigate();
  const closeModal = useUIStore((s) => s.closeModal);

  return (
    <SettingsPage title={t('settings:nav.tabs.developers')}>
      <SettingsSection title={t('settings:developers.title')} description={t('settings:developers.description', { max: BOT_LIMITS.PER_OWNER })}>
        <div className="flex flex-wrap items-center gap-2">
          <button
            type="button"
            className="btn-primary"
            onClick={() => {
              closeModal();
              navigate('/developers/bots');
            }}
          >
            {t('settings:developers.open')}
            <Icon name="chevron-right" size={15} />
          </button>
          {/* A page of its own, not the app's: it opens beside it, and the desktop app hands it to the browser. */}
          <a href="/developers" target="_blank" rel="noopener noreferrer" className="btn-outline">{t('settings:developers.docs')}</a>
        </div>
      </SettingsSection>
    </SettingsPage>
  );
}
