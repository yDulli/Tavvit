import { useEffect, useId, useState } from 'react';
import { useTranslation } from 'react-i18next';
import type { TFunction } from 'i18next';
import { describeError } from '../../../i18n/errors';
import i18n, { availableLanguages, getLanguage, type SupportedLanguage } from '../../../i18n';
import { getApiForOrigin, useSpaceStore } from '../../../stores/spaceStore';
import { copyText } from '../../../utils/clipboard';
import { buildDiscordAnnouncement } from '../../../utils/discordAnnouncement';
import { spaceInviteUrl } from '../../../utils/inviteParser';
import { STREAMER_MASK, useStreamerMode } from '../../../streamer/streamerModeStore';
import { Icon } from '../../ui/Icon';
import { SettingsField } from '../settingsPanels/_shared/SettingsControls';

/** What the text is made from, read once from the instance that hosts the space. */
interface AnnouncementFacts {
  link: string;
  instanceName: string;
  registrationOpen: boolean;
}

/**
 * The text that tells the people on the Discord server where the community went, ready to paste
 * there: in a language picked here, with the space's invite link, which opens the invite page's
 * welcome for people coming from Discord. The link is the space's own address when it has one,
 * else its standing invite, which takes CREATE_INVITE (the server checks).
 */
export function DiscordAnnouncement({ spaceId, origin, withEmoji }: { spaceId: string; origin: string; withEmoji: boolean }) {
  const { t } = useTranslation(['spaces', 'common']);
  const languageId = useId();
  const textId = useId();
  const space = useSpaceStore((state) => state.spaces.find((entry) => entry.id === spaceId));
  const vanityCode = space?.vanityCode ?? null;
  const [language, setLanguage] = useState<SupportedLanguage>(getLanguage());
  const [fixedT, setFixedT] = useState<TFunction<'spaces'> | null>(null);
  const [facts, setFacts] = useState<AnnouncementFacts | null>(null);
  const [error, setError] = useState('');
  const [copied, setCopied] = useState<'text' | 'link' | null>(null);
  const streaming = useStreamerMode();

  useEffect(() => {
    let live = true;
    const api = getApiForOrigin(origin);
    (async () => {
      const code = vanityCode ?? (await api.spaces.invite(spaceId)).inviteCode;
      const info = await api.instance.info();
      const link = new URL(spaceInviteUrl(origin, code));
      link.searchParams.set('from', 'discord');
      if (live) setFacts({ link: link.toString(), instanceName: info.name, registrationOpen: info.registrationOpen });
    })().catch((err: unknown) => {
      if (live) setError(t('spaces:import.announce.linkFailed', { reason: describeError(err) }));
    });
    return () => { live = false; };
    // `t` changes with the app's language, which does not change what is read here.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [origin, spaceId, vanityCode]);

  // The text is in the language picked here, not necessarily the app's: its catalog is loaded
  // first, or i18next would quietly answer in English under another language's name.
  useEffect(() => {
    let live = true;
    i18n.loadLanguages(language)
      .then(() => { if (live) setFixedT(() => i18n.getFixedT(language, 'spaces')); })
      .catch(() => { if (live) setFixedT(() => i18n.getFixedT(getLanguage(), 'spaces')); });
    return () => { live = false; };
  }, [language]);

  useEffect(() => {
    if (copied === null) return undefined;
    const timer = window.setTimeout(() => setCopied(null), 2000);
    return () => window.clearTimeout(timer);
  }, [copied]);

  const text = facts && fixedT && space
    ? buildDiscordAnnouncement({
      t: fixedT,
      spaceName: space.name,
      instanceName: facts.instanceName,
      link: facts.link,
      request: space.visibility === 'request',
      withEmoji,
      registrationOpen: facts.registrationOpen,
    })
    : '';

  // The link lets anyone in: streamer mode shows the text without it. The buttons copy the real one.
  const shownText = streaming && facts ? text.split(facts.link).join(STREAMER_MASK) : text;

  const copy = async (what: 'text' | 'link') => {
    const value = what === 'text' ? text : facts?.link ?? '';
    if (!value) return;
    setError('');
    if (await copyText(value)) setCopied(what);
    else setError(t('spaces:import.announce.copyFailed'));
  };

  return (
    <div className="space-y-4">
      <p className="text-meta leading-relaxed text-txt-secondary">{t('spaces:import.announce.intro')}</p>
      <SettingsField label={t('spaces:import.announce.language')} htmlFor={languageId}>
        <select
          id={languageId}
          value={language}
          onChange={(event) => setLanguage(event.target.value as SupportedLanguage)}
          className="input-standard w-full desktop:w-64"
        >
          {availableLanguages.map((entry) => (
            <option key={entry.code} value={entry.code}>{entry.nativeName}</option>
          ))}
        </select>
      </SettingsField>
      <SettingsField label={t('spaces:import.announce.textLabel')} htmlFor={textId}>
        <textarea
          id={textId}
          readOnly
          value={shownText}
          rows={8}
          onFocus={(event) => event.currentTarget.select()}
          className="input-standard w-full resize-none font-mono text-meta leading-relaxed"
        />
      </SettingsField>
      {facts && !facts.registrationOpen && (
        <p className="text-meta leading-snug text-txt-secondary">{t('spaces:import.announce.registrationClosed')}</p>
      )}
      {error && <p role="alert" className="text-meta text-txt-danger">{error}</p>}
      <div className="flex flex-wrap justify-end gap-2">
        <button type="button" className="btn-outline btn-sm" onClick={() => void copy('link')} disabled={!facts}>
          <Icon name={copied === 'link' ? 'check' : 'link'} size={14} />
          {copied === 'link' ? t('common:actions.copied') : t('spaces:import.announce.copyLink')}
        </button>
        <button type="button" className="btn-primary btn-sm" onClick={() => void copy('text')} disabled={text === ''}>
          <Icon name={copied === 'text' ? 'check' : 'copy'} size={14} />
          {copied === 'text' ? t('common:actions.copied') : t('spaces:import.announce.copyText')}
        </button>
      </div>
    </div>
  );
}
