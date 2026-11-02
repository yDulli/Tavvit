import { ROLE_LIMITS } from '@backspace/shared';
import { hasHiddenCharacters, isRoleIcon, normalizeRoleName } from '@backspace/shared/src/roleDisplay.js';
import type { ErrorCode, ErrorDetails } from '@backspace/shared/src/errors.js';
import type { schema } from '../db/index.js';

// A role's display fields as a create or update request carries them
// (docs/systems/permissions.md, "Role display"): checked here once for both
// routes and the Discord template import, so a role reads the same however it
// was made.

type RoleInsert = typeof schema.roles.$inferInsert;

export type RoleDisplayFields = Pick<RoleInsert, 'name' | 'color' | 'colorSecondary' | 'description' | 'icon' | 'hoist' | 'mentionable'>;

export interface RoleFieldRefusal {
  code: ErrorCode;
  details?: ErrorDetails;
}

const HEX_COLOR = /^#[0-9a-fA-F]{6}$/;

/** A role's name as stored, or a refusal. */
export function roleNameOf(value: unknown): string | RoleFieldRefusal {
  if (typeof value !== 'string' || value.trim().length === 0) return { code: 'role_name_required' };
  const name = normalizeRoleName(value);
  if (name !== null) return name;
  return hasHiddenCharacters(value)
    ? { code: 'role_name_invalid' }
    : { code: 'role_name_too_long', details: { max: ROLE_LIMITS.MAX_NAME_LENGTH } };
}

/** A `#rrggbb` colour as stored (lower case), or a refusal. */
export function roleColorOf(value: unknown): string | RoleFieldRefusal {
  if (typeof value !== 'string' || !HEX_COLOR.test(value.trim())) return { code: 'role_color_invalid' };
  return value.trim().toLowerCase();
}

/** A role icon as stored (null clears), or a refusal. */
export function roleIconOf(value: unknown): string | null | RoleFieldRefusal {
  if (value === null) return null;
  if (typeof value !== 'string') return { code: 'role_icon_invalid' };
  const trimmed = value.trim();
  if (trimmed.length === 0) return null;
  return isRoleIcon(trimmed) ? trimmed : { code: 'role_icon_invalid' };
}

/** A role description as stored (null clears), or a refusal. */
export function roleDescriptionOf(value: unknown): string | null | RoleFieldRefusal {
  if (value === null) return null;
  if (typeof value !== 'string') return { code: 'validation_failed' };
  const trimmed = value.trim();
  if (trimmed.length === 0) return null;
  if (trimmed.length > ROLE_LIMITS.MAX_DESCRIPTION_LENGTH || /[\u0000-\u0009\u000b-\u001f\u007f]/.test(trimmed)) {
    return { code: 'role_description_too_long', details: { max: ROLE_LIMITS.MAX_DESCRIPTION_LENGTH } };
  }
  return trimmed;
}

function isRefusal(value: unknown): value is RoleFieldRefusal {
  return typeof value === 'object' && value !== null && 'code' in value;
}

/**
 * The display fields a request sets, checked: only those it names, so an
 * update leaves the others as they are. Undefined fields are absent from the
 * answer; a refusal names the first field that is wrong.
 */
export function parseRoleDisplayFields(body: Record<string, unknown>): { ok: true; value: Partial<RoleDisplayFields> } | { ok: false; refusal: RoleFieldRefusal } {
  const value: Partial<RoleDisplayFields> = {};
  if (body.name !== undefined) {
    const name = roleNameOf(body.name);
    if (isRefusal(name)) return { ok: false, refusal: name };
    value.name = name;
  }
  if (body.color !== undefined) {
    const color = roleColorOf(body.color);
    if (isRefusal(color)) return { ok: false, refusal: color };
    value.color = color;
  }
  if (body.colorSecondary !== undefined) {
    if (body.colorSecondary === null || body.colorSecondary === '') {
      value.colorSecondary = null;
    } else {
      const color = roleColorOf(body.colorSecondary);
      if (isRefusal(color)) return { ok: false, refusal: color };
      value.colorSecondary = color;
    }
  }
  if (body.description !== undefined) {
    const description = roleDescriptionOf(body.description);
    if (isRefusal(description)) return { ok: false, refusal: description };
    value.description = description;
  }
  if (body.icon !== undefined) {
    const icon = roleIconOf(body.icon);
    if (isRefusal(icon)) return { ok: false, refusal: icon };
    value.icon = icon;
  }
  for (const flag of ['hoist', 'mentionable'] as const) {
    const raw = body[flag];
    if (raw === undefined) continue;
    if (typeof raw !== 'boolean') return { ok: false, refusal: { code: 'validation_failed' } };
    value[flag] = raw ? 1 : 0;
  }
  return { ok: true, value };
}
