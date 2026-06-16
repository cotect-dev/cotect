# Changelog

All notable changes to Cotect are documented here.

The format is based on [Keep a Changelog](https://keepachangelog.com/en/1.1.0/),
and the project adheres to [Semantic Versioning](https://semver.org/spec/v2.0.0.html).

## [Unreleased]

## [0.4.0] - 2026-06-16

## [0.3.0] - 2026-06-16

### Added

- Nix flake for building Cotect from source.
- Community Discord, linked from the landing page and offered as the main action button on mobile.

### Fixed

- Code view: the filename header now stays pinned while only the code scrolls. On some Linux WebViews (WebKitGTK) the editor failed to cap its height, so the whole node grew to the full file length and scrolling moved the header along with the code.
- Landing page: the canvas demo pans with the mouse wheel again on desktop.
- Landing page: the Linux AppImage command no longer selects the whole block on click, so you can highlight just the download URL.

## [0.2.2] - 2026-06-15

### Changed

- New macOS app icon: the cat now sits on the dark brand background (matching the social avatar) instead of a transparent white silhouette, so it reads clearly in the Dock.
- Redesigned the macOS installer (.dmg) with a themed background and a drag-to-Applications arrow, matching the app's look.

### Fixed

- Python dependency graph: local imports now resolve for projects whose import root is not the repository root. Absolute imports such as `from utils import ...` or `from package.module import ...` are matched against the importing file's own package tree and against sibling source trees (for example a monorepo lib directory or a `src/` layout). Files that imported their dependencies this way previously showed no connections and now appear linked in the graph.

## [0.2.1] - 2026-06-12

### Added

- Settings: an About section showing the app version, platform, and an in-app check for updates
- Signed and notarized macOS builds (Developer ID), so macOS opens them without a workaround
- Linux: direct .deb and .rpm downloads on the landing page, plus update notices for package-manager installs
- FAQ section on the landing page

### Changed

- Thin scrollbars throughout the app, matching the landing page

### Fixed

- Windows: breadcrumbs now render path segments correctly instead of showing the full path

## [0.2.0] - 2026-06-12

First public release. Cotect is now open source under Apache-2.0 at
[cotect-dev/cotect](https://github.com/cotect-dev/cotect).

### Added

- Apache-2.0 license; public repository, contribution guide, and CI
- Landing page: open-source and pricing-intent section, GitHub links, Plausible analytics

### Changed

- Releases publish to cotect-dev/cotect; the auto-updater follows the new endpoint
