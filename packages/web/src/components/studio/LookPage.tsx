import { useMemo, useState, type ReactNode } from 'react';
import { useLocation, useNavigate } from 'react-router-dom';
import { useTranslation } from 'react-i18next';
import { useShallow } from 'zustand/react/shallow';
import { appearanceSettingsOf, useAppearanceStore } from '../../stores/appearanceStore';
import { useAuthStore } from '../../stores/authStore';
import { savedLookOf, useLooksStore } from '../../stores/looksStore';
import { useUIStore } from '../../stores/uiStore';
import { decodeLook, lookOfAppearance, sameLook, themeChoiceOf } from '../../utils/looks';
import { Icon } from '../ui/Icon';
import { PUBLIC_CARD, PublicPageFrame } from '../ui/PublicPageFrame';
import { SurfaceSwatch } from '../ui/SurfaceSwatch';

/**
 * A shared look (`/look#…`, docs/systems/design-system.md, "Looks"): the whole look is in the part
 * of the link after `#`, which no server is sent, and this page reads it (`decodeLook`), shows it
 * and offers to put it on this device. It works signed in or not, as a device's appearance does;
 * putting it on also keeps it among the person's looks, and what helps them read stays theirs.
 */
export function LookPage() {
  const { t } = useTranslation(['settings', 'common']);
  const navigate = useNavigate();
  const { hash } = useLocation();
  const shared = useMemo(() => decodeLook(hash), [hash]);
  const signedIn = useAuthStore((s) => s.token !== null);
  const appearance = useAppearanceStore(useShallow(appearanceSettingsOf));
  const putLook = useAppearanceStore((s) => s.putLook);
  const looks = useLooksStore((s) => s.looks);
  const save = useLooksStore((s) => s.save);
  const [justPut, setJustPut] = useState(false);
  const onward = () => navigate(signedIn ? '/channels/@me' : '/login');

  if (!shared) {
    return (
      <PublicPageFrame>
        <div className={`${PUBLIC_CARD} text-center`}>
          <span aria-hidden="true" className="empty-state-icon mx-auto mb-4 text-txt-secondary">
            <Icon name="palette" size={18} />
          </span>
          <h1 className="page-title mb-2">{t('settings:studio.shared.invalidTitle')}</h1>
          <p className="mb-6 text-ui leading-[1.5] text-txt-secondary">{t('settings:studio.shared.invalidText')}</p>
          <button type="button" onClick={onward} className="btn-hero btn-lg">{t('settings:studio.shared.continue')}</button>
        </div>
      </PublicPageFrame>
    );
  }

  const { look } = shared;
  const name = shared.name ?? t('settings:studio.shared.untitled');
  const inUse = sameLook(look, lookOfAppearance(appearance));
  const theme = themeChoiceOf(look.surface);

  const putOn = () => {
    putLook(look);
    if (!savedLookOf(looks, look)) save(name, look);
    setJustPut(true);
    useUIStore.getState().addToast(t('settings:studio.shared.done', { name }), 'success', 3000);
  };

  const facts: Array<{ label: string; value: ReactNode }> = [
    { label: t('settings:appearance.theme.title'), value: t(`settings:appearance.theme.name.${theme}`) },
    {
      label: t('settings:appearance.accent.title'),
      value: look.accent ? (
        <span className="inline-flex items-center gap-1.5">
          <span aria-hidden="true" className="h-3 w-3 rounded-sm border border-border-soft" style={{ backgroundColor: look.accent }} />
          <span className="font-mono text-meta">{look.accent}</span>
        </span>
      ) : t('settings:studio.shared.serverAccent'),
    },
    { label: t('settings:appearance.typeface.label'), value: t(`settings:appearance.typeface.options.${look.font}`) },
    { label: t('settings:appearance.shape.corners.label'), value: t(`settings:appearance.shape.corners.options.${look.corners}`) },
    { label: t('settings:appearance.messages.style.label'), value: t(`settings:appearance.messages.style.options.${look.messageStyle}.label`) },
    { label: t('settings:appearance.messages.density.label'), value: t(`settings:appearance.messages.density.options.${look.density}`) },
    { label: t('settings:appearance.reading.light.label'), value: look.light === 'on' ? t('settings:studio.shared.lightOn') : t('settings:studio.shared.lightOff') },
  ];

  return (
    <PublicPageFrame>
      <div className={PUBLIC_CARD}>
        <div className="label-mono mb-1.5">{t('settings:studio.shared.kicker')}</div>
        <h1 className="page-title mb-4 break-words">{name}</h1>
        <SurfaceSwatch settings={look.surface} accent={look.accent} className="h-28" />
        <dl className="mt-5 grid grid-cols-[auto_minmax(0,1fr)] gap-x-4 gap-y-2 text-ui">
          {facts.map((fact) => (
            <div key={fact.label} className="contents">
              <dt className="text-txt-tertiary">{fact.label}</dt>
              <dd className="min-w-0 truncate text-txt-primary">{fact.value}</dd>
            </div>
          ))}
        </dl>
        <p className="mt-5 text-meta leading-snug text-txt-tertiary">{t('settings:studio.shared.yours')}</p>
        <div className="mt-6 flex flex-wrap items-center gap-2">
          {inUse ? (
            <>
              <span className="inline-flex items-center gap-1.5 text-ui text-txt-secondary">
                <Icon name="check" size={16} className="text-accent-soft" />
                {justPut ? t('settings:studio.shared.nowInUse') : t('settings:studio.shared.inUse')}
              </span>
              <div className="ml-auto flex gap-2">
                {signedIn && <button type="button" onClick={() => navigate('/studio')} className="btn-outline">{t('settings:studio.shared.openStudio')}</button>}
                <button type="button" onClick={onward} className="btn-primary">{t('settings:studio.shared.continue')}</button>
              </div>
            </>
          ) : (
            <>
              <button type="button" onClick={putOn} className="btn-hero btn-lg">{t('settings:studio.shared.use')}</button>
              <button type="button" onClick={onward} className="btn-quiet">{t('settings:studio.shared.notNow')}</button>
            </>
          )}
        </div>
      </div>
    </PublicPageFrame>
  );
}
