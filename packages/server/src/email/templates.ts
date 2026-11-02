import { MAIL_COPY, type EmailKind, type MailLocale } from './copy.js';

export interface RenderInput {
  kind: EmailKind;
  locale: MailLocale;
  /** What the words name. Plain text; escaped here for the HTML part. */
  params: Readonly<Record<string, string>>;
  instanceName: string;
  /** This server's own address: from configuration, never from a request. */
  baseUrl: string;
  /** Where the button leads, for a mail that has one. */
  actionUrl?: string | null;
}

export interface RenderedMail {
  subject: string;
  html: string;
  text: string;
}

export function escapeHtml(value: string): string {
  return value.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;').replace(/'/g, '&#39;');
}

function fill(template: string, values: Readonly<Record<string, string>>): string {
  return template.replace(/\{(\w+)\}/g, (whole, name: string) => values[name] ?? whole);
}

/** Geist is not on anyone's machine; the design's palette is what carries over. */
const FONT = `font-family:-apple-system,BlinkMacSystemFont,'Segoe UI',Roboto,Helvetica,Arial,'Noto Sans','PingFang SC','Microsoft YaHei',sans-serif`;
const INK = '#17181c';
const BODY = '#3d3e46';
const FAINT = '#6d6e78';
const LINE = '#e2e2e7';
const PAGE = '#f3f3f5';
/** A step darker than the app's violet: the button's words have to read on it at this size. */
const SIGNAL = '#6a5ce0';

const paragraph = (text: string): string => `<p style="margin:0 0 12px;${FONT};font-size:14px;line-height:21px;color:${BODY};">${text}</p>`;

/** One look for every mail: the server's name, a card, one button at most. Tables, because mail clients. */
function htmlOf(input: RenderInput, parts: { subject: string; heading: string; lines: readonly string[]; action?: string; after: readonly string[]; fallback: string; footer: string; legalNotice: string; privacy: string }): string {
  const url = input.actionUrl ? escapeHtml(input.actionUrl) : null;
  const button = parts.action && url ? `
          <table role="presentation" cellpadding="0" cellspacing="0" style="margin:20px 0;"><tr><td style="background:${SIGNAL};border-radius:5px;">
            <a href="${url}" style="display:inline-block;padding:11px 20px;${FONT};font-size:14px;line-height:18px;font-weight:600;color:#ffffff;text-decoration:none;">${parts.action}</a>
          </td></tr></table>` : '';
  const fallback = parts.action && url
    ? `<p style="margin:8px 0 0;${FONT};font-size:12px;line-height:18px;color:${FAINT};word-break:break-all;">${parts.fallback}<br><a href="${url}" style="color:${FAINT};">${url}</a></p>`
    : '';
  return `<!doctype html>
<html lang="${input.locale}">
<head>
<meta charset="utf-8">
<meta name="viewport" content="width=device-width, initial-scale=1">
<meta name="color-scheme" content="light">
<title>${parts.subject}</title>
</head>
<body style="margin:0;padding:0;background:${PAGE};">
<table role="presentation" width="100%" cellpadding="0" cellspacing="0" style="background:${PAGE};"><tr><td align="center" style="padding:28px 16px;">
  <table role="presentation" width="100%" cellpadding="0" cellspacing="0" style="max-width:520px;">
    <tr><td style="padding:0 2px 14px;${FONT};font-size:15px;line-height:20px;font-weight:600;color:${INK};">${escapeHtml(input.instanceName)}</td></tr>
    <tr><td style="background:#ffffff;border:1px solid ${LINE};border-radius:6px;padding:26px 26px 22px;">
          <h1 style="margin:0 0 12px;${FONT};font-size:18px;line-height:24px;font-weight:600;color:${INK};">${parts.heading}</h1>
          ${parts.lines.map(paragraph).join('\n          ')}${button}
          ${parts.after.map(paragraph).join('\n          ')}
          ${fallback}
    </td></tr>
    <tr><td style="padding:14px 2px 0;${FONT};font-size:12px;line-height:18px;color:${FAINT};">
      ${parts.footer}<br>
      <a href="${escapeHtml(input.baseUrl)}/imprint" style="color:${FAINT};">${parts.legalNotice}</a> &middot; <a href="${escapeHtml(input.baseUrl)}/privacy" style="color:${FAINT};">${parts.privacy}</a>
    </td></tr>
  </table>
</td></tr></table>
</body>
</html>
`;
}

/** The mail in its two forms. A kind whose copy has a button gets one only when there is somewhere to go. */
export function renderEmail(input: RenderInput): RenderedMail {
  const language = MAIL_COPY[input.locale];
  const copy = language.kinds[input.kind];
  const values: Record<string, string> = { ...input.params, instance: input.instanceName };
  const escaped: Record<string, string> = Object.fromEntries(Object.entries(values).map(([key, value]) => [key, escapeHtml(value)]));
  const after = copy.after ?? [];

  const subject = fill(copy.subject, values);
  const html = htmlOf(input, {
    subject: fill(copy.subject, escaped),
    heading: fill(copy.heading, escaped),
    lines: copy.lines.map((line) => fill(line, escaped)),
    action: copy.action,
    after: after.map((line) => fill(line, escaped)),
    fallback: language.fallback,
    footer: fill(language.footer, escaped),
    legalNotice: language.legalNotice,
    privacy: language.privacy,
  });
  const text = [
    input.instanceName,
    fill(copy.heading, values),
    ...copy.lines.map((line) => fill(line, values)),
    ...(copy.action && input.actionUrl ? [`${copy.action}: ${input.actionUrl}`] : []),
    ...after.map((line) => fill(line, values)),
    `-- \n${fill(language.footer, values)}\n${language.legalNotice}: ${input.baseUrl}/imprint\n${language.privacy}: ${input.baseUrl}/privacy`,
  ].join('\n\n') + '\n';
  return { subject, html, text };
}
