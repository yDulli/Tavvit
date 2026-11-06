import React from 'react';
import { useTranslation } from 'react-i18next';
import { Glyph } from './parts';
import { roomName } from './Plan';
import { MEMBERS, PEOPLE, PLAN_ROOMS, ROLES, type PersonId, type RoleKey, type RoomId } from './planData';

/**
 * Night Shift's member list on the opening's stage (Stage.tsx), as the app's shows it: everyone under
 * their role, in the role's colour, with the role's icon, the owner's crown, and a status where there
 * is one; then whoever has no role. Choosing someone lights the room they are in on the plan, which is
 * what the list and the plan have to say to each other: who is where.
 */

/** The room someone stands in on the plan, from the plan's own data. */
export function roomOf(person: PersonId): RoomId | null {
  return PLAN_ROOMS.find((room) => room.people.includes(person))?.id ?? null;
}

const ROLE_ORDER: readonly RoleKey[] = ['raidLead', 'regulars', 'newBlood'];

export interface MembersProps {
  /** Whether the visitor has walked in, and so stands in the list among those without a role. */
  inside: boolean;
  /** The room the visitor is in. */
  here: RoomId | null;
  found: PersonId | null;
  onFind: (person: PersonId) => void;
}

export function MembersPanel({ inside, here, found, onFind }: MembersProps): React.JSX.Element {
  const { t } = useTranslation('landing');
  const where = (room: RoomId | null): string | null => {
    const data = room ? PLAN_ROOMS.find((entry) => entry.id === room) : undefined;
    if (!data) return null;
    const name = roomName(data, t(`plan.kinds.${data.kind}`));
    return t('stage.members.in', { room: data.kind === 'text' ? `#${name}` : name });
  };
  const groups = [
    ...ROLE_ORDER.map((role) => ({
      key: role,
      title: ROLES[role].name,
      people: (Object.keys(MEMBERS) as PersonId[]).filter((person) => MEMBERS[person].role === role),
    })),
    { key: 'none', title: t('stage.members.online'), people: (Object.keys(MEMBERS) as PersonId[]).filter((person) => MEMBERS[person].role === null) },
  ];
  const count = Object.keys(MEMBERS).length + (inside ? 1 : 0);

  return (
    <div className="lp-room-view">
      <div className="lp-demo-bar">
        <strong>{t('stage.members.title')}</strong>
        <span>{t('stage.people', { count })}</span>
      </div>
      <div className="lp-room-body lp-members">
        <p className="lp-members-hint">{t('stage.members.hint')}</p>
        {groups.map((group) => (
          <section key={group.key} aria-label={group.title}>
            <p className="lp-members-group lp-label">{group.title} — {group.people.length + (group.key === 'none' && inside ? 1 : 0)}</p>
            <ul>
              {group.people.map((person) => {
                const member = MEMBERS[person];
                const role = member.role ? ROLES[member.role] : null;
                return (
                  <li key={person}>
                    <button type="button" className="lp-member" aria-pressed={found === person} onClick={() => onFind(person)}>
                      <i className="lp-member-avatar" style={{ background: member.avatar }} aria-hidden="true">{PEOPLE[person].initial}</i>
                      <span className="lp-member-text">
                        <span className="lp-member-name" style={role ? { color: role.color } : undefined}>
                          {member.name}
                          {role?.icon && <span aria-hidden="true">{role.icon}</span>}
                          {member.owner && <Glyph name="crown" />}
                        </span>
                        <span className="lp-member-line">{member.status ?? where(roomOf(person))}</span>
                      </span>
                    </button>
                  </li>
                );
              })}
              {group.key === 'none' && inside && (
                <li>
                  <span className="lp-member lp-member-you">
                    <i className="lp-member-avatar" aria-hidden="true">{t('stage.you').charAt(0)}</i>
                    <span className="lp-member-text">
                      <span className="lp-member-name">{t('stage.you')}</span>
                      <span className="lp-member-line">{where(here)}</span>
                    </span>
                  </span>
                </li>
              )}
            </ul>
          </section>
        ))}
      </div>
    </div>
  );
}
