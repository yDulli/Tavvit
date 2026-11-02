import { TwoFactorCodeField } from './settingsPanels/TwoFactorSection';
import { useState, useEffect } from 'react';
import { Trans, useTranslation } from 'react-i18next';
import { useAuthStore } from '../../stores/authStore';
import { useInstanceStore } from '../../stores/instanceStore';
import { useSpaceStore } from '../../stores/spaceStore';
import { api } from '../../api/client';
import { describeError } from '../../i18n/errors';
import { deleteAccountOnRemotes, type FederationOpResult } from '../../utils/federationOps';
import { Icon } from '../ui/Icon';
import { Modal } from '../ui/Modal';
import { FormError } from './settingsPanels/_shared/SettingsControls';

/** The dialog's foot, running to its edges under a hairline, like `ConfirmDialog`'s. */
const FOOTER = '-mx-4 !-mb-4 flex justify-end gap-2 border-t border-border-hard px-4 py-3';

interface DeleteAccountModalProps {
  isOpen: boolean;
  onClose: () => void;
}

type Step = 'warning' | 'confirm' | 'federation' | 'complete';

interface OwnedSpaceInfo {
  id: string;
  name: string;
  members: { userId: string; username: string; displayName: string | null }[];
  action: 'none' | 'transfer' | 'delete';
  transferTo: string;
}

export function DeleteAccountModal({ isOpen, onClose }: DeleteAccountModalProps) {
  const { t } = useTranslation(['settings', 'common']);
  const user = useAuthStore((s) => s.user);
  const instances = useInstanceStore((s) => s.instances);
  const spaces = useSpaceStore((s) => s.spaces);

  const [step, setStep] = useState<Step>('warning');
  const [ownedSpaces, setOwnedSpaces] = useState<OwnedSpaceInfo[]>([]);
  const [confirmUsername, setConfirmUsername] = useState('');
  const [confirmPassword, setConfirmPassword] = useState('');
  const [twoFactorCode, setTwoFactorCode] = useState('');
  const [error, setError] = useState('');
  const [isLoading, setIsLoading] = useState(false);
  const [federationResults, setFederationResults] = useState<FederationOpResult[]>([]);
  const [deletionComplete, setDeletionComplete] = useState(false);

  // Reset state when the modal opens or closes. Only the account's identity
  // counts: a fresh copy of the same user (a socket echo, a presence change) must
  // not throw away the choices and the password being typed here.
  useEffect(() => {
    if (isOpen) {
      setStep('warning');
      setConfirmUsername('');
      setConfirmPassword('');
      setError('');
      setIsLoading(false);
      setFederationResults([]);
      setDeletionComplete(false);

      // Build owned spaces list and fetch members for each
      if (user) {
        const owned = spaces.filter(s => s.ownerId === user.id);
        if (owned.length > 0) {
          Promise.all(
            owned.map(async (s) => {
              try {
                const members = await api.spaces.members(s.id);
                return {
                  id: s.id,
                  name: s.name,
                  members: members
                    .filter(m => m.userId !== user.id)
                    .map(m => ({
                      userId: m.userId,
                      username: m.user.username,
                      displayName: m.user.displayName,
                    })),
                  action: 'none' as const,
                  transferTo: '',
                };
              } catch {
                return {
                  id: s.id,
                  name: s.name,
                  members: [] as OwnedSpaceInfo['members'],
                  action: 'none' as const,
                  transferTo: '',
                };
              }
            })
          ).then(setOwnedSpaces);
        }
      }
    }
  }, [isOpen, user?.id]);

  // Auto-redirect after deletion — must be before early return to maintain hooks order
  useEffect(() => {
    if (deletionComplete && step === 'complete') {
      const timer = setTimeout(() => {
        localStorage.removeItem('backspace_token');
        window.location.href = '/login';
      }, 3000);
      return () => clearTimeout(timer);
    }
  }, [deletionComplete, step]);

  if (!isOpen || !user) return null;

  const hasRemotes = instances.filter(i => i.status === 'connected').length > 0;
  const allOwnedHandled = ownedSpaces.every(s => s.action !== 'none');

  const handleSpaceAction = (spaceId: string, action: 'transfer' | 'delete') => {
    setOwnedSpaces(prev => prev.map(s =>
      s.id === spaceId ? { ...s, action, transferTo: action === 'transfer' ? s.transferTo : '' } : s
    ));
  };

  const handleTransferTo = (spaceId: string, userId: string) => {
    setOwnedSpaces(prev => prev.map(s =>
      s.id === spaceId ? { ...s, transferTo: userId } : s
    ));
  };

  const handleContinueFromWarning = async () => {
    setError('');
    setIsLoading(true);

    try {
      // Process owned spaces
      for (const space of ownedSpaces) {
        if (space.action === 'transfer' && space.transferTo) {
          await api.spaces.transferOwnership(space.id, space.transferTo);
        } else if (space.action === 'delete') {
          await api.spaces.delete(space.id);
        }
      }
      setStep('confirm');
    } catch (err) {
      setError(err instanceof Error ? describeError(err) : t('settings:account.deletion.errors.spacesFailed'));
    } finally {
      setIsLoading(false);
    }
  };

  const handleConfirmDelete = async () => {
    if (confirmUsername !== user.username) {
      setError(t('settings:account.deletion.errors.usernameMismatch'));
      return;
    }

    setError('');
    setIsLoading(true);

    try {
      if (hasRemotes) {
        setStep('federation');
        // Delete on remotes first
        const results = await deleteAccountOnRemotes();
        setFederationResults(results);
        // Then delete home account
        await api.users.deleteAccount({ password: confirmPassword, username: confirmUsername, ...(twoFactorCode.trim() ? { twoFactorCode: twoFactorCode.trim() } : {}) });
        setDeletionComplete(true);
        setStep('complete');
      } else {
        // No remotes — direct delete via API (don't clear auth state yet — let the modal show "complete")
        await api.users.deleteAccount({ password: confirmPassword, username: confirmUsername, ...(twoFactorCode.trim() ? { twoFactorCode: twoFactorCode.trim() } : {}) });
        setDeletionComplete(true);
        setStep('complete');
      }
    } catch (err) {
      setError(err instanceof Error ? describeError(err) : t('settings:account.deletion.errors.deleteFailed'));
      if (step === 'federation') {
        // Stay on federation step so user can see results
      } else {
        setStep('confirm');
      }
    } finally {
      setIsLoading(false);
    }
  };

  const handleDeleteAnyway = async () => {
    setError('');
    setIsLoading(true);
    try {
      await api.users.deleteAccount({ password: confirmPassword, username: confirmUsername, ...(twoFactorCode.trim() ? { twoFactorCode: twoFactorCode.trim() } : {}) });
      setDeletionComplete(true);
      setStep('complete');
    } catch (err) {
      setError(err instanceof Error ? describeError(err) : t('settings:account.deletion.errors.deleteFailed'));
    } finally {
      setIsLoading(false);
    }
  };

  return (
    <Modal
      isOpen={isOpen}
      onClose={onClose}
      title={t('settings:account.deletion.title')}
      maxWidth="max-w-lg"
      dismissible={step !== 'complete'}
    >
      <div className="space-y-4">
        {/* Step 1: Warning & Space Handling */}
        {step === 'warning' && (
          <>
            <div className="rounded-lg border border-accent-rose/25 bg-accent-rose/[0.06] px-3.5 py-3">
              <p className="mb-2 text-ui font-medium text-txt-primary">{t('settings:account.deletion.warning.headline')}</p>
              <ul className="list-disc space-y-1 pl-4 text-meta leading-snug text-txt-secondary">
                <li>{t('settings:account.deletion.warning.spaces')}</li>
                <li>{t('settings:account.deletion.warning.friends')}</li>
                <li>{t('settings:account.deletion.warning.dms')}</li>
                <li>{t('settings:account.deletion.warning.messages')}</li>
              </ul>
            </div>

            {ownedSpaces.length > 0 && (
              <div>
                <p className="mb-2 text-ui font-medium text-txt-primary">
                  {t('settings:account.deletion.ownedSpaces.prompt', { count: ownedSpaces.length })}
                </p>
                <div className="space-y-2">
                  {ownedSpaces.map(space => (
                    <div key={space.id} className="surface-card space-y-2.5 rounded-lg p-3">
                      <div className="flex flex-wrap items-center justify-between gap-2">
                        <div className="min-w-0 truncate text-ui font-medium text-txt-primary">{space.name}</div>
                        <div className="flex gap-1.5">
                          <button
                            type="button"
                            aria-pressed={space.action === 'transfer'}
                            onClick={() => handleSpaceAction(space.id, 'transfer')}
                            className={`btn-outline btn-sm ${space.action === 'transfer' ? 'border-accent-primary bg-accent-primary/[0.06] hover:border-accent-primary' : ''}`}
                          >
                            {t('settings:account.deletion.ownedSpaces.transfer')}
                          </button>
                          <button
                            type="button"
                            aria-pressed={space.action === 'delete'}
                            onClick={() => handleSpaceAction(space.id, 'delete')}
                            className={`btn-outline btn-sm ${space.action === 'delete' ? 'border-accent-rose bg-accent-rose/10 text-txt-danger hover:border-accent-rose' : ''}`}
                          >
                            {t('settings:account.deletion.ownedSpaces.delete')}
                          </button>
                        </div>
                      </div>
                      {space.action === 'transfer' && (
                        <select
                          value={space.transferTo}
                          onChange={(e) => handleTransferTo(space.id, e.target.value)}
                          aria-label={t('settings:account.deletion.ownedSpaces.selectOwner')}
                          className="input-standard w-full"
                        >
                          <option value="">{t('settings:account.deletion.ownedSpaces.selectOwner')}</option>
                          {space.members.map(m => (
                            <option key={m.userId} value={m.userId}>
                              {m.displayName || m.username}
                            </option>
                          ))}
                        </select>
                      )}
                    </div>
                  ))}
                </div>
              </div>
            )}

            {error && <FormError>{error}</FormError>}

            <div className={FOOTER}>
              <button type="button" onClick={onClose} className="btn-quiet">
                {t('common:actions.cancel')}
              </button>
              <button
                type="button"
                onClick={ownedSpaces.length > 0 ? handleContinueFromWarning : () => setStep('confirm')}
                disabled={
                  isLoading ||
                  (ownedSpaces.length > 0 && (!allOwnedHandled || ownedSpaces.some(s => s.action === 'transfer' && !s.transferTo)))
                }
                aria-busy={isLoading}
                className="btn-danger"
              >
                {isLoading ? t('settings:account.deletion.processing') : t('common:actions.continue')}
              </button>
            </div>
          </>
        )}

        {/* Step 2: Confirmation */}
        {step === 'confirm' && (
          <form onSubmit={(e) => { e.preventDefault(); handleConfirmDelete(); }} className="space-y-4">
            <div className="rounded-lg border border-accent-rose/25 bg-accent-rose/[0.06] px-3.5 py-3">
              <p className="text-ui font-medium text-txt-danger">{t('settings:account.deletion.confirm.permanent')}</p>
            </div>

            <div>
              <label htmlFor="delete-account-username" className="field-label">
                <Trans
                  t={t}
                  i18nKey="settings:account.deletion.confirm.usernamePrompt"
                  values={{ username: user.username }}
                  components={{ username: <span className="font-mono text-txt-primary" /> }}
                />
              </label>
              <input
                id="delete-account-username"
                type="text"
                value={confirmUsername}
                onChange={(e) => setConfirmUsername(e.target.value)}
                className="input-danger w-full"
                placeholder={user.username}
                autoComplete="off"
              />
            </div>

            <div>
              <label htmlFor="delete-account-password" className="field-label">{t('common:labels.password')}</label>
              <input
                id="delete-account-password"
                type="password"
                value={confirmPassword}
                onChange={(e) => setConfirmPassword(e.target.value)}
                className="input-danger w-full"
                placeholder={t('settings:account.deletion.confirm.passwordPlaceholder')}
                autoComplete="current-password"
              />
            </div>

            <TwoFactorCodeField id="delete-account-two-factor" value={twoFactorCode} onChange={setTwoFactorCode} />

            {error && <FormError>{error}</FormError>}

            <div className={FOOTER}>
              <button
                type="button"
                onClick={() => { setStep('warning'); setError(''); }}
                className="btn-quiet"
              >
                {t('common:actions.back')}
              </button>
              <button
                type="submit"
                disabled={isLoading || confirmUsername !== user.username || !confirmPassword}
                aria-busy={isLoading}
                className="btn-danger"
              >
                {isLoading ? t('settings:account.deletion.confirm.deleting') : t('settings:account.deletion.confirm.submit')}
              </button>
            </div>
          </form>
        )}

        {/* Step 3: Federation Progress */}
        {step === 'federation' && (
          <>
            <p className="text-ui text-txt-secondary">{t('settings:account.deletion.federation.removing')}</p>
            <div className="surface-card divide-y divide-border-hard rounded-lg">
              {instances.filter(i => i.status === 'connected').map(inst => {
                const result = federationResults.find(r => r.origin === inst.origin);
                return (
                  <div key={inst.origin} className="flex items-center justify-between gap-3 px-3 py-2">
                    <span className="min-w-0 truncate text-ui text-txt-primary">{inst.label || new URL(inst.origin).host}</span>
                    {!result ? (
                      <span aria-hidden="true" className="h-4 w-4 flex-shrink-0 animate-spin rounded-full border-[1.5px] border-txt-tertiary border-r-transparent" />
                    ) : result.success ? (
                      <Icon name="check" size={16} className="flex-shrink-0 text-txt-positive" />
                    ) : (
                      <div className="flex min-w-0 items-center gap-1.5">
                        <Icon name="x" size={16} className="flex-shrink-0 text-txt-danger" />
                        <span className="text-meta text-txt-danger">{result.error}</span>
                      </div>
                    )}
                  </div>
                );
              })}
            </div>

            {error && <FormError>{error}</FormError>}

            {federationResults.length > 0 && !deletionComplete && (
              <div className={FOOTER}>
                <button
                  type="button"
                  onClick={handleDeleteAnyway}
                  disabled={isLoading}
                  aria-busy={isLoading}
                  className="btn-danger"
                >
                  {isLoading ? t('settings:account.deletion.confirm.deleting') : t('settings:account.deletion.federation.deleteAnyway')}
                </button>
              </div>
            )}
          </>
        )}

        {/* Step 4: Complete */}
        {step === 'complete' && (
          <div className="py-6 text-center">
            <Icon name="check" size={32} className="mx-auto mb-3 text-txt-tertiary" />
            <p className="mb-1 text-lead font-semibold text-txt-primary">{t('settings:account.deletion.complete.title')}</p>
            <p className="text-ui text-txt-tertiary">{t('settings:account.deletion.complete.redirecting')}</p>
          </div>
        )}
      </div>
    </Modal>
  );
}
