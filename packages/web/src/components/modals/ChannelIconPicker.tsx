import { lazy, Suspense, useState } from 'react';
import { useTranslation } from 'react-i18next';
import type { ChannelType } from '@backspace/shared';
import { normalizeChannelIcon } from '@backspace/shared/src/channelIcons';
import { ROLE_GLYPH_GROUP_IDS, ROLE_GLYPH_GROUPS, parseRoleGlyph, roleGlyphValue } from '@backspace/shared/src/roleGlyphs';
import { RoleGlyph } from '../../roles/RoleIcon';
import { ChannelIcon } from '../ui/ChannelIcon';

const EmojiPicker = lazy(() => import('../chat/EmojiPicker').then((module) => ({ default: module.EmojiPicker })));

type Tab = 'icons' | 'emoji';

/**
 * Choosing a channel's icon: Tavvit's icons, the same set roles have, or an emoji. Each choice is
 * saved at once, and "the type's icon" goes back to what the channel had before any.
 */
export function ChannelIconPicker({ value, type, busy, onChange }: {
  value: string | null;
  type: ChannelType;
  busy: boolean;
  onChange: (icon: string | null) => void;
}) {
  const { t } = useTranslation(['spaces']);
  const glyph = value ? parseRoleGlyph(value) : null;
  const [tab, setTab] = useState<Tab>(value && !glyph ? 'emoji' : 'icons');
  const label = glyph
    ? t(`spaces:roleIcons.names.${glyph}`)
    : value
      ? t('spaces:channel.settings.icon.emoji')
      : t('spaces:channel.settings.icon.default');

  return (
    <div className="surface-card overflow-hidden rounded-lg" aria-busy={busy}>
      <div className="flex min-h-[44px] items-center justify-between gap-3 border-b border-border-hard px-3 py-1.5">
        <span className="flex min-w-0 items-center gap-2 text-meta text-txt-secondary">
          <ChannelIcon type={type} icon={value} size={18} className="text-txt-primary" />
          <span className="truncate">{label}</span>
        </span>
        <div className="flex flex-shrink-0 items-center gap-1">
          {(['icons', 'emoji'] as const).map((option) => (
            <button
              key={option}
              type="button"
              onClick={() => setTab(option)}
              aria-pressed={tab === option}
              className="btn-quiet btn-sm aria-pressed:bg-interactive-selected aria-pressed:text-txt-primary"
            >
              {t(`spaces:channel.settings.icon.tabs.${option}`)}
            </button>
          ))}
          {value && (
            <button type="button" onClick={() => onChange(null)} disabled={busy} className="btn-quiet btn-sm">
              {t('spaces:channel.settings.icon.useDefault')}
            </button>
          )}
        </div>
      </div>

      {tab === 'icons' ? (
        <div className="max-h-[248px] overflow-y-auto px-2 pb-2.5 scrollbar-thin">
          {ROLE_GLYPH_GROUP_IDS.map((group) => (
            <div key={group}>
              <div className="label-mono px-1 pb-1.5 pt-3">{t(`spaces:roleIcons.groups.${group}`)}</div>
              <div className="grid grid-cols-[repeat(auto-fill,minmax(34px,1fr))] gap-0.5">
                {ROLE_GLYPH_GROUPS[group].map((id) => {
                  const name = t(`spaces:roleIcons.names.${id}`);
                  return (
                    <button
                      key={id}
                      type="button"
                      onClick={() => onChange(roleGlyphValue(id))}
                      disabled={busy}
                      aria-pressed={glyph === id}
                      aria-label={name}
                      title={name}
                      className="role-glyph-option aria-pressed:bg-interactive-selected aria-pressed:text-txt-primary"
                    >
                      <RoleGlyph id={id} size={18} />
                    </button>
                  );
                })}
              </div>
            </div>
          ))}
        </div>
      ) : (
        <div className="emoji-picker-wrapper flex justify-center p-2">
          <Suspense fallback={<div className="h-[320px]" />}>
            <EmojiPicker
              stickers={false}
              custom={false}
              onEmojiSelect={({ native }) => {
                // The standard emoji only: an icon has to read the same on every instance.
                const checked = normalizeChannelIcon(native);
                if (checked.ok && checked.icon) onChange(checked.icon);
              }}
            />
          </Suspense>
        </div>
      )}
    </div>
  );
}
