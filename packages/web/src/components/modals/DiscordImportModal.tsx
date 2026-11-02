import { channelIconName } from '../../utils/channelKinds';
import { useEffect, useMemo, useRef, useState } from 'react';
import { useTranslation } from 'react-i18next';
import { useNavigate } from 'react-router-dom';
import {
  DISCORD_IMPORT_LIMITS,
  parseDiscordTemplateCode,
  type DiscordImportApplyRequest,
  type DiscordImportChannelPlan,
  type DiscordImportNote,
  type DiscordImportPreview,
  type DiscordImportResult,
  type DiscordImportRolePlan,
} from '@backspace/shared/src/discordImport';
import { useUIStore } from '../../stores/uiStore';
import { useSpaceStore } from '../../stores/spaceStore';
import { getApiForOrigin } from '../../utils/crossStoreResolvers';
import { describeError } from '../../i18n/errors';
import { useFormatters } from '../../i18n/formatters';
import { Modal } from '../ui/Modal';
import { Icon } from '../ui/Icon';
import { usePermissionNames, type PermissionKey } from '../ui/OverrideEntry';
import { PermissionBits } from '../../utils/permissions';

type Step = 'source' | 'preview' | 'importing' | 'done';

/** What the person gave as the template: a link or code, or a file's JSON. */
type Source = { kind: 'code'; code: string } | { kind: 'file'; name: string; template: unknown };

/** Bytes a template file may weigh, as the instance accepts it. */
const MAX_FILE_BYTES = DISCORD_IMPORT_LIMITS.MAX_TEMPLATE_BYTES;

function requestOf(source: Source): { code?: string; template?: unknown } {
  return source.kind === 'code' ? { code: source.code } : { template: source.template };
}

function isPermissionKey(key: string): key is PermissionKey {
  return Object.prototype.hasOwnProperty.call(PermissionBits, key);
}

/** Tavvit permissions by their names in this language, for a list the planner gives by key. */
function usePermissionList(): (keys: readonly string[]) => string {
  const names = usePermissionNames();
  const { formatList } = useFormatters();
  return (keys) => formatList(keys.map((key) => (isPermissionKey(key) ? names[key] : key)));
}

function NoteText({ note }: { note: DiscordImportNote }) {
  const { t } = useTranslation(['spaces']);
  const { formatInterval } = useFormatters();
  const permissionList = usePermissionList();
  const values = { subject: note.subject ?? '', detail: note.detail ?? '' };
  /** What a converted channel was on Discord, as the planner names it. */
  const convertedFrom = (from: string): string => {
    switch (from) {
      case 'stage': return t('spaces:import.discordTypes.stage');
      case 'media': return t('spaces:import.discordTypes.media');
      default: return from;
    }
  };
  switch (note.kind) {
    case 'channel_converted': return <>{t('spaces:import.notes.channel_converted', { subject: values.subject, detail: convertedFrom(values.detail) })}</>;
    case 'channel_unsupported': return <>{t('spaces:import.notes.channel_unsupported', values)}</>;
    case 'channel_exists': return <>{t('spaces:import.notes.channel_exists', values)}</>;
    case 'category_reused': return <>{t('spaces:import.notes.category_reused', values)}</>;
    case 'role_reused': return <>{t('spaces:import.notes.role_reused', values)}</>;
    case 'role_renamed': return <>{t('spaces:import.notes.role_renamed', values)}</>;
    case 'role_icon_dropped': return <>{t('spaces:import.notes.role_icon_dropped', values)}</>;
    case 'everyone_kept': return <>{t('spaces:import.notes.everyone_kept')}</>;
    case 'roles_below_existing': return <>{t('spaces:import.notes.roles_below_existing')}</>;
    case 'permissions_per_channel': return <>{t('spaces:import.notes.permissions_per_channel', values)}</>;
    case 'member_overwrite_dropped': return <>{t('spaces:import.notes.member_overwrite_dropped', values)}</>;
    case 'reference_missing': return <>{t('spaces:import.notes.reference_missing', values)}</>;
    case 'slowmode_adjusted': {
      // Tavvit's slow mode has fixed steps; Discord's value rounds down to one,
      // which below the shortest step means off.
      const seconds = Number(values.detail);
      return seconds > 0
        ? <>{t('spaces:import.notes.slowmode_adjusted', { subject: values.subject, detail: formatInterval(seconds) })}</>
        : <>{t('spaces:import.notes.slowmode_off', { subject: values.subject })}</>;
    }
    case 'topic_shortened': return <>{t('spaces:import.notes.topic_shortened', values)}</>;
    case 'name_changed': return <>{t('spaces:import.notes.name_changed', values)}</>;
    case 'nsfw_dropped': return <>{t('spaces:import.notes.nsfw_dropped', values)}</>;
    case 'override_withheld':
      return <>{t('spaces:import.notes.override_withheld', { subject: values.subject, detail: permissionList(values.detail.split(',').filter(Boolean)) })}</>;
    case 'override_hierarchy': return <>{t('spaces:import.notes.override_hierarchy', values)}</>;
  }
}

function Count({ label, value }: { label: string; value: number }) {
  return (
    <div className="min-w-0 flex-1 px-3 py-2">
      <div className="label-mono">{label}</div>
      <div className="tabular mt-1 font-mono text-xl leading-none text-txt-primary">{value}</div>
    </div>
  );
}

function RoleRow({ role }: { role: DiscordImportRolePlan }) {
  const { t } = useTranslation(['spaces']);
  const permissionList = usePermissionList();
  const actionLabel = role.action === 'create' ? t('spaces:import.preview.action.create')
    : role.action === 'reuse' ? t('spaces:import.preview.action.reuse')
      : role.action === 'update_everyone' ? t('spaces:import.preview.action.updateEveryone')
        : t('spaces:import.preview.action.keepEveryone');
  return (
    <li className="flex items-start gap-3 px-3 py-2">
      <span aria-hidden="true" className="mt-1.5 h-2.5 w-2.5 flex-shrink-0 rounded-full" style={{ backgroundColor: role.color }} />
      <span className="min-w-0 flex-1">
        <span className="flex min-w-0 flex-wrap items-baseline gap-x-2">
          <span className="truncate text-ui font-medium text-txt-primary">{role.icon ? `${role.icon} ` : ''}{role.name}</span>
          {role.hoist && !role.everyone && <span className="text-meta text-txt-tertiary">{t('spaces:import.preview.hoist')}</span>}
          {role.mentionable && !role.everyone && <span className="text-meta text-txt-tertiary">{t('spaces:import.preview.mentionable')}</span>}
        </span>
        {role.unsupported.length > 0 && (
          <span className="mt-0.5 block text-meta text-txt-tertiary" title={role.unsupported.join(', ')}>
            {t('spaces:import.preview.unsupported', { count: role.unsupported.length })}
          </span>
        )}
        {role.withheld.length > 0 && (
          <span className="mt-0.5 block text-meta text-txt-warning" title={permissionList(role.withheld)}>
            {t('spaces:import.preview.withheld', { count: role.withheld.length })}
          </span>
        )}
      </span>
      <span className="flex-shrink-0 font-mono text-label text-txt-tertiary">{actionLabel}</span>
    </li>
  );
}

function ChannelRow({ channel }: { channel: DiscordImportChannelPlan }) {
  const { t } = useTranslation(['spaces']);
  const skipped = channel.action === 'skip';
  return (
    <li className={`flex items-center gap-2 py-1 pl-6 pr-3 ${skipped ? 'opacity-50' : ''}`}>
      <Icon name={channelIconName(channel.type)} size={14} className="flex-shrink-0 text-txt-tertiary" />
      <span className="min-w-0 flex-1 truncate text-ui text-txt-primary">{channel.name}</span>
      {channel.converted && <span className="flex-shrink-0 text-meta text-txt-tertiary">{t('spaces:import.preview.converted')}</span>}
      {channel.overrides.length > 0 && (
        <span className="flex flex-shrink-0 items-center gap-1 text-meta text-txt-tertiary">
          <Icon name="lock" size={12} />
          {channel.overrides.length}
        </span>
      )}
      {skipped && <span className="flex-shrink-0 font-mono text-label text-txt-tertiary">{t('spaces:import.preview.action.skip')}</span>}
    </li>
  );
}

/**
 * Settings → Import from Discord: a server template's roles, categories and
 * channels as a new space or added to one the person manages (spaces.md,
 * "Importing a Discord template"). Four steps: the template (a link, a code or
 * a saved file), a preview of exactly what will be made and what cannot come
 * over, the import, and a report. Opened with `{ spaceId }` it imports into
 * that space; without, it makes a new one.
 */
export function DiscordImportModal() {
  const { t } = useTranslation(['spaces', 'common']);
  const navigate = useNavigate();
  const activeModal = useUIStore((s) => s.activeModal);
  const modalData = useUIStore((s) => s.modalData);
  const closeModal = useUIStore((s) => s.closeModal);
  const importDiscordTemplate = useSpaceStore((s) => s.importDiscordTemplate);
  const spaces = useSpaceStore((s) => s.spaces);
  const isOpen = activeModal === 'discordImport';
  const targetSpaceId = isOpen && typeof modalData.spaceId === 'string' ? modalData.spaceId : null;
  const targetSpace = targetSpaceId ? spaces.find((space) => space.id === targetSpaceId) : undefined;

  const [step, setStep] = useState<Step>('source');
  const [link, setLink] = useState('');
  const [source, setSource] = useState<Source | null>(null);
  const [preview, setPreview] = useState<DiscordImportPreview | null>(null);
  const [result, setResult] = useState<DiscordImportResult | null>(null);
  const [spaceName, setSpaceName] = useState('');
  const [error, setError] = useState('');
  const [loading, setLoading] = useState(false);
  const fileRef = useRef<HTMLInputElement>(null);
  // Each opening (and each reset) is a new attempt; an answer that arrives
  // for an earlier one is dropped, so a closed import never reappears.
  const attempt = useRef(0);

  const linkCode = parseDiscordTemplateCode(link);
  const client = getApiForOrigin(targetSpace?._instanceOrigin ?? '');

  const reset = () => {
    attempt.current += 1;
    setStep('source');
    setLink('');
    setSource(null);
    setPreview(null);
    setResult(null);
    setSpaceName('');
    setError('');
    setLoading(false);
  };
  const close = () => {
    if (step === 'importing') return;
    reset();
    closeModal();
  };

  // A new opening starts from the beginning, whatever the last one left.
  useEffect(() => {
    if (!isOpen) return;
    attempt.current += 1;
    setStep('source');
    setLink('');
    setSource(null);
    setPreview(null);
    setResult(null);
    setSpaceName('');
    setError('');
    setLoading(false);
  }, [isOpen, targetSpaceId]);

  const load = async (next: Source) => {
    const mine = attempt.current;
    setLoading(true);
    setError('');
    try {
      const answer = await client.import.discordPreview({ ...requestOf(next), ...(targetSpaceId ? { spaceId: targetSpaceId } : {}) });
      if (attempt.current !== mine) return;
      setSource(next);
      setPreview(answer);
      setSpaceName(answer.template.guildName);
      setStep('preview');
    } catch (err) {
      if (attempt.current !== mine) return;
      setError(describeError(err));
    } finally {
      if (attempt.current === mine) setLoading(false);
    }
  };

  const readFile = (file: File) => {
    setError('');
    if (file.size > MAX_FILE_BYTES) {
      setError(t('spaces:import.source.fileTooLarge'));
      return;
    }
    const mine = attempt.current;
    void file.text().then((text) => {
      if (attempt.current !== mine) return;
      let template: unknown;
      try {
        template = JSON.parse(text);
      } catch {
        setError(t('spaces:import.source.fileInvalid'));
        return;
      }
      void load({ kind: 'file', name: file.name, template });
    });
  };

  const runImport = async () => {
    if (!source || !preview) return;
    const request: DiscordImportApplyRequest = {
      ...requestOf(source),
      target: targetSpaceId ? { kind: 'existing', spaceId: targetSpaceId } : { kind: 'new', name: spaceName.trim() || preview.template.guildName },
    };
    const mine = attempt.current;
    setStep('importing');
    setError('');
    try {
      const done = await importDiscordTemplate(request);
      if (attempt.current !== mine) return;
      setResult(done);
      setStep('done');
    } catch (err) {
      if (attempt.current !== mine) return;
      setError(describeError(err));
      setStep('preview');
    }
  };

  const openSpace = () => {
    const id = result?.space.id;
    reset();
    closeModal();
    if (id) navigate(`/channels/${id}`);
  };

  // The categories in the order they will be listed, each with its channels.
  const tree = useMemo(() => {
    if (!preview) return [];
    const byCategory = new Map<string | null, DiscordImportChannelPlan[]>();
    for (const channel of preview.plan.channels) {
      const list = byCategory.get(channel.categoryKey) ?? [];
      list.push(channel);
      byCategory.set(channel.categoryKey, list);
    }
    const groups: Array<{ key: string | null; name: string | null; reused: boolean; locked: number; channels: DiscordImportChannelPlan[] }> = [];
    const loose = byCategory.get(null);
    if (loose && loose.length > 0) groups.push({ key: null, name: null, reused: false, locked: 0, channels: loose });
    for (const category of preview.plan.categories) {
      groups.push({ key: category.key, name: category.name, reused: category.action === 'reuse', locked: category.overrides.length, channels: byCategory.get(category.key) ?? [] });
    }
    return groups;
  }, [preview]);

  const title = targetSpace ? t('spaces:import.titleInto', { space: targetSpace.name }) : t('spaces:import.title');
  const counts = (result ?? preview)?.plan.counts;

  return (
    <Modal isOpen={isOpen} onClose={close} title={title} maxWidth="max-w-2xl" mobileStyle="fullscreen">
      <div className="flex max-h-[calc(80*var(--app-vh))] flex-col">
        <div className="min-h-0 flex-1 overflow-y-auto px-5 py-4">
          {step === 'source' && (
            <div className="space-y-5">
              <p className="text-ui text-txt-secondary">{targetSpace ? t('spaces:import.introInto') : t('spaces:import.intro')}</p>
              <form
                onSubmit={(event) => {
                  event.preventDefault();
                  if (linkCode) void load({ kind: 'code', code: linkCode });
                }}
                className="space-y-1.5"
              >
                <label htmlFor="discord-template-link" className="field-label mb-0">{t('spaces:import.source.linkLabel')}</label>
                <div className="flex gap-2">
                  <input
                    id="discord-template-link"
                    type="text"
                    value={link}
                    onChange={(event) => setLink(event.target.value)}
                    placeholder={t('spaces:import.source.linkPlaceholder')}
                    className="input-standard h-8 min-w-0 flex-1 py-0"
                    autoFocus
                    spellCheck={false}
                  />
                  <button type="submit" className="btn-primary" disabled={!linkCode || loading} aria-busy={loading}>
                    {loading ? t('spaces:import.source.loading') : t('spaces:import.source.load')}
                  </button>
                </div>
                {link.trim() !== '' && !linkCode && <p className="text-meta text-txt-danger">{t('spaces:import.source.linkInvalid')}</p>}
                <p className="text-meta text-txt-tertiary">{t('spaces:import.source.howTo')}</p>
              </form>

              <div className="flex items-center gap-3 text-meta text-txt-tertiary">
                <span className="h-px flex-1 bg-border-hard" />
                {t('spaces:import.source.or')}
                <span className="h-px flex-1 bg-border-hard" />
              </div>

              <div className="space-y-1.5">
                <input
                  ref={fileRef}
                  type="file"
                  accept="application/json,.json"
                  className="hidden"
                  onChange={(event) => {
                    const file = event.target.files?.[0];
                    if (file) readFile(file);
                    event.target.value = '';
                  }}
                />
                <button type="button" className="btn-outline" disabled={loading} onClick={() => fileRef.current?.click()}>
                  <Icon name="upload" size={15} />
                  {t('spaces:import.source.file')}
                </button>
                <p className="text-meta text-txt-tertiary">{t('spaces:import.source.fileHint')}</p>
              </div>

              <section className="rounded-lg border border-border-hard px-4 py-3">
                <h3 className="label-mono">{t('spaces:import.notTransferred.title')}</h3>
                <p className="mt-1.5 text-meta text-txt-secondary">{t('spaces:import.notTransferred.body')}</p>
              </section>
            </div>
          )}

          {(step === 'preview' || step === 'importing') && preview && (
            <div className="space-y-5">
              <header>
                <h3 className="text-lead font-semibold text-txt-primary">{preview.template.name}</h3>
                <p className="mt-0.5 text-meta text-txt-tertiary">
                  {[
                    preview.template.creatorName ? t('spaces:import.preview.by', { name: preview.template.creatorName }) : null,
                    preview.template.usageCount !== null ? t('spaces:import.preview.uses', { count: preview.template.usageCount }) : null,
                    source?.kind === 'file' ? source.name : null,
                  ].filter(Boolean).join(' · ')}
                </p>
                {preview.template.description && <p className="mt-2 text-ui text-txt-secondary">{preview.template.description}</p>}
              </header>

              {!targetSpace && (
                <label className="block">
                  <span className="field-label">{t('spaces:import.preview.spaceName')}</span>
                  <input
                    type="text"
                    value={spaceName}
                    maxLength={100}
                    onChange={(event) => setSpaceName(event.target.value)}
                    className="input-standard h-8 w-full py-0"
                    disabled={step === 'importing'}
                  />
                </label>
              )}

              {counts && (
                <div className="flex flex-wrap divide-x divide-border-hard rounded-lg border border-border-hard">
                  <Count label={t('spaces:import.preview.counts.roles')} value={counts.roles} />
                  <Count label={t('spaces:import.preview.counts.categories')} value={counts.categories} />
                  <Count label={t('spaces:import.preview.counts.channels')} value={counts.channels} />
                  <Count label={t('spaces:import.preview.counts.overrides')} value={counts.overrides} />
                  {counts.skipped > 0 && <Count label={t('spaces:import.preview.counts.skipped')} value={counts.skipped} />}
                </div>
              )}

              <section>
                <h3 className="label-mono px-1">{t('spaces:import.preview.rolesTitle')}</h3>
                <p className="mt-1 px-1 text-meta text-txt-tertiary">{t('spaces:import.preview.rolesHint')}</p>
                <ul className="mt-2 divide-y divide-border-hard rounded-lg border border-border-hard">
                  {[...preview.plan.roles].reverse().map((role) => <RoleRow key={role.key} role={role} />)}
                </ul>
              </section>

              <section>
                <h3 className="label-mono px-1">{t('spaces:import.preview.channelsTitle')}</h3>
                <div className="mt-2 rounded-lg border border-border-hard py-1.5">
                  {tree.map((group) => (
                    <div key={group.key ?? 'loose'} className="py-1">
                      <div className="flex items-center gap-2 px-3 py-1">
                        <span className="label-mono min-w-0 flex-1 truncate">{group.name ?? t('spaces:import.preview.noCategory')}</span>
                        {group.locked > 0 && (
                          <span className="flex flex-shrink-0 items-center gap-1 text-meta text-txt-tertiary">
                            <Icon name="lock" size={12} />
                            {group.locked}
                          </span>
                        )}
                        {group.reused && <span className="flex-shrink-0 font-mono text-label text-txt-tertiary">{t('spaces:import.preview.action.reuse')}</span>}
                      </div>
                      <ul>{group.channels.map((channel) => <ChannelRow key={channel.key} channel={channel} />)}</ul>
                    </div>
                  ))}
                </div>
              </section>

              {preview.plan.notes.length > 0 && (
                <section>
                  <h3 className="label-mono px-1">{t('spaces:import.preview.notesTitle')}</h3>
                  <ul className="mt-2 space-y-1 px-1">
                    {preview.plan.notes.map((note, index) => (
                      <li key={`${note.kind}-${index}`} className="flex gap-2 text-meta text-txt-secondary">
                        <Icon name="info" size={14} className="mt-0.5 flex-shrink-0 text-txt-tertiary" />
                        <span><NoteText note={note} /></span>
                      </li>
                    ))}
                  </ul>
                </section>
              )}

              <section className="rounded-lg border border-border-hard px-4 py-3">
                <h3 className="label-mono">{t('spaces:import.notTransferred.title')}</h3>
                <p className="mt-1.5 text-meta text-txt-secondary">{t('spaces:import.notTransferred.body')}</p>
              </section>
            </div>
          )}

          {step === 'done' && result && (
            <div className="space-y-5">
              <div className="flex items-center gap-3">
                <span className="flex h-9 w-9 flex-shrink-0 items-center justify-center rounded-xl border border-border-hard text-txt-positive">
                  <Icon name="check" size={18} />
                </span>
                <div className="min-w-0">
                  <h3 className="text-lead font-semibold text-txt-primary">{t('spaces:import.done.title')}</h3>
                  <p className="text-meta text-txt-secondary">{result.space.name}</p>
                </div>
              </div>
              {counts && (
                <div className="flex flex-wrap divide-x divide-border-hard rounded-lg border border-border-hard">
                  <Count label={t('spaces:import.preview.counts.roles')} value={counts.roles} />
                  <Count label={t('spaces:import.preview.counts.categories')} value={counts.categories} />
                  <Count label={t('spaces:import.preview.counts.channels')} value={counts.channels} />
                  <Count label={t('spaces:import.preview.counts.overrides')} value={counts.overrides} />
                  {counts.skipped > 0 && <Count label={t('spaces:import.preview.counts.skipped')} value={counts.skipped} />}
                </div>
              )}
              {result.plan.roles.some((role) => role.unsupported.length > 0 || role.withheld.length > 0) && (
                <section>
                  <h3 className="label-mono px-1">{t('spaces:import.done.adjustedTitle')}</h3>
                  <ul className="mt-2 divide-y divide-border-hard rounded-lg border border-border-hard">
                    {[...result.plan.roles].reverse().filter((role) => role.unsupported.length > 0 || role.withheld.length > 0).map((role) => <RoleRow key={role.key} role={role} />)}
                  </ul>
                </section>
              )}
              <section>
                <h3 className="label-mono px-1">{t('spaces:import.done.followUpTitle')}</h3>
                <ul className="mt-2 space-y-1.5 px-1 text-ui text-txt-secondary">
                  <li>{t('spaces:import.done.followUp.invite')}</li>
                  <li>{t('spaces:import.done.followUp.permissions')}</li>
                  <li>{t('spaces:import.done.followUp.bots')}</li>
                </ul>
              </section>
            </div>
          )}

          {error && <p role="alert" className="mt-4 rounded-md border border-accent-rose/30 bg-accent-rose/10 px-3 py-2 text-ui text-txt-danger">{error}</p>}
        </div>

        <div className="flex items-center justify-end gap-2 border-t border-border-hard px-5 py-3">
          {step === 'source' && <button type="button" className="btn-quiet" onClick={close}>{t('common:actions.cancel')}</button>}
          {(step === 'preview' || step === 'importing') && (
            <>
              <button type="button" className="btn-quiet" disabled={step === 'importing'} onClick={() => { setStep('source'); setError(''); }}>
                {t('common:actions.back')}
              </button>
              <button type="button" className="btn-primary" disabled={step === 'importing'} aria-busy={step === 'importing'} onClick={() => { void runImport(); }}>
                {step === 'importing' ? t('spaces:import.importing') : t('spaces:import.preview.import')}
              </button>
            </>
          )}
          {step === 'done' && (
            <>
              <button type="button" className="btn-quiet" onClick={close}>{t('common:actions.close')}</button>
              <button type="button" className="btn-primary" onClick={openSpace}>{t('spaces:import.done.open')}</button>
            </>
          )}
        </div>
      </div>
    </Modal>
  );
}
