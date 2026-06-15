# dmgbuild settings for the macOS .dmg installer window.
#
# Tauri styles its DMG by scripting Finder over AppleScript, which is skipped on
# headless CI runners (the published DMG then opens unstyled). dmgbuild writes
# the .DS_Store itself, so the background, icon positions, and hidden helper
# files apply the same way locally and in CI.
#
# Build the app first, then run from the repo root:
#   DMG_APP=path/to/Cotect.app \
#     dmgbuild -s tauri/dmg/dmgbuild-settings.py Cotect out.dmg
import os

application = os.environ.get(
    "DMG_APP",
    "tauri/target/universal-apple-darwin/release/bundle/macos/Cotect.app",
)

format = "UDZO"
files = [application]
symlinks = {"Applications": "/Applications"}

# Layout matches tauri/dmg/background.html: app on the left, Applications on the
# right, the arrow in the gap. Coordinates are icon centres in window points.
icon_locations = {
    os.path.basename(application): (165, 190),
    "Applications": (495, 190),
}

# Paths are relative to the repo root (the CWD when this runs).
background = "tauri/dmg/background.png"
icon = "tauri/icons/icon.icns"

# ((window x, y on screen), (content width, height)) — size matches background.png.
window_rect = ((200, 120), (660, 400))
default_view = "icon-view"
icon_size = 128
text_size = 13
