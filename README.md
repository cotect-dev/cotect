<p align="center">
  <img src="public/icon.svg" width="72" alt="" />
</p>

<h1 align="center">Cotect</h1>

<p align="center"><strong>A fast, read-first code inspector for the agent era.</strong></p>

<p align="center"><a href="https://cotect.dev">cotect.dev</a> · <a href="https://cotect.dev/#download">Download for macOS, Windows, Linux</a></p>

---

Agents write more code than you can read in a pull-request diff. Cotect
watches your repository while they work: every change lands on an infinite
canvas the moment it happens, ready to review hunk by hunk — and it never
touches your working tree, so agents keep working while you read.

## What it does

- **Live canvas** — files and changes appear as they happen, laid out
  spatially instead of as a file list.
- **Hunk-by-hunk review** — accept or comment on each hunk; comments can be
  copied straight into the agent of your choice.
- **Import graph** — Cotect resolves imports across the codebase and draws
  the shape of the project: what a file pulls in, what depends on it.
- **Codebase health** — structural findings, churn hotspots, and oversized
  files, computed from the repository itself.
- **Read-only by default** — reviewing never mutates git state or the
  working tree.

## Install

Grab an installer from **[cotect.dev](https://cotect.dev/#download)** or the
[latest release](https://github.com/cotect-dev/cotect/releases/latest).
Updates are delivered in-app.

On Linux:

```bash
curl -LO https://github.com/cotect-dev/cotect/releases/latest/download/cotect.AppImage
chmod +x cotect.AppImage
./cotect.AppImage
```

## Free, open source — and the plan for money

Cotect is Apache-2.0 and **free for individual use, forever**. The planned
business model is **paid team features** — shared reviews and collaboration —
built on top of the open-source app. Stating that on day one is deliberate:
if a tool reads your code all day, you shouldn't have to guess how it will
eventually monetize you.

## Building from source

See [DEVELOPMENT.md](DEVELOPMENT.md).

## Contributing

See [CONTRIBUTING.md](CONTRIBUTING.md). Issues — especially "this broke on my
repo" reports — are very welcome.

## License

[Apache-2.0](LICENSE)
