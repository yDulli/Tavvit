/**
 * The developer docs, in the order they are read. Each page is `content/<slug>.md`. Adding one is
 * adding it here; `build.test.ts` fails on a page without a file and a file without a page.
 */
export const SECTIONS = [
  {
    title: 'Getting started',
    pages: [
      { slug: 'overview', title: 'Overview', description: 'What you can build on Tavvit, and which of the two ways fits.' },
      { slug: 'quickstart', title: 'Quickstart', description: 'Your first bot, writing in a channel, in five minutes.' },
      { slug: 'authentication', title: 'Tokens', description: 'How a bot proves who it is, and how to keep its token safe.' },
      { slug: 'permissions', title: 'Permissions', description: 'What a bot may do, every right by its number, and a calculator.' },
    ],
  },
  {
    title: 'Building',
    pages: [
      { slug: 'rest', title: 'REST API', description: 'Every route a bot can reach, and nothing else.' },
      { slug: 'socket', title: 'Socket events', description: 'Staying connected, and what a bot hears as it happens.' },
      { slug: 'commands', title: 'Commands', description: 'Slash commands with options, and answering them.' },
      { slug: 'cards', title: 'Cards', description: 'Showing more than text in a message.' },
      { slug: 'files', title: 'Files', description: 'Uploading a file and putting it in a message.' },
      { slug: 'webhooks', title: 'Webhooks', description: 'An address that posts into a channel, no program of your own needed.' },
    ],
  },
  {
    title: 'Reference',
    pages: [
      { slug: 'limits', title: 'Limits', description: 'How much a bot may do, and how it is told.' },
      { slug: 'errors', title: 'Errors', description: 'The shape of a refusal, and every code it can carry.' },
      { slug: 'changelog', title: 'Changelog', description: 'What changed in the API, and what is promised to stay.' },
    ],
  },
  {
    title: 'Responsibility',
    pages: [
      { slug: 'conduct', title: 'Rules for bots', description: 'What you owe the people your bot meets.' },
      { slug: 'security', title: 'Reporting a vulnerability', description: 'How to tell us about a security problem.' },
    ],
  },
];

export const PAGES = SECTIONS.flatMap((section) => section.pages);

/** Addresses in the app that a docs page may link to, besides the docs themselves. */
export const APP_LINKS = ['/', '/developers', '/developers/bots', '/download', '/terms', '/privacy', '/imprint', '/report', '/.well-known/security.txt', '/developers/assets/example-bot.mjs'];
