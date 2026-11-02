import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { Highlight, Prism } from 'prism-react-renderer';
import { createElement } from 'react';
import { renderToStaticMarkup } from 'react-dom/server';
import ReactMarkdown from 'react-markdown';
import remarkGfm from 'remark-gfm';
import { PAGES, SECTIONS } from './pages.mjs';
import { fillIn, permissionRows } from './reference.mjs';

/**
 * The public developer docs (docs/systems/developers.md): Markdown made into plain HTML while the
 * web client is built. Nothing here runs in a visitor's browser but a small script for the search,
 * so the pages need no app, work without scripts, and search engines read them as they are.
 */

const HERE = path.dirname(fileURLToPath(import.meta.url));
const CONTENT = path.join(HERE, 'content');
const SITE_TITLE = 'Tavvit developers';

const escapeHtml = (value) => String(value)
  .replace(/&/g, '&amp;')
  .replace(/</g, '&lt;')
  .replace(/>/g, '&gt;')
  .replace(/"/g, '&quot;');

export function slugify(text) {
  return text.toLowerCase().replace(/[`'"]/g, '').replace(/[^a-z0-9]+/g, '-').replace(/^-|-$/g, '');
}

function textOf(node) {
  if (typeof node === 'string' || typeof node === 'number') return String(node);
  if (Array.isArray(node)) return node.map(textOf).join('');
  if (node?.props?.children !== undefined) return textOf(node.props.children);
  return '';
}

function withoutStyle(props) {
  const kept = { ...props };
  delete kept.style;
  return kept;
}

/** Code with its words marked by class only: the pages' policy takes no inline style. */
function CodeBlock({ language, code }) {
  return createElement(Highlight, { prism: Prism, code, language, theme: { plain: {}, styles: [] } }, ({ tokens, getLineProps, getTokenProps }) => createElement(
    'code',
    { className: `language-${language}` },
    tokens.map((line, lineAt) => createElement(
      'span',
      { key: lineAt, ...withoutStyle(getLineProps({ line })), className: 'code-line' },
      line.map((token, tokenAt) => createElement('span', { key: tokenAt, ...withoutStyle(getTokenProps({ token })) })),
    )),
  ));
}

const MARKDOWN_COMPONENTS = {
  // The title stands in the page's own head.
  h1: () => null,
  h2: ({ children }) => createElement('h2', { id: slugify(textOf(children)) }, children),
  h3: ({ children }) => createElement('h3', { id: slugify(textOf(children)) }, children),
  a: ({ href, children }) => {
    const external = /^https?:/.test(href ?? '');
    return createElement('a', { href, ...(external ? { rel: 'noopener noreferrer' } : {}) }, children);
  },
  table: ({ children }) => createElement('div', { className: 'table-wrap' }, createElement('table', null, children)),
  pre: ({ children }) => createElement('pre', null, children),
  code: ({ className, children }) => {
    const language = /language-(\w+)/.exec(className ?? '')?.[1];
    if (!language) return createElement('code', null, children);
    return createElement(CodeBlock, { language, code: String(children).replace(/\n$/, '') });
  },
};

function renderMarkdown(markdown) {
  return renderToStaticMarkup(createElement(ReactMarkdown, { remarkPlugins: [remarkGfm], components: MARKDOWN_COMPONENTS }, markdown));
}

/** The headings of a page, for its contents and for the search. */
function headingsOf(markdown) {
  const withoutCode = markdown.replace(/```[\s\S]*?```/g, '');
  return [...withoutCode.matchAll(/^(##|###) (.+)$/gm)].map((match) => {
    const text = match[2].replace(/`/g, '').trim();
    return { level: match[1].length, text, id: slugify(match[2]) };
  });
}

function plainText(markdown) {
  return markdown
    .replace(/```[\s\S]*?```/g, ' ')
    .replace(/[#*`|>]/g, ' ')
    .replace(/\[([^\]]*)\]\([^)]*\)/g, '$1')
    .replace(/\s+/g, ' ')
    .trim();
}

function logo() {
  return '<img class="logo" src="/icons/logo-mark.svg" alt="" width="24" height="24" />';
}

function siteHeader() {
  return `<header class="site-header">
  <a class="brand" href="/developers">${logo()}<span>Tavvit</span><span class="brand-sub">developers</span></a>
  <div class="site-search" role="search">
    <input id="search" type="search" placeholder="Search the docs" aria-label="Search the docs" autocomplete="off" hidden />
    <ul id="search-results" class="search-results" hidden></ul>
  </div>
  <nav class="site-links" aria-label="Site">
    <a href="/developers/docs/overview">Docs</a>
    <a href="/developers/bots">Your bots</a>
    <a class="site-links-app" href="/">Tavvit</a>
  </nav>
</header>`;
}

function siteFooter() {
  return `<footer class="site-footer">
  <a href="/developers/docs/conduct">Rules for bots</a>
  <a href="/developers/docs/security">Report a vulnerability</a>
  <a href="/terms">Terms of use</a>
  <a href="/privacy">Privacy policy</a>
  <a href="/imprint">Legal notice</a>
  <a id="source-code" rel="noopener noreferrer" hidden>Source code</a>
</footer>`;
}

function documentOf({ title, description, body, bodyClass }) {
  return `<!doctype html>
<html lang="en">
<head>
<meta charset="utf-8" />
<meta name="viewport" content="width=device-width, initial-scale=1" />
<title>${escapeHtml(title)}</title>
<meta name="description" content="${escapeHtml(description)}" />
<meta property="og:title" content="${escapeHtml(title)}" />
<meta property="og:description" content="${escapeHtml(description)}" />
<meta property="og:type" content="website" />
<meta name="theme-color" content="#0d0e11" />
<link rel="icon" type="image/png" sizes="32x32" href="/icons/favicon-32.png" />
<link rel="stylesheet" href="/developers/assets/docs.css" />
<script src="/developers/assets/docs.js" defer></script>
</head>
<body class="${bodyClass}">
${body}
</body>
</html>
`;
}

function sideNav(currentSlug) {
  return `<nav class="docs-nav" aria-label="Docs">
  <details class="docs-nav-toggle" open>
    <summary>All pages</summary>
    ${SECTIONS.map((section) => `<p class="docs-nav-title">${escapeHtml(section.title)}</p>
    <ul>${section.pages.map((page) => `<li><a href="/developers/docs/${page.slug}"${page.slug === currentSlug ? ' aria-current="page"' : ''}>${escapeHtml(page.title)}</a></li>`).join('')}</ul>`).join('\n    ')}
  </details>
</nav>`;
}

function contents(headings) {
  const shown = headings.filter((heading) => heading.level === 2);
  if (shown.length < 2) return '';
  return `<nav class="docs-contents" aria-label="On this page">
  <p class="docs-nav-title">On this page</p>
  <ul>${shown.map((heading) => `<li><a href="#${heading.id}">${escapeHtml(heading.text)}</a></li>`).join('')}</ul>
</nav>`;
}

/** The calculator of the permissions page: with no script it is simply the table above it. */
function calculator() {
  const rows = permissionRows().filter((row) => row.name !== 'ADMINISTRATOR');
  return `<section id="calculator" class="calculator" hidden>
  <h2 id="calculator-title">Calculator</h2>
  <p>Tick what your bot needs.</p>
  <div class="calculator-grid">${rows.map((row) => `<label><input type="checkbox" value="${row.value}" /> ${escapeHtml(row.label)}</label>`).join('')}</div>
  <p class="calculator-result">The number for the address: <code id="calculator-value">0</code></p>
</section>`;
}

function neighbours(slug) {
  const at = PAGES.findIndex((page) => page.slug === slug);
  const previous = PAGES[at - 1];
  const next = PAGES[at + 1];
  return `<nav class="docs-neighbours" aria-label="Next and previous">
  ${previous ? `<a href="/developers/docs/${previous.slug}"><span>Previous</span>${escapeHtml(previous.title)}</a>` : '<span></span>'}
  ${next ? `<a class="next" href="/developers/docs/${next.slug}"><span>Next</span>${escapeHtml(next.title)}</a>` : ''}
</nav>`;
}

function docPage(page, markdown) {
  const headings = headingsOf(markdown);
  return documentOf({
    title: `${page.title} · ${SITE_TITLE}`,
    description: page.description,
    bodyClass: 'docs',
    body: `${siteHeader()}
<div class="docs-layout">
${sideNav(page.slug)}
<main class="docs-main">
<h1 class="docs-title">${escapeHtml(page.title)}</h1>
<p class="docs-lead">${escapeHtml(page.description)}</p>
${renderMarkdown(markdown)}
${page.slug === 'permissions' ? calculator() : ''}
${neighbours(page.slug)}
</main>
${contents(headings)}
</div>
${siteFooter()}`,
  });
}

const HOME_SAMPLE = `curl -X POST https://your.instance/api/channels/<channel id>/messages \\
  -H "Authorization: Bot $TAVVIT_TOKEN" \\
  -H "Content-Type: application/json" \\
  -d '{ "content": "Hello from my bot" }'`;

function homePage() {
  const features = [
    ['Bots', 'A program with an account of its own: it reads, writes, reacts and moderates, under the rights a space gives it.', 'quickstart', 'Make your first bot'],
    ['Commands', 'People type a slash and fill in what you ask for. The instance checks it before you hear of it, and you can answer for one person alone.', 'commands', 'Add a command'],
    ['Cards', 'Titles, fields, colours and pictures in a message, with nothing fetched from anywhere else.', 'cards', 'Show a card'],
    ['Webhooks', 'An address that posts into a channel. Nothing to run, and it takes the form many programs already send.', 'webhooks', 'Post from a script'],
  ];
  return documentOf({
    title: SITE_TITLE,
    description: 'Build bots, commands and integrations for Tavvit. Documentation, an API reference and a portal for your bots.',
    bodyClass: 'home',
    body: `${siteHeader()}
<main class="home-main">
<section class="home-hero">
  <p class="eyebrow">For developers</p>
  <h1>Build for the people in your space.</h1>
  <p class="home-lead">Bots, commands and webhooks, with a small API you can read in an afternoon, and a token that opens only what it says.</p>
  <div class="home-actions">
    <a class="button button-main" href="/developers/docs/quickstart">Read the quickstart</a>
    <a class="button" href="/developers/bots">Your bots</a>
  </div>
  <div class="home-sample"><pre>${renderToStaticMarkup(createElement(CodeBlock, { language: 'bash', code: HOME_SAMPLE }))}</pre></div>
</section>
<section class="home-features">
${features.map(([title, text, slug, action]) => `<a class="feature" href="/developers/docs/${slug}"><h2>${title}</h2><p>${text}</p><span>${action}</span></a>`).join('\n')}
</section>
<section class="home-more">
  <h2>What you can count on</h2>
  <ul>
    <li><strong>Closed by default.</strong> A token opens <a href="/developers/docs/rest">the routes on this list</a>, and accounts, sign-in and private messages never.</li>
    <li><strong>Stable.</strong> What is documented only changes by adding to it. <a href="/developers/docs/changelog">The changelog</a> says what changed.</li>
    <li><strong>Plain.</strong> JSON over HTTP and a WebSocket, with no SDK to install. <a href="/developers/assets/example-bot.mjs">A whole bot</a> fits in one file.</li>
  </ul>
</section>
</main>
${siteFooter()}`,
  });
}

/** What the search goes through: each page, and each of its headings. */
function searchIndex(sources) {
  return PAGES.map((page) => {
    const markdown = sources.get(page.slug);
    return {
      slug: page.slug,
      title: page.title,
      description: page.description,
      headings: headingsOf(markdown).map(({ text, id }) => ({ text, id })),
      text: plainText(page.slug === 'errors' ? markdown.split('## Every code')[0] ?? markdown : markdown).slice(0, 4000),
    };
  });
}

/** Writes the whole site into `outDir` (the built client's `developers`). */
export function buildSite(outDir) {
  fs.rmSync(outDir, { recursive: true, force: true });
  fs.mkdirSync(path.join(outDir, 'docs'), { recursive: true });
  fs.mkdirSync(path.join(outDir, 'assets'), { recursive: true });

  const sources = new Map();
  for (const page of PAGES) {
    sources.set(page.slug, fillIn(fs.readFileSync(path.join(CONTENT, `${page.slug}.md`), 'utf8')));
  }

  // Names no static handler would serve as a folder's index: the server's own routes answer these.
  fs.writeFileSync(path.join(outDir, 'home.html'), homePage());
  for (const page of PAGES) {
    fs.writeFileSync(path.join(outDir, 'docs', `${page.slug}.html`), docPage(page, sources.get(page.slug)));
  }

  for (const asset of ['docs.css', 'docs.js']) {
    fs.copyFileSync(path.join(HERE, 'assets', asset), path.join(outDir, 'assets', asset));
  }
  fs.copyFileSync(path.join(HERE, 'example-bot.mjs'), path.join(outDir, 'assets', 'example-bot.mjs'));
  fs.writeFileSync(path.join(outDir, 'assets', 'search-index.json'), JSON.stringify(searchIndex(sources)));
}

if (process.argv[1] && path.resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  buildSite(process.argv[2] ?? path.join(HERE, '..', 'dist', 'developers'));
}
