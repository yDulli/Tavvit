# Translating messages

Right-click a message (hold it on a phone), choose Translate, and the message stands in the reader's language under the original, which stays where it is. Nothing is translated until someone asks, and nothing about it is stored.

**Files:** `packages/shared/src/translation.ts`, `packages/server/src/routes/translation.ts`, `packages/server/src/utils/translation.ts`, `packages/web/src/utils/deviceTranslation.ts`, `packages/web/src/stores/translationStore.ts`, `translationTargetStore.ts`, `packages/web/src/components/chat/MessageTranslation.tsx`, `messageMenuItems.tsx`, `packages/web/src/components/modals/settingsPanels/LanguageSection.tsx`.

## Who translates

Three ways, in this order. Each is tried only when the one before cannot.

1. **The browser itself** (`utils/deviceTranslation.ts`): Chrome from 138 and Edge from 148, on a computer, have a translator and a language detector built in. The words stay on the device, and it costs nobody anything. The first use of a pair of languages fetches a language pack from the browser's maker, which took about a minute in testing, with no progress reported until the end, so the row says it takes a while once. It needs no setting.
2. **The server of the channel**, if its operator set one up (`TRANSLATION_PROVIDER`). `GET /api/instance/info` says `translation`, and the client asks each instance once.
3. **A link to Google Translate**, which the row offers when neither can, and also when the provider failed. Nothing goes anywhere until a person follows it, and then from their own browser, under Google's terms. The link's title says so. In the desktop app it opens in the default browser (`setWindowOpenHandler`).

So with nothing set up: Chrome and Edge on a computer translate in place, everyone else gets the link.

**The desktop app does not ask the browser's translator.** Electron 43 has the names from Chromium but nothing behind them: `Translator.availability()` never comes back and `LanguageDetector.availability()` says `downloadable` for something it cannot fetch (`isElectron()`). In any browser, a question that takes longer than 6 seconds, or a language pack silent for 3 minutes, ends this way for the rest of the window (`silent`), rather than leaving "Translating…" on the row for good.

## The server's side

`POST /api/messages/:id/translate` takes `{ target }`, one of `TRANSLATION_TARGETS`, and answers `TranslateMessageResponse`. **It takes a message and not a text,** so this server is nobody's free translator, and only someone who can read the message can ask: `visibleChannelMessage` or `visibleDmMessage`, 404 otherwise, the same as for a message that is not there. **Bots may not:** the route says nothing of `botAllowed`, on purpose. A program reads the message and can use a translator of its own.

**The address of a translator comes only from the server's settings,** never from a request, so this adds no way to make the server fetch an address (no SSRF). The server follows no redirect from it.

| Setting | Meaning |
|---------|---------|
| `TRANSLATION_PROVIDER` | `none` (the default), `deepl` or `libretranslate`. A half-filled setting refuses to boot. |
| `DEEPL_API_KEY` | For `deepl`. A key of the free plan ends in `:fx`, and goes to its own address. |
| `LIBRETRANSLATE_URL`, `LIBRETRANSLATE_API_KEY` | For `libretranslate`, for example `http://libretranslate:5000`. The key only if that server asks for one. |

**LibreTranslate on the same server** is a service in `docker-compose.yml` (`libretranslate/libretranslate:v1.9.6`, profile `translate`), reached only over the internal network, with no port outside and no key. It takes the 24 languages of `TRANSLATION_TARGETS` by default; set `LT_LOAD_ONLY=` (empty) for all it has, which also tells more languages apart when detecting, or a shorter list to use less room and memory. The first start downloads the languages into the volume `libretranslate-models`, which takes a while; until it is ready, asking answers `translation_failed` and the row offers the link. Budget about 4 to 8 GB of memory and 10 GB of disk for all languages, less for fewer. To turn it on, in `.env`:

```
COMPOSE_PROFILES=translate        # voice,translate with voice
TRANSLATION_PROVIDER=libretranslate
LIBRETRANSLATE_URL=http://libretranslate:5000
```

then `docker compose up -d`. `update.sh` only rebuilds the app, so it neither starts nor updates this service. Its translations are weaker than DeepL's, and all of it stays on the operator's server.

**Limits.** 30 requests a minute, and 30,000 characters a person a day (`TRANSLATION_LIMITS`), which answers `translation_limit_reached`. Only what went to the provider counts, so what someone else had translated is free. Both count per server start, in memory: the point is that one person cannot use up an operator's allowance at a provider, not to keep books.

**The last 500 answers are kept in memory,** with the message's words in the key, so an announcement many people read costs one request and an edit asks again. They go with a restart. **Nothing is written to the database or the logs:** when a provider fails, the log has its status and not the words (`TranslationFailed`).

A failed provider answers 502 `translation_failed`, whatever it said, and the row offers the link beside that.

## What is sent

A message is more than words, and no translator can be trusted with the rest. `splitForTranslation` cuts it, and only the words go out: **code, a link with its address, a mention, a custom emoji, a bare address, `@everyone`, the marks of a spoiler, what opens a line of a list, a quote or a heading, and the end of each line stay as they are.** `joinTranslation` puts it together again, so what a spoiler covers stays covered in the translation, a line stays a line, and a mention still names the person. Neither the name of who asks nor of who wrote it goes along.

Bold and italic stay in the words, as cutting a sentence at them would lose more than it saves; a translator that spaces out the marks gets them closed up again.

**A sentence broken by a mention or by code is translated in pieces,** so it can read a little off in a language with a different word order. That is the price of never having a mention mangled, and a message mostly has its mention at one end.

## The reader's side

`translationStore` holds, per message, what the row shows: working, done, the same language, or the offer. Each entry holds the words it was made from, so after an edit `MessageTranslation` shows nothing instead of the translation of older words. It lasts as long as the window. The menu entry turns into "Hide translation" while one stands there.

**The language** is the one chosen under Settings, Language ("Translate messages into"), kept on this device under `backspace-translate-target` (`translationTargetStore`, on its own, so the settings do not load what a conversation needs); without a choice, the app's own language. Browser and system language are not asked, as with the app's language. A message already in that language says so. Choosing another language lets go of what was translated so far.

A translation under a message is marked as what it is (`.msg-translation`, a rule at its left, and "Translated from German" below it), so nobody takes it for what the person wrote.

## Federation

A channel's messages go to the instance that hosts them (`getApiForOrigin`), and that instance's provider translates, under its operator's privacy policy. An instance without one offers the link, whatever the person's own server has.

## Privacy

The draft (`utils/legalTemplates.ts`, section "Content from third parties") says all three ways, and names the provider when there is one (`LegalTemplateFacts.translation`). **Setting a provider changes the draft, so the operator has to publish it again.** **Read DeepL's current terms before choosing it,** as this was checked only against summaries of them: its paid plans are said to delete the text after translating and to offer a contract for processing on the operator's behalf, and its free plan may use what is sent to train its models, which would not fit a server for other people. LibreTranslate on the operator's own server sends nothing elsewhere.

## Tests

`routes/translation.test.ts` (who may, what goes out, both providers, the limit, what is kept), `utils/translationParts.test.ts` (the cut), `utils/deviceTranslation.test.ts` (the browser's translator, also one that never answers), `stores/translationStore.test.ts` (the order of the ways).

Tested for real: Chrome 156's own translator through the menu, from a fresh profile with the download, and the server's path against a stand-in that answers like LibreTranslate. **Not tested with a real DeepL or LibreTranslate account.**
