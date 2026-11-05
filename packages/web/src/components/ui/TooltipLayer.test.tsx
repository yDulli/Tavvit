import { readdirSync, readFileSync } from 'node:fs';
import { dirname, join, relative, sep } from 'node:path';
import { fileURLToPath } from 'node:url';
import { act, cleanup, fireEvent, render, screen } from '@testing-library/react';
import ts from 'typescript';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { useUIStore } from '../../stores/uiStore';
import { Tooltip } from './Tooltip';
import { TOOLTIP_DELAY_MS, TooltipLayer } from './TooltipLayer';

/** A pointer event as a browser sends it; jsdom has no PointerEvent of its own. */
function point(target: Element, type: 'pointerover' | 'pointerout', pointerType = 'mouse', relatedTarget: Element | null = document.body) {
  const event = new MouseEvent(type, { bubbles: true, relatedTarget });
  Object.defineProperty(event, 'pointerType', { value: pointerType });
  act(() => { target.dispatchEvent(event); });
}

describe('TooltipLayer', () => {
  beforeEach(() => {
    vi.useFakeTimers();
    useUIStore.setState({ isMobile: false });
  });
  afterEach(() => {
    cleanup();
    vi.useRealTimers();
  });

  function renderControls() {
    render(
      <>
        <TooltipLayer />
        <button type="button" className="icon-btn" aria-label="Mute"><svg aria-hidden="true" /></button>
        <button type="button" className="icon-btn" aria-label="Open settings">Settings</button>
        <button type="button" data-tooltip="" aria-label="React with 👍">👍</button>
        <Tooltip content="On another server"><button type="button" className="icon-btn" aria-label="Globe" /></Tooltip>
        <p>Elsewhere</p>
      </>,
    );
  }

  it('names an icon-only control after a short rest of the mouse, and lets go when it leaves', () => {
    renderControls();
    point(screen.getByRole('button', { name: 'Mute' }), 'pointerover');
    expect(screen.queryByRole('tooltip')).toBeNull();
    act(() => { vi.advanceTimersByTime(TOOLTIP_DELAY_MS); });
    expect(screen.getByRole('tooltip')).toHaveTextContent('Mute');
    point(screen.getByText('Elsewhere'), 'pointerover');
    expect(screen.queryByRole('tooltip')).toBeNull();
  });

  it('names an emoji tagged for it, never answers a touch, and leaves a control with words alone', () => {
    renderControls();
    point(screen.getByRole('button', { name: 'React with 👍' }), 'pointerover');
    act(() => { vi.advanceTimersByTime(TOOLTIP_DELAY_MS); });
    expect(screen.getByRole('tooltip')).toHaveTextContent('React with 👍');
    point(screen.getByText('Elsewhere'), 'pointerover');

    point(screen.getByRole('button', { name: 'Mute' }), 'pointerover', 'touch');
    act(() => { vi.advanceTimersByTime(TOOLTIP_DELAY_MS * 2); });
    expect(screen.queryByRole('tooltip')).toBeNull();

    point(screen.getByRole('button', { name: 'Open settings' }), 'pointerover');
    act(() => { vi.advanceTimersByTime(TOOLTIP_DELAY_MS * 2); });
    expect(screen.queryByRole('tooltip')).toBeNull();
  });

  it('hides on Escape and stays quiet until the pointer has left, and doubles no Tooltip of its own', () => {
    renderControls();
    const mute = screen.getByRole('button', { name: 'Mute' });
    point(mute, 'pointerover');
    act(() => { vi.advanceTimersByTime(TOOLTIP_DELAY_MS); });
    fireEvent.keyDown(document.body, { key: 'Escape' });
    expect(screen.queryByRole('tooltip')).toBeNull();
    point(mute.firstElementChild!, 'pointerover');
    act(() => { vi.advanceTimersByTime(TOOLTIP_DELAY_MS * 2); });
    expect(screen.queryByRole('tooltip')).toBeNull();

    point(screen.getByRole('button', { name: 'Globe' }), 'pointerover');
    act(() => { vi.advanceTimersByTime(TOOLTIP_DELAY_MS * 2); });
    expect(screen.queryByRole('tooltip')).toBeNull();
  });

  it('shows nothing on a phone', () => {
    useUIStore.setState({ isMobile: true });
    renderControls();
    point(screen.getByRole('button', { name: 'Mute' }), 'pointerover');
    act(() => { vi.advanceTimersByTime(TOOLTIP_DELAY_MS * 2); });
    expect(screen.queryByRole('tooltip')).toBeNull();
  });
});

/**
 * The rule the layer rests on, held in the source: an icon-only control (an `.icon-btn`, or one with
 * `data-tooltip`) names itself in `aria-label` (or `aria-labelledby`, or the tooltip's own words) and
 * carries no native `title`, which would show a second, late tooltip in the system's look.
 */
describe('icon-only controls', () => {
  const src = join(dirname(fileURLToPath(import.meta.url)), '..', '..');
  const files = (dir: string): string[] => readdirSync(dir, { withFileTypes: true }).flatMap((entry) => {
    const full = join(dir, entry.name);
    if (entry.isDirectory()) return entry.name === 'landing' ? [] : files(full);
    return /\.tsx$/.test(entry.name) && !/\.test\.tsx$/.test(entry.name) ? [full] : [];
  });
  const ICON_BTN = /(^|[\s'"`{(])icon-btn(?![-\w])/;

  it('name themselves for the tooltip and carry no title', () => {
    const problems: string[] = [];
    for (const file of files(src)) {
      const source = ts.createSourceFile(file, readFileSync(file, 'utf8'), ts.ScriptTarget.Latest, true, ts.ScriptKind.TSX);
      const visit = (node: ts.Node) => {
        if (ts.isJsxOpeningElement(node) || ts.isJsxSelfClosingElement(node)) {
          const attr = (name: string) => node.attributes.properties.find((p): p is ts.JsxAttribute => ts.isJsxAttribute(p) && p.name.getText(source) === name);
          const value = (name: string) => attr(name)?.initializer?.getText(source) ?? '';
          const tooltip = attr('data-tooltip');
          if (ICON_BTN.test(value('className')) || (tooltip && value('data-tooltip') !== '"off"')) {
            const where = `${relative(src, file).split(sep).join('/')}:${source.getLineAndCharacterOfPosition(node.getStart(source)).line + 1}`;
            if (attr('title')) problems.push(`${where} has a title`);
            const named = attr('aria-label') || attr('aria-labelledby') || (tooltip && !['""', '"off"'].includes(value('data-tooltip')));
            if (!named) problems.push(`${where} has no name`);
          }
        }
        ts.forEachChild(node, visit);
      };
      visit(source);
    }
    expect(problems).toEqual([]);
  });
});
