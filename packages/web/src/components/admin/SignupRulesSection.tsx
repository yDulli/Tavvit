import { useCallback, useEffect, useId, useState } from 'react';
import { useTranslation } from 'react-i18next';
import type { SignupRule, SignupRuleKind } from '@backspace/shared/src/adminConsole';
import { isSignupChallengeLevel, SIGNUP_CHALLENGE_LEVELS, type SignupChallengeLevel } from '@backspace/shared/src/signupChallenge';
import { api } from '../../api/client';
import { describeError } from '../../i18n/errors';
import { Icon } from '../ui/Icon';
import { LoadingSpinner } from '../ui/LoadingSpinner';

/** One list of the page: what may not be used, the way to add to it and to take away. */
function RuleList({ kind, rules, onChange, children }: {
  kind: SignupRuleKind;
  rules: readonly SignupRule[];
  onChange: (rules: SignupRule[]) => void;
  children?: React.ReactNode;
}) {
  const { t } = useTranslation('admin');
  const fieldId = useId();
  const [value, setValue] = useState('');
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState('');
  const label = kind === 'username' ? t('console.signup.usernames') : t('console.signup.domains');

  const add = async (event: React.FormEvent) => {
    event.preventDefault();
    setBusy(true);
    setError('');
    try {
      onChange((await api.admin.addSignupRule({ kind, value })).rules);
      setValue('');
    } catch (err) {
      setError(describeError(err));
    } finally {
      setBusy(false);
    }
  };

  const remove = async (rule: SignupRule) => {
    setError('');
    try {
      onChange((await api.admin.removeSignupRule(rule.kind, rule.value)).rules);
    } catch (err) {
      setError(describeError(err));
    }
  };

  return (
    <section className="surface-card flex min-w-0 flex-col rounded-lg p-4" aria-label={label}>
      <h3 className="text-ui font-medium text-txt-primary">{label}</h3>
      <p className="mt-0.5 text-meta leading-snug text-txt-tertiary">
        {kind === 'username' ? t('console.signup.usernamesHint') : t('console.signup.domainsHint')}
      </p>
      <form onSubmit={(event) => void add(event)} className="mt-3 flex gap-2">
        <label htmlFor={fieldId} className="sr-only">{label}</label>
        <input
          id={fieldId}
          value={value}
          onChange={(event) => setValue(event.target.value)}
          placeholder={kind === 'username' ? t('console.signup.usernamePlaceholder') : t('console.signup.domainPlaceholder')}
          className="input-standard min-w-0 flex-1"
          autoComplete="off"
          spellCheck={false}
        />
        <button type="submit" disabled={!value.trim() || busy} aria-busy={busy} className="btn-outline">{t('console.signup.add')}</button>
      </form>
      {error && <p role="alert" className="mt-2 text-meta text-txt-danger">{error}</p>}
      {children}
      {rules.length === 0 ? (
        <p className="mt-3 text-ui text-txt-tertiary">{t('console.signup.empty')}</p>
      ) : (
        <ul className="mt-3 flex flex-wrap gap-1.5">
          {rules.map((rule) => (
            <li key={rule.value} className="glass-pill flex min-w-0 items-center gap-1 rounded-md py-0.5 pl-2 pr-0.5 font-mono text-meta text-txt-primary">
              <span className="min-w-0 truncate">{rule.value}</span>
              <button
                type="button"
                onClick={() => void remove(rule)}
                aria-label={t('console.signup.remove', { value: rule.value })}
                className="icon-btn h-5 w-5"
              >
                <Icon name="x" size={12} />
              </button>
            </li>
          ))}
        </ul>
      )}
    </section>
  );
}

/**
 * Who may not sign up here. It is asked when an account is made and when an address is set;
 * it changes nothing for an account that exists, whatever its name or address.
 */
export function SignupRulesSection() {
  const { t } = useTranslation('admin');
  const [rules, setRules] = useState<SignupRule[] | null>(null);
  const [error, setError] = useState('');
  const [busy, setBusy] = useState(false);
  const [level, setLevel] = useState<SignupChallengeLevel>('off');
  const levelField = useId();

  const load = useCallback(async () => {
    try {
      const response = await api.admin.signupRules();
      setRules(response.rules);
      setLevel(response.challengeLevel);
    } catch (err) {
      setError(describeError(err));
    }
  }, []);

  useEffect(() => { void load(); }, [load]);

  const changeLevel = async (value: string) => {
    if (!isSignupChallengeLevel(value)) return;
    setError('');
    try {
      setLevel((await api.admin.setSignupChallenge(value)).challengeLevel);
    } catch (err) {
      setError(describeError(err));
    }
  };

  const addUsual = async () => {
    setBusy(true);
    setError('');
    try {
      setRules((await api.admin.addSignupRule({ kind: 'username', usual: true })).rules);
    } catch (err) {
      setError(describeError(err));
    } finally {
      setBusy(false);
    }
  };

  return (
    <div className="space-y-5">
      <div>
        <h2 className="page-title">{t('console.sections.signup')}</h2>
        <p className="mt-1 max-w-[640px] text-meta leading-snug text-txt-tertiary">{t('console.signup.description')}</p>
      </div>
      {error && <div role="alert" className="rounded-md border border-accent-rose/30 bg-accent-rose/10 px-3 py-2 text-ui text-txt-danger">{error}</div>}
      {!rules && !error && <div className="flex h-24 items-center justify-center"><LoadingSpinner /></div>}
      {rules && (
        <section className="surface-card flex flex-wrap items-start justify-between gap-3 rounded-lg p-4" aria-label={t('console.signup.challenge')}>
          <div className="min-w-0 max-w-[560px]">
            <label htmlFor={levelField} className="text-ui font-medium text-txt-primary">{t('console.signup.challenge')}</label>
            <p className="mt-0.5 text-meta leading-snug text-txt-tertiary">{t('console.signup.challengeHint')}</p>
          </div>
          <select id={levelField} value={level} onChange={(event) => void changeLevel(event.target.value)} className="input-standard w-auto flex-shrink-0">
            {SIGNUP_CHALLENGE_LEVELS.map((option) => (
              <option key={option} value={option}>{t(`console.signup.challengeLevels.${option}`)}</option>
            ))}
          </select>
        </section>
      )}
      {rules && (
        <div className="grid items-start gap-3 desktop:grid-cols-2">
          <RuleList kind="email_domain" rules={rules.filter((rule) => rule.kind === 'email_domain')} onChange={setRules} />
          <RuleList kind="username" rules={rules.filter((rule) => rule.kind === 'username')} onChange={setRules}>
            <button type="button" onClick={() => void addUsual()} disabled={busy} aria-busy={busy} className="btn-quiet btn-sm -ml-2.5 mt-2 self-start">
              {t('console.signup.addUsual')}
            </button>
          </RuleList>
        </div>
      )}
    </div>
  );
}
