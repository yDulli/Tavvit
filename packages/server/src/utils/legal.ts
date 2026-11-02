import { and, desc, eq, lte, gt, sql } from 'drizzle-orm';
import {
  LEGAL_LIMITS,
  LEGAL_OPERATOR_KINDS,
  LEGAL_TEXT_LANGUAGES,
  isLegalTextLanguage,
  type LegalDocumentKind,
  type LegalDocumentMeta,
  type LegalDocumentState,
  type LegalOperator,
  type LegalTextLanguage,
} from '@backspace/shared/src/legal.js';
import { getDb, schema } from '../db/index.js';

// The operator's details and the published versions of the terms and the
// privacy policy (docs/systems/legal.md).

type DocumentRow = typeof schema.legalDocuments.$inferSelect;

/** Parse the stored JSON. A row written by a newer version keeps what this one knows. */
function textsOf(row: Pick<DocumentRow, 'texts'>): Partial<Record<LegalTextLanguage, string>> {
  try {
    const parsed = JSON.parse(row.texts) as Record<string, unknown>;
    const texts: Partial<Record<LegalTextLanguage, string>> = {};
    for (const language of LEGAL_TEXT_LANGUAGES) {
      const text = parsed[language];
      if (typeof text === 'string' && text.length > 0) texts[language] = text;
    }
    return texts;
  } catch {
    return {};
  }
}

export function documentTexts(row: DocumentRow): Partial<Record<LegalTextLanguage, string>> {
  return textsOf(row);
}

export function documentMeta(row: DocumentRow): LegalDocumentMeta {
  return {
    id: row.id,
    kind: row.kind as LegalDocumentKind,
    version: row.version,
    languages: Object.keys(textsOf(row)).filter(isLegalTextLanguage),
    publishedAt: row.publishedAt,
    effectiveAt: row.effectiveAt,
    changes: row.changes,
  };
}

/** The version that applies at `now`: the newest one that has taken effect. */
export function currentDocument(kind: LegalDocumentKind, now: number = Date.now()): DocumentRow | undefined {
  return getDb().select().from(schema.legalDocuments)
    .where(and(eq(schema.legalDocuments.kind, kind), lte(schema.legalDocuments.effectiveAt, now)))
    .orderBy(desc(schema.legalDocuments.version))
    .get();
}

/** A version announced for later, if any: the newest one. */
export function upcomingDocument(kind: LegalDocumentKind, now: number = Date.now()): DocumentRow | undefined {
  return getDb().select().from(schema.legalDocuments)
    .where(and(eq(schema.legalDocuments.kind, kind), gt(schema.legalDocuments.effectiveAt, now)))
    .orderBy(desc(schema.legalDocuments.version))
    .get();
}

export function documentState(kind: LegalDocumentKind, now: number = Date.now()): LegalDocumentState {
  const current = currentDocument(kind, now);
  const upcoming = upcomingDocument(kind, now);
  return {
    current: current ? documentMeta(current) : null,
    upcoming: upcoming ? documentMeta(upcoming) : null,
  };
}

export function nextDocumentVersion(kind: LegalDocumentKind): number {
  const row = getDb().select({ highest: sql<number | null>`max(${schema.legalDocuments.version})` })
    .from(schema.legalDocuments)
    .where(eq(schema.legalDocuments.kind, kind))
    .get();
  return (row?.highest ?? 0) + 1;
}

// ─── The operator ───────────────────────────────────────────────────────────

const LINE_CONTROL = /[\u0000-\u001f\u007f]/;
const TEXT_CONTROL = /[\u0000-\u0009\u000b-\u001f\u007f]/;
const EMAIL = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;

function requiredLine(value: unknown, max: number = LEGAL_LIMITS.LINE_MAX): string | null {
  if (typeof value !== 'string') return null;
  const text = value.trim();
  return text.length > 0 && text.length <= max && !LINE_CONTROL.test(text) ? text : null;
}

/** An optional line: undefined when it is malformed, null when it is left empty. */
function optionalLine(value: unknown): string | null | undefined {
  if (value === null || value === undefined) return null;
  if (typeof value !== 'string') return undefined;
  const text = value.trim();
  if (text.length === 0) return null;
  return text.length <= LEGAL_LIMITS.LINE_MAX && !LINE_CONTROL.test(text) ? text : undefined;
}

/** Read an operator from a request, or null when a field does not hold up. */
export function parseOperator(body: unknown): LegalOperator | null {
  if (typeof body !== 'object' || body === null) return null;
  const input = body as Record<string, unknown>;
  const kind = LEGAL_OPERATOR_KINDS.find((candidate) => candidate === input.kind);
  const name = requiredLine(input.name);
  const email = requiredLine(input.email, LEGAL_LIMITS.EMAIL_MAX);
  const addressValue = typeof input.address === 'string' ? input.address.replace(/\r\n/g, '\n').trim() : '';
  const address = addressValue.length > 0 && addressValue.length <= LEGAL_LIMITS.ADDRESS_MAX && !TEXT_CONTROL.test(addressValue)
    ? addressValue
    : null;
  const representative = optionalLine(input.representative);
  const phone = optionalLine(input.phone);
  const register = optionalLine(input.register);
  const vatId = optionalLine(input.vatId);
  const editorial = optionalLine(input.editorial);
  const hosting = optionalLine(input.hosting);
  const dpo = optionalLine(input.dpo);
  const minimumAge = input.minimumAge;
  if (!kind || name === null || address === null || email === null || !EMAIL.test(email)) return null;
  if (representative === undefined || phone === undefined || register === undefined || vatId === undefined
    || editorial === undefined || hosting === undefined || dpo === undefined) return null;
  if (typeof minimumAge !== 'number' || !Number.isInteger(minimumAge)
    || minimumAge < LEGAL_LIMITS.MIN_AGE_LOWEST || minimumAge > LEGAL_LIMITS.MIN_AGE_HIGHEST) return null;
  return { kind, name, representative, address, email, phone, register, vatId, editorial, hosting, dpo, minimumAge };
}

const SECURITY_TXT_VALID_MS = 365 * 24 * 60 * 60 * 1000;

/** `/.well-known/security.txt` (RFC 9116). The address has been through `parseOperator`: one line. */
export function securityTxt(email: string, origin: string, now: number): string {
  return [
    `Contact: mailto:${email}`,
    `Expires: ${new Date(now + SECURITY_TXT_VALID_MS).toISOString()}`,
    `Canonical: ${origin}/.well-known/security.txt`,
    `Policy: ${origin}/developers/docs/security`,
    'Preferred-Languages: en, de',
    '',
  ].join('\n');
}

export function readOperator(): LegalOperator | null {
  const row = getDb().select({ legalOperator: schema.instanceSettings.legalOperator })
    .from(schema.instanceSettings)
    .where(eq(schema.instanceSettings.id, 1))
    .get();
  if (!row?.legalOperator) return null;
  try {
    return parseOperator(JSON.parse(row.legalOperator));
  } catch {
    return null;
  }
}
