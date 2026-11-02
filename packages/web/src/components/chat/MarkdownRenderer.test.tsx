import { describe, it, expect, vi } from 'vitest';
import { render } from '@testing-library/react';
import { MarkdownRenderer } from './MarkdownRenderer';

// MentionBadge reads the space and UI stores at render time. Only the mention
// case touches them; stub them so the rest of the file needs no app state.
vi.mock('../../stores/spaceStore', () => ({
  useSpaceStore: (selector: (s: unknown) => unknown) =>
    selector({
      members: [],
      spaces: [],
      currentSpaceId: null,
      userViews: new Map(),
      dmChannels: [],
      dmAlternatives: new Map(),
      channelToSpaceMap: new Map(),
      channelOriginMap: new Map(),
    }),
  getApiForOrigin: vi.fn(),
  getMyUserIdForOrigin: vi.fn(),
}));
vi.mock('../../stores/authStore', () => ({
  useAuthStore: (selector: (s: unknown) => unknown) => selector({ user: null }),
}));
vi.mock('../../stores/uiStore', () => ({
  useUIStore: (selector: (s: unknown) => unknown) =>
    selector({ openUserProfile: vi.fn() }),
}));
vi.mock('../../api/client', () => ({
  api: {},
  createApiClient: vi.fn(),
}));

// One message exercising every block the renderer overrides: inline code, a
// link, a blockquote, a GFM table, a highlighted fence and a bare fence.
const MIXED = [
  'Here is `inline code` and a [link](https://example.com).',
  '',
  '> a quoted line',
  '',
  '| Col A | Col B |',
  '| ----- | ----- |',
  '| a1 | b1 |',
  '',
  '```js',
  'const answer = 42;',
  '```',
  '',
  '```',
  'plain fenced text',
  '```',
].join('\n');

describe('MarkdownRenderer', () => {
  it('renders every element of a mixed markdown message', () => {
    const { container } = render(<MarkdownRenderer content={MIXED} />);

    // Link: the `a` override, reached through urlTransform.
    const link = container.querySelector('a[href="https://example.com"]');
    expect(link).not.toBeNull();
    expect(link!.textContent).toBe('link');
    expect(link!.getAttribute('target')).toBe('_blank');
    expect(link!.getAttribute('rel')).toBe('noopener noreferrer');

    // Inline code: a <code> that is not inside a <pre>.
    const inlineCodes = Array.from(container.querySelectorAll('code')).filter(
      (el) => el.closest('pre') === null,
    );
    expect(inlineCodes.map((el) => el.textContent)).toEqual(['inline code']);

    // Blockquote.
    const quote = container.querySelector('blockquote');
    expect(quote).not.toBeNull();
    expect(quote!.textContent).toContain('a quoted line');

    // GFM table: remark-gfm plus the table/thead/tbody/tr/th/td overrides.
    const table = container.querySelector('table');
    expect(table).not.toBeNull();
    expect(Array.from(table!.querySelectorAll('th')).map((el) => el.textContent))
      .toEqual(['Col A', 'Col B']);
    expect(Array.from(table!.querySelectorAll('td')).map((el) => el.textContent))
      .toEqual(['a1', 'b1']);

    // Two fenced blocks, each its own <pre>.
    const pres = Array.from(container.querySelectorAll('pre'));
    expect(pres).toHaveLength(2);

    // Highlighted fence: prism-react-renderer emits token spans, no <code>.
    const [highlighted, bare] = pres as [HTMLElement, HTMLElement];
    expect(highlighted.textContent).toBe('const answer = 42;');
    expect(highlighted.querySelectorAll('span').length).toBeGreaterThan(1);

    // Bare fence: the remark plugin tags it `language-text`, which renders a
    // plain <code> inside the <pre> with no highlighting.
    const bareCode = bare.querySelector('code');
    expect(bareCode).not.toBeNull();
    expect(bareCode!.textContent).toBe('plain fenced text');
    expect(bareCode!.querySelector('span')).toBeNull();
  });

  it('renders emphasis, strikethrough and headings through the overrides', () => {
    const { container } = render(
      <MarkdownRenderer content={'# Title\n\n**bold** _italic_ ~~struck~~'} />,
    );

    expect(container.querySelector('strong')!.textContent).toBe('bold');
    expect(container.querySelector('em')!.textContent).toBe('italic');
    expect(container.querySelector('del')!.textContent).toBe('struck');
    // h1 is overridden to a div, so no heading element may appear.
    expect(container.querySelector('h1')).toBeNull();
    expect(container.textContent).toContain('Title');
  });

  it('turns a mention token into a badge rather than a link', () => {
    const { container } = render(<MarkdownRenderer content={'hi <@U1> there'} />);

    expect(container.querySelector('a')).toBeNull();
    expect(container.textContent).toContain('@Unknown User');
  });

  it('leaves mention tokens inside code spans alone', () => {
    const { container } = render(<MarkdownRenderer content={'`<@U1>`'} />);

    const code = container.querySelector('code');
    expect(code).not.toBeNull();
    expect(code!.textContent).toBe('<@U1>');
  });

  it('renders emoji shortcodes in message text as emoji (issue #252)', () => {
    const { container } = render(
      <MarkdownRenderer content={'on fire :heart_on_fire: and **bold :sparkles:**'} />,
    );

    expect(container.textContent).toBe('on fire ❤️‍🔥 and bold ✨');
    expect(container.querySelector('strong')!.textContent).toBe('bold ✨');
  });

  it('leaves shortcodes inside code spans and fenced blocks as typed', () => {
    const { container } = render(
      <MarkdownRenderer content={'`:smile:`\n\n```\n:smile:\n```'} />,
    );

    expect(Array.from(container.querySelectorAll('code')).map((el) => el.textContent))
      .toEqual([':smile:', ':smile:']);
  });

  it('leaves shortcodes in link text and URLs alone', () => {
    const { container } = render(
      <MarkdownRenderer content={'see https://example.com/:smile:/x'} />,
    );

    const link = container.querySelector('a')!;
    expect(link.getAttribute('href')).toBe('https://example.com/:smile:/x');
    expect(link.textContent).toBe('https://example.com/:smile:/x');
  });

  it('keeps backslash-escaped colons literal', () => {
    const { container } = render(<MarkdownRenderer content={'\\:smile\\: but :smile:'} />);
    expect(container.textContent).toBe(':smile: but 😄');
  });

  it('keeps a colon written as an entity literal', () => {
    const { container } = render(<MarkdownRenderer content={'&#58;smile: but :smile:'} />);
    expect(container.textContent).toBe(':smile: but 😄');
  });

  it('converts shortcodes in a labelled link but not in an angle-bracket autolink', () => {
    const { container } = render(
      <MarkdownRenderer content={'[:tada: party](https://example.com) <https://example.com/:smile:>'} />,
    );
    const [labelled, autolink] = Array.from(container.querySelectorAll('a'));
    expect(labelled!.textContent).toBe('🎉 party');
    expect(autolink!.textContent).toBe('https://example.com/:smile:');
  });

  it('does not treat clock times or addresses as shortcodes', () => {
    const { container } = render(<MarkdownRenderer content={'at 10:30:00 on fe80::a:b:c:d'} />);
    expect(container.textContent).toBe('at 10:30:00 on fe80::a:b:c:d');
  });
});

describe('MarkdownRenderer lists', () => {
  // A list item keeps `whitespace-pre-wrap` for typed line breaks, so a newline
  // node beside a block in it (and in a nested list, which inherits it) would
  // show as a blank line.
  const newlineNodes = (element: Element) => Array.from(element.childNodes)
    .filter((node) => node.nodeType === Node.TEXT_NODE && node.textContent === '\n');

  it('has no newline nodes around a nested list', () => {
    const { container } = render(<MarkdownRenderer content={'- one\n  - inner a\n  - inner b\n- two'} />);
    for (const list of Array.from(container.querySelectorAll('ul, ol, li'))) {
      expect(newlineNodes(list)).toHaveLength(0);
    }
    expect(container.querySelectorAll('ul ul li')).toHaveLength(2);
  });

  it('keeps a typed line break between two inline parts of an item', () => {
    const { container } = render(<MarkdownRenderer content={'- **first**\n  **second**'} />);
    const item = container.querySelector('li')!;
    expect(newlineNodes(item)).toHaveLength(1);
    expect(item.textContent).toBe('first\nsecond');
  });
});

describe('MarkdownRenderer emoji-only messages', () => {
  const jumbo = (content: string) => render(<MarkdownRenderer content={content} />).container.querySelector('.md-jumbo');

  it('draws a message of nothing but a few native emoji large', () => {
    expect(jumbo('😀')).not.toBeNull();
    expect(jumbo('😀 🎉 🔥')).not.toBeNull();
    expect(jumbo('👍🏽 🏳️‍🌈 🇩🇪')).not.toBeNull();
  });

  it('leaves words with emoji, plain numbers and very many emoji at text size', () => {
    expect(jumbo('nice 😀')).toBeNull();
    expect(jumbo('123')).toBeNull();
    expect(jumbo('😀'.repeat(25))).toBeNull();
  });
});

describe('MarkdownRenderer whitespace', () => {
  // A message body sits in a `whitespace-pre-wrap` container so that a line break the author
  // typed survives. react-markdown puts a newline text node between every two blocks, and under
  // pre-wrap each of those renders as a blank line: a three-item list grew two extra lines.
  // jsdom does no layout, so this pins the structure that prevents it.
  it('resets whitespace to normal for the blocks, and opts paragraphs and items back in', () => {
    const { container } = render(
      <div className="whitespace-pre-wrap">
        <MarkdownRenderer content={'intro:\n\n- one\n- two\n\n> quoted'} />
      </div>,
    );
    const wrapper = container.querySelector('.whitespace-pre-wrap > .whitespace-normal');
    expect(wrapper).not.toBeNull();
    const list = container.querySelector('ul');
    expect(list).not.toBeNull();
    expect(wrapper!.contains(list)).toBe(true);
    for (const item of Array.from(list!.querySelectorAll('li'))) {
      expect(item.className).toContain('whitespace-pre-wrap');
    }
    for (const paragraph of Array.from(container.querySelectorAll('span.block'))) {
      expect(paragraph.className).toContain('whitespace-pre-wrap');
    }
  });

  it('keeps a single typed line break inside a paragraph', () => {
    const { container } = render(<MarkdownRenderer content={'first line\nsecond line'} />);
    const paragraph = container.querySelector('span.block');
    expect(paragraph!.textContent).toBe('first line\nsecond line');
    expect(paragraph!.className).toContain('whitespace-pre-wrap');
  });
});
