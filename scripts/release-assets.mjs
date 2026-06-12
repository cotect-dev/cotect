// Prepares release assets: collects the per-OS bundle artifacts from the CI
// matrix, renames them to the stable names the landing page links to, and
// writes the Tauri updater manifest (latest.json) whose URLs point at the
// tag's immutable download paths.
//
// Env: TAG (e.g. v0.1.0), IN_DIR (downloaded artifacts), OUT_DIR (assets to
// upload), REPO (owner/name of the repo releases are published to).
import { copyFileSync, mkdirSync, readdirSync, readFileSync, statSync, writeFileSync } from 'fs'
import { join } from 'path'

const { TAG, IN_DIR, OUT_DIR, REPO } = process.env
if (!TAG || !IN_DIR || !OUT_DIR || !REPO) {
  console.error('Missing env: TAG, IN_DIR, OUT_DIR, REPO are required')
  process.exit(1)
}
const version = TAG.replace(/^v/, '')
const downloadBase = `https://github.com/${REPO}/releases/download/${TAG}`

function walk(dir) {
  const out = []
  for (const name of readdirSync(dir)) {
    const p = join(dir, name)
    if (statSync(p).isDirectory()) out.push(...walk(p))
    else out.push(p)
  }
  return out
}

const files = walk(IN_DIR)
const find = (re) => files.find((f) => re.test(f))
const need = (re, what) => {
  const f = find(re)
  if (!f) {
    console.error(`Missing expected artifact: ${what} (${re})`)
    console.error('Have:', files.join('\n'))
    process.exit(1)
  }
  return f
}

// Stable name -> source file. Every asset the landing page or a package
// manager links gets a permanent name; per-tag download URLs stay immutable.
const assets = new Map([
  ['cotect.AppImage', need(/\.AppImage$/, 'Linux AppImage')],
  ['cotect.AppImage.sig', need(/\.AppImage\.sig$/, 'AppImage signature')],
  ['cotect-amd64.deb', need(/\.deb$/, 'Debian package')],
  ['cotect-x86_64.rpm', need(/\.rpm$/, 'RPM package')],
  ['cotect-setup.exe', need(/-setup\.exe$/, 'Windows NSIS installer')],
  ['cotect-setup.exe.sig', need(/-setup\.exe\.sig$/, 'NSIS signature')],
  ['cotect.dmg', need(/\.dmg$/, 'macOS dmg')],
  ['cotect-macos.app.tar.gz', need(/\.app\.tar\.gz$/, 'macOS updater archive')],
  ['cotect-macos.app.tar.gz.sig', need(/\.app\.tar\.gz\.sig$/, 'macOS updater signature')],
])

mkdirSync(OUT_DIR, { recursive: true })
for (const [name, src] of assets) {
  copyFileSync(src, join(OUT_DIR, name))
  console.log(`${name} <- ${src}`)
}

const sig = (name) => readFileSync(join(OUT_DIR, name), 'utf8').trim()
const platform = (asset, sigName) => ({ signature: sig(sigName), url: `${downloadBase}/${asset}` })
const manifest = {
  version,
  pub_date: new Date().toISOString(),
  platforms: {
    'linux-x86_64': platform('cotect.AppImage', 'cotect.AppImage.sig'),
    'windows-x86_64': platform('cotect-setup.exe', 'cotect-setup.exe.sig'),
    // One universal build serves both mac architectures.
    'darwin-x86_64': platform('cotect-macos.app.tar.gz', 'cotect-macos.app.tar.gz.sig'),
    'darwin-aarch64': platform('cotect-macos.app.tar.gz', 'cotect-macos.app.tar.gz.sig'),
  },
}
writeFileSync(join(OUT_DIR, 'latest.json'), JSON.stringify(manifest, null, 2))
console.log(`latest.json written for ${version}`)
