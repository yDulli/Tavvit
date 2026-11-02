import { describe, expect, it } from 'vitest';
import { render } from '@testing-library/react';
import ReactMarkdown from 'react-markdown';
import remarkGfm from 'remark-gfm';
import { maskSpoilers, spoilerAttachmentIds, withoutSpoilers } from '@backspace/shared/src/spoilers';
import { remarkSpoilers } from './remarkSpoilers';

function rendered(markdown: string): HTMLElement {
  const { container } = render(
    <ReactMarkdown
      remarkPlugins={[remarkGfm, remarkSpoilers]}
      components={{
        span: ({ children, node }) => (node?.properties?.dataSpoiler ? <mark>{children}</mark> : <span>{children}</span>),
      }}
    >
      {markdown}
    </ReactMarkdown>,
  );
  return container;
}

const hidden = (root: HTMLElement) => [...root.querySelectorAll('mark')].map((node) => node.textContent);

describe('spoilers in a message', () => {
  it('hides what stands between two marks', () => {
    const root = rendered('the killer is ||the butler|| of course');
    expect(hidden(root)).toEqual(['the butler']);
    expect(root.textContent?.trim()).toBe('the killer is the butler of course');
  });

  it('takes formatting along', () => {
    const root = rendered('||**very** secret||');
    expect(hidden(root)).toEqual(['very secret']);
    expect(root.querySelector('mark strong')?.textContent).toBe('very');
  });

  it('works inside formatting', () => {
    const root = rendered('**||hidden||**');
    expect(root.querySelector('strong mark')?.textContent).toBe('hidden');
  });

  it('holds several in a row', () => {
    expect(hidden(rendered('||a|| and ||b||'))).toEqual(['a', 'b']);
  });

  it('leaves code alone', () => {
    const root = rendered('run `a || b` now');
    expect(hidden(root)).toEqual([]);
    expect(root.querySelector('code')?.textContent).toBe('a || b');
  });

  it('leaves a mark without a partner, and empty marks, as they were written', () => {
    const lone = rendered('a || b');
    expect(hidden(lone)).toEqual([]);
    expect(lone.textContent?.trim()).toBe('a || b');
    const empty = rendered('nothing |||| here');
    expect(hidden(empty)).toEqual([]);
    expect(empty.textContent?.trim()).toBe('nothing |||| here');
  });

  it('never reads a span somebody typed as a spoiler', () => {
    const root = rendered('<span data-spoiler="true">not hidden</span>');
    expect(hidden(root)).toEqual([]);
  });
});

describe('what other surfaces see of a spoiler', () => {
  it('shows a one-line surface the mask, never the words', () => {
    expect(maskSpoilers('it was ||the butler|| again', '[spoiler]')).toBe('it was [spoiler] again');
    expect(maskSpoilers('||one|| ||two||', '*')).toBe('* *');
    expect(maskSpoilers('||over\ntwo lines||', '*')).toBe('*');
    expect(maskSpoilers('a || b || c', '*')).toBe('a || b || c');
  });

  it('gives an embed nothing to look at', () => {
    expect(withoutSpoilers('see ||https://a.example/secret|| and https://b.example')).toBe('see   and https://b.example');
  });

  it('marks only attachments the message carries', () => {
    expect([...spoilerAttachmentIds(['a', 'x', 7], ['a', 'b'])]).toEqual(['a']);
    expect([...spoilerAttachmentIds('a', ['a'])]).toEqual([]);
    expect([...spoilerAttachmentIds(undefined, ['a'])]).toEqual([]);
  });
});
