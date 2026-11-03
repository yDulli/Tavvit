import { useState, useEffect, useCallback, useRef } from 'react';
import { TwoFactorCodeField } from '../settingsPanels/TwoFactorSection';
import { SUSPENSION_LIMITS } from '@backspace/shared/src/platform';
import { useTranslation, Trans } from 'react-i18next';
import { useFormatters } from '../../../i18n/formatters';
import { describeError } from '../../../i18n/errors';
import { api, HttpError } from '../../../api/client';
import { Icon } from '../../ui/Icon';
import { saveBlob } from '../../../utils/saveBlob';
import { Avatar } from '../../ui/Avatar';
import { ConfirmDialog } from '../../ui/ConfirmDialog';
import { useAuthStore } from '../../../stores/authStore';
import type { AdminUser, AdminUserListResponse } from '@backspace/shared';
import { AdminUserDetailModal } from './AdminUserDetailModal';

/** What the dialog holds; `ownedSpaces` is what the server named when it refused an owner. */
const EMPTY_DELETE_FORM = {
  reason: '', password: '', code: '', error: '',
  ownedSpaces: [] as { id: string; name: string }[],
  deleteSpaces: false,
};

export function UsersPanel() {
  const { t } = useTranslation(['admin', 'common']);
  const [exporting, setExporting] = useState(false);
  const [exportError, setExportError] = useState('');
  const currentUser = useAuthStore((s) => s.user);
  const f = useFormatters();
  const [data, setData] = useState<AdminUserListResponse | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState('');

  const [query, setQuery] = useState('');
  const [showDeleted, setShowDeleted] = useState(false);
  const [page, setPage] = useState(1);
  const pageSize = 50;

  const [instanceFilter, setInstanceFilter] = useState('');
  const [roleFilter, setRoleFilter] = useState('');
  // Accounts suspended now (admin.md, "Suspensions").
  const [statusFilter, setStatusFilter] = useState<'' | 'suspended'>('');
  const [openUserId, setOpenUserId] = useState<string | null>(null);
  const [joinedAfter, setJoinedAfter] = useState('');
  const [joinedBefore, setJoinedBefore] = useState('');
  const [sortBy, setSortBy] = useState('newest');
  const [instances, setInstances] = useState<string[]>([]);

  // Confirm dialogs
  const [confirmAction, setConfirmAction] = useState<{ type: 'demote' | 'delete'; user: AdminUser } | null>(null);
  const [deleteForm, setDeleteForm] = useState(EMPTY_DELETE_FORM);
  const [actionLoading, setActionLoading] = useState(false);

  // Temp password display
  const [tempPassword, setTempPassword] = useState<{ userId: string; password: string } | null>(null);

  const debounceRef = useRef<ReturnType<typeof setTimeout>>();

  useEffect(() => {
    api.admin.listInstances().then(({ instances: inst }) => setInstances(inst)).catch(() => {});
  }, []);

  const filtersRef = useRef<{ homeInstance: string; role: string; status: '' | 'suspended'; joinedAfter: string; joinedBefore: string; sort: string }>(
    { homeInstance: '', role: '', status: '', joinedAfter: '', joinedBefore: '', sort: 'newest' },
  );
  filtersRef.current = { homeInstance: instanceFilter, role: roleFilter, status: statusFilter, joinedAfter, joinedBefore, sort: sortBy };

  const fetchUsers = useCallback(async (
    q: string, p: number, deleted: boolean,
    opts?: { homeInstance?: string; role?: string; status?: '' | 'suspended'; joinedAfter?: string; joinedBefore?: string; sort?: string }
  ) => {
    setLoading(true);
    setError('');
    try {
      const result = await api.admin.listUsers({
        q: q || undefined, page: p, pageSize, showDeleted: deleted,
        homeInstance: opts?.homeInstance || undefined,
        role: opts?.role || undefined,
        status: opts?.status === 'suspended' ? 'suspended' : undefined,
        joinedAfter: opts?.joinedAfter || undefined,
        joinedBefore: opts?.joinedBefore || undefined,
        sort: opts?.sort || undefined,
      });
      setData(result);
    } catch (err) {
      setError(err instanceof Error ? describeError(err) : t('admin:users.loadFailed'));
    } finally {
      setLoading(false);
    }
  }, [t]);

  useEffect(() => {
    fetchUsers(query, page, showDeleted, filtersRef.current);
  }, [fetchUsers, page, showDeleted, instanceFilter, roleFilter, statusFilter, joinedAfter, joinedBefore, sortBy]); // eslint-disable-line react-hooks/exhaustive-deps

  const handleSearchChange = (value: string) => {
    setQuery(value);
    if (debounceRef.current) clearTimeout(debounceRef.current);
    debounceRef.current = setTimeout(() => {
      setPage(1);
      fetchUsers(value, 1, showDeleted, filtersRef.current);
    }, 300);
  };

  const handleToggleAdmin = async (user: AdminUser) => {
    if (user.isAdmin) {
      // Demoting — confirm first
      setConfirmAction({ type: 'demote', user });
      return;
    }
    // Promoting — no confirm needed
    setError('');
    try {
      await api.admin.setUserRole(user.id, true);
      fetchUsers(query, page, showDeleted, filtersRef.current);
    } catch (err) {
      setError(err instanceof Error ? describeError(err) : t('admin:users.roleFailed'));
    }
  };

  const [resetConfirmUser, setResetConfirmUser] = useState<AdminUser | null>(null);
  const [resetLoading, setResetLoading] = useState(false);

  const handleResetPassword = (user: AdminUser) => {
    setResetConfirmUser(user);
  };

  const handleResetConfirm = async () => {
    if (!resetConfirmUser) return;
    setResetLoading(true);
    setError('');
    setTempPassword(null);
    try {
      const result = await api.admin.resetUserPassword(resetConfirmUser.id);
      setTempPassword({ userId: resetConfirmUser.id, password: result.temporaryPassword });
      setResetConfirmUser(null);
    } catch (err) {
      setError(err instanceof Error ? describeError(err) : t('admin:users.resetFailed'));
      setResetConfirmUser(null);
    } finally {
      setResetLoading(false);
    }
  };

  const handleDeleteUser = (user: AdminUser) => {
    setConfirmAction({ type: 'delete', user });
  };

  const handleConfirm = async () => {
    if (!confirmAction) return;
    setActionLoading(true);
    setError('');
    try {
      if (confirmAction.type === 'demote') {
        await api.admin.setUserRole(confirmAction.user.id, false);
      } else if (confirmAction.user.homeInstance) {
        // A copy of an account homed elsewhere, which this instance only cleans up.
        await api.admin.deleteUser(confirmAction.user.id, deleteForm.deleteSpaces ? { deleteSpaces: true } : undefined);
      } else {
        await api.admin.deleteUser(confirmAction.user.id, {
          reason: deleteForm.reason.trim(),
          password: deleteForm.password,
          twoFactorCode: deleteForm.code.trim() || undefined,
          deleteSpaces: deleteForm.deleteSpaces || undefined,
        });
      }
      setConfirmAction(null);
      setDeleteForm(EMPTY_DELETE_FORM);
      fetchUsers(query, page, showDeleted, filtersRef.current);
    } catch (err) {
      const message = err instanceof Error ? describeError(err) : t('admin:users.actionFailed');
      // An owner of spaces: the dialog names them and offers to take them with the account.
      const owned = err instanceof HttpError && err.code === 'user_owns_spaces'
        ? (err.body as { ownedSpaces?: { id: string; name: string }[] } | undefined)?.ownedSpaces ?? []
        : [];
      // A wrong password or code is corrected in the dialog, with what was typed still there.
      if (confirmAction.type === 'delete' && (!confirmAction.user.homeInstance || owned.length > 0)) {
        setDeleteForm((current) => ({
          ...current,
          error: owned.length > 0 ? '' : message,
          ownedSpaces: owned.length > 0 ? owned : current.ownedSpaces,
        }));
      } else {
        setError(message);
        setConfirmAction(null);
      }
    } finally {
      setActionLoading(false);
    }
  };

  const totalPages = data ? Math.max(1, Math.ceil(data.total / pageSize)) : 1;
  const userCountLabel = t('admin:users.count', { count: data?.total ?? 0 });

  const formatDate = (ts: number) => f.formatMediumDate(ts);

  const adminButtonTitle = (user: AdminUser, isFederated: boolean): string => {
    if (user.isAdmin) return t('admin:users.actions.demote');
    if (isFederated) return t('admin:users.actions.federatedNoAdmin');
    return t('admin:users.actions.promote');
  };

  const exportAll = async () => {
    setExporting(true);
    setExportError('');
    try {
      saveBlob(await api.admin.exportUsers(), 'accounts.csv');
    } catch (err) {
      setExportError(describeError(err));
    } finally {
      setExporting(false);
    }
  };

  return (
    <div className="space-y-4">
      <div className="flex flex-wrap items-start justify-between gap-3">
        <div className="min-w-0">
          <h2 className="page-title">{t('admin:users.title')}</h2>
          <p className="mt-1 text-meta leading-snug text-txt-tertiary">{t('admin:users.description')}</p>
        </div>
        <button type="button" onClick={() => void exportAll()} disabled={exporting} aria-busy={exporting} className="btn-outline btn-sm flex-shrink-0">
          <Icon name="download" size={13} />
          {t('admin:console.export')}
        </button>
      </div>
      {exportError && <p role="alert" className="text-meta text-txt-danger">{exportError}</p>}

      {/* Search */}
      <div className="flex items-center gap-3">
        <input
          type="text"
          value={query}
          onChange={(e) => handleSearchChange(e.target.value)}
          placeholder={t('admin:users.searchPlaceholder')}
          aria-label={t('admin:users.searchPlaceholder')}
          className="input-search h-8 flex-1 py-0"
        />
      </div>

      {/* Filters */}
      <div className="flex items-center gap-2 flex-wrap">
        <select
          value={instanceFilter}
          onChange={(e) => { setInstanceFilter(e.target.value); setPage(1); }}
          aria-label={t('admin:users.filters.allInstances')}
          className="input-search h-7 py-0 text-meta"
        >
          <option value="">{t('admin:users.filters.allInstances')}</option>
          <option value="local">{t('admin:users.filters.localOnly')}</option>
          {instances.map((inst) => (
            <option key={inst} value={inst}>{inst}</option>
          ))}
        </select>

        <select
          value={roleFilter}
          onChange={(e) => { setRoleFilter(e.target.value); setPage(1); }}
          aria-label={t('admin:users.filters.allRoles')}
          className="input-search h-7 py-0 text-meta"
        >
          <option value="">{t('admin:users.filters.allRoles')}</option>
          <option value="admin">{t('admin:users.filters.admin')}</option>
          <option value="non-admin">{t('admin:users.filters.nonAdmin')}</option>
        </select>

        <select
          value={statusFilter}
          onChange={(e) => { setStatusFilter(e.target.value === 'suspended' ? 'suspended' : ''); setPage(1); }}
          aria-label={t('admin:platform.users.statusFilter')}
          className="input-search h-7 py-0 text-meta"
        >
          <option value="">{t('admin:platform.users.allStatuses')}</option>
          <option value="suspended">{t('admin:platform.users.suspendedOnly')}</option>
        </select>

        <select
          value={sortBy}
          onChange={(e) => { setSortBy(e.target.value); setPage(1); }}
          aria-label={t('admin:users.filters.newest')}
          className="input-search h-7 py-0 text-meta"
        >
          <option value="newest">{t('admin:users.filters.newest')}</option>
          <option value="oldest">{t('admin:users.filters.oldest')}</option>
          <option value="az">{t('common:labels.nameAZ')}</option>
          <option value="za">{t('admin:users.filters.nameDesc')}</option>
        </select>

        <label className="flex items-center gap-1.5 text-meta text-txt-tertiary">
          <span className="whitespace-nowrap">{t('admin:users.filters.joinedAfter')}</span>
          <input
            type="date"
            value={joinedAfter}
            onChange={(e) => { setJoinedAfter(e.target.value); setPage(1); }}
            className="input-search h-7 py-0 text-meta"
          />
        </label>
        <label className="flex items-center gap-1.5 text-meta text-txt-tertiary">
          <span className="whitespace-nowrap">{t('admin:users.filters.joinedBefore')}</span>
          <input
            type="date"
            value={joinedBefore}
            onChange={(e) => { setJoinedBefore(e.target.value); setPage(1); }}
            className="input-search h-7 py-0 text-meta"
          />
        </label>

        <label className="flex h-7 items-center gap-1.5 text-meta text-txt-secondary cursor-pointer whitespace-nowrap">
          <input
            type="checkbox"
            checked={showDeleted}
            onChange={(e) => { setShowDeleted(e.target.checked); setPage(1); }}
          />
          {t('admin:users.filters.deleted')}
        </label>

        {(instanceFilter || roleFilter || statusFilter || joinedAfter || joinedBefore || sortBy !== 'newest' || showDeleted || query) && (
          <button
            onClick={() => {
              setQuery(''); setInstanceFilter(''); setRoleFilter(''); setStatusFilter('');
              setJoinedAfter(''); setJoinedBefore('');
              setSortBy('newest'); setShowDeleted(false); setPage(1);
              fetchUsers('', 1, false, { sort: 'newest' });
            }}
            className="btn-quiet btn-sm"
          >
            {t('admin:users.filters.clear')}
          </button>
        )}
      </div>

      {/* Error */}
      {error && (
        <div className="rounded-md border border-accent-rose/30 bg-accent-rose/10 px-3 py-2 text-ui text-txt-danger">{error}</div>
      )}

      {/* Loading */}
      {loading && !data && (
        <div className="text-ui text-txt-tertiary py-4">{t('admin:users.loading')}</div>
      )}

      {/* User list */}
      {data && (
        <div className="surface-card divide-y divide-border-hard rounded-lg">
          {data.users.length === 0 && (
            <div className="empty-state">
              <p className="empty-state-body">{t('admin:users.empty')}</p>
            </div>
          )}
          {data.users.map((user) => {
            const isSelf = user.id === currentUser?.id;
            const isFederated = !!user.homeInstance;
            const isDeleted = user.isDeleted;

            const hasTempPassword = tempPassword?.userId === user.id;

            return (
              <div key={user.id}>
                <div className="flex min-h-[52px] items-center gap-3 px-3 py-2">
                  {/* Avatar */}
                  <div className={isDeleted ? 'opacity-50' : ''}>
                    <Avatar
                      src={user.avatar ? api.uploads.url(user.avatar) : null}
                      name={user.displayName || user.username}
                      size={32}
                      avatarColor={user.avatarColor as any}
                    />
                  </div>

                  {/* Info */}
                  <div className={`flex-1 min-w-0 ${isDeleted ? 'opacity-50' : ''}`}>
                    <button type="button" onClick={() => setOpenUserId(user.id)} className="flex max-w-full items-baseline gap-2 text-left hover:underline">
                      <span className={`text-ui font-medium text-txt-primary truncate ${isDeleted ? 'line-through' : ''}`}>
                        {user.username}
                      </span>
                      {user.displayName && !isDeleted && (
                        <span className="text-meta text-txt-tertiary truncate">{user.displayName}</span>
                      )}
                    </button>
                    <div className="flex items-center gap-1.5 mt-0.5">
                      {user.isAdmin && (
                        <span className="rounded bg-accent-amber/15 px-1.5 py-px text-2xs font-medium text-accent-amber">
                          {t('admin:users.badge.admin')}
                        </span>
                      )}
                      {isFederated && (
                        <span className="max-w-[120px] truncate rounded bg-accent-sky/15 px-1.5 py-px text-2xs font-medium text-accent-sky">
                          {user.homeInstance}
                        </span>
                      )}
                      {isDeleted && (
                        <span className="rounded bg-accent-rose/15 px-1.5 py-px text-2xs font-medium text-txt-danger">
                          {t('admin:users.badge.deleted')}
                        </span>
                      )}
                      {user.suspension && (
                        <span className="rounded bg-accent-rose/15 px-1.5 py-px text-2xs font-medium text-txt-danger">
                          {t('admin:platform.suspension.chip')}
                        </span>
                      )}
                      <span className="tabular font-mono text-label text-txt-tertiary">
                        {formatDate(user.createdAt)}
                      </span>
                    </div>
                  </div>

                  {/* Actions */}
                  <button
                    type="button"
                    onClick={() => setOpenUserId(user.id)}
                    className="btn-quiet btn-sm shrink-0"
                  >
                    {t('admin:platform.users.manage')}
                  </button>
                  {!isDeleted && (
                    <div className="flex items-center gap-0.5 shrink-0">
                      {/* Toggle admin */}
                      <button
                        type="button"
                        onClick={() => handleToggleAdmin(user)}
                        disabled={isFederated && !user.isAdmin}
                        title={adminButtonTitle(user, isFederated)}
                        aria-label={adminButtonTitle(user, isFederated)}
                        className={`icon-btn ${user.isAdmin ? 'text-accent-amber enabled:hover:bg-accent-amber/10 enabled:hover:text-accent-amber' : ''}`}
                      >
                        <svg className="w-4 h-4" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={1.5}>
                          <path strokeLinecap="round" strokeLinejoin="round" d="M9 12.75L11.25 15 15 9.75m-3-7.036A11.959 11.959 0 013.598 6 11.99 11.99 0 003 9.749c0 5.592 3.824 10.29 9 11.623 5.176-1.332 9-6.03 9-11.622 0-1.31-.21-2.571-.598-3.751h-.152c-3.196 0-6.1-1.248-8.25-3.285z" />
                        </svg>
                      </button>

                      {/* Reset password */}
                      <button
                        type="button"
                        onClick={() => handleResetPassword(user)}
                        disabled={isFederated}
                        title={isFederated ? t('admin:users.actions.federatedNoReset') : t('admin:users.actions.resetPassword')}
                        aria-label={isFederated ? t('admin:users.actions.federatedNoReset') : t('admin:users.actions.resetPassword')}
                        className="icon-btn"
                      >
                        <svg className="w-4 h-4" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={1.5}>
                          <path strokeLinecap="round" strokeLinejoin="round" d="M15.75 5.25a3 3 0 013 3m3 0a6 6 0 01-7.029 5.912c-.563-.097-1.159.026-1.563.43L10.5 17.25H8.25v2.25H6v2.25H2.25v-2.818c0-.597.237-1.17.659-1.591l6.499-6.499c.404-.404.527-1 .43-1.563A6 6 0 1121.75 8.25z" />
                        </svg>
                      </button>

                      {/* Delete user */}
                      <button
                        type="button"
                        onClick={() => handleDeleteUser(user)}
                        disabled={isSelf}
                        title={isSelf ? t('admin:users.actions.selfDelete') : t('admin:users.actions.delete')}
                        aria-label={isSelf ? t('admin:users.actions.selfDelete') : t('admin:users.actions.delete')}
                        className="icon-btn enabled:hover:bg-accent-rose/10 enabled:hover:text-txt-danger"
                      >
                        <svg className="w-4 h-4" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={1.5}>
                          <path strokeLinecap="round" strokeLinejoin="round" d="M14.74 9l-.346 9m-4.788 0L9.26 9m9.968-3.21c.342.052.682.107 1.022.166m-1.022-.165L18.16 19.673a2.25 2.25 0 01-2.244 2.077H8.084a2.25 2.25 0 01-2.244-2.077L4.772 5.79m14.456 0a48.108 48.108 0 00-3.478-.397m-12 .562c.34-.059.68-.114 1.022-.165m0 0a48.11 48.11 0 013.478-.397m7.5 0v-.916c0-1.18-.91-2.164-2.09-2.201a51.964 51.964 0 00-3.32 0c-1.18.037-2.09 1.022-2.09 2.201v.916m7.5 0a48.667 48.667 0 00-7.5 0" />
                        </svg>
                      </button>
                    </div>
                  )}
                </div>

                {/* Inline temp password display */}
                {hasTempPassword && (
                  <div className="border-t border-status-online/30 bg-status-online/10 px-3 py-2.5">
                    <div className="flex items-center justify-between gap-2">
                      <div className="text-meta text-txt-secondary">{t('admin:users.tempPassword.label')}</div>
                      <button
                        type="button"
                        onClick={() => setTempPassword(null)}
                        className="btn-quiet btn-sm"
                      >
                        {t('common:actions.dismiss')}
                      </button>
                    </div>
                    <div className="mt-1.5 flex items-center gap-2">
                      <code className="select-all rounded-md border border-border-soft bg-surface-input px-2 py-1 font-mono text-ui text-txt-positive">
                        {tempPassword.password}
                      </code>
                      <button
                        type="button"
                        onClick={() => navigator.clipboard.writeText(tempPassword.password)}
                        className="btn-outline btn-sm"
                      >
                        {t('common:actions.copy')}
                      </button>
                    </div>
                    <div className="mt-1.5 text-meta text-txt-tertiary">
                      {t('admin:users.tempPassword.note')}
                    </div>
                  </div>
                )}
              </div>
            );
          })}
        </div>
      )}

      {/* Pagination */}
      {data && totalPages > 1 && (
        <div className="flex items-center justify-between pt-2">
          <button
            onClick={() => setPage(p => Math.max(1, p - 1))}
            disabled={page <= 1}
            className="btn-outline btn-sm"
          >
            {t('common:actions.previous')}
          </button>
          <span className="tabular font-mono text-meta text-txt-tertiary">
            {t('admin:users.pagination', { page, total: totalPages, users: userCountLabel })}
          </span>
          <button
            onClick={() => setPage(p => Math.min(totalPages, p + 1))}
            disabled={page >= totalPages}
            className="btn-outline btn-sm"
          >
            {t('common:actions.next')}
          </button>
        </div>
      )}

      <AdminUserDetailModal
        userId={openUserId}
        onClose={() => setOpenUserId(null)}
        onChanged={() => fetchUsers(query, page, showDeleted, filtersRef.current)}
      />

      {/* Confirm dialogs */}
      <ConfirmDialog
        isOpen={!!resetConfirmUser}
        onClose={() => setResetConfirmUser(null)}
        onConfirm={handleResetConfirm}
        title={t('admin:users.resetDialog.title')}
        description={
          <Trans
            t={t}
            i18nKey="admin:users.resetDialog.description"
            values={{ username: resetConfirmUser?.username ?? '' }}
            components={{ strong: <strong /> }}
          />
        }
        confirmLabel={t('admin:users.resetDialog.confirm')}
        variant="warning"
        loading={resetLoading}
      />
      <ConfirmDialog
        isOpen={confirmAction?.type === 'demote'}
        onClose={() => setConfirmAction(null)}
        onConfirm={handleConfirm}
        title={t('admin:users.demoteDialog.title')}
        description={
          <Trans
            t={t}
            i18nKey="admin:users.demoteDialog.description"
            values={{ username: confirmAction?.user.username ?? '' }}
            components={{ strong: <strong /> }}
          />
        }
        confirmLabel={t('admin:users.demoteDialog.confirm')}
        variant="warning"
        loading={actionLoading}
      />
      <ConfirmDialog
        isOpen={confirmAction?.type === 'delete'}
        onClose={() => { setConfirmAction(null); setDeleteForm(EMPTY_DELETE_FORM); }}
        onConfirm={handleConfirm}
        title={t('admin:users.deleteDialog.title')}
        description={
          <>
            <Trans
              t={t}
              i18nKey="admin:users.deleteDialog.description"
              values={{ username: confirmAction?.user.username ?? '' }}
              components={{ strong: <strong /> }}
            />
            {deleteForm.ownedSpaces.length > 0 && (
              <div className="mt-3 space-y-2 rounded-md border border-border-hard bg-surface-base px-3 py-2.5">
                <p className="text-ui text-txt-secondary">
                  {t('admin:users.deleteDialog.ownedSpaces', {
                    count: deleteForm.ownedSpaces.length,
                    names: deleteForm.ownedSpaces.map((space) => space.name).join(', '),
                  })}
                </p>
                <label className="flex items-start gap-2 text-ui text-txt-primary">
                  <input
                    type="checkbox"
                    checked={deleteForm.deleteSpaces}
                    onChange={(e) => setDeleteForm((current) => ({ ...current, deleteSpaces: e.target.checked, error: '' }))}
                    className="mt-0.5 accent-accent-primary"
                  />
                  <span>{t('admin:users.deleteDialog.deleteSpaces')}</span>
                </label>
              </div>
            )}
            {confirmAction && !confirmAction.user.homeInstance && (
              <div className="mt-3 space-y-3">
                <div>
                  <label htmlFor="delete-account-reason" className="field-label">{t('admin:users.deleteDialog.reason')}</label>
                  <textarea
                    id="delete-account-reason"
                    value={deleteForm.reason}
                    onChange={(e) => setDeleteForm((current) => ({ ...current, reason: e.target.value.slice(0, SUSPENSION_LIMITS.REASON_MAX_LENGTH), error: '' }))}
                    rows={2}
                    className="input-standard w-full resize-none"
                  />
                </div>
                <div>
                  <label htmlFor="delete-account-password" className="field-label">{t('admin:users.deleteDialog.password')}</label>
                  <input
                    id="delete-account-password"
                    type="password"
                    autoComplete="current-password"
                    value={deleteForm.password}
                    onChange={(e) => setDeleteForm((current) => ({ ...current, password: e.target.value, error: '' }))}
                    className="input-standard w-full"
                  />
                </div>
                <TwoFactorCodeField
                  id="delete-account-two-factor"
                  value={deleteForm.code}
                  onChange={(code) => setDeleteForm((current) => ({ ...current, code, error: '' }))}
                />
                {deleteForm.error && <p role="alert" className="text-meta text-txt-danger">{deleteForm.error}</p>}
              </div>
            )}
          </>
        }
        confirmLabel={t('admin:users.deleteDialog.confirm')}
        variant="danger"
        loading={actionLoading}
        confirmDisabled={Boolean(
          (confirmAction && !confirmAction.user.homeInstance
            && (deleteForm.reason.trim().length < SUSPENSION_LIMITS.REASON_MIN_LENGTH || !deleteForm.password))
          || (deleteForm.ownedSpaces.length > 0 && !deleteForm.deleteSpaces),
        )}
      />
    </div>
  );
}
