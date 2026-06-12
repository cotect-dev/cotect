# Developing Cotect

Cotect is a Tauri 2 desktop app: React + Vite + Tailwind on the front,
Rust on the back.

## System dependencies (macOS)

GTK3 libraries are required for Tauri's Linux compatibility layer on macOS:

```bash
brew install pkgconf glib cairo atk gtk+3 pango gdk-pixbuf
```

On Linux, install the Tauri prerequisites for your distro
(webkit2gtk 4.1, libayatana-appindicator, librsvg — see
`.github/workflows/ci.yml` for the exact Ubuntu package list).

## Setup

```bash
yarn install
```

## Development

```bash
yarn dev          # Tauri window + Vite HMR
yarn vite:dev     # Vite dev server only (browser)
yarn landing:dev  # landing page (cotect.dev) dev server
```

## Build

```bash
yarn build           # production desktop app
yarn landing:build   # landing page -> dist-landing/
```

## Tests and checks

```bash
yarn test        # vitest
yarn test:rust   # cargo test
yarn lint        # eslint (zero warnings allowed)
yarn fmt:check   # prettier
```

## Color palette

Three custom color scales are defined in `src/index.css` via Tailwind's
`@theme` directive. They form a dark blue gradient designed for a code/IDE
aesthetic.

| Scale | Default | Range | Usage |
|---|---|---|---|
| `ink-black` | `#00111c` | Near-black with a deep navy tint | Backgrounds, base surfaces |
| `deep-space` | `#002e4e` | Mid-tone dark blue | Cards, panels, borders |
| `yale-blue` | `#003a61` | Richer blue | Interactive elements, accents |

Each scale provides shades from `50` (lightest) to `800`/`900` (darkest). The
lighter end (`50`-`200`) contains bright sky blues useful for text, icons, and
highlights.

```
bg-ink-black          text-yale-blue-200
border-deep-space-300 text-ink-black-50
```
