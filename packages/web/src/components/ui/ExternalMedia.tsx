import React, { type ImgHTMLAttributes } from 'react';
import { useTranslation } from 'react-i18next';
import { externalHostOf, useExternalMediaStore } from '../../stores/externalMediaStore';
import { useConnectedOrigins } from '../../hooks/useConnectedOrigins';
import { useFormatters } from '../../i18n/formatters';

/**
 * Whether this address may be fetched now, and its host when it still needs a yes. An address on
 * one of `trustedOrigins` (servers this client already talks to, `useConnectedOrigins`) needs none.
 */
export function useBlockedHost(url: string | null | undefined, trustedOrigins: readonly string[] = []): string | null {
  const alwaysAllow = useExternalMediaStore((s) => s.alwaysAllow);
  const allowedHosts = useExternalMediaStore((s) => s.allowedHosts);
  const host = externalHostOf(url);
  if (!host || alwaysAllow || allowedHosts.includes(host)) return null;
  return url && trustedOrigins.includes(originOf(url)) ? null : host;
}

/**
 * A picture's address as the page may fetch it now: as given when it is on a server this client
 * talks to (`useConnectedOrigins`) or the person said yes to its host, null while it waits for that
 * yes (docs/systems/legal.md). Every picture a server names goes through this: an account's picture
 * and banner, a space's or a group's icon. What stands in meanwhile is the caller's.
 */
export function useGatedPicture(address: string | null | undefined): string | null {
  const blocked = useBlockedHost(address, useConnectedOrigins()) !== null;
  return address && !blocked ? address : null;
}

/** An `<img>` of such a picture, with `whileBlocked` in its place until it may be fetched. */
export function GatedPicture({ src, whileBlocked, ...rest }: ImgHTMLAttributes<HTMLImageElement> & { src: string; whileBlocked: React.ReactNode }) {
  const shown = useGatedPicture(src);
  return shown ? <img src={shown} {...rest} /> : <>{whileBlocked}</>;
}

function originOf(url: string): string {
  try {
    return new URL(url, window.location.href).origin;
  } catch {
    return '';
  }
}

/**
 * What stands in for something from another server until the person agrees to
 * fetch it (docs/systems/legal.md). The buttons stop the click, because this
 * often sits inside something clickable, such as a video's play button.
 */
function ExternalPlaceholder({ host, compact, className }: { host: string; compact?: boolean; className?: string }) {
  const { t } = useTranslation('legal');
  const allowHost = useExternalMediaStore((s) => s.allowHost);
  const setAlwaysAllow = useExternalMediaStore((s) => s.setAlwaysAllow);

  const load = (e: React.MouseEvent) => {
    e.preventDefault();
    e.stopPropagation();
    allowHost(host);
  };
  const always = (e: React.MouseEvent) => {
    e.preventDefault();
    e.stopPropagation();
    setAlwaysAllow(true);
  };

  if (compact) {
    return (
      <span
        role="button"
        tabIndex={0}
        title={t('external.compactTitle', { host })}
        aria-label={t('external.compactTitle', { host })}
        onClick={load}
        onKeyDown={(e) => { if (e.key === 'Enter' || e.key === ' ') { e.preventDefault(); e.stopPropagation(); allowHost(host); } }}
        className={`flex cursor-pointer items-center justify-center rounded-md border border-border-hard bg-surface-input text-center font-mono text-2xs leading-tight text-txt-tertiary transition-colors hover:border-interactive-muted hover:text-txt-primary ${className ?? ''}`}
      >
        {t('external.compactLoad')}
      </span>
    );
  }

  return (
    <div className={`surface-card max-w-[400px] rounded-lg px-3 py-2.5 text-ui ${className ?? ''}`}>
      <p className="break-words leading-snug text-txt-secondary">{t('external.notice', { host })}</p>
      <div className="mt-2 flex flex-wrap items-center gap-1">
        <button type="button" onClick={load} className="btn-outline btn-sm">{t('external.load')}</button>
        <button type="button" onClick={always} className="btn-quiet btn-sm">{t('external.always')}</button>
      </div>
    </div>
  );
}

/**
 * The notice for something that loads from several servers at once (a Bluesky post's pictures and
 * video): "Load" allows every one of `hosts` until the app closes, "Always allow" is the consent.
 */
export function ExternalHostsNotice({ hosts, className }: { hosts: readonly string[]; className?: string }) {
  const { t } = useTranslation('legal');
  const allowHost = useExternalMediaStore((s) => s.allowHost);
  const setAlwaysAllow = useExternalMediaStore((s) => s.setAlwaysAllow);
  const { formatList } = useFormatters();
  const load = (e: React.MouseEvent) => {
    e.preventDefault();
    e.stopPropagation();
    for (const host of hosts) allowHost(host);
  };
  const always = (e: React.MouseEvent) => {
    e.preventDefault();
    e.stopPropagation();
    setAlwaysAllow(true);
  };
  return (
    <div className={`rounded-md border border-border-soft bg-surface-input px-3 py-2.5 text-ui ${className ?? ''}`}>
      <p className="break-words leading-snug text-txt-secondary">{t('external.noticeMany', { hosts: formatList([...hosts]), count: hosts.length })}</p>
      <div className="mt-2 flex flex-wrap items-center gap-1">
        <button type="button" onClick={load} className="btn-outline btn-sm">{t('external.load')}</button>
        <button type="button" onClick={always} className="btn-quiet btn-sm">{t('external.always')}</button>
      </div>
    </div>
  );
}

/** An image from any address: fetched at once from this server, after a yes from another. */
export function ExternalImage({ src, compact, placeholderClassName, whileBlocked, ...rest }: ImgHTMLAttributes<HTMLImageElement> & {
  /** For a thumbnail: a small placeholder instead of the explanation. */
  compact?: boolean;
  placeholderClassName?: string;
  /** Shown instead of any placeholder. For inside a button, which must not hold controls of its own. */
  whileBlocked?: React.ReactNode;
}) {
  const host = useBlockedHost(src);
  if (host) return whileBlocked !== undefined ? <>{whileBlocked}</> : <ExternalPlaceholder host={host} compact={compact} className={placeholderClassName} />;
  return <img src={src} {...rest} />;
}

/** Anything else fetched from another server: audio, a video, an embedded player, a sticker. */
export function ExternalGate({ url, children, className, trustedOrigins }: {
  url: string | null | undefined;
  children: React.ReactNode;
  className?: string;
  /** Servers whose files need no yes (`useBlockedHost`). */
  trustedOrigins?: readonly string[];
}) {
  const host = useBlockedHost(url, trustedOrigins);
  if (host) return <ExternalPlaceholder host={host} className={className} />;
  return <>{children}</>;
}
