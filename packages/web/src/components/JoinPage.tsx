import React, { useState, useEffect, useMemo } from 'react';
import { useParams, useNavigate, Link } from 'react-router-dom';
import { Trans, useTranslation } from 'react-i18next';
import { useAuthStore } from '../stores/authStore';
import { useSpaceStore, NotConnectedError } from '../stores/spaceStore';
import { useInstanceStore, RemoteLoginRequiredError, type RemoteLoginReason } from '../stores/instanceStore';
import { api, createApiClient } from '../api/client';
import { parseInviteInput, buildInstanceJoinUrl } from '../utils/inviteParser';
import { Avatar } from './ui/Avatar';
import { Icon } from './ui/Icon';
import { LegalLinks } from './legal/LegalLinks';
import { LoadingSpinner } from './ui/LoadingSpinner';
import type { InvitePreview } from '@backspace/shared';
import { describeError } from '../i18n/errors';
import { isAlreadyMemberError, isJoinRequestPendingError, isNotRequestableError, JoinRequestRequiredError } from '../utils/joinErrors';
import { sendInviteJoinRequest, type InviteRequestOutcome } from '../utils/inviteJoinRequest';
import { FallbackNotice } from './modals/RemotePasswordStep';
import { useFederationEnabled } from '../hooks/useFederationEnabled';

type JoinPhase = 'preview' | 'connect' | 'fallback' | 'other-instance' | 'already-member' | 'request-sent';

/**
 * What the page's action does. `request` sends a join request, for a space
 * joined by request: its link admits no one, a manager approves each
 * request. Read from the preview's visibility, and switched when the server
 * answers otherwise (an instance whose preview has no visibility, or a space
 * whose visibility changed after the page loaded).
 */
type JoinAction = 'join' | 'request';

/** The one card the page is: the error's and the invite's. */
const CARD = 'modal-panel my-auto flex-shrink-0 w-full max-w-[440px] glass-modal rounded-lg p-6 desktop:p-8 z-10';

/** The page around the card: where you are, a way to the start, and the legal line every public page has. */
function JoinFrame({ children }: { children: React.ReactNode }) {
  const { t } = useTranslation('common');
  return (
    <div className="stage-light isolate h-full overflow-y-auto flex flex-col items-center bg-surface-base relative px-4 py-6">
      <div aria-hidden="true" className="hero-light" />
      <a href="/" className="mb-6 flex w-fit items-center gap-2.5 self-start">
        <img src="/icons/logo-mark.svg" alt="" className="h-6 w-6" />
        <span className="text-lead font-semibold tracking-[-0.01em] text-txt-primary">{t('appName')}</span>
      </a>
      {children}
      <LegalLinks className="mt-6 justify-center" />
    </div>
  );
}

export function JoinPage() {
  const { t } = useTranslation(['auth', 'common']);
  const { inviteCode: rawInviteCode } = useParams<{ inviteCode: string }>();
  const navigate = useNavigate();
  // Joining from another server needs federation; a private server offers only its own sign-in.
  const federation = useFederationEnabled() === true;
  const token = useAuthStore((s) => s.token);
  const user = useAuthStore((s) => s.user);
  const loadUser = useAuthStore((s) => s.loadUser);
  const isAuthLoading = useAuthStore((s) => s.isLoading);
  const logout = useAuthStore((s) => s.logout);
  const joinByCode = useSpaceStore((s) => s.joinByCode);
  const connectToRemote = useInstanceStore((s) => s.connectToRemote);
  const loginToRemote = useInstanceStore((s) => s.loginToRemote);

  // Hydrate auth store when token exists — useAuth() can't be used here because
  // it hard-redirects to /login when there's no token, and JoinPage is a public route.
  useEffect(() => {
    if (token && !user && !isAuthLoading) {
      loadUser();
    }
  }, [token, user, isAuthLoading, loadUser]);

  const [preview, setPreview] = useState<InvitePreview | null>(null);
  // Why the preview did not load, kept as a fact; the words are this render's,
  // so they follow the reader's language.
  const [previewFailure, setPreviewFailure] = useState<{ cause: unknown } | null>(null);
  const [isLoadingPreview, setIsLoadingPreview] = useState(true);

  const [phase, setPhase] = useState<JoinPhase>('preview');
  const [error, setError] = useState('');
  const [isJoining, setIsJoining] = useState(false);

  // Join request state, for a space joined by request
  const [action, setAction] = useState<JoinAction>('join');
  const [requestSpaceId, setRequestSpaceId] = useState('');
  const [requestMessage, setRequestMessage] = useState('');
  const [requestOutcome, setRequestOutcome] = useState<InviteRequestOutcome>('sent');

  // Federation connect state
  const [password, setPassword] = useState('');
  const [fallbackUsername, setFallbackUsername] = useState('');
  const [fallbackReason, setFallbackReason] = useState<RemoteLoginReason>('credential-refused');
  const [fallbackPassword, setFallbackPassword] = useState('');

  // Other instance state
  const [otherDomain, setOtherDomain] = useState('');

  // Parse the invite code from the URL
  const parsed = useMemo(() => {
    if (!rawInviteCode) return null;
    try {
      return parseInviteInput(rawInviteCode);
    } catch {
      return null;
    }
  }, [rawInviteCode]);

  // Fetch preview on mount
  useEffect(() => {
    if (!parsed) {
      setIsLoadingPreview(false);
      return;
    }

    setIsLoadingPreview(true);
    setPreviewFailure(null);

    const fetchPreview = async () => {
      try {
        let client;
        if (parsed.origin) {
          client = createApiClient(parsed.origin, () => null);
        } else {
          client = api;
        }
        const data = await client.spaces.invitePreview(parsed.code);
        setPreview(data);
        setAction(data.visibility === 'request' ? 'request' : 'join');
        setRequestSpaceId(data.spaceId);
      } catch (err) {
        setPreviewFailure({ cause: err });
      } finally {
        setIsLoadingPreview(false);
      }
    };

    fetchPreview();
  }, [parsed]);

  const previewError = !rawInviteCode
    ? t('auth:join.errors.noCode')
    : !parsed
      ? t('auth:join.errors.invalidCode')
      : previewFailure
        ? (previewFailure.cause instanceof Error ? describeError(previewFailure.cause) : t('auth:join.errors.loadFailed'))
        : '';

  /**
   * Run the page's action against the invite's instance: send the join
   * request, or join by the code. Throws what the caller handles
   * (`NotConnectedError`, `RemoteLoginRequiredError`, a refusal). A request
   * to a space that no longer takes requests joins by the code instead, a
   * join the server answers with `join_request_required` switches the page
   * to the request action for the user to send, and one it answers with
   * `join_request_pending` shows the request that is already waiting.
   */
  const proceed = async (): Promise<void> => {
    if (!parsed) return;
    if (action === 'request' && requestSpaceId) {
      try {
        const outcome = await sendInviteJoinRequest(requestSpaceId, parsed.origin ?? '', requestMessage.trim() || undefined);
        setRequestOutcome(outcome);
        setPhase('request-sent');
        return;
      } catch (err) {
        if (!isNotRequestableError(err)) throw err;
        setAction('join');
      }
    }
    try {
      const space = await joinByCode(parsed.code, parsed.origin || undefined);
      navigate(`/channels/${space.id}`);
    } catch (err) {
      if (isJoinRequestPendingError(err)) {
        setAction('request');
        setRequestOutcome('pending');
        setPhase('request-sent');
        return;
      }
      if (!(err instanceof JoinRequestRequiredError)) throw err;
      setAction('request');
      setRequestSpaceId(err.spaceId);
      setPhase('preview');
    }
  };

  // Join (or request) handler
  const handleJoin = async () => {
    if (!parsed) return;
    setError('');
    setIsJoining(true);
    try {
      await proceed();
    } catch (err) {
      if (err instanceof NotConnectedError) {
        setPhase('connect');
        setError('');
      } else {
        if (isAlreadyMemberError(err)) {
          setPhase('already-member');
          setError('');
        } else {
          setError(err instanceof Error ? describeError(err) : t('auth:join.errors.joinFailed'));
        }
      }
    } finally {
      setIsJoining(false);
    }
  };

  // Federation connect handler
  const handleConnect = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!parsed?.origin) return;
    setError('');
    setIsJoining(true);
    try {
      await connectToRemote(parsed.origin, password, user?.displayName || undefined);
      await proceed();
    } catch (err) {
      if (err instanceof RemoteLoginRequiredError) {
        setPhase('fallback');
        setFallbackUsername(err.remoteUsername);
        setFallbackReason(err.reason);
        setFallbackPassword('');
        setError('');
      } else {
        if (isAlreadyMemberError(err)) {
          setPhase('already-member');
          setError('');
        } else {
          setError(err instanceof Error ? describeError(err) : t('auth:join.errors.connectFailed'));
        }
      }
    } finally {
      setIsJoining(false);
    }
  };

  // Fallback login handler
  const handleFallbackLogin = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!parsed?.origin) return;
    setError('');
    setIsJoining(true);
    try {
      await loginToRemote(parsed.origin, fallbackUsername, fallbackPassword);
      await proceed();
    } catch (err) {
      if (isAlreadyMemberError(err)) {
        setPhase('already-member');
        setError('');
      } else {
        setError(err instanceof Error ? describeError(err) : t('auth:join.errors.loginFailed'));
      }
    } finally {
      setIsJoining(false);
    }
  };

  // Other instance redirect
  const handleOtherInstanceRedirect = (e: React.FormEvent) => {
    e.preventDefault();
    const domain = otherDomain.trim();
    if (!domain) return;

    // Build the qualified invite code: code@originHost
    // If the invite is already qualified (arrived via redirect), preserve the original origin
    const originHost = parsed?.origin ? new URL(parsed.origin).host : window.location.host;
    const code = parsed?.code || rawInviteCode || '';
    const qualifiedCode = `${code}@${originHost}`;

    // The domain is typed here, so it is checked before it becomes a URL:
    // a path, a query, a fragment or a userinfo section in that field would
    // send the browser somewhere other than the instance the user named.
    const targetUrl = buildInstanceJoinUrl(domain, qualifiedCode);
    if (!targetUrl) {
      setError(t('auth:join.errors.domainOnly'));
      return;
    }
    window.location.href = targetUrl;
  };

  let hostDisplay = '';
  try {
    if (parsed?.origin) hostDisplay = new URL(parsed.origin).host;
  } catch { /* ignore */ }

  const redirectParam = rawInviteCode ? `?redirect=/join/${encodeURIComponent(rawInviteCode)}` : '';

  // Loading state
  if (isLoadingPreview) {
    return (
      <JoinFrame>
        <div className="my-auto flex-shrink-0 text-center relative z-10">
          <LoadingSpinner size={28} className="mb-3 text-txt-tertiary" />
          <p className="text-ui text-txt-tertiary">{t('auth:join.loading')}</p>
        </div>
      </JoinFrame>
    );
  }

  // Error state — invalid/expired invite
  if (previewError || !preview) {
    return (
      <JoinFrame>
        <div className={`${CARD} text-center`}>
          <span aria-hidden="true" className="empty-state-icon mx-auto mb-4 text-txt-danger">
            <Icon name="alert" size={18} />
          </span>
          <h1 className="page-title mb-2">{t('auth:join.invalid.title')}</h1>
          <p className="text-ui leading-[1.5] text-txt-secondary mb-6">
            {previewError || t('auth:join.invalid.description')}
          </p>
          {token ? (
            <button
              type="button"
              onClick={() => navigate('/channels/@me')}
              className="btn-hero btn-lg"
            >
              {t('auth:join.invalid.backToApp')}
            </button>
          ) : (
            <Link
              to="/login"
              className="btn-hero btn-lg"
            >
              {t('common:actions.logIn')}
            </Link>
          )}
        </div>
      </JoinFrame>
    );
  }

  // Main invite page
  return (
    <JoinFrame>
      <div className={CARD}>
        {/* Space preview */}
        <div className="text-center mb-6">
          <div className="flex justify-center mb-4">
            <Avatar
              src={preview.icon ? (parsed?.origin ? `${parsed.origin}/api/uploads/${preview.icon}` : preview.icon) : null}
              name={preview.spaceName}
              size={72}
              userId={preview.spaceId}
              avatarColor={preview.avatarColor}
              palette="space"
            />
          </div>
          <p className="label-mono mb-1">{action === 'request' ? t('auth:join.invitedToRequest') : t('auth:join.invitedTo')}</p>
          <h1 className="page-title">{preview.spaceName}</h1>
          {preview.description && (
            <p className="mt-2 text-ui leading-[1.5] text-txt-secondary">{preview.description}</p>
          )}
          <div className="mt-3 flex flex-wrap items-center justify-center gap-x-4 gap-y-1 text-meta text-txt-tertiary">
            <span className="flex items-center gap-1.5">
              <Icon name="users" size={13} />
              {t('auth:join.memberCount', { count: preview.memberCount })}
            </span>
            <span className="flex min-w-0 items-center gap-1.5">
              <Icon name="globe" size={12} className="flex-shrink-0" />
              <span className="truncate">{preview.instanceName}</span>
            </span>
          </div>
        </div>

        {error && (
          <div role="alert" className="mb-4 rounded-md border border-accent-rose/30 bg-accent-rose/10 px-3 py-2 text-ui text-txt-danger">
            {error}
          </div>
        )}

        {/* Phase: preview — main join UI */}
        {phase === 'preview' && (
          <>
            {action === 'request' && (
              <p className="mb-3 text-center text-ui leading-[1.5] text-txt-secondary">{t('auth:join.request.notice')}</p>
            )}
            {token && user ? (
              /* Authenticated user — show identity card + join */
              <div className="space-y-3">
                <div className="surface-card flex items-center gap-3 rounded-lg p-3">
                  <Avatar
                    src={user.avatar || null}
                    name={user.displayName || user.username}
                    size={32}
                    avatarColor={user.avatarColor}
                  />
                  <div className="min-w-0">
                    <p className="text-ui font-medium text-txt-primary truncate">{user.displayName || user.username}</p>
                    <p className="font-mono text-label text-txt-tertiary truncate">@{user.username}</p>
                  </div>
                </div>
                {action === 'request' && (
                  <textarea
                    value={requestMessage}
                    onChange={(e) => setRequestMessage(e.target.value)}
                    placeholder={t('auth:join.request.messagePlaceholder')}
                    aria-label={t('auth:join.request.messageLabel')}
                    maxLength={JOIN_REQUEST_MESSAGE_MAX}
                    rows={2}
                    disabled={isJoining}
                    className="input-standard w-full py-2 resize-none"
                  />
                )}
                <button
                  type="button"
                  onClick={handleJoin}
                  disabled={isJoining}
                  aria-busy={isJoining}
                  className="btn-hero btn-lg w-full"
                >
                  {action === 'request'
                    ? (isJoining ? t('auth:join.request.sending') : t('auth:join.request.askAs', { name: user.displayName || user.username }))
                    : (isJoining ? t('auth:join.joining') : t('auth:join.joinAs', { name: user.displayName || user.username }))}
                </button>
                <p className="text-center text-meta text-txt-tertiary">
                  {t('auth:join.notYou')}{' '}
                  <button
                    type="button"
                    onClick={() => { logout(); navigate(`/login${redirectParam}`); }}
                    className="rounded-sm text-txt-secondary underline decoration-border-soft underline-offset-2 transition-colors hover:text-txt-primary"
                  >
                    {t('auth:join.switchAccount')}
                  </button>
                  {federation && (
                    <>
                      {' · '}
                      <button
                        type="button"
                        onClick={() => { setPhase('other-instance'); setError(''); }}
                        className="rounded-sm text-txt-secondary underline decoration-border-soft underline-offset-2 transition-colors hover:text-txt-primary"
                      >
                        {t('auth:join.otherInstance')}
                      </button>
                    </>
                  )}
                </p>
              </div>
            ) : token ? (
              /* Token exists but user still loading */
              <button
                type="button"
                disabled
                className="btn-hero btn-lg w-full"
              >
                {t('common:states.loading')}
              </button>
            ) : (
              /* Unauthenticated user */
              <div className="space-y-2">
                <Link
                  to={`/login${redirectParam}`}
                  className="btn-hero btn-lg w-full"
                >
                  {action === 'request' ? t('auth:join.request.loginToAsk') : t('auth:join.loginToJoin')}
                </Link>
                <Link
                  to={`/register${redirectParam}`}
                  className="btn-outline btn-lg w-full"
                >
                  {t('auth:join.createAccount')}
                </Link>

                {federation && (
                  <>
                    {/* Divider */}
                    <div className="flex items-center gap-3 py-1">
                      <div className="flex-1 h-px bg-border-soft" />
                      <span className="text-meta text-txt-tertiary">{t('common:labels.or')}</span>
                      <div className="flex-1 h-px bg-border-soft" />
                    </div>

                    <button
                      type="button"
                      onClick={() => { setPhase('other-instance'); setError(''); }}
                      className="btn-outline btn-lg w-full"
                    >
                      {t('auth:join.otherInstance')}
                    </button>
                  </>
                )}
              </div>
            )}
          </>
        )}

        {/* Phase: other-instance — domain input for federation redirect */}
        {phase === 'other-instance' && (
          <form onSubmit={handleOtherInstanceRedirect}>
            <label className="field-label">
              {t('auth:join.domain.label')}
            </label>
            <div className="flex gap-2 mb-1.5">
              <input
                type="text"
                value={otherDomain}
                onChange={(e) => setOtherDomain(e.target.value)}
                placeholder={t('auth:join.domain.placeholder')}
                className="input-standard min-w-0 flex-1 h-10"
                autoFocus
              />
              <button
                type="submit"
                disabled={!otherDomain.trim()}
                className="btn-hero btn-lg"
              >
                {t('auth:join.domain.go')}
              </button>
            </div>
            <p className="text-meta leading-[1.45] text-txt-tertiary mb-4">
              {t('auth:join.domain.redirectNote')}
            </p>
            <button
              type="button"
              onClick={() => { setPhase('preview'); setOtherDomain(''); setError(''); }}
              className="btn-quiet"
            >
              {t('common:actions.back')}
            </button>
          </form>
        )}

        {/* Phase: connect — password prompt for federation */}
        {phase === 'connect' && (
          <form onSubmit={handleConnect}>
            <input type="text" autoComplete="username" value={user?.username || ''} readOnly tabIndex={-1} className="sr-only" />
            {/* Identity card */}
            <div className="surface-card flex items-center gap-3 rounded-lg p-3 mb-3">
              <Avatar
                src={user?.avatar || null}
                name={user?.displayName || user?.username || '?'}
                size={32}
                avatarColor={user?.avatarColor}
              />
              <div className="min-w-0">
                <p className="text-ui font-medium text-txt-primary truncate">{user?.displayName || user?.username}</p>
                <p className="font-mono text-label text-txt-tertiary truncate">@{user?.username}</p>
              </div>
            </div>
            <p className="text-meta text-txt-tertiary mb-4">
              <Trans
                t={t}
                i18nKey="auth:join.connect.connectingTo"
                values={{ host: hostDisplay }}
                components={{ host: <span className="text-txt-secondary font-medium" /> }}
              />
            </p>
            <div className="mb-4">
              <label className="field-label">
                {t('common:labels.password')}
              </label>
              <input
                type="password"
                value={password}
                onChange={(e) => setPassword(e.target.value)}
                placeholder={t('auth:join.connect.passwordPlaceholder')}
                className="input-standard w-full py-2.5"
                disabled={isJoining}
                autoFocus
                autoComplete="current-password"
              />
              <p className="text-meta leading-[1.45] text-txt-tertiary mt-1.5">
                {t('auth:join.connect.passwordNote', { host: hostDisplay })}
              </p>
            </div>
            <div className="flex gap-2">
              <button
                type="button"
                onClick={() => { setPhase('preview'); setPassword(''); setError(''); }}
                className="btn-quiet btn-lg"
              >
                {t('common:actions.back')}
              </button>
              <button
                type="submit"
                disabled={isJoining || !password}
                aria-busy={isJoining}
                className="btn-hero btn-lg flex-1"
              >
                {isJoining
                  ? t('auth:join.connect.submitting')
                  : action === 'request' ? t('auth:join.connect.submitRequest') : t('auth:join.connect.submit')}
              </button>
            </div>
          </form>
        )}

        {/* Phase: already-member — green success with auto-redirect */}
        {phase === 'already-member' && preview && (
          <AlreadyMemberCard spaceName={preview.spaceName} spaceId={preview.spaceId} navigate={navigate} />
        )}

        {/* Phase: request-sent: the join request is with the space's managers */}
        {phase === 'request-sent' && preview && (
          <RequestSentCard
            spaceName={preview.spaceName}
            outcome={requestOutcome}
            onDone={() => navigate('/channels/@me')}
          />
        )}

        {/* Phase: fallback — the account's own credentials on the remote */}
        {phase === 'fallback' && (
          <form onSubmit={handleFallbackLogin}>
            <FallbackNotice reason={fallbackReason} host={hostDisplay} className="mb-3" />
            <div className="mb-4 space-y-3">
              <div>
                <label className="field-label">{t('common:labels.username')}</label>
                <input
                  type="text"
                  value={fallbackUsername}
                  onChange={(e) => setFallbackUsername(e.target.value)}
                  placeholder={t('auth:join.fallback.usernamePlaceholder')}
                  className="input-standard w-full py-2.5"
                  disabled={isJoining}
                  autoComplete="username"
                />
              </div>
              <div>
                <label className="field-label">{t('auth:join.fallback.passwordLabel')}</label>
                <input
                  type="password"
                  value={fallbackPassword}
                  onChange={(e) => setFallbackPassword(e.target.value)}
                  placeholder={t('auth:join.fallback.passwordPlaceholder')}
                  className="input-standard w-full py-2.5"
                  disabled={isJoining}
                  autoFocus
                  autoComplete="current-password"
                />
              </div>
            </div>
            <div className="flex gap-2">
              <button
                type="button"
                onClick={() => { setPhase('connect'); setFallbackPassword(''); setError(''); }}
                className="btn-quiet btn-lg"
              >
                {t('common:actions.back')}
              </button>
              <button
                type="submit"
                disabled={isJoining || !fallbackUsername || !fallbackPassword}
                aria-busy={isJoining}
                className="btn-hero btn-lg flex-1"
              >
                {isJoining
                  ? t('auth:join.fallback.submitting')
                  : action === 'request' ? t('auth:join.fallback.submitRequest') : t('auth:join.fallback.submit')}
              </button>
            </div>
          </form>
        )}
      </div>
    </JoinFrame>
  );
}

/** The longest note a join request keeps; the server cuts anything longer. */
const JOIN_REQUEST_MESSAGE_MAX = 500;

function RequestSentCard({ spaceName, outcome, onDone }: { spaceName: string; outcome: InviteRequestOutcome; onDone: () => void }) {
  const { t } = useTranslation(['auth']);
  return (
    <div className="text-center" role="status">
      <span aria-hidden="true" className="empty-state-icon mx-auto mb-3 text-txt-positive">
        <Icon name="check" size={18} />
      </span>
      <p className="text-body font-semibold text-txt-primary mb-1">
        {outcome === 'sent'
          ? t('auth:join.requestSent.title', { space: spaceName })
          : t('auth:join.requestSent.pendingTitle', { space: spaceName })}
      </p>
      <p className="text-ui leading-[1.5] text-txt-secondary mb-4">{t('auth:join.requestSent.body')}</p>
      <button
        type="button"
        onClick={onDone}
        className="btn-hero btn-lg w-full"
      >
        {t('auth:join.invalid.backToApp')}
      </button>
    </div>
  );
}

function AlreadyMemberCard({ spaceName, spaceId, navigate }: { spaceName: string; spaceId: string; navigate: (path: string) => void }) {
  const { t } = useTranslation(['auth']);
  useEffect(() => {
    const timer = setTimeout(() => navigate(`/channels/${spaceId}`), 2000);
    return () => clearTimeout(timer);
  }, [spaceId, navigate]);

  return (
    <div className="text-center">
      <span aria-hidden="true" className="empty-state-icon mx-auto mb-3 text-txt-positive">
        <Icon name="check" size={18} />
      </span>
      <p className="text-body font-semibold text-txt-primary mb-1">{t('auth:join.alreadyMember.title', { space: spaceName })}</p>
      <p className="text-ui leading-[1.5] text-txt-secondary mb-4">{t('auth:join.alreadyMember.redirecting')}</p>
      <button
        type="button"
        onClick={() => navigate(`/channels/${spaceId}`)}
        className="btn-hero btn-lg w-full"
      >
        {t('auth:join.alreadyMember.go', { space: spaceName })}
      </button>
    </div>
  );
}
