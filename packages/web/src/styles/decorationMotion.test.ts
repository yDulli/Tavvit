import { describe, expect, it } from 'vitest';
import { readFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';

// Decorations at rest have no animation at all (decorations.css, "Where they move"): a paused one
// still holds a compositing layer, and so does everything it overlaps, which made a member list of
// a hundred people hundreds of layers. Every animation of a frame, a nameplate or a name therefore
// names itself through `--deco-move`, which is `none` where the decoration rests. A design added
// without it would bring the layers back: this holds every one of them to it.

const css = readFileSync(join(dirname(fileURLToPath(import.meta.url)), 'decorations.css'), 'utf8');

/** Every rule outside @keyframes and the reduced-motion blocks, as its selector and its body. */
function rules(): Array<{ selector: string; body: string }> {
  const found: Array<{ selector: string; body: string }> = [];
  const pattern = /([^{}]+)\{([^{}]*)\}/g;
  const withoutKeyframes = css.replace(/@keyframes[^{]+\{(?:[^{}]*\{[^{}]*\})*[^{}]*\}/g, '');
  for (const match of withoutKeyframes.matchAll(pattern)) {
    found.push({ selector: match[1]!.replace(/\/\*[\s\S]*?\*\//g, '').trim(), body: match[2]! });
  }
  return found;
}

describe('decoration motion', () => {
  it('names every animation of a frame, a nameplate or a name through --deco-move', () => {
    const offenders: string[] = [];
    let checked = 0;
    for (const { selector, body } of rules()) {
      const animation = /(?:^|;)\s*animation:\s*([^;]+);/.exec(body);
      if (!animation || animation[1]!.trim().startsWith('none')) continue;
      // Effects pause instead (a picker's tile shows them caught mid-way), and a reduced-motion
      // rule only ever takes animations away.
      if (/\.deco-effect|\.deco-art-shooting|\.deco-art-branch|data-motion='reduce'/.test(selector)) continue;
      checked += 1;
      if (!/animation-name:\s*var\(--deco-move,/.test(body)) offenders.push(selector.split('\n').pop()!.trim());
    }
    expect(offenders).toEqual([]);
    // The parse found the animations it is about (frames, nameplates and names had 35 in 1.38.0).
    expect(checked).toBeGreaterThanOrEqual(30);
  });

  it('rests where a decoration may not move, and moves where it may', () => {
    expect(css).toMatch(/\[data-motion='off'\],\s*\[data-motion='hover'\]\s*\{\s*--deco-move: none;/);
    expect(css).toMatch(/\[data-motion='on'\],\s*\.deco-hover:is\(:hover, :focus-visible, :focus-within\) \[data-motion='hover'\]\s*\{\s*--deco-move: initial;/);
  });

  it('never pauses a frame, a nameplate or a name to keep it still', () => {
    expect(css).not.toMatch(/\.deco-(art|nameplate|name)\[data-motion='hover'\][^{]*\{[^}]*animation-play-state: paused/);
  });
});
