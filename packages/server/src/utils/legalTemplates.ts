import type { LegalDocumentKind, LegalOperator, LegalTextLanguage } from '@backspace/shared/src/legal.js';

// Drafts of the terms and the privacy policy (docs/systems/legal.md), written
// from what this software does and from what this instance has switched on. An
// admin reads, changes and publishes them; nothing here is ever shown to anyone
// until then. They are a starting point and not legal advice.

export interface LegalTemplateFacts {
  operator: LegalOperator;
  instanceName: string;
  origin: string;
  /** Voice and video run on this instance's LiveKit. */
  voice: boolean;
  /** GIF search is switched on (Klipy). */
  gifs: boolean;
  /** Who translates a message on request for those whose browser cannot. Absent: nobody here. */
  translation?: 'deepl' | 'libretranslate' | null;
  /** Federation with other instances is switched on. */
  federation: boolean;
  /** Spaces of this instance may be listed in the public directory. */
  directory: boolean;
  /** How many daily database backups are kept. */
  backupDays: number;
  /** How many backups from before an update are kept. */
  backupsBeforeUpdates: number;
  /** How many days a backup made by hand is kept at most. */
  backupHandDays: number;
  /** A new account starts in spaces the operator chose. */
  starterSpaces?: boolean;
  /** This instance sends mail, through whom, and whether a new account has to give an address. Absent: no mail. */
  mail?: { provider: 'resend' | 'smtp'; required: boolean } | null;
}

const flatAddress = (operator: LegalOperator): string => operator.address.split('\n').map((line) => line.trim()).filter(Boolean).join(', ');

function sections(parts: ReadonlyArray<string | false | null | undefined>): string {
  return parts.filter((part): part is string => typeof part === 'string').join('\n\n') + '\n';
}

function termsDe(f: LegalTemplateFacts): string {
  const o = f.operator;
  return sections([
    `# Nutzungsbedingungen von ${f.instanceName}`,
    `## 1. Anbieter und Geltung

Diese Bedingungen gelten für die Nutzung des Dienstes ${f.instanceName} unter ${f.origin} (der „Dienst“). Anbieter ist ${o.name}, ${flatAddress(o)}. Weitere Angaben stehen im [Impressum](/imprint).

Der Dienst läuft mit der Software Tavvit.`,
    `## 2. Der Dienst

Der Dienst bietet Text-Chats, Direktnachrichten, Dateiaustausch${f.voice ? ', Sprach- und Videokanäle, Bildschirmübertragung' : ''} sowie Spaces, in denen sich Menschen zusammenfinden. Die Nutzung ist kostenlos. Einen Anspruch auf eine bestimmte Verfügbarkeit oder den Fortbestand einzelner Funktionen gibt es nicht.`,
    `## 3. Konto und Mindestalter

Du musst mindestens ${o.minimumAge} Jahre alt sein und bestätigst das bei der Registrierung. Halte deine Zugangsdaten geheim; du bist für das verantwortlich, was über dein Konto geschieht. Wähle keinen Namen, der über deine Identität täuscht oder Rechte anderer verletzt.`,
    `## 4. Deine Inhalte

Inhalte, die du einstellst, bleiben deine. Du räumst dem Anbieter das einfache, unentgeltliche Recht ein, sie zu speichern, zu übertragen, technisch aufzubereiten und den Personen anzuzeigen, für die sie bestimmt sind, soweit das für den Dienst nötig ist. Dieses Recht endet, sobald du die Inhalte löschst; Kopien in Sicherungen verschwinden mit deren Ablauf. Du versicherst, dass du die nötigen Rechte an deinen Inhalten hast.`,
    `## 5. Regeln

Nicht erlaubt sind insbesondere:

- rechtswidrige Inhalte, etwa Volksverhetzung, Bedrohung, Beleidigung, Verleumdung, Aufrufe zu Gewalt, Darstellungen des sexuellen Missbrauchs von Kindern, terroristische Inhalte, Verletzungen von Urheber- und Persönlichkeitsrechten;
- Belästigung, Hetze und das Veröffentlichen privater Daten anderer ohne deren Einwilligung;
- Betrug, Schadsoftware, Spam und das massenhafte automatisierte Abrufen des Dienstes;
- das Umgehen von Sperren und Schutzmaßnahmen;
- sich als eine andere Person oder als der Anbieter auszugeben.

Programme (Bots) dürfen nur über ein eigenes Bot-Konto laufen, nie über das Konto einer Person. Wer einen Bot betreibt, steht für ihn ein, schützt seinen Zugangsschlüssel und hält die [Regeln für Bots](/developers/docs/conduct) ein. Der Anbieter kann Bots entfernen, die gegen diese Bedingungen verstoßen.`,
    `## 6. Spaces

Wer einen Space anlegt, legt dort Regeln, Rollen und Moderatoren fest und kann eigene automatische Wortfilter einsetzen. Das sind Entscheidungen des Space, nicht des Anbieters. Der Anbieter greift ein, wenn etwas gegen das Gesetz oder diese Bedingungen verstößt.`,
    `## 7. Moderation durch den Anbieter

Der Anbieter kann Inhalte entfernen, Konten befristet oder unbefristet sperren und Spaces aus der öffentlichen Übersicht nehmen oder ihre Verifizierung entziehen. Grundlage sind das Gesetz und diese Bedingungen. Menschen prüfen jeden Fall; der Anbieter trifft keine automatisierten Entscheidungen. Er handelt verhältnismäßig und berücksichtigt die Grundrechte der Beteiligten, besonders die Meinungsfreiheit.

Wer betroffen ist, erfährt in der App oder beim Anmelden, was entschieden wurde und warum. Widerspruch ist formlos an ${o.email} möglich. Der Weg zu den Gerichten bleibt offen.`,
    `## 8. Rechtswidrige Inhalte melden

Melde Inhalte über „Melden“ in der App oder über das [Meldeformular](/report), auch ohne Konto. Gib möglichst genau an, wo der Inhalt steht und warum er aus deiner Sicht rechtswidrig ist. Du erhältst eine Eingangsbestätigung und erfährst das Ergebnis. Wer wiederholt offensichtlich unbegründete Meldungen einreicht, kann gesperrt werden.

Kontaktstelle für Nutzer und Behörden (Art. 11 und 12 DSA): ${o.email}, auf Deutsch oder Englisch.`,
    `## 9. Ende der Nutzung

Du kannst dein Konto jederzeit in den Einstellungen löschen. Der Anbieter kann den Dienst oder deinen Zugang mit einer Frist von vier Wochen beenden und weist in der App darauf hin; aus wichtigem Grund auch ohne Frist.`,
    `## 10. Haftung

Der Anbieter haftet unbeschränkt bei Vorsatz und grober Fahrlässigkeit, für Schäden an Leben, Körper und Gesundheit und nach dem Produkthaftungsgesetz. Bei leicht fahrlässiger Verletzung einer wesentlichen Vertragspflicht ist die Haftung auf den vorhersehbaren, typischen Schaden begrenzt. Im Übrigen ist sie ausgeschlossen. Sichere dir wichtige Inhalte selbst.`,
    `## 11. Änderungen

Eine neue Fassung dieser Bedingungen wird mit einer Frist in der App angekündigt und gilt für dich, sobald du zustimmst. Stimmst du nicht zu, gilt die bisherige Fassung weiter; der Anbieter kann die Nutzung dann nach Nr. 9 beenden.`,
    `## 12. Schluss

Es gilt deutsches Recht. Zwingende Verbraucherschutzvorschriften des Staates, in dem du lebst, bleiben unberührt. An Streitbeilegungsverfahren vor einer Verbraucherschlichtungsstelle nimmt der Anbieter nicht teil. Die Software steht unter der AGPL-3.0; den Quellcode findest du über den Link in der App.`,
  ]);
}

function termsEn(f: LegalTemplateFacts): string {
  const o = f.operator;
  return sections([
    `# Terms of use of ${f.instanceName}`,
    `*This translation is for convenience; the German version is binding.*`,
    `## 1. Provider and scope

These terms apply to the use of the service ${f.instanceName} at ${f.origin} (the "service"). The provider is ${o.name}, ${flatAddress(o)}. See the [legal notice](/imprint) for more.

The service runs on the software Tavvit.`,
    `## 2. The service

The service offers text chats, direct messages, file sharing${f.voice ? ', voice and video channels, screen sharing' : ''} and spaces where people gather. It is free of charge. There is no claim to any particular availability or to any feature continuing to exist.`,
    `## 3. Account and minimum age

You must be at least ${o.minimumAge} years old and confirm this when you register. Keep your credentials secret; you are responsible for what happens through your account. Do not choose a name that misleads about who you are or infringes anyone's rights.`,
    `## 4. Your content

What you post stays yours. You grant the provider the simple, free right to store it, transmit it, process it technically and show it to the people it is meant for, as far as the service needs that. This right ends when you delete the content; copies in backups go when those expire. You assure that you hold the rights your content needs.`,
    `## 5. Rules

In particular, the following are not allowed:

- illegal content, such as incitement to hatred, threats, insults, defamation, calls for violence, depictions of the sexual abuse of children, terrorist content, infringements of copyright and personality rights;
- harassment, hate campaigns and publishing other people's private data without their consent;
- fraud, malware, spam and mass automated access to the service;
- getting around bans and protective measures;
- posing as another person or as the provider.

Programs (bots) may run only on a bot's account of their own, never on a person's account. Whoever runs a bot answers for it, keeps its token safe and follows the [rules for bots](/developers/docs/conduct). The provider may remove bots that break these terms.`,
    `## 6. Spaces

Whoever creates a space sets its rules, roles and moderators and may use automatic word filters there. Those are the space's decisions, not the provider's. The provider steps in when something breaks the law or these terms.`,
    `## 7. Moderation by the provider

The provider can remove content, suspend accounts for a time or indefinitely, and take spaces off the public listing or withdraw their verification. This rests on the law and on these terms. People review each case; the provider makes no automated decisions. It acts proportionately and takes the fundamental rights of those involved into account, freedom of expression in particular.

Anyone affected learns in the app or when signing in what was decided and why. You can object informally at ${o.email}. The way to the courts stays open.`,
    `## 8. Reporting illegal content

Report content through "Report" in the app or through the [report form](/report), also without an account. Say as exactly as you can where the content is and why you consider it illegal. You get a confirmation and learn the outcome. Anyone who repeatedly files manifestly unfounded reports may be suspended.

Point of contact for users and authorities (Art. 11 and 12 DSA): ${o.email}, in German or English.`,
    `## 9. Ending use

You can delete your account in the settings at any time. The provider can end the service or your access with four weeks' notice, given in the app; for good cause, without notice.`,
    `## 10. Liability

The provider is liable without limit for intent and gross negligence, for harm to life, body and health and under the Product Liability Act. For a slightly negligent breach of an essential contractual duty, liability is limited to the foreseeable, typical damage. Otherwise it is excluded. Keep your own copies of what matters to you.`,
    `## 11. Changes

A new version of these terms is announced in the app with a period of notice and applies to you once you agree. If you do not agree, the earlier version continues to apply; the provider may then end your use under section 9.`,
    `## 12. Final provisions

German law applies. Mandatory consumer protection rules of the country you live in are unaffected. The provider does not take part in dispute resolution before a consumer arbitration board. The software is licensed under the AGPL-3.0; the link in the app leads to its source code.`,
  ]);
}

function privacyDe(f: LegalTemplateFacts): string {
  const o = f.operator;
  return sections([
    `# Datenschutzerklärung von ${f.instanceName}`,
    `## 1. Verantwortlicher

${o.name}, ${flatAddress(o)}, E-Mail: ${o.email}.${o.dpo ? ` Datenschutzbeauftragte Person: ${o.dpo}.` : ''}`,
    `## 2. Das Wichtigste vorab

Dieser Dienst zeigt keine Werbung, verkauft keine Daten und setzt keine Analyse- oder Tracking-Werkzeuge ein. ${!f.mail ? 'Er verlangt keine E-Mail-Adresse.' : f.mail.required ? 'Für ein neues Konto verlangt er eine E-Mail-Adresse und schreibt daran nur zu deinem Konto, nie Werbung.' : 'Eine E-Mail-Adresse ist freiwillig; er schreibt daran nur zu deinem Konto, nie Werbung.'} Nachrichten sind auf dem Weg zum Server verschlüsselt, auf dem Server aber nicht Ende-zu-Ende verschlüsselt: Der Betreiber könnte sie technisch lesen und tut das nur, wenn es für eine gemeldete Rechtsverletzung nötig ist.`,
    `## 3. Konto und Profil

Wir speichern deinen Benutzernamen, dein Passwort nur als Hash, den Zeitpunkt der Registrierung und deiner Zustimmung zu den Nutzungsbedingungen sowie die Angaben, die du freiwillig machst (Anzeigename, Bild, Banner, Biografie, Pronomen, Links, Farben, Status). Rechtsgrundlage ist die Erfüllung des Nutzungsvertrags (Art. 6 Abs. 1 lit. b DSGVO). Die Daten bleiben, bis du dein Konto löschst. Änderst du deinen Benutzernamen, halten wir den alten 30 Tage lang frei, damit sich niemand für dich ausgeben kann, und speichern dafür, dass er zu deinem Konto gehörte.

Beim Löschen werden dein Profil, deine Mitgliedschaften und Freundschaften entfernt, ebenso deine Nachrichten in Spaces mit ihren Anhängen und Reaktionen. Direktnachrichten bleiben für die anderen Beteiligten lesbar, stehen dann aber unter „Gelöschter Nutzer“.`,
    f.starterSpaces && `Ein neues Konto ist von Anfang an Mitglied der öffentlichen Spaces, die der Betreiber dafür ausgewählt hat; du kannst sie jederzeit verlassen.`,
    f.mail && `Gibst du eine E-Mail-Adresse an, speichern wir sie, den Zeitpunkt ihrer Bestätigung und die Sprache, in der du Mails bekommst. Wir nutzen sie, um die Adresse zu bestätigen und ein vergessenes Passwort zurückzusetzen (Art. 6 Abs. 1 lit. b DSGVO) und um dich über sicherheitsrelevante Änderungen an deinem Konto zu informieren (Art. 6 Abs. 1 lit. f DSGVO). Andere Personen sehen sie nicht. Sie bleibt, bis du sie entfernst oder dein Konto löschst. In der Warteschlange für den Versand liegt sie nur, bis die Mail verschickt ist; danach behalten wir bis zu sieben Tage einen Hash, um zu häufige Mails zu verhindern. Kommt eine Mail dauerhaft zurück oder wird sie als Spam gemeldet, behalten wir den Hash der Adresse, damit nichts mehr dorthin geht: bei Rückläufern 30 Tage, bei Spam-Meldungen ohne Frist. Administratoren können ein Konto über seine vollständige bestätigte Adresse finden, etwa um eine Anfrage zu beantworten; eine Liste der Adressen bekommen sie nicht.`,
    `## 4. Nachrichten und Dateien

Wir speichern deine Nachrichten, Reaktionen, Lesestände und hochgeladenen Dateien, um sie den Beteiligten anzuzeigen (Art. 6 Abs. 1 lit. b DSGVO), bis du oder eine berechtigte Person sie löscht. Auf dem Weg zum Server sind sie verschlüsselt (HTTPS), auf dem Server aber nicht Ende-zu-Ende-verschlüsselt, auch Direktnachrichten nicht: Wer den Server betreibt, könnte sie technisch lesen. Wir lesen sie nicht, außer wenn uns eine Meldung zu ihnen erreicht, ein Gesetz es verlangt oder es nötig ist, um den Dienst vor Missbrauch zu schützen. Eine weitergeleitete Nachricht ist eine Kopie unter dem Namen der Person, die sie weitergeleitet hat; sie bleibt, wenn das Original gelöscht wird. Was in einem Ankündigungskanal gepostet wird, geht als Kopie unter dem Namen dieses Kanals an die Kanäle anderer Spaces auf diesem Server, die ihm folgen; eine spätere Bearbeitung oder Löschung erreicht diese Kopien nicht. Wir speichern, wer ein solches Folgen eingerichtet hat, und es läuft weiter, wenn das Konto dieser Person nicht mehr besteht. Bei einer Umfrage kann jeder im Kanal sehen, wer was gewählt hat. Wenn du einem Thread folgst, speichern wir das, um dich über neue Antworten zu benachrichtigen. Nachrichten, die du speicherst, deine Erinnerungen dazu und die Stichwörter, die dich benachrichtigen, sieht nur du. Wenn du bei einem Termin zusagst, sehen das die Mitglieder des Space, und wir erinnern dich kurz vor dem Beginn. Verlangt ein Space die Zustimmung zu seinen Regeln, speichern wir, wann du zugestimmt hast. Tonclips, die du einem Soundboard hinzufügst, stehen allen Mitgliedern des Space zur Verfügung. Emojis und Sticker, die du einem Space hinzufügst, ebenso; wir speichern dazu, wer sie hinzugefügt hat, und sie zählen zu deinem Speicherplatz. Ein Emoji eines Space kann in Nachrichten überall auf diesem Server erscheinen, und sein Bild ist unter seiner Adresse für jeden abrufbar. Mitglieder eines Space können Bots hinzufügen. Ein Bot ist ein Programm, das nicht wir betreiben, sondern die Person, der es gehört: Er sieht und kann weitergeben, was in den Kanälen steht, die er lesen darf, und wir haben keinen Einfluss darauf, was sein Betreiber damit tut. Ein Bot ist an seiner Nachricht gekennzeichnet und in der Mitgliederliste zu erkennen. Wenn du einen Bot betreibst, speichern wir, dass er dir gehört und wann er zuletzt benutzt wurde, von seinem Schlüssel nur einen Hash. Ein Space kann Webhooks einrichten: Wer die Adresse eines Webhooks kennt, kann Nachrichten in den Kanal schreiben. Dazu speichern wir den Namen, wer ihn angelegt hat und wann er zuletzt benutzt wurde, vom Geheimnis in der Adresse nur einen Hash. Dateien liegen unter schwer zu erratenden Adressen und sind für jeden abrufbar, der die Adresse kennt. Bilder werden samt ihren Metadaten gespeichert; entferne etwa Standortangaben, bevor du ein Foto hochlädst.`,
    f.voice && `## 5. Sprache und Video

Sprach- und Videoverbindungen laufen über den eigenen Server des Betreibers (LiveKit). Sie werden in Echtzeit vermittelt und nicht aufgezeichnet. Rechtsgrundlage ist Art. 6 Abs. 1 lit. b DSGVO.

Schaut ihr in einem Sprachkanal gemeinsam ein Video, hält unser Server dessen Link, Titel und die Warteschlange nur im Arbeitsspeicher, solange der Anruf läuft; gespeichert wird davon nichts. Wer den Sprachkanal sehen kann, sieht den Titel dessen, was gerade läuft; wer im Anruf ist, sieht die Links, die Warteschlange und wer die Sitzung gestartet hat. Den Titel fragt unser Server bei YouTube oder Vimeo ab; dorthin geht dabei nur der Link des Videos, nichts von dir. Das Video selbst lädt dein Gerät erst nach deiner Zustimmung (siehe „Inhalte von Dritten“).`,
    `## 6. Status und Aktivität

Andere sehen, ob du online bist, und auf Wunsch deinen Status. In der Desktop-App erkennt eine Prüfung auf deinem Computer laufende Spiele; nur der Name eines erkannten Spiels wird geteilt, und nur solange Aktivität teilen eingeschaltet ist. Beides stellst du in den Einstellungen ab. Rechtsgrundlage ist Art. 6 Abs. 1 lit. b DSGVO.`,
    `## 7. Technische Daten

Dein Gerät sendet bei jeder Verbindung seine IP-Adresse. Der Server nutzt sie im Arbeitsspeicher, um die Verbindung herzustellen und Missbrauch zu begrenzen (Art. 6 Abs. 1 lit. f DSGVO), und schreibt sie vollständig weder in die Datenbank noch in seine Protokolle. Die Protokolle enthalten Zeit, Anfrageart und Pfad, keine Suchbegriffe, und sind in ihrer Größe begrenzt. Zu jeder Anmeldung speichern wir die IP-Adresse gekürzt (ohne ihren letzten Teil), Browser und Betriebssystem und den Zeitpunkt der letzten Aktivität, damit du unter Einstellungen → Sicherheit erkennst, wo du angemeldet bist, und dort abmelden kannst, was nicht deins ist (Art. 6 Abs. 1 lit. f DSGVO). Das endet mit der Sitzung, spätestens nach 30 Tagen.`,
    `Außerdem führen wir für dein Konto eine Liste sicherheitsrelevanter Ereignisse (Anmeldungen, Fehlversuche, Änderungen an Passwort, Adresse und Zwei-Faktor-Anmeldung) mit Browser, Betriebssystem und gekürzter IP-Adresse, damit du sie unter Einstellungen → Sicherheit prüfen kannst und wir dich vor fremden Zugriffen warnen können (Art. 6 Abs. 1 lit. f DSGVO). Wir löschen jeden Eintrag nach 90 Tagen. Um neue Geräte zu erkennen, schickt dein Browser beim Anmelden eine zufällige Geräte-ID; davon speichern wir nur einen Hash und löschen ihn, wenn das Gerät 180 Tage nicht mehr angemeldet war. Nutzt du die Zwei-Faktor-Anmeldung, speichern wir das Geheimnis dafür verschlüsselt und Wiederherstellungscodes nur als Hash, bis du sie ausschaltest oder dein Konto löschst. Administratoren können diese Liste und die Sitzungen eines Kontos einsehen, wenn sie Missbrauch nachgehen oder einer Bitte um Hilfe (Art. 6 Abs. 1 lit. f DSGVO).`,
    `## 8. Speicher im Browser

Der Dienst setzt keine Cookies. Er speichert im Browser oder in der Desktop-App deine Anmeldung, Einstellungen und Entwürfe sowie eine zufällige Geräte-ID zum Schutz deines Kontos, weil er sonst nicht funktioniert (§ 25 Abs. 2 TDDDG).`,
    `## 9. Inhalte von Dritten

Für Link-Vorschauen ruft unser Server die verlinkte Seite ab; die Seite sieht dabei den Server, nicht dich. Bilder, Vorschaubilder, Audio und Videos von fremden Servern, darunter YouTube, Vimeo und Spotify, lädt dein Gerät erst, wenn du dem zustimmst: einzeln per Klick oder dauerhaft mit „Immer erlauben“. Dann erfährt der jeweilige Anbieter deine IP-Adresse und kann eigene Cookies setzen; manche sitzen außerhalb der EU, etwa in den USA. Rechtsgrundlage ist deine Einwilligung (Art. 6 Abs. 1 lit. a DSGVO, § 25 Abs. 1 TDDDG), die du in den Einstellungen unter „Datenschutz“ jederzeit widerrufen kannst.`,
    `Teilt jemand einen Einladungslink in einem anderen Dienst, ruft dieser Dienst bei uns Name, Beschreibung, Mitgliederzahl und Symbol des Spaces ab, um eine Vorschau zu zeigen. Wer den Link hat, sieht diese Angaben auch ohne Konto; Suchmaschinen bitten wir, solche Links nicht aufzunehmen.`,
    f.gifs && `Die GIF-Suche läuft über unseren Server zum Anbieter Klipy; die GIFs selbst lädt dein Gerät von Klipy, ebenfalls erst nach deiner Zustimmung.`,
    `Lässt du eine Nachricht übersetzen, übersetzt sie zuerst dein Browser selbst, wenn er das kann; ihr Text bleibt dann auf deinem Gerät. Nur die Sprachdaten dafür lädt dein Browser von seinem Hersteller.`,
    f.translation === 'deepl' && `Kann dein Browser das nicht, schicken wir auf deine Anfrage den Text dieser Nachricht ohne deinen Namen an die DeepL SE, Köln, Deutschland, die ihn in unserem Auftrag übersetzt (Art. 28 DSGVO). Die Antwort halten wir kurz im Arbeitsspeicher, damit dieselbe Nachricht nicht mehrmals gesendet wird, und speichern sie nicht dauerhaft.`,
    f.translation === 'libretranslate' && `Kann dein Browser das nicht, schicken wir auf deine Anfrage den Text dieser Nachricht ohne deinen Namen an einen Übersetzungsdienst (LibreTranslate), den wir dafür betreiben oder betreiben lassen. Die Antwort halten wir kurz im Arbeitsspeicher, damit dieselbe Nachricht nicht mehrmals gesendet wird, und speichern sie nicht dauerhaft.`,
    `Wählst du „In Google Übersetzer öffnen“, öffnet dein Browser die Seite von Google mit dem Text der Nachricht. Das geht von deinem Gerät aus und nur auf diesen Klick hin; dort gelten die Bedingungen von Google.`,
    `Holst du Kanäle und Rollen aus einer Discord-Vorlage oder die Emojis und Sticker eines Discord-Servers in einen Space, fragt unser Server auf deine Anfrage bei der Discord Inc., San Francisco, USA, an (Art. 6 Abs. 1 lit. b DSGVO). Dorthin gehen der Code der Vorlage oder die ID des Servers und das Token deines eigenen Bots, sonst nichts von dir. Das Token nutzen wir nur für diese Abfrage; wir speichern und protokollieren es nicht. Von Discords Antwort behalten wir nur Namen, Bilder und Discord-IDs der übernommenen Emojis und Sticker, nicht, wer sie bei Discord hochgeladen hat. Die Bilder lädt unser Server von Discord; Discord sieht dabei unseren Server, nicht dich.`,
    f.federation && `## 10. Andere Instanzen

Dieser Dienst ist mit anderen Tavvit-Servern verbunden. Schreibst du Personen auf anderen Servern oder trittst du Spaces dort bei, gehen dein Name, dein Bild und die betreffenden Nachrichten dorthin. Für den anderen Server ist dessen Betreiber verantwortlich. Rechtsgrundlage ist Art. 6 Abs. 1 lit. b DSGVO.`,
    f.directory && `## 11. Öffentliches Verzeichnis

Spaces, deren Inhaber das wünscht und die freigegeben wurden, erscheinen mit Name, Beschreibung, Bild und Mitgliederzahl in einem öffentlichen Verzeichnis, das bei Cloudflare betrieben wird. Daten einzelner Mitglieder gehen dorthin nicht.`,
    `## 12. Meldungen und Moderation

Wer etwas meldet, gibt die Meldung und, ohne Konto, Name und E-Mail-Adresse an; wir speichern dazu eine Kopie des gemeldeten Inhalts (Art. 6 Abs. 1 lit. c und f DSGVO, Art. 16 DSA). Entschiedene Meldungen und gelesene Hinweise löschen wir nach einem Jahr, das Protokoll der Administratoren nach zwei Jahren. Moderationsprotokolle eines Space löschen wir nach 180 Tagen. Administratoren können zu einem Konto kurze Notizen für die Moderation anlegen; sie stehen in der Datenauskunft dieses Kontos und werden mit ihm gelöscht. Automatisierte Entscheidungen im Sinne von Art. 22 DSGVO finden nicht statt; Wortfilter legt ein Space selbst fest.`,
    `## 13. Hosting und Sicherungen

${o.hosting ? `Der Server steht bei ${o.hosting}, der die Daten in unserem Auftrag verarbeitet (Art. 28 DSGVO).` : 'Der Betreiber betreibt den Server selbst.'} Täglich entsteht eine Sicherung der Datenbank; die letzten ${f.backupDays} bleiben erhalten, dazu die letzten ${f.backupsBeforeUpdates} vor Updates. Von Hand angelegte Sicherungen bleiben höchstens ${f.backupHandDays} Tage. Gelöschtes verschwindet erst mit Ablauf dieser Sicherungen ganz.`,
    `Wenn du Push auf einem Gerät einschaltest, speichern wir die Adresse, die dein Browser dafür nennt, und zwei Schlüssel. Benachrichtigungen gehen dann über den Push-Dienst deines Browsers (Google, Mozilla, Apple oder Microsoft). Ihr Inhalt ist für diesen Dienst verschlüsselt; er sieht nur, wann und an welches Gerät etwas geht. Das endet, wenn du Push ausschaltest oder dich auf dem Gerät abmeldest.`,
    f.mail?.provider === 'resend' && `E-Mails verschickt in unserem Auftrag (Art. 28 DSGVO) die Plus Five Five, Inc., San Francisco, USA (Resend). Sie erhält die Empfängeradresse, den Benutzernamen und den Inhalt der Mail einschließlich des darin enthaltenen Links und erfasst, ob die Mail zugestellt wurde; sie bewahrt das bis zu 30 Tage auf. Die Verarbeitung findet in den USA statt. Die Übermittlung stützt sich auf den Angemessenheitsbeschluss zum EU-US Data Privacy Framework (Art. 45 DSGVO) und zusätzlich auf EU-Standardvertragsklauseln (Art. 46 DSGVO).`,
    f.mail?.provider === 'smtp' && `E-Mails verschicken wir über [Name und Sitz des Mail-Dienstes eintragen; bei einem eigenen Mailserver diesen Absatz löschen]. Der Dienst erhält die Empfängeradresse, den Benutzernamen und den Inhalt der Mail einschließlich des darin enthaltenen Links und verarbeitet sie in unserem Auftrag (Art. 28 DSGVO).`,
    `## 14. Deine Rechte

Du hast das Recht auf Auskunft, Berichtigung, Löschung, Einschränkung, Datenübertragbarkeit und Widerspruch (Art. 15 bis 21 DSGVO). Vieles kannst du in den Einstellungen selbst tun: Eine Kopie deiner Daten forderst du unter Einstellungen → Konto an; wir halten sie eine Woche zum Herunterladen bereit und löschen sie dann. Für alles andere genügt eine E-Mail an ${o.email}. Du kannst dich außerdem bei einer Datenschutz-Aufsichtsbehörde beschweren (Art. 77 DSGVO).`,
    `## 15. Mindestalter und Änderungen

Der Dienst richtet sich an Personen ab ${o.minimumAge} Jahren. Ändert sich diese Erklärung, findest du die aktuelle Fassung immer hier.`,
  ]);
}

function privacyEn(f: LegalTemplateFacts): string {
  const o = f.operator;
  return sections([
    `# Privacy policy of ${f.instanceName}`,
    `*This translation is for convenience; the German version is binding.*`,
    `## 1. Controller

${o.name}, ${flatAddress(o)}, email: ${o.email}.${o.dpo ? ` Data protection officer: ${o.dpo}.` : ''}`,
    `## 2. In short

This service shows no ads, sells no data and uses no analytics or tracking tools. ${!f.mail ? 'It does not ask for an email address.' : f.mail.required ? 'A new account has to give an email address; the service writes to it only about your account, never with advertising.' : 'An email address is optional; the service writes to it only about your account, never with advertising.'} Messages are encrypted on their way to the server, but not end-to-end encrypted on it: the operator could technically read them, and does so only when a reported violation requires it.`,
    `## 3. Account and profile

We store your username, your password only as a hash, when you registered and agreed to the terms, and what you choose to add (display name, picture, banner, biography, pronouns, links, colours, status). The legal basis is performing the contract of use (Art. 6(1)(b) GDPR). The data stays until you delete your account. If you change your username, we keep the old one reserved for 30 days, so that nobody can pose as you, and store for this that it belonged to your account.

Deleting removes your profile, memberships and friendships, and your messages in spaces with their attachments and reactions. Direct messages stay readable for the others involved, but then appear under "Deleted User".`,
    f.starterSpaces && `A new account starts as a member of the public spaces the operator chose for this; you can leave them at any time.`,
    f.mail && `If you give an email address, we store it, when it was confirmed and the language you get mail in. We use it to confirm the address and to reset a forgotten password (Art. 6(1)(b) GDPR) and to tell you about security-relevant changes to your account (Art. 6(1)(f) GDPR). Other people do not see it. It stays until you remove it or delete your account. It sits in the sending queue only until the mail has gone; after that we keep a hash for up to seven days to prevent too many mails. If a mail bounces for good or is reported as spam, we keep the address's hash so that nothing more goes there: 30 days for a bounce, without limit for a spam report. Administrators can find an account by its whole confirmed address, for example to answer a request; they get no list of addresses.`,
    `## 4. Messages and files

We store your messages, reactions, read states and uploaded files in order to show them to those involved (Art. 6(1)(b) GDPR), until you or someone entitled deletes them. They are encrypted on their way to the server (HTTPS), but not end-to-end encrypted on it, direct messages included: whoever runs the server could technically read them. We do not read them unless a report about them reaches us, a law requires it, or it is needed to protect the service from abuse. A forwarded message is a copy under the name of the person who forwarded it; it stays when the original is deleted. What is posted in an announcement channel goes, as a copy under the name of that channel, to the channels of other spaces on this server that follow it; a later edit or deletion does not reach those copies. We store who set up such a follow, and it keeps working when that person's account is gone. In a poll, everyone in the channel can see who chose what. If you follow a thread, we store that in order to notify you of new replies. The messages you save, your reminders for them and the words that alert you are seen only by you. If you say you are going to an event, the members of the space can see it, and we remind you shortly before it starts. If a space asks you to agree to its rules, we store when you agreed. Clips you add to a soundboard are available to all members of the space. So are emoji and stickers you add to a space; we store who added them, and they count towards your storage. A space's emoji can appear in messages anywhere on this server, and its picture can be fetched at its address by anyone. Members of a space can add bots. A bot is a program run not by us but by the person it belongs to: it sees, and can pass on, what is in the channels it may read, and we have no say in what its operator does with that. A bot is marked at its message and can be recognised in the member list. If you run a bot, we store that it is yours and when it was last used, and of its key only a hash. A space can set up webhooks: whoever knows a webhook's address can post into the channel. For this we store its name, who made it and when it was last used, and of the secret in the address only a hash. Files live at addresses that are hard to guess and can be fetched by anyone who knows the address. Images are stored with their metadata; remove location data, for example, before you upload a photo.`,
    f.voice && `## 5. Voice and video

Voice and video connections run through the operator's own server (LiveKit). They are relayed in real time and not recorded. The legal basis is Art. 6(1)(b) GDPR.

When you watch a video together in a voice channel, our server holds its link, its title and the queue in memory only, while the call lasts; none of it is stored. Whoever can see the voice channel sees the title of what is playing; those in the call see the links, the queue and who started the session. Our server asks YouTube or Vimeo for the title; only the video's link goes there, nothing of yours. Your device loads the video itself only once you agree (see "Content from third parties").`,
    `## 6. Status and activity

Others see whether you are online and, if you wish, your status. In the desktop app, a check on your computer recognises running games; only the name of a recognised game is shared, and only while sharing activity is on. You can turn both off in the settings. The legal basis is Art. 6(1)(b) GDPR.`,
    `## 7. Technical data

Your device sends its IP address with every connection. The server uses it in working memory to establish the connection and to limit abuse (Art. 6(1)(f) GDPR), and writes it in full neither to the database nor to its logs. The logs hold the time, the kind of request and the path, no search terms, and are limited in size. For each sign-in we store the IP address cut short (without its last part), the browser and system and the time of last activity, so that under Settings → Security you can recognise where you are signed in and sign out what is not yours (Art. 6(1)(f) GDPR). This ends with the session, after 30 days at the latest.`,
    `We also keep a list of security-relevant events for your account (sign-ins, failed attempts, changes to your password, address and two-factor authentication) with the browser, system and shortened IP address, so that you can check them under Settings → Security and we can warn you about access by others (Art. 6(1)(f) GDPR). We delete each entry after 90 days. To recognise new devices, your browser sends a random device ID when signing in; we store only a hash of it and delete that once the device has not signed in for 180 days. If you use two-factor authentication, we store its secret encrypted and recovery codes only as hashes, until you turn it off or delete your account. Administrators can see this list and an account's sessions when looking into abuse or a request for help (Art. 6(1)(f) GDPR).`,
    `## 8. Browser storage

The service sets no cookies. It stores your sign-in, settings and drafts, and a random device ID that protects your account, in the browser or the desktop app, because it does not work otherwise (§ 25(2) TDDDG).`,
    `## 9. Content from third parties

For link previews our server fetches the linked page; the page sees the server, not you. Images, thumbnails, audio and video from other servers, including YouTube, Vimeo and Spotify, are loaded by your device only once you agree: one at a time with a click, or permanently with "Always allow". The provider concerned then learns your IP address and may set its own cookies; some are outside the EU, for example in the USA. The legal basis is your consent (Art. 6(1)(a) GDPR, § 25(1) TDDDG), which you can withdraw at any time in the settings under "Privacy".`,
    `If someone shares an invite link on another service, that service fetches the space's name, description, member count and icon from us to show a preview. Anyone with the link sees these details without an account; we ask search engines not to list such links.`,
    f.gifs && `GIF search goes through our server to the provider Klipy; your device loads the GIFs themselves from Klipy, also only after you agree.`,
    `If you have a message translated, your browser does it itself first if it can, and the text stays on your device. Only the language data for this comes to your browser from its maker.`,
    f.translation === 'deepl' && `If your browser cannot, we send the text of that message, on your request and without your name, to DeepL SE, Cologne, Germany, which translates it on our behalf (Art. 28 GDPR). We keep the answer in memory for a short while, so that the same message is not sent several times, and do not store it.`,
    f.translation === 'libretranslate' && `If your browser cannot, we send the text of that message, on your request and without your name, to a translation service (LibreTranslate) that we run or have run for this. We keep the answer in memory for a short while, so that the same message is not sent several times, and do not store it.`,
    `If you choose "Open in Google Translate", your browser opens Google's page with the text of the message. This happens from your device and only on that click; Google's terms apply there.`,
    `If you bring channels and roles from a Discord template, or the emoji and stickers of a Discord server, into a space, our server asks Discord Inc., San Francisco, USA, on your request (Art. 6(1)(b) GDPR). What goes there is the template's code, or the server's ID and the token of your own bot, nothing else of yours. We use the token for that request only; we neither store nor log it. Of Discord's answer we keep only the names, pictures and Discord IDs of the emoji and stickers brought over, not who uploaded them on Discord. Our server fetches the pictures from Discord; Discord sees our server, not you.`,
    f.federation && `## 10. Other instances

This service is connected to other Tavvit servers. If you write to people on other servers or join spaces there, your name, your picture and the messages concerned go there. The operator of that server is responsible for it. The legal basis is Art. 6(1)(b) GDPR.`,
    f.directory && `## 11. Public directory

Spaces whose owners want it and which were approved appear with their name, description, picture and member count in a public directory run on Cloudflare. No data about individual members goes there.`,
    `## 12. Reports and moderation

Someone who reports something provides the report and, without an account, a name and email address; we store a copy of the reported content with it (Art. 6(1)(c) and (f) GDPR, Art. 16 DSA). We delete decided reports and read notices after a year, and the administrators' log after two years. We delete a space's moderation log after 180 days. Administrators can keep short notes about an account for moderation; they are part of that account's data export and are deleted with it. There are no automated decisions within the meaning of Art. 22 GDPR; word filters are set by a space itself.`,
    `## 13. Hosting and backups

${o.hosting ? `The server is hosted by ${o.hosting}, which processes the data on our behalf (Art. 28 GDPR).` : 'The operator runs the server themselves.'} A backup of the database is made daily; the last ${f.backupDays} are kept, plus the last ${f.backupsBeforeUpdates} from before updates. Backups made by hand are kept for at most ${f.backupHandDays} days. Deleted data is fully gone only once those backups expire.`,
    `If you turn on push on a device, we store the address your browser names for it and two keys. Notifications then go through your browser's push service (Google, Mozilla, Apple or Microsoft). Their content is encrypted against that service; it only sees when and to which device something goes. This ends when you turn push off or sign out on that device.`,
    f.mail?.provider === 'resend' && `Plus Five Five, Inc., San Francisco, USA (Resend) sends email on our behalf (Art. 28 GDPR). It receives the recipient's address, the username and the content of the mail including the link in it, and records whether the mail was delivered; it keeps this for up to 30 days. Processing takes place in the USA. The transfer rests on the adequacy decision for the EU-US Data Privacy Framework (Art. 45 GDPR) and additionally on EU standard contractual clauses (Art. 46 GDPR).`,
    f.mail?.provider === 'smtp' && `We send email through [enter the name and seat of the mail service; delete this paragraph for your own mail server]. The service receives the recipient's address, the username and the content of the mail including the link in it, and processes them on our behalf (Art. 28 GDPR).`,
    `## 14. Your rights

You have the right to access, rectification, erasure, restriction, data portability and to object (Art. 15 to 21 GDPR). You can do much of this yourself in the settings: you ask for a copy of your data under Settings → Account; we keep it ready to download for a week and then delete it. For everything else an email to ${o.email} is enough. You can also complain to a data protection supervisory authority (Art. 77 GDPR).`,
    `## 15. Minimum age and changes

The service is meant for people aged ${o.minimumAge} and over. If this policy changes, you will always find the current version here.`,
  ]);
}

/** A draft of a document in one language. */
export function legalTemplate(kind: LegalDocumentKind, language: LegalTextLanguage, facts: LegalTemplateFacts): string {
  if (kind === 'terms') return language === 'de' ? termsDe(facts) : termsEn(facts);
  return language === 'de' ? privacyDe(facts) : privacyEn(facts);
}
