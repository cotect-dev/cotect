# Contributing to Cotect

Thanks for your interest. Cotect is young and currently a solo project, so
small, focused PRs are the easiest to review and land.

## Before you start

- For features or behavior changes, please open an issue first so we agree
  on direction before you write code.
- Bug fixes can go straight to a PR.

## Setup

See [DEVELOPMENT.md](DEVELOPMENT.md) for system dependencies and commands.

## Checks that must pass

```bash
yarn fmt:check   # prettier
yarn lint        # eslint, zero warnings
yarn test        # vitest
yarn test:rust   # cargo test
```

CI runs the same checks on every PR.

## Commit style

Conventional-commit subjects (`feat:`, `fix:`, `chore:`, `docs:`) to match
the existing history.

## License

By contributing, you agree that your contributions are licensed under
Apache-2.0.
