import { invoke } from '@tauri-apps/api/core'
import { check } from '@tauri-apps/plugin-updater'
import { ask, message } from '@tauri-apps/plugin-dialog'
import { relaunch } from '@tauri-apps/plugin-process'

// Remembers which version a package-manager install was already told about,
// so the announcement shows once per version instead of on every launch.
const ANNOUNCED_VERSION_KEY = 'updater.announcedVersion'

// Startup update check against the GitHub releases manifest. Fire-and-forget:
// any failure (offline, manifest missing, signature mismatch) leaves the
// running version untouched.
export async function checkForUpdates(): Promise<void> {
  try {
    const selfUpdatable = await invoke<boolean>('is_self_updatable')
    const update = await check()
    if (!update) return
    if (!selfUpdatable) {
      // Package-manager installs (deb/rpm/AUR) cannot overwrite themselves;
      // announce the version and let the package manager deliver it.
      if (localStorage.getItem(ANNOUNCED_VERSION_KEY) === update.version) return
      await message(
        `Cotect ${update.version} is available (you have ${update.currentVersion}). Get it from cotect.dev or your package manager.`,
        { title: 'Update available', kind: 'info' },
      )
      localStorage.setItem(ANNOUNCED_VERSION_KEY, update.version)
      return
    }
    const install = await ask(
      `Cotect ${update.version} is available (you have ${update.currentVersion}).`,
      {
        title: 'Update available',
        kind: 'info',
        okLabel: 'Install and restart',
        cancelLabel: 'Later',
      },
    )
    if (!install) return
    await update.downloadAndInstall()
    // On Windows the installer exits the app itself; elsewhere we relaunch.
    await relaunch()
  } catch (err) {
    console.warn('[updater] update check failed:', err)
  }
}
