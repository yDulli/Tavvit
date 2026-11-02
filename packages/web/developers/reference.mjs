import fs from 'node:fs';
import { ACCOUNT_LIMITS } from '../../shared/src/accountLimits.ts';
import { BOT_LIMITS, BOT_ROUTES, BOT_SOCKET_EVENTS } from '../../shared/src/bots.ts';
import { CARD_LIMITS } from '../../shared/src/cards.ts';
import { ERROR_CODES } from '../../shared/src/errors.ts';
import { DEFAULT_EVERYONE_PERMISSIONS, PermissionBits } from '../../shared/src/permissions.ts';
import { MAX_MESSAGE_LENGTH } from '../../shared/src/types.ts';

/**
 * The parts of the docs made from the code itself, so that they cannot say anything else than what
 * the server does. A page holds `{{name}}` where one goes.
 */

const readCatalog = (name) => JSON.parse(fs.readFileSync(new URL(`../src/locales/en/${name}.json`, import.meta.url), 'utf8'));

/** Backticks and pipes in a table cell would end it. */
const cell = (text) => String(text).replace(/\|/g, '\\|').replace(/\r?\n/g, ' ');

function table(head, rows) {
  return [`| ${head.join(' | ')} |`, `| ${head.map(() => '---').join(' | ')} |`, ...rows.map((row) => `| ${row.map(cell).join(' | ')} |`)].join('\n');
}

function camelCase(name) {
  return name.toLowerCase().replace(/_([a-z])/g, (_all, letter) => letter.toUpperCase());
}

/** The rights, as the calculator on the permissions page and the table below it read them. */
export function permissionRows() {
  const names = readCatalog('spaces').permissions.names;
  return Object.entries(PermissionBits).map(([name, bit]) => ({
    name,
    value: bit.toString(),
    label: names[camelCase(name)] ?? name,
    everyone: (DEFAULT_EVERYONE_PERMISSIONS & bit) !== 0n,
  }));
}

/** A short body stays on its line. A long one is laid out, so that it can be read without scrolling. */
const SHORT_BODY = 60;
const laidOut = (body) => (body.length <= SHORT_BODY ? body : JSON.stringify(JSON.parse(body), null, 2));

function routes() {
  return BOT_ROUTES.map((route) => [
    `### ${route.method} ${route.path}`,
    '',
    route.summary,
    ...(route.permission ? ['', `Takes the \`${route.permission}\` right.`] : []),
    ...(route.body ? ['', '```json', laidOut(route.body), '```'] : []),
  ].join('\n')).join('\n\n');
}

function permissions() {
  return table(
    ['Right', 'Name', 'Number', 'Everyone has it by default'],
    permissionRows().map((row) => [
      row.label,
      `\`${row.name}\``,
      row.value,
      row.name === 'ADMINISTRATOR' ? 'Never for a bot' : row.everyone ? 'Yes' : '',
    ]),
  );
}

const SOCKET_SENDS = {
  typing_start: ['`channelId`', 'Shows it as typing for a few seconds'],
  reaction_add: ['`messageId`, `emoji`', 'Adds its reaction'],
  reaction_remove: ['`messageId`, `emoji`', 'Takes its reaction back'],
};

function socketSends() {
  return table(['Event', 'Fields', 'What it does'], BOT_SOCKET_EVENTS.map((name) => [`\`${name}\``, ...(SOCKET_SENDS[name] ?? ['', ''])]));
}

function cardLimits() {
  return table(['Cards', 'At most'], [
    ['Cards in a message', CARD_LIMITS.PER_MESSAGE],
    ['Characters in a title', CARD_LIMITS.TITLE_MAX_LENGTH],
    ['Characters of text', CARD_LIMITS.TEXT_MAX_LENGTH],
    ['Fields in a card', CARD_LIMITS.FIELDS_PER_CARD],
    ['Characters in a field\'s name', CARD_LIMITS.FIELD_NAME_MAX_LENGTH],
    ['Characters in a field\'s value', CARD_LIMITS.FIELD_VALUE_MAX_LENGTH],
    ['Characters in a footer', CARD_LIMITS.FOOTER_MAX_LENGTH],
    ['Characters in an address', CARD_LIMITS.URL_MAX_LENGTH],
    ['All the words of a message\'s cards together', CARD_LIMITS.TOTAL_WORDS_MAX_LENGTH],
  ]);
}

function commandLimits() {
  return table(['Commands', 'At most'], [
    ['Commands of a bot', BOT_LIMITS.COMMANDS_PER_BOT],
    ['Characters in a command\'s name', BOT_LIMITS.COMMAND_NAME_MAX_LENGTH],
    ['Characters in its description', BOT_LIMITS.COMMAND_DESCRIPTION_MAX_LENGTH],
    ['Characters after its name', BOT_LIMITS.COMMAND_ARGS_MAX_LENGTH],
    ['Options of a command', BOT_LIMITS.OPTIONS_PER_COMMAND],
    ['Characters in an option\'s name', BOT_LIMITS.OPTION_NAME_MAX_LENGTH],
    ['Characters in its description', BOT_LIMITS.OPTION_DESCRIPTION_MAX_LENGTH],
    ['Choices of an option', BOT_LIMITS.OPTION_CHOICES],
    ['Characters in a choice', BOT_LIMITS.OPTION_CHOICE_MAX_LENGTH],
    ['Characters in a text option', BOT_LIMITS.OPTION_TEXT_MAX_LENGTH],
    ['Answers to one command', BOT_LIMITS.REPLIES_PER_INTERACTION],
    ['Minutes to answer', BOT_LIMITS.INTERACTION_TTL_MS / 60_000],
  ]);
}

function botLimits() {
  return table(['Bots', 'At most'], [
    ['Requests a minute, per bot, across everything open to it', BOT_LIMITS.REQUESTS_PER_MINUTE],
    ['Bots of one person', BOT_LIMITS.PER_OWNER],
    ['Characters in a bot\'s name', BOT_LIMITS.NAME_MAX_LENGTH],
    ['Characters in its description', BOT_LIMITS.DESCRIPTION_MAX_LENGTH],
  ]);
}

function sizeLimits() {
  return table(['What', 'How much'], [
    ['Characters in a message', MAX_MESSAGE_LENGTH],
    ['One file', 'What the instance sets, 100 MB unless its operator changed it'],
    ['All your files, your bots\' included', `What the instance sets, ${ACCOUNT_LIMITS.DEFAULT_STORAGE_BYTES / 1024 ** 3} GB unless its operator changed it`],
  ]);
}

function errorCodes() {
  const texts = readCatalog('errors');
  // A blank of the catalog's, as `{max}`: left as it is, it would read as something unfilled.
  const textOf = (code) => (texts[code] ?? texts[`${code}_other`] ?? '').replace(/\{\{(\w+)\}\}/g, '`{$1}`');
  return table(['Code', 'What a person is told'], ERROR_CODES.map((code) => [`\`${code}\``, textOf(code)]));
}

const PARTS = { routes, permissions, socketSends, cardLimits, commandLimits, botLimits, sizeLimits, errorCodes };

/** A page's Markdown with its generated parts in place. A name nothing knows is an error, not a gap. */
export function fillIn(markdown) {
  return markdown.replace(/\{\{(\w+)\}\}/g, (_all, name) => {
    if (!PARTS[name]) throw new Error(`No generated part called ${name}`);
    return PARTS[name]();
  });
}
