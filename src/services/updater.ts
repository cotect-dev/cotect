import { invoke } from '@tauri-apps/api/core'
import { check } from '@tauri-apps/plugin-updater'
import { ask } from '@tauri-apps/plugin-dialog'
import { relaunch } from '@tauri-apps/plugin-process'

// Startup update check against the GitHub releases manifest. Fire-and-forget:
// any failure (offline, manifest missing, signature mismatch) leaves the
// running version untouched.
export async function checkForUpdates(): Promise<void> {
  try {
    // Package-manager installs (deb/rpm/AUR) update through the package
    // manager; the updater cannot write to system paths anyway.
    if (!(await invoke<boolean>('is_self_updatable'))) return
    const update = await check()
    if (!update) return
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
