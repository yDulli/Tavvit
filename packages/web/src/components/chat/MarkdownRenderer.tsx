import { ExternalImage } from '../ui/ExternalMedia';
import React, { createContext, useContext } from 'react';
import ReactMarkdown, { defaultUrlTransform } from 'react-markdown';
import remarkGfm from 'remark-gfm';
import { Highlight, themes } from 'prism-react-renderer';
import type { Components } from 'react-markdown';
import { MassMentionBadge } from './MassMentionBadge';
import { MentionBadge } from './MentionBadge';
import { remarkEmojiShortcodes } from '../../utils/remarkEmojiShortcodes';
import { remarkSpoilers } from '../../utils/remarkSpoilers';
import { Spoiler } from './Spoiler';
import { useEmojiShortcodeNames } from '../../utils/emojiShortcodes';
import { splitMentions } from '../../utils/mentionTokens';
import { splitCustomEmoji } from '@backspace/shared/src/customEmoji';
import { CustomEmojiImage, EmojiSizeContext, type EmojiSize } from '../ui/CustomEmojiImage';
import { getChannelOrigin } from '../../stores/spaceStore';

// ─── Remark Plugin: Tag Bare Fenced Blocks ─────────────────────────────────
// react-markdown v9 removed the `inline` prop from <code>. Fenced blocks
// without a language hint have no className, making them indistinguishable
// from inline code. This plugin assigns `lang: 'text'` to bare fenced blocks
// so that `className="language-text"` is always present on block-level code.

interface MdastNode {
  type: string;
  lang?: string | null;
  children?: MdastNode[];
}

function remarkDefaultCodeLang() {
  return (tree: MdastNode) => {
    walkTree(tree);
  };
}

function walkTree(node: MdastNode) {
  if (node.type === 'code' && !node.lang) {
    node.lang = 'text';
  }
  if (node.children) {
    for (const child of node.children) {
      walkTree(child);
    }
  }
}

// ─── Rehype Plugin: Newlines Around List Blocks ────────────────────────────
// The hast tree puts a "\n" text node between the blocks of a list. A list item
// keeps `whitespace-pre-wrap` for the line breaks its author typed, so each of
// those shows as a blank line, and a nested list inherits it: two nested items
// grew four blank lines. A newline between two inline parts is a typed break and
// stays.

interface HastNode {
  type: string;
  tagName?: string;
  value?: string;
  children?: HastNode[];
}

const LIST_TAGS = new Set(['ul', 'ol', 'li']);
const BLOCK_TAGS = new Set(['ul', 'ol', 'li', 'p', 'blockquote', 'pre', 'table', 'hr', 'h1', 'h2', 'h3', 'h4', 'h5', 'h6']);

function isBlockOrEdge(node: HastNode | undefined): boolean {
  return node === undefined || (node.type === 'element' && BLOCK_TAGS.has(node.tagName ?? ''));
}

function dropListSeparators(node: HastNode): void {
  if (!node.children) return;
  if (LIST_TAGS.has(node.tagName ?? '')) {
    node.children = node.children.filter((child, i, siblings) => (
      child.type !== 'text' || child.value !== '\n'
      || !(isBlockOrEdge(siblings[i - 1]) || isBlockOrEdge(siblings[i + 1]))
    ));
  }
  node.children.forEach(dropListSeparators);
}

function rehypeListSeparators() {
  return dropListSeparators;
}

// ─── Pre-processing: Mention Tokens ─────────────────────────────────────────
// remark-parse mangles <@userId> (treats as autolink or escapes the angle
// brackets) before remark plugins can see the text nodes. We solve this by
// converting mention tokens to standard markdown links BEFORE the parser
// runs. The `a` component override then detects the mention:// scheme (a
// user) and the mass-mention:// scheme (`everyone`, `here`, or `&` and a role
// id). Code spans and fenced blocks are kept as-is by the shared token scan
// (utils/mentionTokens.ts), the same scan the reply preview, the mention
// highlight, the composer and the alert rule use.

function preprocessMentions(raw: string): string {
  return splitMentions(raw).map((part) => {
    switch (part.kind) {
      case 'text': return part.text;
      case 'user': return `[@${part.userId}](mention://${part.userId})`;
      case 'role': return `[@&${part.roleId}](mass-mention://&${part.roleId})`;
      case 'everyone': return `[@${part.keyword}](mass-mention://${part.keyword})`;
    }
  }).join('');
}

// ─── Pre-processing: Custom Emoji ───────────────────────────────────────────
// `<:name:id>` is turned into a link with the `emoji://` scheme for the same
// reason as the mentions above, and the `a` override draws the picture. Code is
// left alone by the shared scan. The name travels in the address, not the link
// text (which the shortcode plugin would rewrite), so an emoji that is no longer
// in the library can still be written as `:name:`.

function preprocessCustomEmoji(raw: string): string {
  return splitCustomEmoji(raw).map((part) => (
    part.kind === 'text' ? part.text : `[emoji](emoji://${part.id}/${part.name})`
  )).join('');
}

/** A message that is nothing but a few emoji is drawn large. */
const JUMBO_LIMIT = 24;

function emojiSizeOf(content: string): EmojiSize {
  const parts = splitCustomEmoji(content);
  const emoji = parts.filter((part) => part.kind === 'emoji').length;
  const onlyEmoji = emoji > 0 && parts.every((part) => part.kind === 'emoji' || part.text.trim() === '');
  return onlyEmoji && emoji <= JUMBO_LIMIT ? 'jumbo' : 'inline';
}

/** One native emoji: a pictograph with what modifies it, or a flag. A digit is not one here. */
const NATIVE_EMOJI = /\p{Regional_Indicator}{2}|\p{Extended_Pictographic}(?:\p{Emoji_Modifier}|️)*(?:‍\p{Extended_Pictographic}(?:\p{Emoji_Modifier}|️)*)*/gu;

function isNativeEmojiOnly(content: string): boolean {
  const emoji = content.match(NATIVE_EMOJI);
  return !!emoji && emoji.length <= JUMBO_LIMIT && content.replace(NATIVE_EMOJI, '').trim() === '';
}

// ─── URL Transform: Allow mention:// Scheme ─────────────────────────────────
// react-markdown's defaultUrlTransform strips URLs with unknown protocols.
// Internal mention and emoji schemes reach their renderers; none opens an external URL.

function urlTransform(url: string): string {
  if (url.startsWith('mention://') || url.startsWith('mass-mention://') || url.startsWith('emoji://')) return url;
  return defaultUrlTransform(url);
}

// ─── Code Theme ───────────────────────────────────────────────────────────
// One Dark's token colours on the sunken surface every code block sits on.

const codeTheme = {
  ...themes.oneDark,
  plain: {
    ...themes.oneDark.plain,
    backgroundColor: 'rgb(var(--bg-input))',
    color: 'rgb(var(--text-message))',
  },
};

// ─── Markdown Component Overrides ──────────────────────────────────────────

const REMARK_PLUGINS = [remarkGfm, remarkDefaultCodeLang, remarkEmojiShortcodes, remarkSpoilers];
const REHYPE_PLUGINS = [rehypeListSeparators];

function CodeBlock({ language, code }: { language: string; code: string }) {
  // 'text' means a bare fenced block with no language — render without highlighting
  if (language === 'text') {
    return (
      <pre className="md-code-block scrollbar-thin">
        <code>{code}</code>
      </pre>
    );
  }

  return (
    <Highlight theme={codeTheme} code={code} language={language}>
      {({ style, tokens, getLineProps, getTokenProps }) => (
        <pre className="md-code-block scrollbar-thin" style={style}>
          {tokens.map((line, i) => {
            const lineProps = getLineProps({ line });
            return (
              <div key={i} {...lineProps} style={{ ...lineProps.style, minHeight: '1.5em' }}>
                {line.map((token, key) => (
                  <span key={key} {...getTokenProps({ token })} />
                ))}
              </div>
            );
          })}
        </pre>
      )}
    </Highlight>
  );
}

const MemoizedCodeBlock = React.memo(CodeBlock);

// ─── Mentions: Channel Context ─────────────────────────────────────────────
// The component overrides below are built once and shared by every message,
// so the channel a message belongs to reaches its mention badges through
// context rather than through the overrides.

const MentionChannelContext = createContext<string | null>(null);

/** A `mass-mention://` target: `everyone`, `here`, or `&` and a role id. */
function ChannelMassMentionBadge({ target }: { target: string }) {
  const channelId = useContext(MentionChannelContext);
  if (target.startsWith('&')) return <MassMentionBadge roleId={target.slice(1)} channelId={channelId} />;
  if (target === 'everyone' || target === 'here') return <MassMentionBadge keyword={target} channelId={channelId} />;
  return <>{'@' + target}</>;
}

/**
 * An emoji in a channel's message. Emoji ids belong to the instance that holds
 * the library (this one), so in a channel another instance hosts the id means
 * nothing here and the emoji stays as the `:name:` the author's text carried.
 */
function ChannelEmoji({ id, name }: { id: string; name: string | undefined }) {
  const channelId = useContext(MentionChannelContext);
  if (channelId !== null && getChannelOrigin(channelId) !== '') {
    const written = `:${name ?? 'emoji'}:`;
    return <>{written}</>;
  }
  return <CustomEmojiImage id={id} fallbackName={name} />;
}

function ChannelMentionBadge({ userId }: { userId: string }) {
  const channelId = useContext(MentionChannelContext);
  return <MentionBadge userId={userId} channelId={channelId} />;
}

function buildComponents(): Components {
  return {
    // Paragraphs → spans to avoid block nesting issues in chat messages.
    // `whitespace-pre-wrap` is set here, per paragraph, so a single line break the
    // author typed is kept (this is chat, not a document); the renderer's own
    // wrapper is `whitespace-normal` so the "\n" text nodes react-markdown puts
    // BETWEEN blocks collapse instead of showing up as blank lines.
    p: ({ children }) => <span className="md-p block whitespace-pre-wrap">{children}</span>,

    // Only remarkSpoilers makes a span: a span written in a message is not parsed as HTML.
    span: ({ children, node }) => (node?.properties?.dataSpoiler
      ? <Spoiler>{children}</Spoiler>
      : <span>{children}</span>),

    // Links & Mentions
    // remark-parse autolinks <@userId> into mailto:@userId before plugins run,
    // so we intercept that pattern here instead of using a remark plugin.
    a: ({ href, children }) => {
      if (href?.startsWith('emoji://')) {
        const [id = '', name] = href.slice('emoji://'.length).split('/');
        return <ChannelEmoji id={id} name={name} />;
      }
      if (href?.startsWith('mass-mention://')) {
        return <ChannelMassMentionBadge target={href.slice('mass-mention://'.length)} />;
      }
      if (href?.startsWith('mention://')) {
        return <ChannelMentionBadge userId={href.slice('mention://'.length)} />;
      }
      const mentionMatch = href?.match(/^(?:mailto:)?@([a-zA-Z0-9_-]+)$/);
      if (mentionMatch) {
        return <ChannelMentionBadge userId={mentionMatch[1]!} />;
      }
      return (
        <a
          href={href}
          target="_blank"
          rel="noopener noreferrer"
          className="text-txt-link hover:underline"
        >
          {children}
        </a>
      );
    },

    // Fenced code blocks (have className from our remark plugin) vs inline code
    code: ({ className, children, ...rest }) => {
      const match = /language-(\w+)/.exec(className || '');
      if (match) {
        const code = String(children).replace(/\n$/, '');
        return <MemoizedCodeBlock language={match[1]!} code={code} />;
      }
      // Inline code
      return (
        <code className="md-code" {...rest}>
          {children}
        </code>
      );
    },

    // Override <pre> to be a minimal wrapper — the CodeBlock handles all styling
    pre: ({ children }) => <>{children}</>,

    // Bold / Italic / Strikethrough
    strong: ({ children }) => <strong className="font-semibold text-txt-primary">{children}</strong>,
    em: ({ children }) => <em className="italic">{children}</em>,
    del: ({ children }) => <del className="line-through text-txt-secondary">{children}</del>,

    // Blockquotes
    blockquote: ({ children }) => (
      <blockquote className="md-quote pl-3 border-l-2 border-interactive-muted text-txt-secondary">
        {children}
      </blockquote>
    ),

    // Lists
    ul: ({ children }) => <ul className="md-list list-disc pl-5 space-y-0.5 marker:text-txt-tertiary">{children}</ul>,
    ol: ({ children }) => <ol className="md-list list-decimal pl-5 space-y-0.5 marker:text-txt-tertiary">{children}</ol>,
    li: ({ children }) => <li className="whitespace-pre-wrap pl-0.5">{children}</li>,

    // Headings, kept modest: this is a chat message, not a page.
    h1: ({ children }) => <div className="md-h1">{children}</div>,
    h2: ({ children }) => <div className="md-h2">{children}</div>,
    h3: ({ children }) => <div className="md-h3">{children}</div>,

    // Horizontal rules
    hr: () => <hr className="border-border-hard my-2" />,

    // Images (in markdown content — not attachments)
    img: ({ src, alt }) => (
      <div className="mt-1 max-w-[400px]">
        <ExternalImage
          src={src}
          alt={alt ?? ''}
          className="max-w-full max-h-[300px] rounded-lg"
          loading="lazy"
          referrerPolicy="no-referrer"
          crossOrigin="anonymous"
        />
      </div>
    ),

    // Tables (GFM)
    table: ({ children }) => (
      <div className="md-table overflow-x-auto">
        <table className="border-collapse text-body">{children}</table>
      </div>
    ),
    thead: ({ children }) => <thead className="border-b border-border-soft">{children}</thead>,
    tbody: ({ children }) => <tbody>{children}</tbody>,
    tr: ({ children }) => <tr className="border-b border-border-hard">{children}</tr>,
    th: ({ children }) => <th className="px-3 first:pl-0 py-1.5 text-left text-txt-primary font-semibold">{children}</th>,
    td: ({ children }) => <td className="px-3 first:pl-0 py-1.5">{children}</td>,
  };
}

// Build once and reuse — the components object is static
const MARKDOWN_COMPONENTS = buildComponents();

// ─── Public Component ──────────────────────────────────────────────────────

interface MarkdownRendererProps {
  content: string;
  /**
   * The channel the content was written in; `<@id>` mentions resolve among
   * that channel's people (see `MentionBadge`). Omitted for text that belongs
   * to no channel, where a mention cannot be resolved.
   */
  channelId?: string | null;
}

export const MarkdownRenderer = React.memo(function MarkdownRenderer({ content, channelId = null }: MarkdownRendererProps) {
  useEmojiShortcodeNames();
  return (
    <EmojiSizeContext.Provider value={emojiSizeOf(content)}>
    <MentionChannelContext.Provider value={channelId}>
      {/* The message body sits in a `whitespace-pre-wrap` container (so typed line
          breaks survive), and react-markdown emits a "\n" text node between every
          two blocks, which pre-wrap turns into a blank line: lists and quotes grew
          gaps the height of a line. Reset to `normal` here; paragraphs, list items
          and headings opt back in to `pre-wrap` themselves (see `buildComponents`). */}
      <div className={`md-root whitespace-normal ${isNativeEmojiOnly(content) ? 'md-jumbo' : ''}`}>
        <ReactMarkdown remarkPlugins={REMARK_PLUGINS} rehypePlugins={REHYPE_PLUGINS} components={MARKDOWN_COMPONENTS} urlTransform={urlTransform}>
          {preprocessCustomEmoji(preprocessMentions(content))}
        </ReactMarkdown>
      </div>
    </MentionChannelContext.Provider>
    </EmojiSizeContext.Provider>
  );
});
