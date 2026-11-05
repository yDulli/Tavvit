import { useMemo, useState } from 'react';
import { useTranslation } from 'react-i18next';
import { ROLE_LIMITS, type MemberWithUser, type Role } from '@backspace/shared';
import { useSpaceStore, type TaggedSpace } from '../../../stores/spaceStore';
import { changeMemberRole } from '../../layout/memberMenu/memberRoleActions';
import { useViewerHeldPermissions, viewerCanEditMemberRoles, viewerCanManageRoleAt, viewerHoldsEveryBit } from '../../../utils/roleHierarchy';
import { stringToPermissions } from '../../../utils/permissions';
import { spaceMemberName } from '../../../utils/identity';
import { roleTextStyle } from '../../../utils/roleStyle';
import { Toggle } from '../../ui/Toggle';
import { Avatar } from '../../ui/Avatar';
import { Icon } from '../../ui/Icon';
import { resolveAssetUrl } from '../../../utils/assetUrls';
import { RoleIcon } from '../../../roles/RoleIcon';
import { RoleIconPicker } from '../../../roles/RoleIconPicker';

interface RoleDisplayFieldsProps {
  name: string;
  color: string;
  colorSecondary: string | null;
  onColorSecondary: (value: string | null) => void;
  icon: string;
  onIcon: (value: string) => void;
  description: string;
  onDescription: (value: string) => void;
  hoist: boolean;
  onHoist: (value: boolean) => void;
  mentionable: boolean;
  onMentionable: (value: boolean) => void;
}

/**
 * The role editor's display fields (permissions.md, "Role display"): a second
 * colour for a gradient, an icon, a description and how the role shows
 * in the member list and in mentions, with the name as it will look. Inside the
 * editor's fieldset, so a role the viewer may not change has them disabled.
 */
export function RoleDisplayFields(props: RoleDisplayFieldsProps) {
  const { t } = useTranslation(['spaces', 'common']);
  const { name, color, colorSecondary, onColorSecondary, icon, onIcon, description, onDescription, hoist, onHoist, mentionable, onMentionable } = props;

  return (
    <>
      <div>
        <label className="mb-1.5 flex items-center justify-between gap-3 text-meta text-txt-secondary">
          <span>{t('spaces:roleDisplay.gradient')}</span>
          <Toggle
            enabled={colorSecondary !== null}
            onChange={(on) => onColorSecondary(on ? '#7466e8' : null)}
            ariaLabel={t('spaces:roleDisplay.gradient')}
          />
        </label>
        {colorSecondary !== null && (
          <div className="flex items-center gap-2">
            <label className="relative h-7 w-7 cursor-pointer overflow-hidden rounded-md border border-border-soft">
              <input
                type="color"
                value={colorSecondary}
                onChange={(event) => onColorSecondary(event.target.value)}
                className="absolute inset-0 h-full w-full cursor-pointer opacity-0"
                aria-label={t('spaces:roleDisplay.secondColor')}
              />
              <span aria-hidden="true" className="block h-full w-full" style={{ backgroundColor: colorSecondary }} />
            </label>
            <input
              type="text"
              value={colorSecondary}
              maxLength={7}
              onChange={(event) => {
                const value = event.target.value;
                if (/^#[0-9a-fA-F]{0,6}$/.test(value)) onColorSecondary(value.toLowerCase());
              }}
              className="input-standard h-7 w-20 px-2 py-0 font-mono text-meta"
              aria-label={t('spaces:roleDisplay.secondColor')}
            />
          </div>
        )}
        <p className="mt-2 text-ui">
          <span className="text-txt-tertiary">{t('spaces:roleDisplay.preview')} </span>
          <span className="font-semibold" style={roleTextStyle({ color, colorSecondary })}>{name}</span>
          {icon.trim() && <RoleIcon icon={icon.trim()} color={color} colorSecondary={colorSecondary} size={14} className="ml-1 inline-block align-[-2px]" />}
        </p>
      </div>

      <div>
        <span className="field-label">{t('spaces:roleDisplay.icon')}</span>
        <RoleIconPicker value={icon} onChange={onIcon} color={color} colorSecondary={colorSecondary} />
      </div>

      <div>
        <label htmlFor="role-description" className="field-label flex items-center justify-between">
          <span>{t('spaces:roleDisplay.description')}</span>
          <span className="tabular font-mono text-label font-normal text-txt-tertiary">{description.length}/{ROLE_LIMITS.MAX_DESCRIPTION_LENGTH}</span>
        </label>
        <textarea
          id="role-description"
          value={description}
          maxLength={ROLE_LIMITS.MAX_DESCRIPTION_LENGTH}
          onChange={(event) => onDescription(event.target.value)}
          rows={2}
          placeholder={t('spaces:roleDisplay.descriptionPlaceholder')}
          className="input-standard w-full resize-none"
        />
      </div>

      <div className="space-y-3">
        <label className="flex items-center justify-between gap-4">
          <span className="min-w-0">
            <span className="block text-ui font-medium text-txt-primary">{t('spaces:roleDisplay.hoist')}</span>
            <span className="mt-0.5 block text-meta leading-snug text-txt-tertiary">{t('spaces:roleDisplay.hoistHint')}</span>
          </span>
          <Toggle enabled={hoist} onChange={onHoist} ariaLabel={t('spaces:roleDisplay.hoist')} />
        </label>
        <label className="flex items-center justify-between gap-4">
          <span className="min-w-0">
            <span className="block text-ui font-medium text-txt-primary">{t('spaces:roleDisplay.mentionable')}</span>
            <span className="mt-0.5 block text-meta leading-snug text-txt-tertiary">{t('spaces:roleDisplay.mentionableHint')}</span>
          </span>
          <Toggle enabled={mentionable} onChange={onMentionable} ariaLabel={t('spaces:roleDisplay.mentionable')} />
        </label>
      </div>
    </>
  );
}

/**
 * Who holds the role, and giving or taking it, under the same rules as the
 * member menu (the hierarchy and the held-bits rule, checked again by the
 * instance). Lists the open space's loaded members.
 */
export function RoleMembers({ space, role }: { space: TaggedSpace; role: Role }) {
  const { t } = useTranslation(['spaces', 'common']);
  const members = useSpaceStore((s) => s.members);
  const roles = useSpaceStore((s) => s.roles);
  const myPermissions = useSpaceStore((s) => s.spacePermissions.get(space.id));
  const held = useViewerHeldPermissions(space.id);
  const [adding, setAdding] = useState('');

  const spaceMembers = useMemo(() => members.filter((member) => member.spaceId === space.id), [members, space.id]);
  const holders = spaceMembers.filter((member) => member.roles?.some((r) => r.id === role.id));
  const canManageRole = viewerCanManageRoleAt(space, members, role.position);
  const canEdit = (member: MemberWithUser) => canManageRole && viewerCanEditMemberRoles(space, members, roles, myPermissions, member);
  // Giving the role gives its bits, so the viewer must hold them all (the
  // held-bits rule); taking it away follows the hierarchy alone, as on the server.
  const canGive = viewerHoldsEveryBit(held, stringToPermissions(role.permissions));
  const addable = canGive ? spaceMembers.filter((member) => !member.roles?.some((r) => r.id === role.id) && canEdit(member)) : [];
  const origin = space._instanceOrigin ?? '';
  const target = (member: MemberWithUser) => ({ origin, spaceId: space.id, userId: member.userId });

  return (
    <div>
      <div className="label-mono mb-1.5">{t('spaces:roleDisplay.membersTitle', { count: holders.length })}</div>
      <div className="surface-card rounded-lg">
        {holders.length === 0 ? (
          <p className="px-4 py-3 text-meta text-txt-tertiary">{t('spaces:roleDisplay.membersEmpty')}</p>
        ) : (
          <ul className="divide-y divide-border-hard">
            {holders.map((member) => {
              const name = spaceMemberName(member, member.user);
              return (
                <li key={member.userId} className="flex min-h-[44px] items-center gap-3 px-3 py-2">
                  <Avatar src={(member.avatar ? resolveAssetUrl(member.avatar, origin) : null) ?? member.user.avatar} name={name} size={24} user={member.user} />
                  <span className="min-w-0 flex-1 truncate text-ui text-txt-primary">{name}</span>
                  {canEdit(member) && (
                    <button
                      type="button"
                      className="icon-btn"
                      onClick={() => { void changeMemberRole(target(member), role.id, false); }}
                      aria-label={t('spaces:roleDisplay.removeMember', { name })}
                    >
                      <Icon name="x" size={14} />
                    </button>
                  )}
                </li>
              );
            })}
          </ul>
        )}
        {addable.length > 0 && (
          <div className="flex items-center gap-2 border-t border-border-hard px-3 py-2.5">
            <select
              value={adding}
              onChange={(event) => setAdding(event.target.value)}
              className="input-standard h-8 min-w-0 flex-1 py-0"
              aria-label={t('spaces:roleDisplay.addMember')}
            >
              <option value="">{t('spaces:roleDisplay.addMemberPlaceholder')}</option>
              {addable.map((member) => (
                <option key={member.userId} value={member.userId}>{spaceMemberName(member, member.user)}</option>
              ))}
            </select>
            <button
              type="button"
              className="btn-outline"
              disabled={!adding}
              onClick={() => {
                const member = addable.find((candidate) => candidate.userId === adding);
                if (!member) return;
                setAdding('');
                void changeMemberRole(target(member), role.id, true);
              }}
            >
              {t('spaces:roleDisplay.addMember')}
            </button>
          </div>
        )}
      </div>
    </div>
  );
}
