import { RoleIcon } from '../../roles/RoleIcon';
import { useId } from 'react';
import { useTranslation } from 'react-i18next';
import type { Role } from '@backspace/shared';
import { roleDotStyle, roleTextStyle } from '../../utils/roleStyle';

/**
 * A space member's roles on their profile card and full profile: a heading in
 * the profile's section style and one chip per role: a dot in the role's
 * colours (split for a gradient role), its icon, and its name in its colour
 * or gradient (`roleTextStyle`), as the member list draws names. Owning the
 * space is a badge (BadgeList), not a role. Renders nothing for a member
 * without roles.
 */
export function ProfileRoles({ roles }: { roles: Role[] }) {
  const { t } = useTranslation(['social']);
  const headingId = useId();

  if (roles.length === 0) return null;

  return (
    <div>
      <span id={headingId} className="label-mono">
        {t('social:profile.roles')}
      </span>
      <ul aria-labelledby={headingId} className="flex flex-wrap gap-1.5 mt-1.5">
        {roles.map((role) => (
          <li
            key={role.id}
            title={role.description ?? undefined}
            className="inline-flex items-center gap-1.5 max-w-full min-w-0 px-2 py-[3px] rounded-md bg-interactive-hover"
          >
            <span
              className="w-2 h-2 rounded-full flex-shrink-0"
              style={roleDotStyle({ color: role.color || '#b9bbbe', colorSecondary: role.colorSecondary })}
              aria-hidden="true"
            />
            {role.icon && <RoleIcon icon={role.icon} color={role.color} colorSecondary={role.colorSecondary} size={13} />}
            <span
              className={`text-meta leading-[1.35] truncate ${role.color ? '' : 'text-txt-secondary'}`}
              style={role.color ? roleTextStyle(role) : undefined}
            >
              {role.name}
            </span>
          </li>
        ))}
      </ul>
    </div>
  );
}
