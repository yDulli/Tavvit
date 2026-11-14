import React from 'react';

/** Tilt (degrees) and lift (em) per letter: the letters stand a little crooked, like cut metal set by hand. */
const POSES: readonly (readonly [number, number])[] = [
  [-7, 0.02],
  [4, -0.04],
  [-3, 0.03],
  [6, -0.02],
  [-5, 0.04],
  [3, -0.03],
  [-4, 0.02],
  [7, -0.04],
];

/** Where the light catches an edge: the letter, where on it, and when in the loop. */
const GLINTS: readonly (readonly [number, string, string, number])[] = [
  [0, '8%', '12%', 0],
  [2, '70%', '8%', 1.4],
  [4, '30%', '78%', 2.6],
  [5, '82%', '20%', 0.8],
];

/**
 * A word in polished, extruded chrome (the wordmark of the "Schwarzlicht" look, as on Showomat):
 * every letter has a dark body behind a moving metal face, stands at its own angle, and a few edges
 * catch the light. The face is painted by the stylesheet from the letter itself (`data-letter`), so
 * the word stands in the page's text once. One per view, for the product's name. It is decoration:
 * hidden from assistive technology, so the page around it names the product in real text.
 * `.chrome-word` and its parts are in globals.css; they stand still with Reduce motion and are plain
 * text in forced colours.
 */
export function ChromeWord({ word, className = '' }: { word: string; className?: string }): React.JSX.Element {
  return (
    <span aria-hidden="true" className={`chrome-word ${className}`}>
      {Array.from(word).map((letter, index) => {
        const [tilt, lift] = POSES[index % POSES.length] ?? [0, 0];
        const glint = GLINTS.find(([at]) => at === index);
        return (
          <span
            key={index}
            className="chrome-letter"
            style={{ '--tilt': `${tilt}deg`, '--lift': `${lift}em`, '--i': index } as React.CSSProperties}
          >
            <span className="chrome-letter-body" data-letter={letter}>{letter}</span>
            {glint && <span className="chrome-glint" style={{ left: glint[1], top: glint[2], animationDelay: `${glint[3]}s` }} />}
          </span>
        );
      })}
    </span>
  );
}
