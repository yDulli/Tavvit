import { getLanguage } from '../../i18n';
import React, { useState, useRef, useEffect } from 'react';
import { Link, useNavigate, useSearchParams } from 'react-router-dom';
import { Trans, useTranslation } from 'react-i18next';
import { useAuthStore } from '../../stores/authStore';
import { Avatar, avatarRadius } from '../ui/Avatar';
import { Icon } from '../ui/Icon';
import { ImageCropModal } from '../ui/ImageCropModal';
import { AVATAR_GRADIENT_MAP } from '../../utils/gradients';
import { AVATAR_COLORS } from '@backspace/shared';
import { PASSWORD_MIN_LENGTH } from '@backspace/shared/src/constants';
import type { AvatarColor, CheckInviteResponse, InstanceInfoResponse } from '@backspace/shared';
import { api, HttpError, RateLimitError } from '../../api/client';
import { useTransferStore } from '../../stores/transferStore';
import { waitForTransferAttachment } from '../../utils/waitForTransfer';
import { AUTH_FIELD, AUTH_LINK, AUTH_SUBMIT, AuthNotice, AuthShell } from './AuthShell';
import { LEGAL_LIMITS } from '@backspace/shared/src/legal';
import { useLegalStore } from '../../stores/legalStore';
import { describeError } from '../../i18n/errors';

// Single-source regex for extracting a bare invite token from a pasted full URL.
// Token format: 22 chars base64url ([A-Za-z0-9_-]).
const INVITE_URL_REGEX = /[?&]invite=([A-Za-z0-9_-]{22})/;

const USERNAME_MIN_LENGTH = 3;
const USERNAME_MAX_LENGTH = 32;

type UsernameStatus = 'idle' | 'checking' | 'available' | 'taken' | 'invalid';

type CheckTone = 'checking' | 'good' | 'bad';

const CHECK_TEXT: Record<CheckTone, string> = {
  checking: 'text-txt-tertiary',
  good: 'text-txt-positive',
  bad: 'text-txt-danger',
};

/** One line saying what is being checked, or how it came out. */
function CheckLine({ tone, id, className = '', children }: {
  tone: CheckTone;
  id?: string;
  className?: string;
  children: React.ReactNode;
}): React.JSX.Element {
  return (
    <div id={id} role="status" className={`flex items-start gap-1.5 text-meta leading-4 ${CHECK_TEXT[tone]} ${className}`}>
      {tone === 'checking'
        ? <span aria-hidden="true" className="mt-0.5 h-3 w-3 flex-shrink-0 animate-spin rounded-full border-[1.5px] border-current border-r-transparent" />
        : <Icon name={tone === 'good' ? 'check' : 'x'} size={14} strokeWidth={2} className="mt-px flex-shrink-0" />}
      <span className="min-w-0 break-words">{children}</span>
    </div>
  );
}

export function RegisterPage() {
  const { t } = useTranslation(['auth', 'common', 'legal']);
  // Step state
  const [step, setStep] = useState<1 | 2>(1);
  const [direction, setDirection] = useState<'forward' | 'back'>('forward');

  // Step 1 fields
  const [username, setUsername] = useState('');
  const [email, setEmail] = useState('');
  const [password, setPassword] = useState('');
  const [confirmPassword, setConfirmPassword] = useState('');
  // The field a refused "Continue" is about, until something is typed again.
  const [invalidField, setInvalidField] = useState<'username' | 'email' | 'password' | 'confirm' | null>(null);

  // Username availability check
  const [usernameStatus, setUsernameStatus] = useState<UsernameStatus>('idle');
  const [usernameStatusMessage, setUsernameStatusMessage] = useState('');
  const usernameCheckTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  const usernameCheckAbortRef = useRef<AbortController | null>(null);

  // Instance info (for registration policy)
  const [instanceInfo, setInstanceInfo] = useState<InstanceInfoResponse | null>(null);

  // Invite token state
  const [manualInviteToken, setManualInviteToken] = useState('');
  const [inviteCheck, setInviteCheck] = useState<CheckInviteResponse | null>(null);
  const [inviteChecking, setInviteChecking] = useState(false);
  const inviteCheckTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  // Whether the server has refused the invite in the address. Apart from `inviteCheck`,
  // which from then on says how a typed code fared, and is empty while one is checked.
  const [urlTokenInvalid, setUrlTokenInvalid] = useState(false);

  // Step 2 fields
  const [displayName, setDisplayName] = useState('');
  const [avatarColor, setAvatarColor] = useState<AvatarColor>(
    () => AVATAR_COLORS[Math.floor(Math.random() * AVATAR_COLORS.length)] ?? 'mint'
  );
  const [avatarPreview, setAvatarPreview] = useState<string | null>(null);
  const [avatarFile, setAvatarFile] = useState<File | null>(null);
  const [avatarCropSrc, setAvatarCropSrc] = useState<string | null>(null);
  const avatarInputRef = useRef<HTMLInputElement>(null);

  const [error, setError] = useState('');
  const [isRegistering, setIsRegistering] = useState(false);
  const [termsAgreed, setTermsAgreed] = useState(false);
  // The terms in force, once the instance has published any (docs/systems/legal.md).
  const termsInForce = useLegalStore((s) => s.info?.terms.current ?? null);
  const loadLegal = useLegalStore((s) => s.load);
  const [legalChecked, setLegalChecked] = useState(false);
  useEffect(() => {
    let active = true;
    void loadLegal().finally(() => { if (active) setLegalChecked(true); });
    return () => { active = false; };
  }, [loadLegal]);
  const minimumAge = useLegalStore((s) => s.info?.operator?.minimumAge ?? LEGAL_LIMITS.MIN_AGE_DEFAULT);
  const [retryAfter, setRetryAfter] = useState(0);

  const initSession = useAuthStore((s) => s.initSession);
  const navigate = useNavigate();
  const [searchParams] = useSearchParams();
  const redirect = searchParams.get('redirect');
  const urlInviteToken = searchParams.get('invite');

  // Cleanup blob URL on unmount
  useEffect(() => {
    return () => {
      if (avatarPreview) URL.revokeObjectURL(avatarPreview);
    };
  }, [avatarPreview]);

  // Fetch instance info to determine registration policy
  useEffect(() => {
    let cancelled = false;
    api.instance.info()
      .then((info) => { if (!cancelled) setInstanceInfo(info); })
      .catch(() => {
        // Leave null — treat as open by default to avoid soft-locking the page.
        // Server-side validation (Task 11) is the real gate.
      });
    return () => { cancelled = true; };
  }, []);

  // Validate URL-supplied invite token — only fires when:
  // (a) a URL token is present, AND
  // (b) instanceInfo has loaded AND indicates registration is closed.
  // Per spec §4.4: when registration is open, the URL invite param is silently ignored
  // (no token consumption, no validation, no rate-limit slot burned).
  useEffect(() => {
    if (!urlInviteToken) return;
    if (!instanceInfo || instanceInfo.registrationOpen) return;
    let cancelled = false;
    setUrlTokenInvalid(false);
    setInviteChecking(true);
    api.auth.checkInvite(urlInviteToken)
      .then((res) => {
        if (!cancelled) {
          setUrlTokenInvalid(!res.valid);
          setInviteCheck(res);
        }
      })
      .catch(() => {
        if (!cancelled) {
          setUrlTokenInvalid(true);
          setInviteCheck({ valid: false, reason: 'invalid' });
        }
      })
      .finally(() => { if (!cancelled) setInviteChecking(false); });
    return () => { cancelled = true; };
  }, [urlInviteToken, instanceInfo]);

  // Debounced manual-entry invite validation.
  // The URL token takes precedence while it is still in-flight or has been confirmed valid.
  useEffect(() => {
    if (urlInviteToken && !urlTokenInvalid) return; // URL token takes precedence while in flight or valid

    const trimmed = manualInviteToken.trim();
    if (!trimmed) {
      setInviteCheck(null);
      setInviteChecking(false);
      return;
    }

    // Extract bare token if user pasted a full URL
    let token = trimmed;
    const urlMatch = trimmed.match(INVITE_URL_REGEX);
    if (urlMatch) token = urlMatch[1]!;

    let cancelled = false;

    if (inviteCheckTimerRef.current) clearTimeout(inviteCheckTimerRef.current);

    // Set checking=true immediately so the manual-entry row shows "Checking..." rather
    // than the stale URL-token failure state while the user is actively typing.
    setInviteChecking(true);

    inviteCheckTimerRef.current = setTimeout(async () => {
      if (cancelled) return;
      // Clear the previous code's result before the fresh API response arrives so
      // stale text never briefly flashes on completion.
      setInviteCheck(null);
      try {
        const res = await api.auth.checkInvite(token);
        if (cancelled) return;
        setInviteCheck(res);
      } catch {
        if (cancelled) return;
        setInviteCheck({ valid: false, reason: 'invalid' });
      } finally {
        if (!cancelled) setInviteChecking(false);
      }
    }, 500);

    return () => {
      cancelled = true;
      if (inviteCheckTimerRef.current) clearTimeout(inviteCheckTimerRef.current);
    };
  }, [manualInviteToken, urlInviteToken, urlTokenInvalid]);

  // Debounced username availability check
  useEffect(() => {
    // Clear previous timer and abort
    if (usernameCheckTimerRef.current) clearTimeout(usernameCheckTimerRef.current);
    if (usernameCheckAbortRef.current) usernameCheckAbortRef.current.abort();

    const trimmed = username.trim();

    if (trimmed.length === 0) {
      setUsernameStatus('idle');
      setUsernameStatusMessage('');
      return;
    }

    if (trimmed.length < USERNAME_MIN_LENGTH || trimmed.length > USERNAME_MAX_LENGTH) {
      setUsernameStatus(trimmed.length > 0 ? 'invalid' : 'idle');
      setUsernameStatusMessage(trimmed.length > 0 ? t('auth:validation.usernameLength', { min: USERNAME_MIN_LENGTH, max: USERNAME_MAX_LENGTH }) : '');
      return;
    }

    if (!/^[a-z0-9_]+$/.test(trimmed)) {
      setUsernameStatus('invalid');
      setUsernameStatusMessage(t('auth:validation.usernameCharset'));
      return;
    }

    setUsernameStatus('checking');
    setUsernameStatusMessage(t('auth:validation.usernameChecking'));

    usernameCheckTimerRef.current = setTimeout(async () => {
      const controller = new AbortController();
      usernameCheckAbortRef.current = controller;

      try {
        const result = await api.auth.checkUsername(trimmed);
        if (controller.signal.aborted) return;

        if (result.reason || result.code) {
          setUsernameStatus('invalid');
          // Localize by code when the server sends one; the English reason is
          // the fallback for an instance that predates the codes.
          setUsernameStatusMessage(
            describeError(new HttpError(200, result.reason ?? '', result, result.code, result.details)),
          );
        } else if (result.available) {
          setUsernameStatus('available');
          setUsernameStatusMessage(t('auth:validation.usernameAvailable'));
        } else {
          setUsernameStatus('taken');
          setUsernameStatusMessage(t('auth:validation.usernameTaken'));
        }
      } catch {
        if (controller.signal.aborted) return;
        // Network error or rate limit — fall back to idle silently
        setUsernameStatus('idle');
        setUsernameStatusMessage('');
      }
    }, 500);

    return () => {
      if (usernameCheckTimerRef.current) clearTimeout(usernameCheckTimerRef.current);
      if (usernameCheckAbortRef.current) usernameCheckAbortRef.current.abort();
    };
  }, [username]);

  // Countdown timer
  useEffect(() => {
    if (retryAfter <= 0) return;
    const timer = setInterval(() => {
      setRetryAfter((prev) => {
        if (prev <= 1) {
          clearInterval(timer);
          return 0;
        }
        return prev - 1;
      });
    }, 1000);
    return () => clearInterval(timer);
  }, [retryAfter]);

  // ── Invite requirements ──
  const inviteRequired = instanceInfo !== null && !instanceInfo.registrationOpen;
  const inviteValid = inviteRequired ? inviteCheck?.valid === true : true;

  // Show the manual-entry container when:
  // - Registration is closed AND
  // - There is no URL token, OR the URL token has already been validated as invalid
  const showManualEntry = instanceInfo !== null
    && !instanceInfo.registrationOpen
    && (!urlInviteToken || urlTokenInvalid);

  // ── Step 1 validation ──
  const handleContinue = (e: React.FormEvent) => {
    e.preventDefault();
    setError('');
    setInvalidField(null);

    const refuse = (field: 'username' | 'email' | 'password' | 'confirm', message: string) => {
      setInvalidField(field);
      setError(message);
    };

    const trimmed = username.trim();
    if (!trimmed) {
      refuse('username', t('auth:validation.usernameRequired'));
      return;
    }
    if (trimmed.length < USERNAME_MIN_LENGTH || trimmed.length > USERNAME_MAX_LENGTH) {
      refuse('username', t('auth:validation.usernameLength', { min: USERNAME_MIN_LENGTH, max: USERNAME_MAX_LENGTH }));
      return;
    }
    if (!/^[a-z0-9_]+$/.test(trimmed)) {
      refuse('username', t('auth:validation.usernameCharset'));
      return;
    }
    if (usernameStatus === 'taken' || usernameStatus === 'invalid') {
      return;
    }
    if (instanceInfo?.email) {
      const address = email.trim();
      if (!address && instanceInfo.emailRequired) {
        refuse('email', t('auth:validation.emailRequired'));
        return;
      }
      if (address && !address.includes('@')) {
        refuse('email', t('auth:validation.emailInvalid'));
        return;
      }
    }
    if (!password) {
      refuse('password', t('auth:validation.passwordRequired'));
      return;
    }
    if (password.length < PASSWORD_MIN_LENGTH) {
      refuse('password', t('auth:validation.passwordMinLength', { min: PASSWORD_MIN_LENGTH }));
      return;
    }
    if (password !== confirmPassword) {
      refuse('confirm', t('auth:validation.passwordMismatch'));
      return;
    }
    if (termsInForce && !termsAgreed) {
      setError(t('legal:register.agreeFirst'));
      return;
    }

    setDirection('forward');
    setStep(2);
  };

  // ── Avatar file selection ──
  const handleAvatarSelect = (e: React.ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0];
    if (!file) return;
    const reader = new FileReader();
    reader.onload = () => setAvatarCropSrc(reader.result as string);
    reader.readAsDataURL(file);
    if (avatarInputRef.current) avatarInputRef.current.value = '';
  };

  const handleAvatarCropComplete = (blob: Blob) => {
    if (avatarPreview) URL.revokeObjectURL(avatarPreview);
    const previewUrl = URL.createObjectURL(blob);
    setAvatarPreview(previewUrl);
    setAvatarFile(new File([blob], 'avatar.png', { type: 'image/png' }));
    setAvatarCropSrc(null);
  };

  // ── Registration ──
  const handleRegister = async (skip: boolean) => {
    setError('');
    setIsRegistering(true);
    try {
      const dn = skip ? undefined : displayName.trim() || undefined;
      const ac = skip ? undefined : avatarColor;

      // Resolve the token to send.
      // Per spec §4.4 / §3: open-registration instances silently ignore invite tokens —
      // sending one would be harmless (server ignores it) but it's cleaner to omit it
      // client-side so nothing unexpected is on the wire.
      const tokenForRegister = (() => {
        if (!instanceInfo || instanceInfo.registrationOpen) {
          return undefined;
        }
        // URL token takes precedence ONLY while it hasn't been confirmed invalid.
        if (urlInviteToken && !urlTokenInvalid) return urlInviteToken;
        const trimmed = manualInviteToken.trim();
        if (trimmed) {
          const urlMatch = trimmed.match(INVITE_URL_REGEX);
          return urlMatch ? urlMatch[1] : trimmed;
        }
        // Manual empty AND URL token was confirmed invalid — send URL token so the
        // server returns the authoritative error message rather than "invite required".
        return urlInviteToken ?? undefined;
      })();

      // Step 1: Register via API — store token in localStorage for API auth,
      // but NOT in Zustand yet so AuthRedirect doesn't fire prematurely
      const response = await api.auth.register({
        username: username.trim(),
        password,
        displayName: dn,
        avatarColor: ac,
        ...(tokenForRegister ? { inviteToken: tokenForRegister } : {}),
        ...(termsInForce && termsAgreed ? { acceptedTermsVersion: termsInForce.version, ageConfirmed: true } : {}),
        ...(instanceInfo?.email && email.trim() ? { email: email.trim(), locale: getLanguage() } : {}),
      });
      localStorage.setItem('backspace_token', response.token);

      // Step 2: Upload avatar while still on the register page
      let finalUser = response.user;
      if (!skip && avatarFile) {
        try {
          const tid = await useTransferStore.getState().startUpload(avatarFile, { tray: false });
          const { filename } = await waitForTransferAttachment(tid);
          finalUser = await api.users.update({ avatar: filename });
        } catch {
          // Avatar upload failed — user can set it later in settings
        }
      }

      // Step 3: Activate session — sets Zustand token, triggers AuthRedirect
      initSession(response.token, finalUser);

      if (redirect && redirect.startsWith('/') && !redirect.startsWith('//')) {
        navigate(redirect);
      } else {
        navigate('/channels/@me');
      }
    } catch (err) {
      if (err instanceof HttpError && (err.code === 'terms_not_accepted' || err.code === 'age_not_confirmed')) {
        // The terms changed, or had not loaded: back to where they are agreed to.
        await loadLegal();
        setTermsAgreed(false);
        setDirection('back');
        setStep(1);
        setError(t('legal:register.agreeFirst'));
      } else if (err instanceof HttpError && (err.code === 'email_invalid' || err.code === 'email_required' || err.code === 'email_undeliverable')) {
        // Asked on the first step, so that is where to fix it.
        setDirection('back');
        setStep(1);
        setInvalidField('email');
        setError(describeError(err));
      } else if (err instanceof HttpError && err.code === 'password_too_common') {
        setDirection('back');
        setStep(1);
        setInvalidField('password');
        setError(describeError(err));
      } else if (err instanceof RateLimitError) {
        setRetryAfter(err.retryAfter);
        setError('');
      } else {
        setError(err instanceof Error ? describeError(err) : t('auth:register.failed'));
      }
      setIsRegistering(false);
    }
  };

  const effectiveDisplayName = displayName.trim() || username.trim();
  const initial = effectiveDisplayName.charAt(0).toUpperCase();
  const gradient = AVATAR_GRADIENT_MAP[avatarColor];

  const isDisabled = isRegistering || retryAfter > 0;

  // Continue button is blocked while username is invalid/taken OR when an invite is required
  // but not yet validated as valid
  const continueDisabled =
    !legalChecked ||
    usernameStatus === 'taken' ||
    usernameStatus === 'invalid' ||
    (inviteRequired && !inviteValid);

  const usernameRefused = usernameStatus === 'taken' || usernameStatus === 'invalid';
  // The invite link in the address, as far as the server has said anything about it.
  const urlInviteTone: CheckTone = urlTokenInvalid ? 'bad' : inviteChecking || !inviteCheck ? 'checking' : inviteCheck.valid ? 'good' : 'bad';
  // The result under the code field is about what is typed there, never about the link.
  const typedCodeCheck = manualInviteToken.trim() ? inviteCheck : null;

  return (
    // AuthShell owns the page's scroll: the root is `h-full overflow-hidden`, and
    // without a scroller of its own a phone with the keyboard up could not reach
    // the submit button on step 2.
    <>
      <AuthShell instanceInfo={instanceInfo}>
        {/* Progress: two steps, the current one in the signal colour */}
        <div className="mb-6 flex gap-1.5" aria-hidden="true">
          <div className={`h-[3px] w-8 rounded-sm transition-colors ${step === 1 ? 'bg-accent-primary' : 'bg-border-soft'}`} />
          <div className={`h-[3px] w-8 rounded-sm transition-colors ${step === 2 ? 'bg-accent-primary' : 'bg-border-soft'}`} />
        </div>

        {step === 1 ? (
          <div key="step1" className={`w-full${direction === 'back' ? ' animate-step-back' : ''}`}>
            <div className="mb-8">
              <h1 className="page-title">{t('auth:register.title')}</h1>
            </div>

            <form onSubmit={handleContinue}>
              {error && <AuthNotice tone="danger" role="alert" title={error} />}

              {/* Closed-registration invite entry — shown when registration is closed and:
                  (a) no URL token is present, or (b) the URL token has already failed validation */}
              {showManualEntry && (
                <div className="surface-card mb-5 space-y-2.5 rounded-lg p-3">
                  <p className="text-ui leading-5 text-txt-secondary">
                    {t('auth:register.invite.closedNotice')}
                  </p>
                  <input
                    type="text"
                    value={manualInviteToken}
                    onChange={(e) => setManualInviteToken(e.target.value)}
                    placeholder={t('auth:register.invite.placeholder')}
                    aria-invalid={!inviteChecking && typedCodeCheck?.valid === false}
                    className={AUTH_FIELD}
                    aria-label={t('auth:register.invite.placeholder')}
                    autoComplete="off"
                  />
                  {inviteChecking && (
                    <CheckLine tone="checking">{t('auth:register.invite.checking')}</CheckLine>
                  )}
                  {!inviteChecking && typedCodeCheck?.valid === true && (
                    <CheckLine tone="good">{t('auth:register.invite.valid', { name: typedCodeCheck.name })}</CheckLine>
                  )}
                  {!inviteChecking && typedCodeCheck?.valid === false && (
                    <CheckLine tone="bad">
                      {typedCodeCheck.reason === 'expired' && t('auth:register.invite.expired')}
                      {typedCodeCheck.reason === 'exhausted' && t('auth:register.invite.exhausted')}
                      {typedCodeCheck.reason === 'invalid' && t('auth:register.invite.invalidCode')}
                    </CheckLine>
                  )}
                </div>
              )}

              {/* The invite in the address — shown only when registration is closed AND a URL token was provided.
                  Per spec §4.4: open-registration instances silently ignore the ?invite= param. */}
              {urlInviteToken && instanceInfo && !instanceInfo.registrationOpen && (
                <CheckLine tone={urlInviteTone} className="surface-card mb-5 rounded-md px-3 py-2.5">
                  {urlInviteTone === 'checking' && t('auth:register.invite.validating')}
                  {urlInviteTone === 'good' && inviteCheck?.valid === true && t('auth:register.invite.using', { name: inviteCheck.name })}
                  {urlInviteTone === 'bad' && t('auth:register.invite.invalidLink')}
                </CheckLine>
              )}

              <div className="mb-4">
                <label htmlFor="register-username" className="field-label">
                  {t('common:labels.username')} <span className="text-txt-danger">*</span>
                </label>
                <input
                  id="register-username"
                  type="text"
                  value={username}
                  onChange={(e) => { setUsername(e.target.value.toLowerCase()); setInvalidField(null); }}
                  aria-invalid={usernameRefused || invalidField === 'username'}
                  aria-describedby={usernameStatus !== 'idle' ? 'register-username-check' : undefined}
                  className={AUTH_FIELD}
                  autoFocus
                  autoComplete="username"
                />
                {usernameStatus !== 'idle' && (
                  <CheckLine
                    id="register-username-check"
                    tone={usernameStatus === 'available' ? 'good' : usernameStatus === 'checking' ? 'checking' : 'bad'}
                    className="mt-1.5"
                  >
                    {usernameStatusMessage}
                  </CheckLine>
                )}
              </div>

              {instanceInfo?.email && (
                <div className="mb-4">
                  <label htmlFor="register-email" className="field-label">
                    {instanceInfo.emailRequired
                      ? <>{t('auth:fields.email')} <span className="text-txt-danger">*</span></>
                      : t('auth:fields.emailOptional')}
                  </label>
                  <input
                    id="register-email"
                    type="email"
                    value={email}
                    onChange={(e) => { setEmail(e.target.value); setInvalidField(null); }}
                    aria-invalid={invalidField === 'email'}
                    aria-describedby="register-email-hint"
                    className={AUTH_FIELD}
                    autoComplete="email"
                  />
                  <p id="register-email-hint" className="mt-1.5 text-meta leading-4 text-txt-tertiary">{t('auth:fields.emailHint')}</p>
                </div>
              )}

              <div className="mb-4">
                <label htmlFor="register-password" className="field-label">
                  {t('common:labels.password')} <span className="text-txt-danger">*</span>
                </label>
                <input
                  id="register-password"
                  type="password"
                  value={password}
                  onChange={(e) => { setPassword(e.target.value); setInvalidField(null); }}
                  aria-invalid={invalidField === 'password'}
                  className={AUTH_FIELD}
                  autoComplete="new-password"
                />
              </div>

              <div className="mb-5">
                <label htmlFor="register-confirm-password" className="field-label">
                  {t('auth:fields.confirmPassword')} <span className="text-txt-danger">*</span>
                </label>
                <input
                  id="register-confirm-password"
                  type="password"
                  value={confirmPassword}
                  onChange={(e) => { setConfirmPassword(e.target.value); setInvalidField(null); }}
                  aria-invalid={invalidField === 'confirm'}
                  className={AUTH_FIELD}
                  autoComplete="new-password"
                />
              </div>

              {termsInForce && (
                <label className="mb-5 flex items-start gap-2 text-ui leading-5 text-txt-secondary">
                  <input
                    type="checkbox"
                    checked={termsAgreed}
                    onChange={(e) => setTermsAgreed(e.target.checked)}
                    className="mt-0.5 flex-shrink-0"
                  />
                  <span>
                    <Trans
                      t={t}
                      i18nKey="legal:register.agree"
                      values={{ age: minimumAge }}
                      components={{
                        terms: <Link to="/terms" target="_blank" rel="noopener" className={AUTH_LINK} />,
                        privacy: <Link to="/privacy" target="_blank" rel="noopener" className={AUTH_LINK} />,
                      }}
                    />
                  </span>
                </label>
              )}

              <button
                type="submit"
                disabled={continueDisabled}
                className={AUTH_SUBMIT}
              >
                {t('common:actions.continue')}
              </button>

              {/* Helper text when invite is required but not yet entered */}
              {inviteRequired && !manualInviteToken.trim() && !urlInviteToken && (
                <p className="mt-2 text-meta text-txt-tertiary">
                  {t('auth:register.invite.required')}
                </p>
              )}

              <p className="mt-4 text-ui leading-5 text-txt-tertiary">
                <Trans
                  t={t}
                  i18nKey="auth:register.loginPrompt"
                  components={{
                    actionLink: <Link to={`/login${redirect ? `?redirect=${encodeURIComponent(redirect)}` : ''}`} className={AUTH_LINK} />,
                  }}
                />
              </p>
            </form>
          </div>
        ) : (
          <div key="step2" className={`w-full${direction === 'forward' ? ' animate-step-forward' : ''}`}>
            <div className="mb-8">
              <h1 className="page-title">{t('auth:register.personalize.title')}</h1>
              <p className="mt-1 text-body text-txt-tertiary">{t('auth:register.personalize.subtitle')}</p>
            </div>

            {retryAfter > 0 && (
              <AuthNotice tone="warning" title={t('auth:register.rateLimited.title')}>
                <p className="mt-0.5 text-txt-secondary">{t('auth:register.rateLimited.retryIn', { seconds: retryAfter })}</p>
              </AuthNotice>
            )}

            {error && <AuthNotice tone="danger" role="alert" title={error} />}

            {/* Avatar preview */}
            <div className="mb-5 flex items-center gap-4">
              <button
                type="button"
                onClick={() => avatarInputRef.current?.click()}
                aria-label={t('auth:register.uploadPhoto')}
                className="group relative flex-shrink-0"
                style={{ borderRadius: avatarRadius(80) }}
              >
                <Avatar
                  src={avatarPreview}
                  name={effectiveDisplayName}
                  size={80}
                  avatarColor={avatarColor}
                />
                <div
                  className="absolute inset-0 flex items-center justify-center bg-black/40 opacity-0 transition-opacity group-hover:opacity-100 group-focus-visible:opacity-100"
                  style={{ borderRadius: avatarRadius(80) }}
                >
                  <svg className="w-6 h-6 text-white" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2}>
                    <path strokeLinecap="round" strokeLinejoin="round" d="M3 9a2 2 0 012-2h.93a2 2 0 001.664-.89l.812-1.22A2 2 0 0110.07 4h3.86a2 2 0 011.664.89l.812 1.22A2 2 0 0018.07 7H19a2 2 0 012 2v9a2 2 0 01-2 2H5a2 2 0 01-2-2V9z" />
                    <path strokeLinecap="round" strokeLinejoin="round" d="M15 13a3 3 0 11-6 0 3 3 0 016 0z" />
                  </svg>
                </div>
              </button>
              <button
                type="button"
                onClick={() => avatarInputRef.current?.click()}
                className="btn-outline"
              >
                {t('auth:register.uploadPhoto')}
              </button>
              <input
                ref={avatarInputRef}
                type="file"
                accept="image/*"
                className="hidden"
                onChange={handleAvatarSelect}
              />
            </div>

            {/* Display Name */}
            <div className="mb-5">
              <label htmlFor="register-display-name" className="field-label">
                {t('common:labels.displayName')}
              </label>
              <input
                id="register-display-name"
                type="text"
                value={displayName}
                onChange={(e) => setDisplayName(e.target.value)}
                placeholder={username.trim() || t('auth:fields.displayNamePlaceholder')}
                className={AUTH_FIELD}
                autoComplete="name"
              />
            </div>

            {/* Avatar Color Picker */}
            <div className="mb-6">
              <p id="register-avatar-color" className="field-label">
                {t('auth:fields.avatarColor')}
              </p>
              <div role="group" aria-labelledby="register-avatar-color" className="flex flex-wrap gap-2">
                {AVATAR_COLORS.map((key) => {
                  const entry = AVATAR_GRADIENT_MAP[key];
                  return (
                    <button
                      data-tooltip=""
                      key={key}
                      type="button"
                      onClick={() => setAvatarColor(key)}
                      aria-pressed={avatarColor === key}
                      className="h-8 w-8 rounded border-2 transition-colors"
                      style={{
                        background: entry.gradient,
                        borderColor: avatarColor === key ? 'white' : 'transparent',
                      }}
                      // `key` is the closed AvatarColor union; the catalog lists every member:
                      // common:colors.{mint,sky,lavender,coral,rose,teal,amber}
                      aria-label={t(`common:colors.${key}`)}
                    />
                  );
                })}
              </div>
            </div>

            {/* Actions */}
            <button
              type="button"
              onClick={() => handleRegister(false)}
              disabled={isDisabled}
              aria-busy={isRegistering}
              className={AUTH_SUBMIT}
            >
              {retryAfter > 0
                ? t('auth:register.rateLimited.retryIn', { seconds: retryAfter })
                : isRegistering
                  ? t('auth:register.submitting')
                  : t('auth:register.submit')}
            </button>

            {/* The two quiet actions line their words up with the button's edges. */}
            <div className="mt-2 flex items-center justify-between">
              <button
                type="button"
                onClick={() => { setError(''); setRetryAfter(0); setDirection('back'); setStep(1); }}
                disabled={isRegistering}
                className="btn-quiet -ml-3 h-11 desktop:h-8"
              >
                {t('common:actions.back')}
              </button>
              <button
                type="button"
                onClick={() => handleRegister(true)}
                disabled={isDisabled}
                className="btn-quiet -mr-3 h-11 desktop:h-8"
              >
                {t('auth:register.skip')}
              </button>
            </div>
          </div>
        )}

      </AuthShell>

      {/* Image Crop Modal */}
      {avatarCropSrc && (
        <ImageCropModal
          isOpen={true}
          onClose={() => setAvatarCropSrc(null)}
          imageSrc={avatarCropSrc}
          onCropComplete={handleAvatarCropComplete}
          title={t('auth:register.cropAvatarTitle')}
          aspectRatio={1}
          cropShape="round"
          maxOutputDimension={256}
        />
      )}
    </>
  );
}
