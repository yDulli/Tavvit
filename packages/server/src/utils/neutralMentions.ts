import { eq } from 'drizzle-orm';
import { splitMentions } from '@backspace/shared/src/mentions.js';
import { getDb, schema } from '../db/index.js';

const NAME_MARKS = /[<>@]/g;
const NO_MENTION = '@\u200B';

/**
 * Words that mention nobody, for text that reaches people its writer did not address (a
 * forwarded message, a webhook's post). A person or role becomes their name, without
 * anything in the name that reads as a token, and `@everyone` stays readable. Each `@`
 * here carries a zero-width space that stops it being a mention, names too: a person
 * can be called "everyone", and the `@everyone` role is a role.
 */
export function withoutMentions(content: string): string {
  const db = getDb();
  return splitMentions(content).map((part) => {
    switch (part.kind) {
      case 'text':
        return part.text;
      case 'user': {
        const user = db.select({ username: schema.users.username, displayName: schema.users.displayName })
          .from(schema.users).where(eq(schema.users.id, part.userId)).get();
        return `${NO_MENTION}${(user?.displayName || user?.username || '').replace(NAME_MARKS, '')}`;
      }
      case 'role': {
        const role = db.select({ name: schema.roles.name }).from(schema.roles).where(eq(schema.roles.id, part.roleId)).get();
        return `${NO_MENTION}${(role?.name ?? '').replace(NAME_MARKS, '')}`;
      }
      case 'everyone':
        return `${NO_MENTION}${part.keyword}`;
    }
  }).join('');
}
