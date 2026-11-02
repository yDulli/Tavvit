import { useTranslation } from 'react-i18next';
import { ROLE_GLYPH_GROUP_IDS, ROLE_GLYPH_GROUPS, roleGlyphValue, roleIconGlyph } from '@backspace/shared/src/roleGlyphs';
import { RoleGlyph, RoleIcon } from './RoleIcon';

/**
 * Choosing a role's icon: the set in groups. The chosen one wears the role's colour or
 * gradient, and the rest stay quiet so that the choice is what stands out. An emoji from before
 * the set, with no icon meaning the same, stays until someone picks something else.
 */
export function RoleIconPicker({ value, onChange, color, colorSecondary }: {
  value: string;
  onChange: (value: string) => void;
  color: string;
  colorSecondary: string | null;
}) {
  const { t } = useTranslation(['spaces']);
  const current = value.trim();
  const selected = current ? roleIconGlyph(current) : null;

  return (
    <div className="surface-card overflow-hidden rounded-lg">
      <div className="flex min-h-[44px] items-center justify-between gap-3 border-b border-border-hard px-3 py-1.5">
        <span className="flex min-w-0 items-center gap-2 text-meta text-txt-tertiary">
          {current
            ? <RoleIcon icon={current} color={color} colorSecondary={colorSecondary} size={20} glow />
            : <span aria-hidden="true" className="h-5 w-5 rounded-full border border-dashed border-border-soft" />}
          <span className="truncate">
            {selected ? t(`spaces:roleIcons.names.${selected}`) : current ? t('spaces:roleIcons.fromBefore') : t('spaces:roleIcons.none')}
          </span>
        </span>
        {current && (
          <button type="button" onClick={() => onChange('')} className="btn-quiet btn-sm">{t('spaces:roleDisplay.removeIcon')}</button>
        )}
      </div>
      <div className="max-h-[248px] overflow-y-auto px-2 pb-2.5 scrollbar-thin">
        {ROLE_GLYPH_GROUP_IDS.map((group) => (
          <div key={group}>
            <div className="label-mono px-1 pb-1.5 pt-3">{t(`spaces:roleIcons.groups.${group}`)}</div>
            <div className="grid grid-cols-[repeat(auto-fill,minmax(34px,1fr))] gap-0.5">
              {ROLE_GLYPH_GROUPS[group].map((id) => {
                const isChosen = selected === id;
                const name = t(`spaces:roleIcons.names.${id}`);
                return (
                  <button
                    key={id}
                    type="button"
                    onClick={() => onChange(roleGlyphValue(id))}
                    aria-pressed={isChosen}
                    aria-label={name}
                    title={name}
                    className="role-glyph-option"
                    style={isChosen ? { backgroundColor: `${color}26`, boxShadow: `inset 0 0 0 1px ${color}99` } : undefined}
                  >
                    <RoleGlyph id={id} size={18} color={isChosen ? color : undefined} colorSecondary={isChosen ? colorSecondary : undefined} glow={isChosen} />
                  </button>
                );
              })}
            </div>
          </div>
        ))}
      </div>
    </div>
  );
}
