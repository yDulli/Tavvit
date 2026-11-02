import { useTranslation } from 'react-i18next';
import { useVoiceStore } from '../../../stores/voiceStore';
import { useUIStore } from '../../../stores/uiStore';
import { VideoSection } from './VideoSection';
import { AudioInputSection } from './AudioInputSection';
import { AudioOutputSection } from './AudioOutputSection';
import { SettingsPage, SettingsSection, ToggleRow } from './_shared/SettingsControls';

export function VoicePanel() {
  const { t } = useTranslation(['settings']);
  const echoCancellation = useVoiceStore((s) => s.echoCancellation);
  const autoGainControl = useVoiceStore((s) => s.autoGainControl);
  const rnnoiseEnabled = useVoiceStore((s) => s.rnnoiseEnabled);
  const setEchoCancellation = useVoiceStore((s) => s.setEchoCancellation);
  const setAutoGainControl = useVoiceStore((s) => s.setAutoGainControl);
  const setRnnoiseEnabled = useVoiceStore((s) => s.setRnnoiseEnabled);
  const pipEnabled = useVoiceStore((s) => s.pipEnabled);
  const setPipEnabled = useVoiceStore((s) => s.setPipEnabled);
  // The floating window is mounted only by the desktop layout (AppLayout), and
  // the mobile Voice settings screen renders this same panel, so the setting is
  // offered only where it has an effect.
  const isMobile = useUIStore((s) => s.isMobile);

  return (
    <SettingsPage title={t('settings:voice.title')}>
      <AudioInputSection />
      <AudioOutputSection />

      {!isMobile && (
        <SettingsSection title={t('settings:voice.pip.sectionTitle')}>
          <ToggleRow
            label={t('settings:voice.pip.showOnSwitch.label')}
            description={t('settings:voice.pip.showOnSwitch.description')}
            enabled={pipEnabled}
            onChange={setPipEnabled}
          />
        </SettingsSection>
      )}

      <VideoSection />

      <SettingsSection title={t('settings:voice.processing.sectionTitle')}>
        <ToggleRow
          label={t('settings:voice.processing.noiseSuppression.label')}
          description={t('settings:voice.processing.noiseSuppression.description')}
          enabled={rnnoiseEnabled}
          onChange={setRnnoiseEnabled}
        />
        <ToggleRow
          label={t('settings:voice.processing.echoCancellation.label')}
          description={t('settings:voice.processing.echoCancellation.description')}
          enabled={echoCancellation}
          onChange={setEchoCancellation}
        />
        <ToggleRow
          label={t('settings:voice.processing.autoGain.label')}
          description={t('settings:voice.processing.autoGain.description')}
          enabled={autoGainControl}
          onChange={setAutoGainControl}
        />
      </SettingsSection>
    </SettingsPage>
  );
}
