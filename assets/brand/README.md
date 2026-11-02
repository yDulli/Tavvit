# Tavvit brand assets

The masters of Tavvit's identity. Everything else (favicons, PWA icons, the in-app logo,
the desktop build icons) is generated from them.

| File | What it is |
| --- | --- |
| `logo-source.png` | The logo as supplied by the owner of this instance (raster, grey on near-black). The source of truth for the shape. |
| `mark.svg` | The mark (a slanted T inside a thin ring) on transparent, in white. Traced from the source; the grey became white so the mark is black and white everywhere. |
| `mark-icon.svg` | The mark with a slightly heavier ring, for the phone home-screen icons. |
| `app-icon.svg` | The mark on the app's graphite (`#121316`) in a rounded square with a hairline: dock, taskbar, PWA install. |
| `app-icon-small.svg` | The same tile with the T alone, up to 32 px: the ring disappears at that size and the gap under the bar is drawn wider. Also the favicons and the tray icons on Windows and Linux. |
| `mark-mono-light.svg`, `mark-mono-dark.svg` | The T alone in white or black in a square box. The light one is the app's logo in the top bar and on the sign-in pages (`/icons/logo-mark.svg`). |
| `mark-tray.svg` | The T alone on an 18x22 canvas, pure black, for the macOS menu bar (a template image, the system tints it). |
| `app-icon-1024.png` | A 1024 px reference export of the app icon. |
| `logo-orbit-retired.png` | The ringed planet this app used until 1.13. Nothing reads it and release archives leave it out. |

## Palette

| Role | Value |
| --- | --- |
| Mark | `#ffffff`: the logo is black and white, never coloured |
| Logo ground | `#121316`, the app's frame colour (baked into the app icons) |
| Interface accent (default) | `#7466e8` (violet), for controls only, never the logo |
| App background | `#121316`; panels step up from `#17181c` to `#24252b` |

The accent is the one colour the administrator may change (Settings → Instance →
General); the server refuses colours that would make white button text or the dark
panels unreadable. The product name "Tavvit" is fixed; the *instance* name is theirs.

## Regenerating the icon set

After changing any SVG here:

```bash
pnpm gen-icons
```

This rewrites `packages/web/public/icons/*` and the desktop build resources. The
output is byte-stable for a given lockfile; a dependency bump may change the encoded
PNGs without any artwork changing.

## Rights

The logo was supplied by the owner of this Tavvit instance, who is responsible for
having the right to use and distribute it. It is distributed with the source on the
same terms as Tavvit's other changes (AGPL-3.0-only) unless its owner states
otherwise, and is not offered as a trademark. See `NOTICE` and
`docs/tavvit/LICENSING.md`. The Backspace name, logo and icons are **not** used.
