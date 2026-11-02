import { afterEach, describe, expect, it } from 'vitest';
import { cleanup, render, waitFor } from '@testing-library/react';
import { SlidingMark } from './SlidingMark';

function List({ active }: { active: 'a' | 'b' | null }) {
  return (
    <div data-testid="list" className="sliding-list">
      <SlidingMark variant="row" />
      <button type="button" data-testid="a" className="nav-item" data-active={active === 'a' ? 'true' : undefined}>A</button>
      <button type="button" data-testid="b" className="nav-item" data-active={active === 'b' ? 'true' : undefined}>B</button>
    </div>
  );
}

const offsetDescriptors = ['offsetParent', 'offsetLeft', 'offsetTop', 'offsetWidth', 'offsetHeight'] as const;
const original = offsetDescriptors.map((name) => [name, Object.getOwnPropertyDescriptor(HTMLElement.prototype, name)] as const);

/** jsdom lays nothing out, so each row is told the place a browser would measure for it. */
function layOut(): void {
  Object.defineProperties(HTMLElement.prototype, {
    offsetParent: { configurable: true, get(this: HTMLElement) { return this.dataset.testid === 'list' ? null : this.closest('[data-testid="list"]'); } },
    offsetLeft: { configurable: true, get: () => 8 },
    offsetTop: { configurable: true, get(this: HTMLElement) { return this.dataset.testid === 'b' ? 40 : 4; } },
    offsetWidth: { configurable: true, get: () => 200 },
    offsetHeight: { configurable: true, get: () => 32 },
  });
}

afterEach(() => {
  cleanup();
  for (const [name, descriptor] of original) {
    if (descriptor) Object.defineProperty(HTMLElement.prototype, name, descriptor);
    else delete (HTMLElement.prototype as unknown as Record<string, unknown>)[name];
  }
});

describe('the mark of a list', () => {
  it('finds the active row, takes its place and size, and takes over its highlight', () => {
    layOut();
    const { getByTestId, container } = render(<List active="a" />);
    const mark = container.querySelector<HTMLElement>('[data-sliding-mark]')!;
    expect(mark.getAttribute('aria-hidden')).toBe('true');
    expect(mark.style.transform).toBe('translate3d(8px, 4px, 0)');
    expect(mark.style.width).toBe('200px');
    expect(mark.style.height).toBe('32px');
    expect(mark.dataset.on).toBe('true');
    expect(getByTestId('list').dataset.marked).toBe('true');
  });

  it('goes where the active row goes', async () => {
    layOut();
    const { rerender, container } = render(<List active="a" />);
    rerender(<List active="b" />);
    const mark = container.querySelector<HTMLElement>('[data-sliding-mark]')!;
    await waitFor(() => expect(mark.style.transform).toBe('translate3d(8px, 40px, 0)'));
  });

  it('steps aside when nothing is active, and the list looks as it always does', async () => {
    layOut();
    const { rerender, getByTestId, container } = render(<List active="a" />);
    rerender(<List active={null} />);
    const mark = container.querySelector<HTMLElement>('[data-sliding-mark]')!;
    await waitFor(() => expect(mark.dataset.on).toBe('false'));
    expect(getByTestId('list').dataset.marked).toBeUndefined();
  });

  it('has no place in a list that is not laid out, such as a hidden panel', () => {
    const { getByTestId, container } = render(<List active="a" />);
    expect(container.querySelector<HTMLElement>('[data-sliding-mark]')!.dataset.on).toBe('false');
    expect(getByTestId('list').dataset.marked).toBeUndefined();
  });

  it('lets the list go when it leaves', () => {
    layOut();
    const { unmount, getByTestId } = render(<List active="a" />);
    const list = getByTestId('list');
    unmount();
    expect(list.dataset.marked).toBeUndefined();
  });
});
