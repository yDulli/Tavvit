// @vitest-environment node
import { readFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { describe, expect, it } from 'vitest';
import { CARBON_SURFACES } from './appTheme';

// Carbon is written down twice: as the stylesheet's own colours, and as what every
// other theme's maths starts from. A theme at depth 0 is meant to be exactly as
// bright as Carbon, so a retuned layer has to change in both places.
const here = dirname(fileURLToPath(import.meta.url));
const css = readFileSync(join(here, '..', 'styles', 'globals.css'), 'utf8');

describe('Carbon', () => {
  it.each(Object.entries(CARBON_SURFACES))('%s is the same in the stylesheet and in the theme maths', (token, rgb) => {
    const declared = css.match(new RegExp(`${token}: (\\d+) (\\d+) (\\d+);`));
    expect(declared?.slice(1).map(Number)).toEqual(rgb);
  });
});
