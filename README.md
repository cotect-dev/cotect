# Cotect

Desktop application built with React, Vite, Tailwind CSS, and NeutralinoJS.

## Setup

```bash
yarn install
yarn neu:update
```

## Development

```bash
yarn dev          # Neutralino window + Vite HMR
yarn vite:dev     # Vite dev server only (browser)
```

## Build

```bash
yarn build        # Production build
yarn neu:build    # Package as Neutralino desktop app
```

## Color Palette

Three custom color scales are defined in `src/index.css` via Tailwind's `@theme` directive. They form a dark blue gradient designed for a code/IDE aesthetic.

| Scale | Default | Range | Usage |
|---|---|---|---|
| `ink-black` | `#00111c` | Near-black with a deep navy tint | Backgrounds, base surfaces |
| `deep-space` | `#002e4e` | Mid-tone dark blue | Cards, panels, borders |
| `yale-blue` | `#003a61` | Richer blue | Interactive elements, accents |

Each scale provides shades from `50` (lightest) to `800`/`900` (darkest). The lighter end (`50`-`200`) contains bright sky blues useful for text, icons, and highlights.

```
bg-ink-black          text-yale-blue-200
border-deep-space-300 text-ink-black-50
```
