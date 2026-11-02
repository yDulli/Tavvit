import { useTranslation } from 'react-i18next';
import { INTERFACE_SCALES, useInterfaceScaleStore } from '../../../stores/interfaceScaleStore';
import { useUIStore } from '../../../stores/uiStore';
import { SettingsSection } from './_shared/SettingsControls';

export function InterfaceScaleSection() {
  const { t } = useTranslation('settings');
  const scale = useInterfaceScaleStore(state => state.scale);
  const setScale = useInterfaceScaleStore(state => state.setScale);
  const changeScale = (value: number) => {
    const wasMobile = useUIStore.getState().isMobile;
    setScale(value);
    const ui = useUIStore.getState();
    // Keep this panel reachable when scaling crosses the responsive breakpoint.
    if (ui.isMobile !== wasMobile) {
      if (ui.isMobile) {
        ui.closeModal();
        ui.pushMobileScreen('settings-appearance');
      } else {
        ui.openModal('userSettings', { tab: 'appearance' });
      }
    }
  };
  return (
    <SettingsSection title={t('interfaceScale.label')} description={t('interfaceScale.description')}>
      <div className="flex gap-2">
        <select
          id="interface-scale"
          aria-label={t('interfaceScale.label')}
          value={scale}
          onChange={event => changeScale(Number(event.target.value))}
          className="input-standard min-w-0 flex-1"
        >
          {INTERFACE_SCALES.map(value => <option key={value} value={value}>{value}%</option>)}
        </select>
        <button
          type="button"
          onClick={() => changeScale(100)}
          disabled={scale === 100}
          className="btn-outline h-auto"
        >
          {t('interfaceScale.reset')}
        </button>
      </div>
    </SettingsSection>
  );
}
