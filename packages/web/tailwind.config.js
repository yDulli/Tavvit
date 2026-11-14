/** @type {import('tailwindcss').Config} */
export default {
  content: [
    './index.html',
    './src/**/*.{js,ts,jsx,tsx}',
    './site/**/*.{astro,ts,tsx}',
  ],
  theme: {
    extend: {
      height: { screen: 'calc(100 * var(--app-vh))' },
      minHeight: { screen: 'calc(100 * var(--app-vh))' },
      colors: {
        // ── TAVVIT TOKENS ──
        // RGB-channel variables enable Tailwind opacity modifiers (e.g. bg-accent-rose/10).
        // The values live in src/styles/globals.css; the names are the upstream
        // design system's (surface-*, accent-*, txt-*), kept so every component and the
        // colour-token test keep working while the palette is Tavvit's own.
        surface: {
          base:     'rgb(var(--bg-base) / <alpha-value>)',
          channel:  'rgb(var(--bg-channel) / <alpha-value>)',
          chat:     'rgb(var(--bg-chat) / <alpha-value>)',
          members:  'rgb(var(--bg-members) / <alpha-value>)',
          elevated: 'rgb(var(--bg-elevated) / <alpha-value>)',
          input:    'rgb(var(--bg-input) / <alpha-value>)',
          // Evolve's panel (the structural unit on the canvas) and a control raised on it.
          panel:    'rgb(var(--bg-panel) / <alpha-value>)',
          raised:   'rgb(var(--bg-raised) / <alpha-value>)',
          overlay:  'var(--bg-overlay)',
        },
        border: {
          faint: 'rgb(var(--border-faint) / <alpha-value>)',
          hard: 'rgb(var(--border-hard) / <alpha-value>)',
          soft: 'rgb(var(--border-soft) / <alpha-value>)',
        },
        accent: {
          mint:            'rgb(var(--accent-mint) / <alpha-value>)',
          peach:           'rgb(var(--accent-peach) / <alpha-value>)',
          lavender:        'rgb(var(--accent-lavender) / <alpha-value>)',
          sky:             'rgb(var(--accent-sky) / <alpha-value>)',
          amber:           'rgb(var(--accent-amber) / <alpha-value>)',
          rose:            'rgb(var(--accent-rose) / <alpha-value>)',
          coral:           'rgb(var(--accent-coral) / <alpha-value>)',
          primary:         'rgb(var(--accent-primary) / <alpha-value>)',
          'primary-hover': 'rgb(var(--accent-primary-hover) / <alpha-value>)',
          'primary-active':'rgb(var(--accent-primary-active) / <alpha-value>)',
          // The accent as text, an icon or a line on the dark panels (>= 4.5:1).
          // `primary` is a fill; what is written on that fill is `on-accent` below.
          soft:            'rgb(var(--accent-primary-soft) / <alpha-value>)',
        },
        // What stands on the signal's fill: black on the white default, white on an accent a
        // person or an instance chose (utils/instanceBranding.ts). Never `text-white` there.
        'on-accent': 'rgb(var(--on-accent) / <alpha-value>)',
        danger: {
          fill:  'rgb(var(--danger-fill) / <alpha-value>)',
          'fill-hover': 'rgb(var(--danger-fill-hover) / <alpha-value>)',
        },
        txt: {
          primary:   'rgb(var(--text-primary) / <alpha-value>)',
          secondary: 'rgb(var(--text-secondary) / <alpha-value>)',
          tertiary:  'rgb(var(--text-tertiary) / <alpha-value>)',
          message:   'rgb(var(--text-message) / <alpha-value>)',
          link:      'rgb(var(--text-link) / <alpha-value>)',
          positive:  'rgb(var(--text-positive) / <alpha-value>)',
          warning:   'rgb(var(--text-warning) / <alpha-value>)',
          danger:    'rgb(var(--text-danger) / <alpha-value>)',
        },
        interactive: {
          hover:    'var(--interactive-hover)',
          active:   'var(--interactive-active)',
          selected: 'var(--interactive-selected)',
          muted:    'rgb(var(--interactive-muted) / <alpha-value>)',
        },
        status: {
          online:  'rgb(var(--status-online) / <alpha-value>)',
          idle:    'rgb(var(--status-idle) / <alpha-value>)',
          dnd:     'rgb(var(--status-dnd) / <alpha-value>)',
          offline: 'rgb(var(--status-offline) / <alpha-value>)',
          streaming: 'rgb(var(--status-streaming) / <alpha-value>)',
        },
        glass: {
          bg:        'var(--glass-bg)',
          border:    'var(--glass-border)',
          highlight: 'var(--glass-highlight)',
        },
        notification: 'rgb(var(--notification) / <alpha-value>)',
      },
      // Showomat's shapes, every one multiplied by `--radius-scale` (Settings,
      // Appearance), so the person's choice of sharp, standard or round reaches
      // every control that uses a radius utility: `rounded-md` makes a 32px
      // control a pill, `rounded-lg` is the corner of a frame (panels, menus,
      // dialogs, the composer), `rounded-pill` a pill of any height.
      // `rounded-full` stays exact, for dots, avatars and the status pips.
      borderRadius: {
        none: '0px',
        sm: 'calc(6px * var(--radius-scale))',
        DEFAULT: 'calc(8px * var(--radius-scale))',
        md: 'calc(16px * var(--radius-scale))',
        lg: 'calc(24px * var(--radius-scale))',
        xl: 'calc(28px * var(--radius-scale))',
        '2xl': 'calc(32px * var(--radius-scale))',
        '3xl': 'calc(40px * var(--radius-scale))',
        pill: 'var(--radius-pill)',
        full: '9999px',
      },
      // Surfaces sit flat and are separated by a hairline; only what floats
      // above the page (menus, dialogs) casts a shadow, and a plain one.
      boxShadow: {
        'header': 'none',
        'elevation-low': '0 1px 2px rgb(0 0 0 / 0.4)',
        'raised': 'var(--shadow-raised)',
        'glow': 'var(--shadow-glow)',
        'elevation-high': 'var(--shadow-popover)',
        'glass': 'var(--shadow-popover)',
        'input': 'none',
      },
      // The sizes of the interface, one name each. A size only: a line height,
      // where one matters, comes from a `leading-*` utility beside it.
      fontSize: {
        '2xs': '10px',
        label: '11px',
        meta: '12px',
        ui: '13px',
        body: '14px',
        lead: '15px',
        title: '18px',
      },
      fontFamily: {
        sans: 'var(--font-ui)',
        mono: 'var(--font-mono)',
      },
      animation: {
        'slide-up-sheet': 'slide-up-sheet 200ms ease-out',
      },
      keyframes: {
        'slide-up-sheet': {
          '0%': { transform: 'translateY(100%)' },
          '100%': { transform: 'translateY(0)' },
        },
      },
    },
  },
  plugins: [
    ({ addVariant }) => {
      addVariant('desktop', 'html[data-viewport="desktop"] &');
      // The desktop shell at tablet and small-laptop widths (platform/interfaceScale.ts).
      addVariant('compact', 'html[data-viewport="desktop"][data-width="compact"] &');
    },
  ],
};
