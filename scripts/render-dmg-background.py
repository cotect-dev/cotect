#!/usr/bin/env python3
"""Render the macOS .dmg installer background from tauri/dmg/background.html.

Uses headless Chrome to render the HTML at 2x, then downsamples to the .dmg
window size (660x400) so the result is crisp. Output: tauri/dmg/background.png.

Requires Google Chrome (override with CHROME_BIN) and Pillow.
Run: python3 scripts/render-dmg-background.py
"""
import os
import subprocess
import sys
import tempfile
from pathlib import Path

from PIL import Image

ROOT = Path(__file__).resolve().parent.parent
HTML = ROOT / "tauri/dmg/background.html"
OUT = ROOT / "tauri/dmg/background.png"
W, H = 660, 400
SCALE = 2

CHROME = os.environ.get(
    "CHROME_BIN", "/Applications/Google Chrome.app/Contents/MacOS/Google Chrome"
)


def main() -> int:
    if not Path(CHROME).exists():
        sys.exit(f"Chrome not found at {CHROME!r}; set CHROME_BIN to its path.")

    with tempfile.TemporaryDirectory() as tmp:
        shot = Path(tmp) / "shot.png"
        subprocess.run(
            [
                CHROME,
                "--headless",
                "--disable-gpu",
                "--hide-scrollbars",
                f"--screenshot={shot}",
                f"--window-size={W},{H}",
                f"--force-device-scale-factor={SCALE}",
                HTML.as_uri(),
            ],
            check=True,
            stdout=subprocess.DEVNULL,
            stderr=subprocess.DEVNULL,
        )
        img = Image.open(shot).convert("RGB").resize((W, H), Image.LANCZOS)
        OUT.parent.mkdir(parents=True, exist_ok=True)
        img.save(OUT)
    print(f"wrote {OUT.relative_to(ROOT)} ({W}x{H})")
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
