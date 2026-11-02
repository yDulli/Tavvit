/**
 * The words of every mail, in every language the app speaks. The server has no catalog
 * otherwise: it sends error codes and the client finds the words, but nobody else is there
 * to translate a mail. `{name}` is filled in, and escaped, by templates.ts.
 *
 * Mail is sent for a reason someone needs, so it stays short and has no marketing in it.
 */
export const MAIL_LOCALES = ['en', 'de', 'pt', 'ru', 'zh'] as const;
export type MailLocale = (typeof MAIL_LOCALES)[number];

export function isMailLocale(value: unknown): value is MailLocale {
  return typeof value === 'string' && (MAIL_LOCALES as readonly string[]).includes(value);
}

export const EMAIL_KINDS = [
  'verify_email',
  'change_email_confirm',
  'change_requested',
  'email_changed',
  'email_removed',
  'password_reset',
  'password_changed',
  'username_changed',
  'address_in_use',
  'new_device',
  'suspicious_login',
  'mfa_failures',
  'two_factor_on',
  'two_factor_off',
  'two_factor_reset',
  'recovery_regenerated',
  'recovery_used',
  'operator_disk_high',
  'operator_backup_failed',
  'operator_backup_old',
  'operator_offsite_failed',
  'operator_restart_loop',
  'test',
] as const;
export type EmailKind = (typeof EMAIL_KINDS)[number];

export interface MailCopy {
  subject: string;
  heading: string;
  lines: readonly string[];
  /** The button's words, for a mail that has one. */
  action?: string;
  /** What comes after the button: usually what to do if this was not you. */
  after?: readonly string[];
}

interface LocaleCopy {
  /** Above the raw link, for when the button does not work. */
  fallback: string;
  footer: string;
  legalNotice: string;
  privacy: string;
  /** Where a browser and system cannot be told. */
  unknownDevice: string;
  kinds: Record<EmailKind, MailCopy>;
}

export const MAIL_COPY: Record<MailLocale, LocaleCopy> = {
  en: {
    fallback: 'If the button does not work, open this link:',
    footer: 'This is an automatic message about your account at {instance}.',
    legalNotice: 'Legal notice',
    privacy: 'Privacy',
    unknownDevice: 'Unknown device',
    kinds: {
      verify_email: {
        subject: 'Confirm your email address for {instance}',
        heading: 'Confirm your email address',
        lines: ['Hi {username}, please confirm that this address is yours. The link works for 24 hours and only once.'],
        action: 'Confirm address',
        after: ['If you did not create an account, you can ignore this mail.'],
      },
      change_email_confirm: {
        subject: 'Confirm your new email address for {instance}',
        heading: 'Confirm your new address',
        lines: ['Hi {username}, you asked to use this address for your account. Your old address stays in force until you confirm. The link works for 24 hours and only once.'],
        action: 'Confirm new address',
        after: ['If you did not ask for this, you can ignore this mail.'],
      },
      change_requested: {
        subject: 'Your email address at {instance} is about to change',
        heading: 'A new address was requested',
        lines: ['Someone signed in to your account {username} asked to change its address to {newAddress}. Nothing changes until that address is confirmed.'],
        after: ['If this was not you, change your password now and sign out the devices you do not recognize under Settings, Security.'],
      },
      email_changed: {
        subject: 'Your email address at {instance} was changed',
        heading: 'Your address was changed',
        lines: ['The address of your account {username} is now {newAddress}. This address is no longer connected to it.'],
        after: ['If this was not you, contact the operator of this server right away.'],
      },
      email_removed: {
        subject: 'Your email address at {instance} was removed',
        heading: 'Your address was removed',
        lines: ['This address is no longer connected to your account {username}. Without a confirmed address, a forgotten password can only be reset by an administrator.'],
        after: ['If this was not you, contact the operator of this server right away.'],
      },
      password_reset: {
        subject: 'Reset your password for {instance}',
        heading: 'Reset your password',
        lines: ['Someone asked to reset the password of your account {username}. The link works for 30 minutes and only once.'],
        action: 'Choose a new password',
        after: ['If this was not you, you can ignore this mail: your password stays as it is.'],
      },
      password_changed: {
        subject: 'Your password at {instance} was changed',
        heading: 'Your password was changed',
        lines: ['The password of your account {username} was just changed, and other devices were signed out.'],
        action: 'This was not me',
        after: ['If this was you, there is nothing to do. If not, the button above lets you set a new password.'],
      },
      username_changed: {
        subject: 'Your username at {instance} was changed',
        heading: 'Your username was changed',
        lines: ['Your account is now called {username}. Use this name to sign in from now on.'],
        action: 'This was not me',
        after: ['If this was you, there is nothing to do. If not, the button above lets you set a new password.'],
      },
      address_in_use: {
        subject: 'Someone tried to use your email address at {instance}',
        heading: 'Your address is already in use',
        lines: ['Someone tried to connect this address to an account at {instance}, but it already belongs to one. Nothing was changed.'],
        after: ['If this was you, sign in with your account or use "Forgot password". If not, you can ignore this mail.'],
      },
      new_device: {
        subject: 'New sign-in to your account at {instance}',
        heading: 'A new device signed in',
        lines: ['Your account {username} was signed in on a device not seen before.', 'Device: {device}. Address: {addressHint}. Time: {time}.'],
        after: ['If this was you, there is nothing to do. If not, change your password now and sign that device out under Settings, Security.'],
      },
      suspicious_login: {
        subject: 'Failed sign-ins to your account at {instance}',
        heading: 'Several sign-ins failed',
        lines: ['Someone tried several times to sign in to your account {username} with a wrong password. Nobody got in.', 'Last attempt: {device}, address {addressHint}, {time}.'],
        after: ['If this was you, there is nothing to do. If not, make sure your password is long and used nowhere else, and consider turning on two-factor authentication.'],
      },
      mfa_failures: {
        subject: 'Someone knows your password at {instance}',
        heading: 'Wrong codes after the right password',
        lines: ['Someone entered the right password for your account {username}, then wrong two-factor codes. Nobody got in.', 'Last attempt: {device}, address {addressHint}, {time}.'],
        after: ['If this was not you, your password is known to someone else. Change it now.'],
      },
      two_factor_on: {
        subject: 'Two-factor authentication is on at {instance}',
        heading: 'Two-factor authentication is on',
        lines: ['Two-factor authentication was turned on for your account {username}. Signing in now also takes a code from your authenticator app, and other devices were signed out.'],
        after: ['If this was not you, contact the operator of this server right away.'],
      },
      two_factor_off: {
        subject: 'Two-factor authentication is off at {instance}',
        heading: 'Two-factor authentication is off',
        lines: ['Two-factor authentication was turned off for your account {username}. Signing in now takes only your password.'],
        after: ['If this was not you, change your password and contact the operator of this server right away.'],
      },
      two_factor_reset: {
        subject: 'Two-factor authentication was reset at {instance}',
        heading: 'Two-factor authentication was reset',
        lines: ['The operator of this server turned off two-factor authentication for your account {username}, and every device was signed out.'],
        after: ['You can turn it on again under Settings, Security. If you did not ask for this, contact the operator right away.'],
      },
      recovery_regenerated: {
        subject: 'New recovery codes at {instance}',
        heading: 'New recovery codes were made',
        lines: ['New recovery codes were made for your account {username}. The old ones no longer work.'],
        after: ['If this was not you, change your password and contact the operator of this server right away.'],
      },
      recovery_used: {
        subject: 'A recovery code was used at {instance}',
        heading: 'A recovery code was used',
        lines: ['A recovery code was used on your account {username}. It cannot be used again.'],
        after: ['If this was not you, change your password and make new recovery codes under Settings, Security now.'],
      },
      operator_disk_high: {
        subject: 'The disk of {instance} is {detail}% full',
        heading: 'The disk is nearly full',
        lines: ['The disk {instance} stores its data on is {detail}% full. When it is full, uploads stop and the database can be damaged. Free some room, or give the server a larger disk.'],
      },
      operator_backup_failed: {
        subject: 'A backup of {instance} failed',
        heading: 'A backup failed',
        lines: ['The scheduled backup of {instance} could not be written. Until this is sorted out, what happens from now on is not saved anywhere else. The error: {detail}'],
      },
      operator_backup_old: {
        subject: '{instance} has no recent backup',
        heading: 'There is no recent backup',
        lines: ['The newest backup of {instance} is {detail} hours old, though one should be taken more often than that. Look at the System page of the admin console, and at the server\'s log.'],
      },
      operator_offsite_failed: {
        subject: 'The copy of {instance} to another machine failed',
        heading: 'The copy to another machine failed',
        lines: ['The copy of the backups of {instance} to another machine did not work. A backup on the same machine does not survive losing that machine. What it said: {detail}'],
      },
      operator_restart_loop: {
        subject: '{instance} keeps restarting',
        heading: 'The server keeps restarting',
        lines: ['{instance} has started {detail} times within a quarter of an hour, so something is stopping it. Look at its log: docker compose logs backspace'],
      },
      test: {
        subject: 'Test mail from {instance}',
        heading: 'Mail is working',
        lines: ['An administrator of {instance} sent this test. If you are reading it, this server can send mail to this address.'],
      },
    },
  },
  de: {
    fallback: 'Falls der Button nicht funktioniert, öffne diesen Link:',
    footer: 'Dies ist eine automatische Nachricht zu deinem Konto bei {instance}.',
    legalNotice: 'Impressum',
    privacy: 'Datenschutz',
    unknownDevice: 'Unbekanntes Gerät',
    kinds: {
      verify_email: {
        subject: 'Bestätige deine E-Mail-Adresse für {instance}',
        heading: 'Bestätige deine E-Mail-Adresse',
        lines: ['Hallo {username}, bitte bestätige, dass diese Adresse dir gehört. Der Link gilt 24 Stunden und nur einmal.'],
        action: 'Adresse bestätigen',
        after: ['Wenn du kein Konto angelegt hast, kannst du diese Mail ignorieren.'],
      },
      change_email_confirm: {
        subject: 'Bestätige deine neue E-Mail-Adresse für {instance}',
        heading: 'Bestätige deine neue Adresse',
        lines: ['Hallo {username}, du möchtest diese Adresse für dein Konto verwenden. Deine alte Adresse gilt, bis du bestätigst. Der Link gilt 24 Stunden und nur einmal.'],
        action: 'Neue Adresse bestätigen',
        after: ['Wenn du das nicht wolltest, kannst du diese Mail ignorieren.'],
      },
      change_requested: {
        subject: 'Deine E-Mail-Adresse bei {instance} soll geändert werden',
        heading: 'Eine neue Adresse wurde angefragt',
        lines: ['Jemand, der in deinem Konto {username} angemeldet ist, möchte die Adresse in {newAddress} ändern. Es ändert sich nichts, bis diese Adresse bestätigt ist.'],
        after: ['Warst du das nicht, ändere jetzt dein Passwort und melde unter Einstellungen, Sicherheit die Geräte ab, die du nicht kennst.'],
      },
      email_changed: {
        subject: 'Deine E-Mail-Adresse bei {instance} wurde geändert',
        heading: 'Deine Adresse wurde geändert',
        lines: ['Die Adresse deines Kontos {username} ist jetzt {newAddress}. Diese Adresse ist nicht mehr damit verbunden.'],
        after: ['Warst du das nicht, wende dich sofort an den Betreiber dieses Servers.'],
      },
      email_removed: {
        subject: 'Deine E-Mail-Adresse bei {instance} wurde entfernt',
        heading: 'Deine Adresse wurde entfernt',
        lines: ['Diese Adresse ist nicht mehr mit deinem Konto {username} verbunden. Ohne bestätigte Adresse kann nur noch ein Administrator ein vergessenes Passwort zurücksetzen.'],
        after: ['Warst du das nicht, wende dich sofort an den Betreiber dieses Servers.'],
      },
      password_reset: {
        subject: 'Setze dein Passwort für {instance} zurück',
        heading: 'Passwort zurücksetzen',
        lines: ['Jemand möchte das Passwort deines Kontos {username} zurücksetzen. Der Link gilt 30 Minuten und nur einmal.'],
        action: 'Neues Passwort wählen',
        after: ['Warst du das nicht, kannst du diese Mail ignorieren: Dein Passwort bleibt, wie es ist.'],
      },
      password_changed: {
        subject: 'Dein Passwort bei {instance} wurde geändert',
        heading: 'Dein Passwort wurde geändert',
        lines: ['Das Passwort deines Kontos {username} wurde gerade geändert, und andere Geräte wurden abgemeldet.'],
        action: 'Das war ich nicht',
        after: ['Warst du das, ist nichts zu tun. Wenn nicht, kannst du über den Button oben ein neues Passwort setzen.'],
      },
      username_changed: {
        subject: 'Dein Benutzername bei {instance} wurde geändert',
        heading: 'Dein Benutzername wurde geändert',
        lines: ['Dein Konto heißt jetzt {username}. Melde dich ab jetzt mit diesem Namen an.'],
        action: 'Das war ich nicht',
        after: ['Warst du das, ist nichts zu tun. Wenn nicht, kannst du über den Button oben ein neues Passwort setzen.'],
      },
      address_in_use: {
        subject: 'Jemand wollte deine E-Mail-Adresse bei {instance} verwenden',
        heading: 'Deine Adresse wird schon verwendet',
        lines: ['Jemand wollte diese Adresse mit einem Konto bei {instance} verbinden, sie gehört aber schon zu einem. Es wurde nichts geändert.'],
        after: ['Warst du das, melde dich mit deinem Konto an oder nutze „Passwort vergessen“. Wenn nicht, kannst du diese Mail ignorieren.'],
      },
      new_device: {
        subject: 'Neue Anmeldung in deinem Konto bei {instance}',
        heading: 'Ein neues Gerät hat sich angemeldet',
        lines: ['Dein Konto {username} wurde auf einem Gerät angemeldet, das bisher nicht bekannt war.', 'Gerät: {device}. Adresse: {addressHint}. Zeit: {time}.'],
        after: ['Warst du das, ist nichts zu tun. Wenn nicht, ändere jetzt dein Passwort und melde dieses Gerät unter Einstellungen, Sicherheit ab.'],
      },
      suspicious_login: {
        subject: 'Fehlgeschlagene Anmeldungen in deinem Konto bei {instance}',
        heading: 'Mehrere Anmeldungen sind fehlgeschlagen',
        lines: ['Jemand hat mehrmals versucht, sich mit einem falschen Passwort in deinem Konto {username} anzumelden. Niemand ist hineingekommen.', 'Letzter Versuch: {device}, Adresse {addressHint}, {time}.'],
        after: ['Warst du das, ist nichts zu tun. Wenn nicht, achte darauf, dass dein Passwort lang ist und nirgendwo sonst verwendet wird, und schalte am besten die Zwei-Faktor-Anmeldung ein.'],
      },
      mfa_failures: {
        subject: 'Jemand kennt dein Passwort bei {instance}',
        heading: 'Falsche Codes nach dem richtigen Passwort',
        lines: ['Jemand hat das richtige Passwort für dein Konto {username} eingegeben und danach falsche Zwei-Faktor-Codes. Niemand ist hineingekommen.', 'Letzter Versuch: {device}, Adresse {addressHint}, {time}.'],
        after: ['Warst du das nicht, kennt jemand anderes dein Passwort. Ändere es jetzt.'],
      },
      two_factor_on: {
        subject: 'Zwei-Faktor-Anmeldung ist an bei {instance}',
        heading: 'Die Zwei-Faktor-Anmeldung ist an',
        lines: ['Für dein Konto {username} wurde die Zwei-Faktor-Anmeldung eingeschaltet. Zum Anmelden braucht es jetzt auch einen Code aus deiner Authenticator-App, und andere Geräte wurden abgemeldet.'],
        after: ['Warst du das nicht, wende dich sofort an den Betreiber dieses Servers.'],
      },
      two_factor_off: {
        subject: 'Zwei-Faktor-Anmeldung ist aus bei {instance}',
        heading: 'Die Zwei-Faktor-Anmeldung ist aus',
        lines: ['Für dein Konto {username} wurde die Zwei-Faktor-Anmeldung ausgeschaltet. Zum Anmelden reicht jetzt dein Passwort.'],
        after: ['Warst du das nicht, ändere dein Passwort und wende dich sofort an den Betreiber dieses Servers.'],
      },
      two_factor_reset: {
        subject: 'Zwei-Faktor-Anmeldung wurde zurückgesetzt bei {instance}',
        heading: 'Die Zwei-Faktor-Anmeldung wurde zurückgesetzt',
        lines: ['Der Betreiber dieses Servers hat die Zwei-Faktor-Anmeldung für dein Konto {username} ausgeschaltet, und alle Geräte wurden abgemeldet.'],
        after: ['Du kannst sie unter Einstellungen, Sicherheit wieder einschalten. Wenn du das nicht wolltest, wende dich sofort an den Betreiber.'],
      },
      recovery_regenerated: {
        subject: 'Neue Wiederherstellungscodes bei {instance}',
        heading: 'Neue Wiederherstellungscodes wurden erstellt',
        lines: ['Für dein Konto {username} wurden neue Wiederherstellungscodes erstellt. Die alten funktionieren nicht mehr.'],
        after: ['Warst du das nicht, ändere dein Passwort und wende dich sofort an den Betreiber dieses Servers.'],
      },
      recovery_used: {
        subject: 'Ein Wiederherstellungscode wurde benutzt bei {instance}',
        heading: 'Ein Wiederherstellungscode wurde benutzt',
        lines: ['In deinem Konto {username} wurde ein Wiederherstellungscode benutzt. Er funktioniert nicht noch einmal.'],
        after: ['Warst du das nicht, ändere jetzt dein Passwort und erstelle unter Einstellungen, Sicherheit neue Wiederherstellungscodes.'],
      },
      operator_disk_high: {
        subject: 'Die Platte von {instance} ist zu {detail} % voll',
        heading: 'Die Platte ist fast voll',
        lines: ['Die Platte, auf der {instance} seine Daten speichert, ist zu {detail} % voll. Ist sie ganz voll, stoppen Uploads, und die Datenbank kann beschädigt werden. Schaffe Platz oder gib dem Server eine größere Platte.'],
      },
      operator_backup_failed: {
        subject: 'Ein Backup von {instance} ist fehlgeschlagen',
        heading: 'Ein Backup ist fehlgeschlagen',
        lines: ['Das geplante Backup von {instance} konnte nicht geschrieben werden. Bis das behoben ist, wird das, was ab jetzt passiert, nirgends sonst gesichert. Der Fehler: {detail}'],
      },
      operator_backup_old: {
        subject: '{instance} hat kein aktuelles Backup',
        heading: 'Es gibt kein aktuelles Backup',
        lines: ['Das neueste Backup von {instance} ist {detail} Stunden alt, dabei sollte öfter eines entstehen. Schau dir die Systemseite der Admin-Konsole und das Log des Servers an.'],
      },
      operator_offsite_failed: {
        subject: 'Die Kopie von {instance} auf einen anderen Rechner ist fehlgeschlagen',
        heading: 'Die Kopie auf einen anderen Rechner ist fehlgeschlagen',
        lines: ['Die Kopie der Backups von {instance} auf einen anderen Rechner hat nicht geklappt. Ein Backup auf demselben Rechner übersteht dessen Verlust nicht. Die Meldung: {detail}'],
      },
      operator_restart_loop: {
        subject: '{instance} startet immer wieder neu',
        heading: 'Der Server startet immer wieder neu',
        lines: ['{instance} ist innerhalb einer Viertelstunde {detail}-mal gestartet, also hält ihn etwas auf. Schau in sein Log: docker compose logs backspace'],
      },
      test: {
        subject: 'Testmail von {instance}',
        heading: 'Der Mailversand funktioniert',
        lines: ['Ein Administrator von {instance} hat diesen Test geschickt. Wenn du das liest, kann dieser Server an diese Adresse senden.'],
      },
    },
  },
  pt: {
    fallback: 'Se o botão não funcionar, abra este link:',
    footer: 'Esta é uma mensagem automática sobre a sua conta em {instance}.',
    legalNotice: 'Aviso legal',
    privacy: 'Privacidade',
    unknownDevice: 'Dispositivo desconhecido',
    kinds: {
      verify_email: {
        subject: 'Confirme seu endereço de e-mail em {instance}',
        heading: 'Confirme seu endereço de e-mail',
        lines: ['Olá, {username}. Confirme que este endereço é seu. O link vale por 24 horas e uma única vez.'],
        action: 'Confirmar endereço',
        after: ['Se você não criou uma conta, pode ignorar este e-mail.'],
      },
      change_email_confirm: {
        subject: 'Confirme seu novo endereço de e-mail em {instance}',
        heading: 'Confirme seu novo endereço',
        lines: ['Olá, {username}. Você pediu para usar este endereço na sua conta. O endereço antigo continua valendo até você confirmar. O link vale por 24 horas e uma única vez.'],
        action: 'Confirmar novo endereço',
        after: ['Se você não pediu isso, pode ignorar este e-mail.'],
      },
      change_requested: {
        subject: 'Seu endereço de e-mail em {instance} está para mudar',
        heading: 'Um novo endereço foi solicitado',
        lines: ['Alguém conectado à sua conta {username} pediu para mudar o endereço para {newAddress}. Nada muda até que esse endereço seja confirmado.'],
        after: ['Se não foi você, troque sua senha agora e desconecte os dispositivos que não reconhece em Configurações, Segurança.'],
      },
      email_changed: {
        subject: 'Seu endereço de e-mail em {instance} foi alterado',
        heading: 'Seu endereço foi alterado',
        lines: ['O endereço da sua conta {username} agora é {newAddress}. Este endereço não está mais ligado a ela.'],
        after: ['Se não foi você, fale imediatamente com o operador deste servidor.'],
      },
      email_removed: {
        subject: 'Seu endereço de e-mail em {instance} foi removido',
        heading: 'Seu endereço foi removido',
        lines: ['Este endereço não está mais ligado à sua conta {username}. Sem um endereço confirmado, só um administrador pode redefinir uma senha esquecida.'],
        after: ['Se não foi você, fale imediatamente com o operador deste servidor.'],
      },
      password_reset: {
        subject: 'Redefina sua senha em {instance}',
        heading: 'Redefina sua senha',
        lines: ['Alguém pediu para redefinir a senha da sua conta {username}. O link vale por 30 minutos e uma única vez.'],
        action: 'Escolher uma nova senha',
        after: ['Se não foi você, pode ignorar este e-mail: sua senha continua a mesma.'],
      },
      password_changed: {
        subject: 'Sua senha em {instance} foi alterada',
        heading: 'Sua senha foi alterada',
        lines: ['A senha da sua conta {username} acabou de ser alterada, e os outros dispositivos foram desconectados.'],
        action: 'Não fui eu',
        after: ['Se foi você, não há nada a fazer. Se não, o botão acima permite definir uma nova senha.'],
      },
      username_changed: {
        subject: 'Seu nome de usuário em {instance} foi alterado',
        heading: 'Seu nome de usuário foi alterado',
        lines: ['Sua conta agora se chama {username}. Use este nome para entrar daqui em diante.'],
        action: 'Não fui eu',
        after: ['Se foi você, não há nada a fazer. Se não, o botão acima permite definir uma nova senha.'],
      },
      address_in_use: {
        subject: 'Alguém tentou usar seu endereço de e-mail em {instance}',
        heading: 'Seu endereço já está em uso',
        lines: ['Alguém tentou ligar este endereço a uma conta em {instance}, mas ele já pertence a uma. Nada foi alterado.'],
        after: ['Se foi você, entre com a sua conta ou use "Esqueci a senha". Se não, pode ignorar este e-mail.'],
      },
      new_device: {
        subject: 'Novo acesso à sua conta em {instance}',
        heading: 'Um novo dispositivo entrou',
        lines: ['Sua conta {username} foi acessada em um dispositivo ainda não visto.', 'Dispositivo: {device}. Endereço: {addressHint}. Hora: {time}.'],
        after: ['Se foi você, não há nada a fazer. Se não, troque sua senha agora e desconecte esse dispositivo em Configurações, Segurança.'],
      },
      suspicious_login: {
        subject: 'Tentativas de acesso à sua conta em {instance}',
        heading: 'Várias tentativas de acesso falharam',
        lines: ['Alguém tentou várias vezes entrar na sua conta {username} com uma senha errada. Ninguém conseguiu entrar.', 'Última tentativa: {device}, endereço {addressHint}, {time}.'],
        after: ['Se foi você, não há nada a fazer. Se não, garanta que sua senha seja longa e não usada em outro lugar, e considere ativar a autenticação em duas etapas.'],
      },
      mfa_failures: {
        subject: 'Alguém conhece sua senha em {instance}',
        heading: 'Códigos errados depois da senha certa',
        lines: ['Alguém digitou a senha certa da sua conta {username} e depois códigos de duas etapas errados. Ninguém conseguiu entrar.', 'Última tentativa: {device}, endereço {addressHint}, {time}.'],
        after: ['Se não foi você, outra pessoa conhece sua senha. Troque-a agora.'],
      },
      two_factor_on: {
        subject: 'A autenticação em duas etapas está ativa em {instance}',
        heading: 'A autenticação em duas etapas está ativa',
        lines: ['A autenticação em duas etapas foi ativada na sua conta {username}. Entrar agora também exige um código do seu app autenticador, e os outros dispositivos foram desconectados.'],
        after: ['Se não foi você, fale imediatamente com o operador deste servidor.'],
      },
      two_factor_off: {
        subject: 'A autenticação em duas etapas está desativada em {instance}',
        heading: 'A autenticação em duas etapas está desativada',
        lines: ['A autenticação em duas etapas foi desativada na sua conta {username}. Entrar agora exige só a sua senha.'],
        after: ['Se não foi você, troque sua senha e fale imediatamente com o operador deste servidor.'],
      },
      two_factor_reset: {
        subject: 'A autenticação em duas etapas foi redefinida em {instance}',
        heading: 'A autenticação em duas etapas foi redefinida',
        lines: ['O operador deste servidor desativou a autenticação em duas etapas da sua conta {username}, e todos os dispositivos foram desconectados.'],
        after: ['Você pode ativá-la de novo em Configurações, Segurança. Se você não pediu isso, fale imediatamente com o operador.'],
      },
      recovery_regenerated: {
        subject: 'Novos códigos de recuperação em {instance}',
        heading: 'Novos códigos de recuperação foram criados',
        lines: ['Novos códigos de recuperação foram criados para a sua conta {username}. Os antigos não funcionam mais.'],
        after: ['Se não foi você, troque sua senha e fale imediatamente com o operador deste servidor.'],
      },
      recovery_used: {
        subject: 'Um código de recuperação foi usado em {instance}',
        heading: 'Um código de recuperação foi usado',
        lines: ['Um código de recuperação foi usado na sua conta {username}. Ele não pode ser usado de novo.'],
        after: ['Se não foi você, troque sua senha agora e crie novos códigos de recuperação em Configurações, Segurança.'],
      },
      operator_disk_high: {
        subject: 'O disco de {instance} está {detail}% cheio',
        heading: 'O disco está quase cheio',
        lines: ['O disco onde {instance} guarda os dados está {detail}% cheio. Quando encher, os envios param e o banco de dados pode ser danificado. Libere espaço ou dê ao servidor um disco maior.'],
      },
      operator_backup_failed: {
        subject: 'Um backup de {instance} falhou',
        heading: 'Um backup falhou',
        lines: ['O backup programado de {instance} não pôde ser gravado. Até que isso seja resolvido, o que acontecer a partir de agora não fica salvo em outro lugar. O erro: {detail}'],
      },
      operator_backup_old: {
        subject: '{instance} não tem um backup recente',
        heading: 'Não há um backup recente',
        lines: ['O backup mais novo de {instance} tem {detail} horas, embora devesse ser feito com mais frequência. Veja a página Sistema do console de administração e o log do servidor.'],
      },
      operator_offsite_failed: {
        subject: 'A cópia de {instance} para outra máquina falhou',
        heading: 'A cópia para outra máquina falhou',
        lines: ['A cópia dos backups de {instance} para outra máquina não funcionou. Um backup na mesma máquina não sobrevive à perda dela. O que foi dito: {detail}'],
      },
      operator_restart_loop: {
        subject: '{instance} não para de reiniciar',
        heading: 'O servidor não para de reiniciar',
        lines: ['{instance} iniciou {detail} vezes em quinze minutos, então algo o está parando. Veja o log: docker compose logs backspace'],
      },
      test: {
        subject: 'E-mail de teste de {instance}',
        heading: 'O envio de e-mails está funcionando',
        lines: ['Um administrador de {instance} enviou este teste. Se você está lendo isto, este servidor consegue enviar para este endereço.'],
      },
    },
  },
  ru: {
    fallback: 'Если кнопка не работает, откройте эту ссылку:',
    footer: 'Это автоматическое сообщение о вашей учётной записи на {instance}.',
    legalNotice: 'Правовая информация',
    privacy: 'Конфиденциальность',
    unknownDevice: 'Неизвестное устройство',
    kinds: {
      verify_email: {
        subject: 'Подтвердите адрес электронной почты для {instance}',
        heading: 'Подтвердите адрес электронной почты',
        lines: ['Здравствуйте, {username}. Подтвердите, что этот адрес принадлежит вам. Ссылка действует 24 часа и только один раз.'],
        action: 'Подтвердить адрес',
        after: ['Если вы не создавали учётную запись, просто проигнорируйте это письмо.'],
      },
      change_email_confirm: {
        subject: 'Подтвердите новый адрес электронной почты для {instance}',
        heading: 'Подтвердите новый адрес',
        lines: ['Здравствуйте, {username}. Вы хотите использовать этот адрес для своей учётной записи. Старый адрес действует, пока вы не подтвердите новый. Ссылка действует 24 часа и только один раз.'],
        action: 'Подтвердить новый адрес',
        after: ['Если вы этого не запрашивали, просто проигнорируйте это письмо.'],
      },
      change_requested: {
        subject: 'Ваш адрес электронной почты на {instance} хотят изменить',
        heading: 'Запрошен новый адрес',
        lines: ['Кто-то, кто вошёл в вашу учётную запись {username}, хочет изменить адрес на {newAddress}. Ничего не изменится, пока этот адрес не будет подтверждён.'],
        after: ['Если это были не вы, сейчас же смените пароль и завершите сеансы незнакомых устройств в разделе «Настройки», «Безопасность».'],
      },
      email_changed: {
        subject: 'Ваш адрес электронной почты на {instance} изменён',
        heading: 'Ваш адрес изменён',
        lines: ['Адрес вашей учётной записи {username} теперь {newAddress}. Этот адрес с ней больше не связан.'],
        after: ['Если это были не вы, немедленно свяжитесь с оператором этого сервера.'],
      },
      email_removed: {
        subject: 'Ваш адрес электронной почты на {instance} удалён',
        heading: 'Ваш адрес удалён',
        lines: ['Этот адрес больше не связан с вашей учётной записью {username}. Без подтверждённого адреса забытый пароль может сбросить только администратор.'],
        after: ['Если это были не вы, немедленно свяжитесь с оператором этого сервера.'],
      },
      password_reset: {
        subject: 'Сброс пароля для {instance}',
        heading: 'Сброс пароля',
        lines: ['Кто-то запросил сброс пароля вашей учётной записи {username}. Ссылка действует 30 минут и только один раз.'],
        action: 'Выбрать новый пароль',
        after: ['Если это были не вы, просто проигнорируйте это письмо: ваш пароль останется прежним.'],
      },
      password_changed: {
        subject: 'Ваш пароль на {instance} изменён',
        heading: 'Ваш пароль изменён',
        lines: ['Пароль вашей учётной записи {username} только что был изменён, а на других устройствах выполнен выход.'],
        action: 'Это был не я',
        after: ['Если это были вы, ничего делать не нужно. Если нет, кнопка выше позволит задать новый пароль.'],
      },
      username_changed: {
        subject: 'Ваше имя пользователя в {instance} изменено',
        heading: 'Ваше имя пользователя изменено',
        lines: ['Теперь ваша учётная запись называется {username}. Используйте это имя для входа.'],
        action: 'Это был не я',
        after: ['Если это были вы, ничего делать не нужно. Если нет, кнопка выше позволит задать новый пароль.'],
      },
      address_in_use: {
        subject: 'Кто-то пытался использовать ваш адрес на {instance}',
        heading: 'Ваш адрес уже используется',
        lines: ['Кто-то пытался связать этот адрес с учётной записью на {instance}, но он уже принадлежит другой. Ничего не изменилось.'],
        after: ['Если это были вы, войдите в свою учётную запись или воспользуйтесь функцией «Забыли пароль». Если нет, просто проигнорируйте это письмо.'],
      },
      new_device: {
        subject: 'Новый вход в вашу учётную запись на {instance}',
        heading: 'Вход с нового устройства',
        lines: ['В вашу учётную запись {username} вошли с устройства, которого раньше не было.', 'Устройство: {device}. Адрес: {addressHint}. Время: {time}.'],
        after: ['Если это были вы, ничего делать не нужно. Если нет, сейчас же смените пароль и завершите сеанс этого устройства в разделе «Настройки», «Безопасность».'],
      },
      suspicious_login: {
        subject: 'Неудачные попытки входа на {instance}',
        heading: 'Несколько попыток входа не удались',
        lines: ['Кто-то несколько раз пытался войти в вашу учётную запись {username} с неверным паролем. Никто не вошёл.', 'Последняя попытка: {device}, адрес {addressHint}, {time}.'],
        after: ['Если это были вы, ничего делать не нужно. Если нет, убедитесь, что пароль длинный и нигде больше не используется, и включите двухфакторную аутентификацию.'],
      },
      mfa_failures: {
        subject: 'Кто-то знает ваш пароль на {instance}',
        heading: 'Неверные коды после верного пароля',
        lines: ['Кто-то ввёл верный пароль от вашей учётной записи {username}, а затем неверные коды двухфакторной аутентификации. Никто не вошёл.', 'Последняя попытка: {device}, адрес {addressHint}, {time}.'],
        after: ['Если это были не вы, ваш пароль известен кому-то ещё. Смените его сейчас.'],
      },
      two_factor_on: {
        subject: 'Двухфакторная аутентификация включена на {instance}',
        heading: 'Двухфакторная аутентификация включена',
        lines: ['Для вашей учётной записи {username} включена двухфакторная аутентификация. Теперь для входа нужен и код из приложения-аутентификатора, а на других устройствах выполнен выход.'],
        after: ['Если это были не вы, немедленно свяжитесь с оператором этого сервера.'],
      },
      two_factor_off: {
        subject: 'Двухфакторная аутентификация выключена на {instance}',
        heading: 'Двухфакторная аутентификация выключена',
        lines: ['Для вашей учётной записи {username} выключена двухфакторная аутентификация. Теперь для входа нужен только пароль.'],
        after: ['Если это были не вы, смените пароль и немедленно свяжитесь с оператором этого сервера.'],
      },
      two_factor_reset: {
        subject: 'Двухфакторная аутентификация сброшена на {instance}',
        heading: 'Двухфакторная аутентификация сброшена',
        lines: ['Оператор этого сервера выключил двухфакторную аутентификацию для вашей учётной записи {username}, а на всех устройствах выполнен выход.'],
        after: ['Её можно снова включить в разделе «Настройки», «Безопасность». Если вы этого не просили, немедленно свяжитесь с оператором.'],
      },
      recovery_regenerated: {
        subject: 'Новые коды восстановления на {instance}',
        heading: 'Созданы новые коды восстановления',
        lines: ['Для вашей учётной записи {username} созданы новые коды восстановления. Старые больше не работают.'],
        after: ['Если это были не вы, смените пароль и немедленно свяжитесь с оператором этого сервера.'],
      },
      recovery_used: {
        subject: 'Использован код восстановления на {instance}',
        heading: 'Использован код восстановления',
        lines: ['В вашей учётной записи {username} использован код восстановления. Повторно он не сработает.'],
        after: ['Если это были не вы, сейчас же смените пароль и создайте новые коды восстановления в разделе «Настройки», «Безопасность».'],
      },
      operator_disk_high: {
        subject: 'Диск {instance} заполнен на {detail}%',
        heading: 'Диск почти заполнен',
        lines: ['Диск, на котором {instance} хранит данные, заполнен на {detail}%. Когда он заполнится, загрузки остановятся, а база данных может быть повреждена. Освободите место или дайте серверу диск побольше.'],
      },
      operator_backup_failed: {
        subject: 'Резервная копия {instance} не удалась',
        heading: 'Резервная копия не удалась',
        lines: ['Плановую резервную копию {instance} не удалось записать. Пока это не исправлено, всё новое больше нигде не сохраняется. Ошибка: {detail}'],
      },
      operator_backup_old: {
        subject: 'У {instance} нет свежей резервной копии',
        heading: 'Нет свежей резервной копии',
        lines: ['Самой новой резервной копии {instance} уже {detail} ч., хотя они должны создаваться чаще. Посмотрите страницу «Система» в панели администратора и журнал сервера.'],
      },
      operator_offsite_failed: {
        subject: 'Копирование {instance} на другой компьютер не удалось',
        heading: 'Копирование на другой компьютер не удалось',
        lines: ['Копирование резервных копий {instance} на другой компьютер не сработало. Копия на том же компьютере не переживёт его потерю. Сообщение: {detail}'],
      },
      operator_restart_loop: {
        subject: '{instance} постоянно перезапускается',
        heading: 'Сервер постоянно перезапускается',
        lines: ['{instance} запускался {detail} раз за пятнадцать минут: что-то его останавливает. Посмотрите журнал: docker compose logs backspace'],
      },
      test: {
        subject: 'Тестовое письмо от {instance}',
        heading: 'Отправка почты работает',
        lines: ['Администратор {instance} отправил этот тест. Если вы это читаете, сервер может отправлять письма на этот адрес.'],
      },
    },
  },
  zh: {
    fallback: '如果按钮无法使用,请打开此链接:',
    footer: '这是一封关于你在 {instance} 的账户的自动邮件。',
    legalNotice: '法律声明',
    privacy: '隐私',
    unknownDevice: '未知设备',
    kinds: {
      verify_email: {
        subject: '确认你在 {instance} 的邮箱地址',
        heading: '确认你的邮箱地址',
        lines: ['{username},你好。请确认此地址属于你。此链接 24 小时内有效,且只能使用一次。'],
        action: '确认地址',
        after: ['如果你没有创建账户,可以忽略此邮件。'],
      },
      change_email_confirm: {
        subject: '确认你在 {instance} 的新邮箱地址',
        heading: '确认你的新地址',
        lines: ['{username},你好。你要求将此地址用于你的账户。在你确认之前,旧地址仍然有效。此链接 24 小时内有效,且只能使用一次。'],
        action: '确认新地址',
        after: ['如果这不是你的操作,可以忽略此邮件。'],
      },
      change_requested: {
        subject: '你在 {instance} 的邮箱地址即将更改',
        heading: '有人请求使用新地址',
        lines: ['有人登录了你的账户 {username},并请求将地址更改为 {newAddress}。在该地址得到确认之前,不会有任何更改。'],
        after: ['如果这不是你的操作,请立即更改密码,并在“设置”的“安全”中退出你不认识的设备。'],
      },
      email_changed: {
        subject: '你在 {instance} 的邮箱地址已更改',
        heading: '你的地址已更改',
        lines: ['你的账户 {username} 的地址现在是 {newAddress}。此地址已不再与该账户关联。'],
        after: ['如果这不是你的操作,请立即联系此服务器的运营者。'],
      },
      email_removed: {
        subject: '你在 {instance} 的邮箱地址已移除',
        heading: '你的地址已移除',
        lines: ['此地址已不再与你的账户 {username} 关联。没有已确认的地址时,忘记的密码只能由管理员重置。'],
        after: ['如果这不是你的操作,请立即联系此服务器的运营者。'],
      },
      password_reset: {
        subject: '重置你在 {instance} 的密码',
        heading: '重置密码',
        lines: ['有人请求重置你的账户 {username} 的密码。此链接 30 分钟内有效,且只能使用一次。'],
        action: '选择新密码',
        after: ['如果这不是你的操作,可以忽略此邮件:你的密码不会改变。'],
      },
      password_changed: {
        subject: '你在 {instance} 的密码已更改',
        heading: '你的密码已更改',
        lines: ['你的账户 {username} 的密码刚刚已更改,其他设备已退出登录。'],
        action: '这不是我',
        after: ['如果是你本人操作,则无需处理。如果不是,可通过上面的按钮设置新密码。'],
      },
      username_changed: {
        subject: '你在 {instance} 的用户名已更改',
        heading: '你的用户名已更改',
        lines: ['你的账户现在名为 {username}。今后请使用此名称登录。'],
        action: '这不是我',
        after: ['如果是你本人操作,则无需处理。如果不是,可通过上面的按钮设置新密码。'],
      },
      address_in_use: {
        subject: '有人试图在 {instance} 使用你的邮箱地址',
        heading: '你的地址已被使用',
        lines: ['有人试图将此地址关联到 {instance} 的账户,但它已属于一个账户。没有任何更改。'],
        after: ['如果是你本人操作,请登录你的账户或使用“忘记密码”。如果不是,可以忽略此邮件。'],
      },
      new_device: {
        subject: '你在 {instance} 的账户有新的登录',
        heading: '有新设备登录',
        lines: ['你的账户 {username} 在一台此前未见过的设备上登录。', '设备:{device}。地址:{addressHint}。时间:{time}。'],
        after: ['如果是你本人操作,则无需处理。如果不是,请立即更改密码,并在“设置”的“安全”中退出该设备。'],
      },
      suspicious_login: {
        subject: '你在 {instance} 的账户有登录失败',
        heading: '多次登录失败',
        lines: ['有人多次尝试使用错误的密码登录你的账户 {username}。没有人成功登录。', '最后一次尝试:{device},地址 {addressHint},{time}。'],
        after: ['如果是你本人操作,则无需处理。如果不是,请确保密码足够长且未在别处使用,并考虑开启两步验证。'],
      },
      mfa_failures: {
        subject: '有人知道你在 {instance} 的密码',
        heading: '密码正确但验证码错误',
        lines: ['有人为你的账户 {username} 输入了正确的密码,然后输入了错误的两步验证码。没有人成功登录。', '最后一次尝试:{device},地址 {addressHint},{time}。'],
        after: ['如果这不是你的操作,说明别人知道你的密码。请立即更改。'],
      },
      two_factor_on: {
        subject: '你在 {instance} 的两步验证已开启',
        heading: '两步验证已开启',
        lines: ['你的账户 {username} 已开启两步验证。现在登录还需要验证器应用中的代码,其他设备已退出登录。'],
        after: ['如果这不是你的操作,请立即联系此服务器的运营者。'],
      },
      two_factor_off: {
        subject: '你在 {instance} 的两步验证已关闭',
        heading: '两步验证已关闭',
        lines: ['你的账户 {username} 已关闭两步验证。现在登录只需要密码。'],
        after: ['如果这不是你的操作,请更改密码并立即联系此服务器的运营者。'],
      },
      two_factor_reset: {
        subject: '你在 {instance} 的两步验证已重置',
        heading: '两步验证已重置',
        lines: ['此服务器的运营者关闭了你的账户 {username} 的两步验证,所有设备都已退出登录。'],
        after: ['你可以在“设置”的“安全”中重新开启。如果你没有提出此请求,请立即联系运营者。'],
      },
      recovery_regenerated: {
        subject: '你在 {instance} 有新的恢复码',
        heading: '已创建新的恢复码',
        lines: ['已为你的账户 {username} 创建新的恢复码。旧的恢复码不再有效。'],
        after: ['如果这不是你的操作,请更改密码并立即联系此服务器的运营者。'],
      },
      recovery_used: {
        subject: '你在 {instance} 使用了恢复码',
        heading: '已使用恢复码',
        lines: ['你的账户 {username} 使用了一个恢复码。它不能再次使用。'],
        after: ['如果这不是你的操作,请立即更改密码,并在“设置”的“安全”中创建新的恢复码。'],
      },
      operator_disk_high: {
        subject: '{instance} 的磁盘已用 {detail}%',
        heading: '磁盘快满了',
        lines: ['{instance} 存放数据的磁盘已用 {detail}%。磁盘写满后，上传会停止，数据库也可能损坏。请清理空间，或为服务器换一块更大的磁盘。'],
      },
      operator_backup_failed: {
        subject: '{instance} 的一次备份失败了',
        heading: '一次备份失败了',
        lines: ['{instance} 的定时备份无法写入。在解决之前，从现在起发生的内容都不会保存到别处。错误：{detail}'],
      },
      operator_backup_old: {
        subject: '{instance} 没有最近的备份',
        heading: '没有最近的备份',
        lines: ['{instance} 最新的备份已有 {detail} 小时，本应更频繁地创建。请查看管理控制台的系统页面和服务器日志。'],
      },
      operator_offsite_failed: {
        subject: '{instance} 复制到另一台机器失败',
        heading: '复制到另一台机器失败',
        lines: ['将 {instance} 的备份复制到另一台机器没有成功。同一台机器上的备份无法在这台机器损失后保留。提示：{detail}'],
      },
      operator_restart_loop: {
        subject: '{instance} 不断重启',
        heading: '服务器不断重启',
        lines: ['{instance} 在十五分钟内启动了 {detail} 次，说明有什么在阻止它运行。请查看日志：docker compose logs backspace'],
      },
      test: {
        subject: '来自 {instance} 的测试邮件',
        heading: '邮件发送正常',
        lines: ['{instance} 的管理员发送了此测试。如果你看到这封邮件,说明此服务器可以向此地址发送邮件。'],
      },
    },
  },
};
