import { afterEach, describe, expect, it } from 'vitest';
import { cleanup, render } from '@testing-library/react';
import { ChromeWord } from './ChromeWord';

afterEach(cleanup);

describe('ChromeWord', () => {
  // The metal face is painted by the stylesheet from `data-letter`: a second copy of each letter in
  // the page would be read twice by a search engine and copied twice with the page's text.
  it('stands in the page once, each letter with what its face is painted from', () => {
    const { container } = render(<ChromeWord word="Tavvit" />);
    const word = container.querySelector('.chrome-word')!;
    expect(word.textContent).toBe('Tavvit');
    const letters = [...word.querySelectorAll('.chrome-letter-body')];
    expect(letters.map((letter) => letter.getAttribute('data-letter'))).toEqual(['T', 'a', 'v', 'v', 'i', 't']);
  });

  it('is decoration: the page around it names the product in real text', () => {
    const { container } = render(<ChromeWord word="Tavvit" className="text-[5rem]" />);
    const word = container.querySelector('.chrome-word')!;
    expect(word).toHaveAttribute('aria-hidden', 'true');
    expect(word).toHaveClass('text-[5rem]');
  });

  it('gives each letter its own angle and place in the arrival, and a few of them a glint', () => {
    const { container } = render(<ChromeWord word="Tavvit" />);
    const letters = [...container.querySelectorAll<HTMLElement>('.chrome-letter')];
    expect(letters).toHaveLength(6);
    expect(letters.map((letter) => letter.style.getPropertyValue('--i'))).toEqual(['0', '1', '2', '3', '4', '5']);
    expect(new Set(letters.map((letter) => letter.style.getPropertyValue('--tilt'))).size).toBeGreaterThan(3);
    expect(container.querySelectorAll('.chrome-glint')).toHaveLength(4);
  });

  it('takes a name with letters outside the basic plane one letter at a time', () => {
    const { container } = render(<ChromeWord word="A𝔅c" />);
    expect(container.querySelectorAll('.chrome-letter')).toHaveLength(3);
  });
});
