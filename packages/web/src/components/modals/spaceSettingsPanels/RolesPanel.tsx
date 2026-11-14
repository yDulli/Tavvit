import React, { useState, useRef, useEffect } from 'react';
import { useTranslation } from 'react-i18next';
import { useSpaceStore, getApiForOrigin } from '../../../stores/spaceStore';
import { useUIStore } from '../../../stores/uiStore';
import { HttpError, type RoleUpdateBody } from '../../../api/client';
import { PermissionBits, stringToPermissions, permissionsToString, rolePermissionsVersion } from '../../../utils/permissions';
import { PERMISSION_GROUPS, usePermissionDescriptions, usePermissionGroupTitles, type PermDef } from '../../../utils/permissionGroups';
import { RoleDisplayFields, RoleMembers } from './RoleDisplayFields';
import { usePermissionNames } from '../../ui/OverrideEntry';
import { describeError } from '../../../i18n/errors';
import type { Role } from '@backspace/shared';
import {
  viewerCanManageRoleAt,
  useViewerHeldPermissions,
  viewerCanSwitchBit,
  viewerCanCreateRoleWith,
  viewerHoldsEveryBit,
} from '../../../utils/roleHierarchy';
import { RoleOrderList } from './RoleOrderList';
import { withSavedRole } from '../../../utils/roleOrder';
import { LockNote, LOCK_ICON } from '../../ui/LockNote';

const ALL_PERMISSION_DEFS: PermDef[] = PERMISSION_GROUPS.flatMap((group) => group.perms);

const PRESET_COLORS = [
  '#b9bbbe', '#a5f3c4', '#ffc9a9', '#c4b5fd', '#93c5fd',
  '#fbbf24', '#fda4af', '#f87171', '#60a5fa', '#34d399',
];

/** Auto-increment a base name ("Foo" → "Foo 2" → "Foo 3") to avoid uniqueness conflicts. */
function getUniqueRoleName(baseName: string, existingRoles: Role[]): string {
  const existingNames = new Set(existingRoles.map((r) => r.name.toLowerCase()));
  let candidateName = baseName;
  let counter = 2;
  while (existingNames.has(candidateName.toLowerCase())) {
    candidateName = `${baseName} ${counter}`;
    counter++;
  }
  return candidateName;
}

// ─── Component ──────────────────────────────────────────────────────────────

interface RolesPanelProps {
  spaceId: string;
}

export function RolesPanel({ spaceId }: RolesPanelProps) {
  const { t } = useTranslation(['spaces', 'common']);
  const roles = useSpaceStore((s) => s.roles);
  const loadSpaceDetail = useSpaceStore((s) => s.loadSpaceDetail);
  const space = useSpaceStore((s) => s.spaces.find((sp) => sp.id === spaceId));
  const members = useSpaceStore((s) => s.members);
  // A new role starts at the bottom (position 1), so creating one needs a top
  // role above that (permissions.md, "Role hierarchy").
  const canCreateRole = !space || viewerCanManageRoleAt(space, members, 1);

  const [editingRoleId, setEditingRoleId] = useState<string | null>(null);
  const [isNewRole, setIsNewRole] = useState(false);
  const [creating, setCreating] = useState(false);
  const [error, setError] = useState('');

  const handleCreateRole = async () => {
    setCreating(true);
    setError('');
    try {
      const uniqueName = getUniqueRoleName(t('spaces:roles.defaultName'), roles);
      // Roles live on the space's own instance (client-federation.md).
      const newRole = await getApiForOrigin(space?._instanceOrigin ?? '').roles.create(spaceId, { name: uniqueName });
      // The editor opens on the new role, so it has to be in the list now;
      // the space_access_changed refresh would arrive a moment later.
      await loadSpaceDetail(spaceId, { quiet: true });
      setIsNewRole(true);
      setEditingRoleId(newRole.id);
    } catch (err) {
      setError(describeError(err));
    } finally {
      setCreating(false);
    }
  };

  if (editingRoleId) {
    const role = roles.find((r) => r.id === editingRoleId);
    if (!role) {
      setEditingRoleId(null);
      return null;
    }
    return (
      <RoleEditView
        key={editingRoleId}
        role={role}
        spaceId={spaceId}
        isNew={isNewRole}
        onBack={() => { setIsNewRole(false); setEditingRoleId(null); }}
        onDeleted={() => { setIsNewRole(false); setEditingRoleId(null); }}
        onCopied={(newRoleId) => { setIsNewRole(true); setEditingRoleId(newRoleId); }}
      />
    );
  }

  return (
    <div className="space-y-5">
      <h2 className="page-title">{t('spaces:roles.title')}</h2>
      {error && (
        <div className="rounded-md border border-accent-rose/30 bg-accent-rose/10 px-3 py-2 text-ui text-txt-danger">{error}</div>
      )}

      <div className="sticky top-0 z-10 pointer-events-none">
        <button
          type="button"
          onClick={handleCreateRole}
          disabled={creating || !canCreateRole}
          aria-busy={creating}
          className="btn-outline bg-surface-chat pointer-events-auto"
        >
          <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth={2}>
            <line x1="12" y1="5" x2="12" y2="19" />
            <line x1="5" y1="12" x2="19" y2="12" />
          </svg>
          {creating ? t('spaces:roles.creating') : t('spaces:roles.create')}
        </button>
      </div>

      <div>
        <div className="label-mono mb-1.5">{t('spaces:roles.listHeading')}</div>
        <p className="text-meta leading-snug text-txt-tertiary">{t('spaces:roles.description')}</p>
        <p className="mb-2 text-meta leading-snug text-txt-tertiary">{t('spaces:roles.hierarchyHint')}</p>
        <div className="surface-card rounded-lg p-1">
          <RoleOrderList
            spaceId={spaceId}
            onOpen={(roleId) => { setIsNewRole(false); setEditingRoleId(roleId); }}
          />
        </div>
      </div>
    </div>
  );
}

// ─── Role Edit View ─────────────────────────────────────────────────────────

interface RoleEditViewProps {
  role: Role;
  spaceId: string;
  isNew?: boolean;
  onBack: () => void;
  onDeleted: () => void;
  onCopied: (newRoleId: string) => void;
}

/** A role's display fields as the editor drafts them. */
interface RoleDisplay {
  name: string;
  color: string;
  colorSecondary: string | null;
  description: string;
  icon: string;
  hoist: boolean;
  mentionable: boolean;
}

function displayOf(role: Role): RoleDisplay {
  return {
    name: role.name,
    color: role.color,
    colorSecondary: role.colorSecondary ?? null,
    description: role.description ?? '',
    icon: role.icon ?? '',
    hoist: role.hoist !== false,
    mentionable: role.mentionable === true,
  };
}

function sameDisplay(a: RoleDisplay, b: RoleDisplay): boolean {
  return a.name === b.name && a.color === b.color && a.colorSecondary === b.colorSecondary
    && a.description === b.description && a.icon === b.icon && a.hoist === b.hoist && a.mentionable === b.mentionable;
}

/**
 * Display fields in the form the instance stores them: a name trimmed with
 * its runs of space collapsed, colours in lower case, description and icon
 * trimmed. Drafts and the stored role are compared in this form on both
 * sides, so an edit that would store nothing new is no change, and a role
 * stored before these rules (a double space in its name) opens clean.
 */
function storedForm(display: RoleDisplay): RoleDisplay {
  return {
    name: display.name.trim().replace(/\s+/g, ' '),
    color: display.color.toLowerCase(),
    colorSecondary: display.colorSecondary?.toLowerCase() ?? null,
    description: display.description.trim(),
    icon: display.icon.trim(),
    hoist: display.hoist,
    mentionable: display.mentionable,
  };
}

function RoleEditView({ role, spaceId, isNew, onBack, onDeleted, onCopied }: RoleEditViewProps) {
  const { t } = useTranslation(['spaces', 'common']);
  const permissionNames = usePermissionNames();
  const permissionDescriptions = usePermissionDescriptions();
  const loadSpaceDetail = useSpaceStore((s) => s.loadSpaceDetail);
  const setRoles = useSpaceStore((s) => s.setRoles);
  const roles = useSpaceStore((s) => s.roles);
  const space = useSpaceStore((s) => s.spaces.find((sp) => sp.id === spaceId));
  const members = useSpaceStore((s) => s.members);
  const isEveryone = role.id === spaceId;
  // Roles at or above the viewer's top role can be looked at, not changed
  // (permissions.md, "Role hierarchy"); the server refuses the change anyway.
  const canEdit = !space || viewerCanManageRoleAt(space, members, role.position);
  // Held-bits rule (permissions.md): only bits the viewer holds can be
  // switched, and a copy can only carry bits they hold.
  const held = useViewerHeldPermissions(spaceId);
  const copyCarriesUnheld = !viewerCanCreateRoleWith(held, stringToPermissions(role.permissions));
  const canCopy = (!space || viewerCanManageRoleAt(space, members, 1)) && !copyCarriesUnheld;
  // Deleting switches the role's bits off for everyone holding it.
  const offersDelete = !isEveryone && canEdit;
  const deleteCarriesUnheld = offersDelete && !viewerHoldsEveryBit(held, stringToPermissions(role.permissions));
  const hasUnheldToggle = canEdit && ALL_PERMISSION_DEFS.some((perm) => !viewerCanSwitchBit(held, perm.bit));
  // Every role write goes to the space's own instance (client-federation.md).
  const roleApi = () => getApiForOrigin(space?._instanceOrigin ?? '').roles;

  const [draftName, setDraftName] = useState(role.name);
  const [nameError, setNameError] = useState('');
  const nameInputRef = useRef<HTMLInputElement>(null);

  useEffect(() => {
    if (!isEveryone && canEdit && nameInputRef.current) {
      nameInputRef.current.focus();
      nameInputRef.current.select();
    }
  }, []);

  const validateName = (name: string): string => {
    const trimmed = name.trim();
    if (!trimmed) return t('spaces:roles.nameEmpty');
    const isDuplicate = roles.some(
      (r) => r.id !== role.id && r.name.toLowerCase() === trimmed.toLowerCase()
    );
    return isDuplicate ? t('spaces:roles.nameDuplicate') : '';
  };

  const [draftColor, setDraftColor] = useState(role.color);
  const [draftColorSecondary, setDraftColorSecondary] = useState<string | null>(role.colorSecondary ?? null);
  const [draftDescription, setDraftDescription] = useState(role.description ?? '');
  const [draftIcon, setDraftIcon] = useState(role.icon ?? '');
  const [draftHoist, setDraftHoist] = useState(role.hoist !== false);
  const [draftMentionable, setDraftMentionable] = useState(role.mentionable === true);
  // The display fields follow the stored role like the permissions do: a
  // field nobody touched here takes on what someone else saved meanwhile, so
  // their change is shown instead of reading as an edit of the viewer's (and
  // being written back over theirs on the next save).
  const storedDisplay = displayOf(role);
  const draftDisplay = storedForm({
    name: draftName,
    color: draftColor,
    colorSecondary: draftColorSecondary,
    description: draftDescription,
    icon: draftIcon,
    hoist: draftHoist,
    mentionable: draftMentionable,
  });
  const [syncedDisplay, setSyncedDisplay] = useState(storedDisplay);
  if (!sameDisplay(syncedDisplay, storedDisplay)) {
    // Untouched means equal to what was last synced, in stored form.
    const synced = storedForm(syncedDisplay);
    setSyncedDisplay(storedDisplay);
    if (draftDisplay.name === synced.name) setDraftName(storedDisplay.name);
    if (draftDisplay.color === synced.color) setDraftColor(storedDisplay.color);
    if (draftDisplay.colorSecondary === synced.colorSecondary) setDraftColorSecondary(storedDisplay.colorSecondary);
    if (draftDisplay.description === synced.description) setDraftDescription(storedDisplay.description);
    if (draftDisplay.icon === synced.icon) setDraftIcon(storedDisplay.icon);
    if (draftDisplay.hoist === synced.hoist) setDraftHoist(storedDisplay.hoist);
    if (draftDisplay.mentionable === synced.mentionable) setDraftMentionable(storedDisplay.mentionable);
  }
  // The permissions this edit started from, and the draft made from them.
  // The save names the version of the base (permissions.md, "Concurrent
  // edits"), so a change someone else saved meanwhile is refused rather than
  // overwritten. While there is no local edit, the base follows the role, so
  // such a change shows here instead of reading as an edit of the viewer's.
  const storedPermissions = role.permissions ?? '0';
  const [basePermissions, setBasePermissions] = useState(storedPermissions);
  const [draftPermissions, setDraftPermissions] = useState<bigint>(
    stringToPermissions(storedPermissions)
  );
  const [syncedPermissions, setSyncedPermissions] = useState(storedPermissions);
  if (syncedPermissions !== storedPermissions) {
    setSyncedPermissions(storedPermissions);
    if (draftPermissions === stringToPermissions(basePermissions)) {
      setBasePermissions(storedPermissions);
      setDraftPermissions(stringToPermissions(storedPermissions));
    }
  }
  const addToast = useUIStore((s) => s.addToast);
  const [saving, setSaving] = useState(false);
  const [deleting, setDeleting] = useState(false);
  const [saveError, setSaveError] = useState('');
  const [confirmDelete, setConfirmDelete] = useState(false);

  // Compared in the form the instance stores, on both sides, so a save leaves
  // nothing that looks unsaved.
  const storedRole = storedForm(storedDisplay);
  const hasNameChange = !isEveryone && draftDisplay.name !== storedRole.name;
  const hasColorChange = !isEveryone && draftDisplay.color !== storedRole.color;
  const hasColorSecondaryChange = !isEveryone && draftDisplay.colorSecondary !== storedRole.colorSecondary;
  const hasDescriptionChange = !isEveryone && draftDisplay.description !== storedRole.description;
  const hasIconChange = !isEveryone && draftDisplay.icon !== storedRole.icon;
  const hasHoistChange = !isEveryone && draftDisplay.hoist !== storedRole.hoist;
  const hasMentionableChange = !isEveryone && draftDisplay.mentionable !== storedRole.mentionable;
  const hasDisplayChange = hasColorSecondaryChange || hasDescriptionChange || hasIconChange || hasHoistChange || hasMentionableChange;
  const hasPermChange = draftPermissions !== stringToPermissions(basePermissions);
  const hasChanges = hasNameChange || hasColorChange || hasDisplayChange || hasPermChange;

  const togglePermission = (bit: bigint) => {
    if (!canEdit || !viewerCanSwitchBit(held, bit)) return;
    setDraftPermissions((prev) => (prev & bit) !== 0n ? prev & ~bit : prev | bit);
  };

  const handleSave = async () => {
    setConfirmDelete(false);
    setSaving(true);
    setSaveError('');
    try {
      const data: RoleUpdateBody = {};
      if (hasNameChange) data.name = draftDisplay.name;
      if (hasColorChange) data.color = draftDisplay.color;
      if (hasColorSecondaryChange) data.colorSecondary = draftDisplay.colorSecondary;
      if (hasDescriptionChange) data.description = draftDisplay.description || null;
      if (hasIconChange) data.icon = draftDisplay.icon || null;
      if (hasHoistChange) data.hoist = draftHoist;
      if (hasMentionableChange) data.mentionable = draftMentionable;
      if (hasPermChange) {
        data.permissions = permissionsToString(draftPermissions);
        data.permissionsVersion = rolePermissionsVersion(basePermissions);
      }
      const saved = await roleApi().update(spaceId, role.id, data);
      // What the server now holds is the base of the next edit.
      const savedPermissions = saved.permissions ?? data.permissions ?? basePermissions;
      setBasePermissions(savedPermissions);
      setDraftPermissions(stringToPermissions(savedPermissions));
      // The drafts take the stored form of what was saved.
      const savedDisplay = displayOf(saved);
      setDraftName(savedDisplay.name);
      setDraftColor(savedDisplay.color);
      setDraftColorSecondary(savedDisplay.colorSecondary);
      setDraftDescription(savedDisplay.description);
      setDraftIcon(savedDisplay.icon);
      setDraftHoist(savedDisplay.hoist);
      setDraftMentionable(savedDisplay.mentionable);
      setSyncedDisplay(savedDisplay);
      // Show what was saved at once; space_access_changed refreshes the rest.
      setRoles(withSavedRole(useSpaceStore.getState().roles, saved));
      addToast(t('spaces:roles.saved'), 'success', 2000);
    } catch (err) {
      // A duplicate name belongs on the name field, not in the save banner.
      if (err instanceof HttpError && err.code === 'role_name_taken') {
        setNameError(t('spaces:roles.nameDuplicate'));
      } else if (err instanceof HttpError && err.code === 'role_permissions_conflict') {
        // Someone else saved this role's permissions meanwhile: show theirs,
        // so the viewer reviews them and saves again.
        await loadSpaceDetail(spaceId, { quiet: true });
        const fresh = useSpaceStore.getState().roles.find((r) => r.id === role.id);
        const freshPermissions = fresh?.permissions ?? basePermissions;
        setBasePermissions(freshPermissions);
        setDraftPermissions(stringToPermissions(freshPermissions));
        setSaveError(describeError(err));
      } else {
        setSaveError(describeError(err));
      }
    } finally {
      setSaving(false);
    }
  };

  const handleDiscard = () => {
    setDraftName(role.name);
    setDraftColor(role.color);
    setDraftColorSecondary(role.colorSecondary ?? null);
    setDraftDescription(role.description ?? '');
    setDraftIcon(role.icon ?? '');
    setDraftHoist(role.hoist !== false);
    setDraftMentionable(role.mentionable === true);
    setBasePermissions(storedPermissions);
    setDraftPermissions(stringToPermissions(storedPermissions));
    setConfirmDelete(false);
    setSaveError('');
    setNameError('');
  };

  const handleDelete = async () => {
    if (deleteCarriesUnheld) return;
    if (!confirmDelete) {
      setConfirmDelete(true);
      return;
    }
    setDeleting(true);
    setSaveError('');
    try {
      await roleApi().delete(spaceId, role.id);
      // Gone from the list at once; space_access_changed brings the
      // renumbered positions.
      setRoles(useSpaceStore.getState().roles.filter((r) => r.id !== role.id));
      onDeleted();
    } catch (err) {
      setSaveError(describeError(err));
      setConfirmDelete(false);
    } finally {
      setDeleting(false);
    }
  };

  const [copying, setCopying] = useState(false);

  const handleCopy = async () => {
    setCopying(true);
    setSaveError('');
    try {
      const uniqueName = getUniqueRoleName(t('spaces:roles.copyName', { name: role.name }), roles);
      const newRole = await roleApi().create(spaceId, {
        name: uniqueName,
        color: role.color,
        colorSecondary: role.colorSecondary ?? null,
        description: role.description ?? null,
        icon: role.icon ?? null,
        hoist: role.hoist !== false,
        mentionable: role.mentionable === true,
        permissions: role.permissions ?? undefined,
      });
      // The editor moves to the copy, so it has to be in the list now.
      await loadSpaceDetail(spaceId, { quiet: true });
      onCopied(newRole.id);
    } catch (err) {
      setSaveError(describeError(err));
    } finally {
      setCopying(false);
    }
  };

  const groupTitles = usePermissionGroupTitles();
  const groupTitle = (id: keyof typeof groupTitles): string => groupTitles[id];

  return (
    <div className="space-y-5">
      {/* Back button */}
      <div className="sticky top-0 z-10 pointer-events-none">
        <button
          type="button"
          onClick={onBack}
          className="btn-quiet -ml-2 bg-surface-chat pointer-events-auto"
        >
          <svg className="w-4 h-4" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2}>
            <path strokeLinecap="round" strokeLinejoin="round" d="M15 19l-7-7 7-7" />
          </svg>
          {t('spaces:roles.backToList')}
        </button>
      </div>

      {isNew && !hasChanges && (
        <div className="rounded-md border border-status-online/30 bg-status-online/10 px-3 py-2 text-ui text-txt-positive">
          {t('spaces:roles.created')}
        </div>
      )}

      {!canEdit && <LockNote>{t('spaces:roles.aboveYou')}</LockNote>}

      {(hasUnheldToggle || copyCarriesUnheld) && (
        <LockNote>
          {hasUnheldToggle && t('spaces:roles.unheldLocked')}
          {hasUnheldToggle && copyCarriesUnheld && ' '}
          {copyCarriesUnheld && t(deleteCarriesUnheld ? 'spaces:roles.copyDeleteUnheld' : 'spaces:roles.copyUnheld')}
        </LockNote>
      )}

      {/* Identity card (Name + Color — not shown for @everyone) */}
      {!isEveryone && (
        <div>
          <div className="label-mono mb-1.5">{t('spaces:roles.identity')}</div>
          {/* A disabled fieldset disables every control inside it. */}
          <fieldset disabled={!canEdit} className={`surface-card rounded-lg p-4 space-y-4 min-w-0 ${canEdit ? '' : 'opacity-60'}`}>
            <div>
              <label className="field-label">
                {t('spaces:roles.nameLabel')}
              </label>
              <input
                ref={nameInputRef}
                type="text"
                value={draftName}
                onChange={(e) => {
                  setDraftName(e.target.value);
                  setNameError(validateName(e.target.value));
                }}
                onBlur={() => setNameError(validateName(draftName))}
                aria-invalid={nameError ? true : undefined}
                className="input-standard w-full"
              />
              {nameError && (
                <p className="text-meta text-txt-danger mt-1">{nameError}</p>
              )}
            </div>
            <div>
              <label className="field-label">
                {t('spaces:roles.colorLabel')}
              </label>
              <div className="flex items-center gap-2 flex-wrap">
                {PRESET_COLORS.map((c) => (
                  <button
                    data-tooltip=""
                    key={c}
                    type="button"
                    onClick={() => setDraftColor(c)}
                    aria-label={c}
                    aria-pressed={draftColor === c}
                    className={`w-7 h-7 rounded-md border-2 transition-colors duration-100 ${
                      draftColor === c ? 'border-white' : 'border-transparent hover:border-white/40'
                    }`}
                    style={{ backgroundColor: c }}
                  />
                ))}
                <label className="relative w-7 h-7 rounded-md border border-border-soft hover:border-interactive-muted transition-colors duration-100 cursor-pointer overflow-hidden">
                  <input
                    type="color"
                    value={draftColor}
                    onChange={(e) => setDraftColor(e.target.value)}
                    className="absolute inset-0 w-full h-full opacity-0 cursor-pointer"
                  />
                  <div className="w-full h-full bg-gradient-to-br from-red-400 via-green-400 to-blue-400" />
                </label>
                <input
                  type="text"
                  value={draftColor}
                  onChange={(e) => {
                    const v = e.target.value;
                    if (/^#[0-9a-fA-F]{0,6}$/.test(v)) setDraftColor(v.toLowerCase());
                  }}
                  className="input-standard h-7 w-20 px-2 py-0 font-mono text-meta"
                  maxLength={7}
                />
              </div>
            </div>
            <RoleDisplayFields
              name={draftName.trim() || role.name}
              color={draftColor}
              colorSecondary={draftColorSecondary}
              onColorSecondary={setDraftColorSecondary}
              icon={draftIcon}
              onIcon={setDraftIcon}
              description={draftDescription}
              onDescription={setDraftDescription}
              hoist={draftHoist}
              onHoist={setDraftHoist}
              mentionable={draftMentionable}
              onMentionable={setDraftMentionable}
            />
          </fieldset>
        </div>
      )}

      {!isEveryone && space && <RoleMembers space={space} role={role} />}

      {/* Permission groups — each gets its own section card */}
      {PERMISSION_GROUPS.map((group) => (
        <div key={group.id}>
          <div className="label-mono mb-1.5">
            {groupTitle(group.id)}
          </div>
          <div className="surface-card rounded-lg p-1.5">
            <div className="space-y-0.5">
              {group.perms.map((perm) => {
                const isAdminBit = perm.bit === PermissionBits.ADMINISTRATOR;
                const hasAdmin = (draftPermissions & PermissionBits.ADMINISTRATOR) !== 0n;
                const isOn = isAdminBit ? hasAdmin : hasAdmin || (draftPermissions & perm.bit) !== 0n;
                const isInherited = !isAdminBit && hasAdmin;
                const isUnheld = canEdit && !viewerCanSwitchBit(held, perm.bit);
                const isLocked = isInherited || !canEdit || isUnheld;
                const name = permissionNames[perm.key] ?? perm.key;
                const description = permissionDescriptions[perm.key];
                return (
                  <label
                    key={perm.key}
                    className={`flex items-center justify-between gap-3 rounded-md px-2.5 py-2 transition-colors duration-100 group/perm ${
                      isLocked ? 'cursor-default' : 'cursor-pointer hover:bg-interactive-hover'
                    }`}
                  >
                    <span className={`min-w-0 ${isLocked ? 'opacity-50' : ''}`}>
                      <span className={`block text-ui font-medium ${isAdminBit ? 'text-txt-danger' : 'text-txt-primary'}`}>
                        {name}
                      </span>
                      {description && (
                        <span className="mt-0.5 block text-meta leading-snug text-txt-tertiary">{description}</span>
                      )}
                    </span>
                    <span className="flex items-center gap-2 flex-shrink-0">
                      {isUnheld && (
                        <svg
                          width="12" height="12" viewBox="0 0 24 24" fill="currentColor"
                          className="text-txt-tertiary"
                          role="img"
                          aria-label={t('spaces:roles.unheldPermission')}
                        >
                          <title>{t('spaces:roles.unheldPermission')}</title>
                          <path d={LOCK_ICON} />
                        </svg>
                      )}
                      <div
                        role="switch"
                        aria-checked={isOn}
                        aria-disabled={isLocked}
                        aria-label={name}
                        tabIndex={isLocked ? -1 : 0}
                        onClick={(e) => {
                          e.preventDefault();
                          if (!isLocked) togglePermission(perm.bit);
                        }}
                        onKeyDown={(e) => {
                          if (e.key !== ' ' && e.key !== 'Enter') return;
                          e.preventDefault();
                          if (!isLocked) togglePermission(perm.bit);
                        }}
                        className={`relative inline-flex h-5 w-9 flex-shrink-0 items-center rounded-md transition-colors ${
                          isLocked ? 'cursor-not-allowed opacity-50' : 'cursor-pointer'
                        } ${isOn ? 'bg-accent-primary' : 'bg-interactive-muted'}`}
                      >
                        <span
                          aria-hidden="true"
                          className={`inline-block h-3.5 w-3.5 rounded-full transition-transform ${
                            isOn ? 'translate-x-[19px] bg-on-accent' : 'translate-x-[3px] bg-white'
                          }`}
                        />
                      </div>
                    </span>
                  </label>
                );
              })}
            </div>
          </div>
        </div>
      ))}

      {saveError && (
        <div className="rounded-md border border-accent-rose/30 bg-accent-rose/10 px-3 py-2 text-ui text-txt-danger">{saveError}</div>
      )}
      <div className="sticky bottom-0 z-10 pointer-events-none">
          <div className="flex justify-center pt-3 pb-1">
            <div className={`action-bar pointer-events-auto${
              isEveryone ? ' animate-slide-up' : ''
            }`}>
              {hasChanges && (
                <>
                  <button
                    onClick={handleDiscard}
                    className="btn-quiet"
                  >
                    {t('spaces:settings.discardChanges')}
                  </button>
                  <button
                    onClick={handleSave}
                    disabled={saving || (!isEveryone && !draftName.trim()) || !!nameError}
                    aria-busy={saving}
                    className="btn-primary"
                  >
                    {saving ? t('common:states.saving') : t('common:actions.save')}
                  </button>
                </>
              )}
              {hasChanges && (
                <div className="w-px h-5 bg-border-soft" />
              )}
              <button
                onClick={handleCopy}
                disabled={copying || !canCopy}
                className="btn-quiet"
              >
                {copying ? t('spaces:roles.copying') : t('spaces:roles.copy')}
              </button>
              {offersDelete && (
                <>
                  <div className="w-px h-5 bg-border-soft" />
                  <button
                    type="button"
                    onClick={handleDelete}
                    disabled={deleting || deleteCarriesUnheld}
                    aria-busy={deleting}
                    className={confirmDelete ? 'btn-danger' : 'btn-quiet text-txt-danger hover:bg-accent-rose/10 hover:text-txt-danger'}
                  >
                    {deleting ? t('spaces:roles.deleting') : confirmDelete ? t('spaces:roles.confirmDelete') : t('spaces:roles.delete')}
                  </button>
                </>
              )}
            </div>
          </div>
        </div>
    </div>
  );
}
