import React, { useState, useEffect, useRef, useCallback } from 'react';
import { useTranslation, Trans } from 'react-i18next';
import type { TFunction } from 'i18next';
import { useKeybindStore, BINDABLE_ACTIONS, Keybind } from '../../../stores/keybindStore';
import { isElectron, isElectronMac } from '../../../platform/platform';
import { codeToNumeric, shortcutTypesText } from '../../../utils/keybindKeys';
import { useKeybindPortalStatus } from '../../../hooks/useKeybindPortalStatus';
import { SettingsPage, SettingsSection } from './_shared/SettingsControls';

// ---------------------------------------------------------------------------
// Constants
// ---------------------------------------------------------------------------

const MODIFIER_CODES = new Set([
  'ShiftLeft', 'ShiftRight', 'ControlLeft', 'ControlRight',
  'AltLeft', 'AltRight', 'MetaLeft', 'MetaRight',
]);

const MOUSE_BUTTON_MAP: Record<number, number> = { 1: 3, 3: 4, 4: 5 };

type SettingsT = TFunction<['settings', 'common']>;

/**
 * The name a mouse button is shown under. The label is composed while the
 * user records the combo and stored with the keybind, so it is in the
 * language that was active at recording time.
 */
function mouseButtonName(t: SettingsT, button: number): string {
  switch (button) {
    case 3: return t('keybinds.key.middleClick');
    case 4: return t('keybinds.key.mouse4');
    case 5: return t('keybinds.key.mouse5');
    default: return t('keybinds.key.mouseGeneric', { button });
  }
}

function keyDisplayName(t: SettingsT, code: string, key: string): string {
  if (code.startsWith('Shift')) return t('keybinds.key.shift');
  if (code.startsWith('Control')) return t('keybinds.key.ctrl');
  if (code.startsWith('Alt')) return isElectronMac() ? t('keybinds.key.option') : t('keybinds.key.alt');
  if (code.startsWith('Meta')) return isElectronMac() ? t('keybinds.key.cmd') : t('keybinds.key.win');
  if (code.startsWith('Key')) return code.slice(3).toUpperCase();
  if (code.startsWith('Digit')) return code.slice(5);
  if (key === ' ') return t('keybinds.key.space');
  return key.length === 1 ? key.toUpperCase() : key;
}

// ---------------------------------------------------------------------------
// Keybind Row
// ---------------------------------------------------------------------------

interface KeybindRowProps {
  label: string;
  keybind: Keybind | undefined;
  isRecording: boolean;
  recordingDisplay: string;
  onStartRecording: () => void;
  onDelete: () => void;
  rowRef: React.RefObject<HTMLDivElement>;
}

function KeybindRow({ label, keybind, isRecording, recordingDisplay, onStartRecording, onDelete, rowRef }: KeybindRowProps) {
  const { t } = useTranslation(['settings', 'common']);
  return (
    <div
      ref={rowRef}
      className={`flex items-center gap-3 px-4 py-2.5 transition-colors ${
        isRecording ? 'bg-interactive-selected shadow-[inset_2px_0_0_rgb(var(--accent-primary))]' : ''
      }`}
    >
      <div className="min-w-0 flex-1">
        <div className="text-ui font-medium text-txt-primary">{label}</div>
        <div className="mt-1 flex min-h-[18px] flex-wrap items-center gap-1 text-meta text-txt-tertiary">
          {isRecording ? (
            <span className="animate-pulse text-accent-soft">
              {recordingDisplay || t('keybinds.row.recordingPrompt')}
            </span>
          ) : keybind ? (
            keybind.displayLabel.split(' + ').map((key, index) => <kbd key={`${key}-${index}`} className="kbd">{key}</kbd>)
          ) : (
            t('keybinds.row.notBound')
          )}
        </div>
      </div>
      <div className="flex flex-shrink-0 items-center gap-1">
        {!isRecording && (
          <>
            <button
              type="button"
              onClick={onStartRecording}
              className={`btn-sm ${keybind ? 'btn-quiet' : 'btn-outline'}`}
            >
              {keybind ? t('common:actions.edit') : t('keybinds.row.record')}
            </button>
            {keybind && (
              <button
                type="button"
                onClick={onDelete}
                className="btn-quiet btn-sm hover:bg-accent-rose/10 hover:text-txt-danger"
              >
                {t('common:actions.delete')}
              </button>
            )}
          </>
        )}
        {isRecording && (
          <span className="text-meta text-txt-tertiary">{t('keybinds.row.escToCancel')}</span>
        )}
      </div>
    </div>
  );
}

// ---------------------------------------------------------------------------
// Conflict Dialog (inline)
// ---------------------------------------------------------------------------

interface ConflictInfo {
  newActionId: string;
  existingKeybind: Keybind;
  pendingKeybind: Keybind;
}

// ---------------------------------------------------------------------------
// KeybindsPanel
// ---------------------------------------------------------------------------

export function KeybindsPanel() {
  const { t } = useTranslation(['settings', 'common']);
  const { keybinds, setKeybind, removeKeybind, findConflict } = useKeybindStore();
  const portal = useKeybindPortalStatus();
  useEffect(() => {
    // Only opening this panel initiates first-time registration. A cancelled
    // request becomes unavailable and requires an explicit retry, not a loop.
    if (portal?.state === 'idle') window.backspace?.retryKeybindPortal?.();
  }, [portal?.state]);

  const [recordingActionId, setRecordingActionId] = useState<string | null>(null);
  const [recordingDisplay, setRecordingDisplay] = useState('');
  const [conflict, setConflict] = useState<ConflictInfo | null>(null);

  const [accessibilityTrusted, setAccessibilityTrusted] = useState<boolean | null>(null);
  const [hookError, setHookError] = useState<string | null>(null);
  // A shortcut the desktop app refused to listen for because it types text on its own.
  const [typingRefused, setTypingRefused] = useState(false);

  const pressedCodesRef = useRef(new Map<string, { numeric: number; display: string }>());
  const mouseButtonRef = useRef<number | null>(null);
  const mouseDisplayRef = useRef<string | null>(null);
  const debounceTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  const rowRefs = useRef<Record<string, React.RefObject<HTMLDivElement>>>({});

  for (const action of BINDABLE_ACTIONS) {
    if (!rowRefs.current[action.id]) {
      rowRefs.current[action.id] = React.createRef();
    }
  }

  // --- Platform checks on mount ---
  useEffect(() => {
    if (isElectronMac() && window.backspace?.checkAccessibility) {
      window.backspace.checkAccessibility().then(setAccessibilityTrusted);
    }
    if (isElectron() && window.backspace?.onAccessibilityStatus) {
      const cleanup = window.backspace.onAccessibilityStatus((status) => {
        setAccessibilityTrusted(status.trusted);
      });
      return cleanup;
    }
  }, []);

  useEffect(() => {
    if (isElectron() && window.backspace?.onKeybindHookError) {
      const cleanup = window.backspace.onKeybindHookError((error) => {
        setHookError(error.message);
      });
      return cleanup;
    }
  }, []);

  // --- Recording logic ---
  const cancelRecording = useCallback(() => {
    setRecordingActionId(null);
    setRecordingDisplay('');
    pressedCodesRef.current.clear();
    mouseButtonRef.current = null;
    mouseDisplayRef.current = null;
    if (debounceTimerRef.current) {
      clearTimeout(debounceTimerRef.current);
      debounceTimerRef.current = null;
    }
  }, []);

  const finalizeRecording = useCallback((actionId: string) => {
    const codes = pressedCodesRef.current;
    const mouseBtn = mouseButtonRef.current;

    const keys = Array.from(codes.values()).map((c) => c.numeric).sort((a, b) => a - b);
    const displayParts = Array.from(codes.values()).map((c) => c.display);
    if (mouseBtn) {
      displayParts.push(mouseButtonName(t, mouseBtn));
    }
    const displayLabel = displayParts.join(' + ');

    const hasNonModifier = Array.from(codes.keys()).some((code) => !MODIFIER_CODES.has(code));
    if (!hasNonModifier && !mouseBtn) {
      return;
    }

    // The desktop app's hook hears the whole computer, so it does not listen for keys that type
    // text on their own (desktop/src/keybindPolicy.ts). Say so instead of saving a dead shortcut.
    if (isElectron() && shortcutTypesText(keys, mouseBtn ?? undefined)) {
      setTypingRefused(true);
      cancelRecording();
      return;
    }
    setTypingRefused(false);

    const newKeybind: Keybind = { actionId, keys, mouseButton: mouseBtn ?? undefined, displayLabel };

    const existing = findConflict(keys, mouseBtn ?? undefined, actionId);
    if (existing) {
      setConflict({ newActionId: actionId, existingKeybind: existing, pendingKeybind: newKeybind });
      cancelRecording();
      return;
    }

    setKeybind(newKeybind);
    cancelRecording();
  }, [findConflict, setKeybind, cancelRecording, t]);

  // --- Recording event listeners ---
  useEffect(() => {
    if (portal || !recordingActionId) return;

    function onKeyDown(e: KeyboardEvent) {
      e.preventDefault();
      e.stopPropagation();

      if (e.code === 'Escape') {
        cancelRecording();
        return;
      }

      if (debounceTimerRef.current) {
        clearTimeout(debounceTimerRef.current);
        debounceTimerRef.current = null;
      }

      const display = keyDisplayName(t, e.code, e.key);
      const numeric = codeToNumeric(e.code);
      pressedCodesRef.current.set(e.code, { numeric, display });

      const parts = Array.from(pressedCodesRef.current.values()).map((c) => c.display);
      if (mouseDisplayRef.current) parts.push(mouseDisplayRef.current);
      setRecordingDisplay(parts.join(' + '));
    }

    function onKeyUp(e: KeyboardEvent) {
      e.preventDefault();
      e.stopPropagation();

      if (debounceTimerRef.current) clearTimeout(debounceTimerRef.current);
      debounceTimerRef.current = setTimeout(() => {
        if (recordingActionId) finalizeRecording(recordingActionId);
      }, 300);
    }

    function onMouseDown(e: MouseEvent) {
      const rowRef = rowRefs.current[recordingActionId!];
      if (rowRef?.current && !rowRef.current.contains(e.target as Node)) {
        cancelRecording();
        return;
      }

      const uiButton = MOUSE_BUTTON_MAP[e.button];
      if (!uiButton) return;

      e.preventDefault();
      e.stopPropagation();

      mouseButtonRef.current = uiButton;
      mouseDisplayRef.current = mouseButtonName(t, uiButton);

      const parts = Array.from(pressedCodesRef.current.values()).map((c) => c.display);
      parts.push(mouseDisplayRef.current);
      setRecordingDisplay(parts.join(' + '));

      finalizeRecording(recordingActionId!);
    }

    window.addEventListener('keydown', onKeyDown, true);
    window.addEventListener('keyup', onKeyUp, true);
    window.addEventListener('mousedown', onMouseDown, true);

    return () => {
      window.removeEventListener('keydown', onKeyDown, true);
      window.removeEventListener('keyup', onKeyUp, true);
      window.removeEventListener('mousedown', onMouseDown, true);
      if (debounceTimerRef.current) clearTimeout(debounceTimerRef.current);
    };
  }, [recordingActionId, cancelRecording, finalizeRecording, t, portal]);

  // --- Conflict resolution ---
  const confirmConflict = () => {
    if (!conflict) return;
    removeKeybind(conflict.existingKeybind.actionId);
    setKeybind(conflict.pendingKeybind);
    setConflict(null);
  };

  const cancelConflict = () => setConflict(null);

  const getKeybind = (actionId: string) => keybinds.find((kb) => kb.actionId === actionId);

  const conflictAction = conflict
    ? BINDABLE_ACTIONS.find((a) => a.id === conflict.existingKeybind.actionId)
    : undefined;
  const conflictActionLabel = conflictAction ? t(`keybinds.action.${conflictAction.id}`) : '';

  if (portal) {
    return (
      <SettingsPage title={t('keybinds.title')}>
        <div className="surface-card rounded-lg p-4 text-ui leading-relaxed text-txt-secondary" role="status">
          <p>{t('keybinds.portal.description')}</p>
          <p className="mt-2">{t(`keybinds.portal.${portal.state}`)}</p>
          {portal.state === 'unavailable' && (
            <button type="button" onClick={() => window.backspace?.retryKeybindPortal?.()} className="btn-outline btn-sm mt-3">
              {t('keybinds.portal.retry')}
            </button>
          )}
        </div>
        <dl className="surface-card divide-y divide-border-hard rounded-lg">
          {BINDABLE_ACTIONS.map((action) => (
            <div key={action.id} className="px-4 py-2.5">
              <dt className="text-ui font-medium text-txt-primary">{t(`keybinds.action.${action.id}`)}</dt>
              <dd className="mt-0.5 text-meta text-txt-tertiary">
                {portal.shortcuts[action.id]
                  ? t('keybinds.portal.assigned', { shortcut: portal.shortcuts[action.id] })
                  : t('keybinds.portal.notAssigned')}
              </dd>
            </div>
          ))}
        </dl>
      </SettingsPage>
    );
  }

  return (
    <SettingsPage title={t('keybinds.title')}>
      {/* macOS Accessibility Warning */}
      {isElectronMac() && accessibilityTrusted === false && (
        <div className="rounded-lg border border-accent-amber/25 bg-accent-amber/10 px-3.5 py-3">
          <div className="text-ui font-medium text-txt-primary">{t('keybinds.accessibility.title')}</div>
          <div className="mt-1 text-meta leading-snug text-txt-secondary">
            {t('keybinds.accessibility.description')}
          </div>
          <button
            type="button"
            onClick={() => {
              window.backspace?.checkAccessibility().then(setAccessibilityTrusted);
            }}
            className="btn-outline btn-sm mt-2.5"
          >
            {t('keybinds.accessibility.grant')}
          </button>
        </div>
      )}

      {/* Linux hook error warning */}
      {isElectron() && hookError && (
        <div className="rounded-lg border border-accent-amber/25 bg-accent-amber/10 px-3.5 py-3">
          <div className="text-ui font-medium text-txt-primary">{t('keybinds.hookError.title')}</div>
          <div className="mt-1 text-meta leading-snug text-txt-secondary">
            <Trans
              t={t}
              i18nKey="keybinds.hookError.description"
              components={{ code: <code className="rounded bg-black/20 px-1 font-mono" /> }}
            />
          </div>
        </div>
      )}

      {/* A shortcut that types text on its own: refused just now, or kept from before the rule. */}
      {isElectron() && (typingRefused || BINDABLE_ACTIONS.some((action) => {
        const kb = getKeybind(action.id);
        return kb !== undefined && shortcutTypesText(kb.keys, kb.mouseButton);
      })) && (
        <div role="status" className="rounded-lg border border-accent-amber/25 bg-accent-amber/10 px-3.5 py-3">
          <div className="text-ui font-medium text-txt-primary">{t('keybinds.typingKey.title')}</div>
          <div className="mt-1 text-meta leading-snug text-txt-secondary">{t('keybinds.typingKey.description')}</div>
        </div>
      )}

      {/* Keybind rows; in a browser the line above them says how far they reach. */}
      <SettingsSection
        title={t('keybinds.section.voice')}
        description={isElectron() ? undefined : t('keybinds.note.webOnly')}
        flush
      >
        <div className="divide-y divide-border-hard">
          {BINDABLE_ACTIONS.map((action) => (
            <KeybindRow
              key={action.id}
              label={t(`keybinds.action.${action.id}`)}
              keybind={getKeybind(action.id)}
              isRecording={recordingActionId === action.id}
              recordingDisplay={recordingDisplay}
              onStartRecording={() => {
                cancelRecording();
                setRecordingActionId(action.id);
              }}
              onDelete={() => removeKeybind(action.id)}
              rowRef={rowRefs.current[action.id]!}
            />
          ))}
        </div>
      </SettingsSection>

      {/* Conflict dialog */}
      {conflict && (
        <div role="alert" className="surface-card rounded-lg p-4">
          <div className="text-ui leading-relaxed text-txt-primary">
            <Trans
              t={t}
              i18nKey="keybinds.conflict.message"
              values={{
                combo: conflict.pendingKeybind.displayLabel,
                action: conflictActionLabel,
              }}
              components={{ strong: <span className="font-medium" /> }}
            />
          </div>
          <div className="mt-3 flex justify-end gap-2">
            <button type="button" onClick={cancelConflict} className="btn-quiet btn-sm">
              {t('common:actions.cancel')}
            </button>
            <button type="button" onClick={confirmConflict} className="btn-primary btn-sm">
              {t('keybinds.conflict.overwrite')}
            </button>
          </div>
        </div>
      )}
    </SettingsPage>
  );
}
