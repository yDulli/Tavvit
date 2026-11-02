import { useId, useMemo, useState, type FormEvent } from 'react';
import { useTranslation } from 'react-i18next';
import type { BotCommandOption, ChannelCommand, CommandOptionValue } from '@backspace/shared/src/bots';
import { useSpaceStore } from '../../stores/spaceStore';

type Filled = Record<string, string | boolean>;

/** What was filled in, as the server wants it: nothing for an empty field, and a number as a number. */
export function commandValues(options: readonly BotCommandOption[], filled: Filled): Record<string, CommandOptionValue> {
  const values: Record<string, CommandOptionValue> = {};
  for (const option of options) {
    const value = filled[option.name];
    if (value === undefined || value === '') continue;
    if (option.type === 'boolean') values[option.name] = value === true;
    else if (option.type === 'number') values[option.name] = Number(value);
    else values[option.name] = String(value);
  }
  return values;
}

/** What is still missing or cannot be sent: the server checks all of it again. */
function isComplete(options: readonly BotCommandOption[], filled: Filled): boolean {
  return options.every((option) => {
    const value = filled[option.name];
    if (option.type === 'number' && value !== undefined && value !== '' && !Number.isFinite(Number(value))) return false;
    if (!option.required) return true;
    return option.type === 'boolean' ? value !== undefined : value !== undefined && value !== '';
  });
}

function OptionField({ option, id, value, onChange }: {
  option: BotCommandOption;
  id: string;
  value: string | boolean | undefined;
  onChange: (next: string | boolean) => void;
}) {
  const { t } = useTranslation(['chat']);
  const members = useSpaceStore((state) => state.members);
  const channels = useSpaceStore((state) => state.channels);
  const roles = useSpaceStore((state) => state.roles);
  const currentSpaceId = useSpaceStore((state) => state.currentSpaceId);

  const choices = useMemo((): Array<{ value: string; label: string }> | null => {
    if (option.choices) return option.choices.map((choice) => ({ value: choice, label: choice }));
    if (option.type === 'person') {
      return members
        .map((member) => ({ value: member.userId, label: member.nickname || member.user.displayName || member.user.username }))
        .sort((a, b) => a.label.localeCompare(b.label));
    }
    if (option.type === 'channel') return channels.map((channel) => ({ value: channel.id, label: `#${channel.name}` }));
    // The role of everyone has the space's id: asking for it would say nothing.
    if (option.type === 'role') return roles.filter((role) => role.id !== currentSpaceId).map((role) => ({ value: role.id, label: role.name }));
    return null;
  }, [option, members, channels, roles, currentSpaceId]);

  if (option.type === 'boolean') {
    return (
      <label htmlFor={id} className="flex cursor-pointer items-center gap-2 text-ui text-txt-primary">
        <input id={id} type="checkbox" checked={value === true} onChange={(e) => onChange(e.target.checked)} />
        <span className="min-w-0">{option.name}<span className="ml-2 text-meta text-txt-tertiary">{option.description}</span></span>
      </label>
    );
  }

  return (
    <div>
      <label htmlFor={id} className="field-label">
        {option.name}
        {option.required && <span className="ml-1 text-txt-tertiary">{t('chat:commands.required')}</span>}
      </label>
      {choices ? (
        <select id={id} value={typeof value === 'string' ? value : ''} onChange={(e) => onChange(e.target.value)} className="input-standard w-full">
          <option value="">{t('chat:commands.pick')}</option>
          {choices.map((choice) => <option key={choice.value} value={choice.value}>{choice.label}</option>)}
        </select>
      ) : (
        <input
          id={id}
          type={option.type === 'number' ? 'number' : 'text'}
          value={typeof value === 'string' ? value : ''}
          onChange={(e) => onChange(e.target.value)}
          className="input-standard w-full"
        />
      )}
      <p className="mt-1 text-label text-txt-tertiary">{option.description}</p>
    </div>
  );
}

/** Above the composer once someone picks a command that asks for things. */
export function CommandOptionsForm({ command, busy, onSubmit, onCancel }: {
  command: ChannelCommand;
  busy: boolean;
  onSubmit: (values: Record<string, CommandOptionValue>) => void;
  onCancel: () => void;
}) {
  const { t } = useTranslation(['chat', 'common']);
  const baseId = useId();
  const options = useMemo(() => command.options ?? [], [command]);
  const [filled, setFilled] = useState<Filled>({});

  const send = (event: FormEvent) => {
    event.preventDefault();
    if (!busy && isComplete(options, filled)) onSubmit(commandValues(options, filled));
  };

  return (
    <form
      onSubmit={send}
      onKeyDown={(event) => {
        if (event.key === 'Escape') {
          event.stopPropagation();
          onCancel();
        }
      }}
      className="glass absolute bottom-full left-0 z-30 mb-2 flex max-h-[calc(60*var(--app-vh))] w-full max-w-md flex-col gap-3 overflow-y-auto rounded-lg p-3"
    >
      <div className="flex items-baseline gap-2">
        <span className="truncate font-mono text-meta text-txt-primary">/{command.name}</span>
        <span className="ml-auto flex-shrink-0 text-label text-txt-tertiary">{command.botName}</span>
      </div>
      {options.map((option) => (
        <OptionField
          key={option.name}
          option={option}
          id={`${baseId}-${option.name}`}
          value={filled[option.name]}
          onChange={(next) => setFilled((current) => ({ ...current, [option.name]: next }))}
        />
      ))}
      <div className="flex justify-end gap-2">
        <button type="button" onClick={onCancel} className="btn-quiet btn-sm">{t('common:actions.cancel')}</button>
        <button type="submit" disabled={busy || !isComplete(options, filled)} aria-busy={busy} className="btn-primary btn-sm">{t('chat:commands.send')}</button>
      </div>
    </form>
  );
}
