// ─── remark plugin: `||hidden||` → a spoiler ────────────────────────────────
// Works on the inline children of one parent, so `||**bold**||` is one spoiler and code
// stays literal: a code span is not a text node, and a mark inside it is never seen. A
// mark without a partner in the same parent stays what it is, two pipes.

interface MdastNode {
  type: string;
  value?: string;
  children?: MdastNode[];
  data?: { hName: string; hProperties: Record<string, string> };
}

const MARK = '||';

/** The parent's children with each text node split around its marks. */
function splitAtMarks(children: readonly MdastNode[]): Array<MdastNode | typeof MARK> {
  const parts: Array<MdastNode | typeof MARK> = [];
  for (const child of children) {
    if (child.type !== 'text' || !child.value?.includes(MARK)) {
      parts.push(child);
      continue;
    }
    child.value.split(MARK).forEach((text, index) => {
      if (index > 0) parts.push(MARK);
      if (text) parts.push({ type: 'text', value: text });
    });
  }
  return parts;
}

/** Whether the parts between two marks hold anything to hide. */
function hasContent(parts: readonly MdastNode[]): boolean {
  return parts.some((part) => part.type !== 'text' || (part.value ?? '').trim().length > 0);
}

function convert(node: MdastNode): void {
  if (!node.children) return;
  for (const child of node.children) convert(child);
  if (!node.children.some((child) => child.type === 'text' && child.value?.includes(MARK))) return;

  const next: MdastNode[] = [];
  let open: MdastNode[] | null = null;
  const addText = (target: MdastNode[], text: string) => {
    const last = target[target.length - 1];
    if (last?.type === 'text') last.value = `${last.value ?? ''}${text}`;
    else target.push({ type: 'text', value: text });
  };
  for (const part of splitAtMarks(node.children)) {
    if (part !== MARK) {
      (open ?? next).push(part);
      continue;
    }
    if (open === null) {
      open = [];
      continue;
    }
    if (hasContent(open)) {
      next.push({ type: 'spoiler', children: open, data: { hName: 'span', hProperties: { dataSpoiler: 'true' } } });
    } else {
      addText(next, MARK);
      next.push(...open);
      addText(next, MARK);
    }
    open = null;
  }
  if (open !== null) {
    addText(next, MARK);
    for (const part of open) {
      if (part.type === 'text') addText(next, part.value ?? '');
      else next.push(part);
    }
  }
  node.children = next;
}

/** remark plugin: render `||text||` as a spoiler. */
export function remarkSpoilers() {
  return (tree: MdastNode) => {
    convert(tree);
  };
}
