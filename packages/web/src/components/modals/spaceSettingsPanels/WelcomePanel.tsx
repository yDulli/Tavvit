import { useEffect, useId, useState } from 'react';
import { useTranslation } from 'react-i18next';
import { WELCOME_LIMITS } from '@backspace/shared/src/welcome';
import { describeError } from '../../../i18n/errors';
import { getApiForOrigin, useSpaceStore } from '../../../stores/spaceStore';
import { useUIStore } from '../../../stores/uiStore';
import { useWelcomeStore } from '../../../stores/welcomeStore';
import { SettingsSection, ToggleRow } from '../settingsPanels/_shared/SettingsControls';

/** What a space says to someone new, and whether they must agree to its rules to take part. */
export function WelcomePanel({ spaceId }: { spaceId: string }) {
  const { t } = useTranslation(['spaces', 'common']);
  const fieldId = useId();
  const origin = useSpaceStore((state) => state.spaces.find((space) => space.id === spaceId)?._instanceOrigin ?? '');
  const channels = useSpaceStore((state) => state.channels);
  const addToast = useUIStore((state) => state.addToast);
  const [loaded, setLoaded] = useState(false);
  const [welcomeText, setWelcomeText] = useState('');
  const [rulesText, setRulesText] = useState('');
  const [rulesRequired, setRulesRequired] = useState(false);
  const [channelIds, setChannelIds] = useState<string[]>([]);
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState('');

  useEffect(() => {
    let cancelled = false;
    useWelcomeStore.getState().load(origin, spaceId).then((welcome) => {
      if (cancelled) return;
      setWelcomeText(welcome.welcomeText ?? '');
      setRulesText(welcome.rulesText ?? '');
      setRulesRequired(welcome.rulesRequired);
      setChannelIds(welcome.channels.map((channel) => channel.id));
      setLoaded(true);
    }).catch((err: unknown) => {
      if (!cancelled) setError(describeError(err));
    });
    return () => {
      cancelled = true;
    };
  }, [origin, spaceId]);

  const textChannels = channels.filter((channel) => channel.spaceId === spaceId && channel.type !== 'voice' && channel.type !== 'thread');
  const toggleChannel = (channelId: string) => setChannelIds((current) => (
    current.includes(channelId) ? current.filter((id) => id !== channelId) : [...current, channelId]
  ));

  const save = async () => {
    setSaving(true);
    setError('');
    try {
      const updated = await getApiForOrigin(origin).welcome.update(spaceId, {
        welcomeText: welcomeText.trim() || null,
        rulesText: rulesText.trim() || null,
        rulesRequired,
        channelIds,
      });
      useWelcomeStore.getState().store(origin, spaceId, updated);
      addToast(t('spaces:settings.welcome.saved'), 'success');
    } catch (err) {
      setError(describeError(err));
    } finally {
      setSaving(false);
    }
  };

  const rulesMissing = rulesRequired && !rulesText.trim();

  return (
    <div className="space-y-6">
      <div>
        <h2 className="page-title">{t('spaces:settings.welcome.title')}</h2>
        <p className="mt-1 text-ui text-txt-secondary">{t('spaces:settings.welcome.description')}</p>
      </div>

      <SettingsSection title={t('spaces:settings.welcome.messageTitle')} description={t('spaces:settings.welcome.messageDescription')}>
        <label htmlFor={`${fieldId}-welcome`} className="sr-only">{t('spaces:settings.welcome.messageTitle')}</label>
        <textarea
          id={`${fieldId}-welcome`}
          value={welcomeText}
          rows={4}
          disabled={!loaded}
          onChange={(change) => setWelcomeText(change.target.value.slice(0, WELCOME_LIMITS.WELCOME_MAX_LENGTH))}
          className="input-standard w-full resize-y"
        />
      </SettingsSection>

      <SettingsSection title={t('spaces:settings.welcome.rulesTitle')} description={t('spaces:settings.welcome.rulesDescription')}>
        <label htmlFor={`${fieldId}-rules`} className="sr-only">{t('spaces:settings.welcome.rulesTitle')}</label>
        <textarea
          id={`${fieldId}-rules`}
          value={rulesText}
          rows={8}
          disabled={!loaded}
          onChange={(change) => setRulesText(change.target.value.slice(0, WELCOME_LIMITS.RULES_MAX_LENGTH))}
          className="input-standard w-full resize-y"
        />
        <ToggleRow
          label={t('spaces:settings.welcome.requiredLabel')}
          description={t('spaces:settings.welcome.requiredDescription')}
          enabled={rulesRequired}
          onChange={setRulesRequired}
        />
        {rulesMissing && <p className="text-meta text-txt-danger">{t('spaces:settings.welcome.rulesMissing')}</p>}
      </SettingsSection>

      <SettingsSection
        title={t('spaces:settings.welcome.channelsTitle')}
        description={t('spaces:settings.welcome.channelsDescription', { max: WELCOME_LIMITS.CHANNELS_MAX })}
      >
        <ul className="flex flex-col gap-1">
          {textChannels.map((channel) => {
            const chosen = channelIds.includes(channel.id);
            return (
              <li key={channel.id}>
                <label className="list-row w-full cursor-pointer">
                  <input
                    type="checkbox"
                    checked={chosen}
                    disabled={!chosen && channelIds.length >= WELCOME_LIMITS.CHANNELS_MAX}
                    onChange={() => toggleChannel(channel.id)}
                  />
                  <span className="min-w-0 flex-1 truncate text-ui text-txt-primary">{channel.name}</span>
                </label>
              </li>
            );
          })}
        </ul>
      </SettingsSection>

      {error && <p role="alert" className="text-meta text-txt-danger">{error}</p>}

      <div className="flex justify-end">
        <button type="button" onClick={() => void save()} disabled={!loaded || saving || rulesMissing} aria-busy={saving} className="btn-primary">
          {t('common:actions.save')}
        </button>
      </div>
    </div>
  );
}
