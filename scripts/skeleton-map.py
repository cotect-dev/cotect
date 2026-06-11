#!/usr/bin/env python3
"""Map a drawn cat-skeleton image onto the AsciiCat glyph grid.

Takes the cartoon skeleton (cream bones on a black cat body, white
background) and the landing icon, aligns the two body silhouettes, and
computes how much bone covers each cell of the ASCII grid used by
landing/components/AsciiCat.tsx. Emits:

  - a BONE_MAP string block to paste into AsciiCat.tsx (stdout)
  - preview.png: the glyph grid with bone weights overlaid, for eyeballing

Usage:
  python3 scripts/skeleton-map.py <skeleton.png> [--icon public/icon.svg]
          [--out-dir /tmp/skel] [--boost 2.2] [--dx 0] [--dy 0]

--dx/--dy nudge the skeleton relative to the icon, in icon pixels.
"""

import argparse
import subprocess
import sys
import tempfile
from pathlib import Path

import numpy as np
from PIL import Image

RENDER_SIZE = 480
CELL = 7
GRID = RENDER_SIZE // CELL  # cells per side that fit fully

DARK_MAX = 100  # max channel value for a pixel to count as cat body outline
MIN_INTENSITY = 0.18  # icon cell threshold, must match sampleCells()


def rasterize_icon(icon_path: Path, out_dir: Path) -> Image.Image:
    if icon_path.suffix == '.svg':
        png = out_dir / 'icon480.png'
        subprocess.run(
            ['inkscape', str(icon_path), '-w', str(RENDER_SIZE), '-h', str(RENDER_SIZE), '-o', str(png)],
            check=True,
            capture_output=True,
        )
        return Image.open(png).convert('RGBA')
    return Image.open(icon_path).convert('RGBA').resize((RENDER_SIZE, RENDER_SIZE))


def icon_cell_grid(icon: Image.Image) -> np.ndarray:
    """Boolean grid of glyph cells, sampled exactly like sampleCells()."""
    a = np.asarray(icon, dtype=np.float64)
    cells = np.zeros((GRID + 1, GRID + 1), dtype=bool)
    for gy, y in enumerate(range(0, RENDER_SIZE, CELL)):
        for gx, x in enumerate(range(0, RENDER_SIZE, CELL)):
            px = min(RENDER_SIZE - 1, x + CELL // 2)
            py = min(RENDER_SIZE - 1, y + CELL // 2)
            intensity = (a[py, px, 3] / 255.0) * (a[py, px, 0] / 255.0)
            cells[gy, gx] = intensity > MIN_INTENSITY
    return cells


def largest_component(mask: np.ndarray) -> np.ndarray:
    """Largest 4-connected component, BFS without scipy."""
    seen = np.zeros_like(mask)
    best: list[tuple[int, int]] = []
    h, w = mask.shape
    for sy in range(h):
        for sx in range(w):
            if not mask[sy, sx] or seen[sy, sx]:
                continue
            comp = [(sy, sx)]
            seen[sy, sx] = True
            queue = [(sy, sx)]
            while queue:
                cy, cx = queue.pop()
                for ny, nx in ((cy - 1, cx), (cy + 1, cx), (cy, cx - 1), (cy, cx + 1)):
                    if 0 <= ny < h and 0 <= nx < w and mask[ny, nx] and not seen[ny, nx]:
                        seen[ny, nx] = True
                        comp.append((ny, nx))
                        queue.append((ny, nx))
            if len(comp) > len(best):
                best = comp
    out = np.zeros_like(mask)
    for cy, cx in best:
        out[cy, cx] = True
    return out


def flood_background(open_mask: np.ndarray) -> np.ndarray:
    """Region of open_mask connected to the border, via iterative dilation."""
    bg = np.zeros_like(open_mask)
    bg[0, :] = open_mask[0, :]
    bg[-1, :] = open_mask[-1, :]
    bg[:, 0] = open_mask[:, 0]
    bg[:, -1] = open_mask[:, -1]
    while True:
        grown = bg.copy()
        grown[1:, :] |= bg[:-1, :]
        grown[:-1, :] |= bg[1:, :]
        grown[:, 1:] |= bg[:, :-1]
        grown[:, :-1] |= bg[:, 1:]
        grown &= open_mask
        if (grown == bg).all():
            return bg
        bg = grown


def extract_bone(skeleton: Image.Image) -> tuple[np.ndarray, np.ndarray]:
    """Returns (bone_mask, body_mask) at the skeleton image's resolution."""
    rgb = np.asarray(skeleton.convert('RGB'), dtype=np.int64)
    dark = rgb.max(axis=2) < DARK_MAX
    bg = flood_background(~dark)
    body = ~bg  # dark outline plus everything it encloses
    bone = body & ~dark
    return bone, body


def bbox(mask: np.ndarray) -> tuple[int, int, int, int]:
    ys, xs = np.where(mask)
    return xs.min(), ys.min(), xs.max(), ys.max()


def main() -> None:
    ap = argparse.ArgumentParser()
    ap.add_argument('skeleton')
    ap.add_argument('--icon', default='public/icon.svg')
    ap.add_argument('--out-dir', default=tempfile.gettempdir() + '/skel')
    ap.add_argument('--boost', type=float, default=2.2, help='coverage-to-weight multiplier')
    ap.add_argument('--dx', type=float, default=0.0)
    ap.add_argument('--dy', type=float, default=0.0)
    args = ap.parse_args()

    out_dir = Path(args.out_dir)
    out_dir.mkdir(parents=True, exist_ok=True)

    icon = rasterize_icon(Path(args.icon), out_dir)
    cells = icon_cell_grid(icon)
    body_cells = largest_component(cells)  # drops the tail-wag marks

    skeleton = Image.open(args.skeleton)
    bone, skel_body = extract_bone(skeleton)

    # Affine fit: skeleton body bbox -> icon body bbox (pixel space).
    bx0, by0, bx1, by1 = bbox(body_cells)
    ix0, iy0 = bx0 * CELL, by0 * CELL
    ix1, iy1 = (bx1 + 1) * CELL, (by1 + 1) * CELL
    sx0, sy0, sx1, sy1 = bbox(skel_body)
    scale_x = (sx1 - sx0) / (ix1 - ix0)
    scale_y = (sy1 - sy0) / (iy1 - iy0)

    def to_skel(x: float, y: float) -> tuple[float, float]:
        return sx0 + (x - ix0 - args.dx) * scale_x, sy0 + (y - iy0 - args.dy) * scale_y

    bone_u8 = bone.astype(np.uint8)
    weights = np.zeros((GRID + 1, GRID + 1))
    dropped = 0.0
    for gy in range(GRID + 1):
        for gx in range(GRID + 1):
            x0, y0 = to_skel(gx * CELL, gy * CELL)
            x1, y1 = to_skel((gx + 1) * CELL, (gy + 1) * CELL)
            xa, xb = max(0, int(x0)), min(bone.shape[1], int(np.ceil(x1)))
            ya, yb = max(0, int(y0)), min(bone.shape[0], int(np.ceil(y1)))
            if xb <= xa or yb <= ya:
                continue
            coverage = bone_u8[ya:yb, xa:xb].mean()
            if coverage < 0.06:
                continue
            w = min(1.0, coverage * args.boost)
            if cells[gy, gx]:
                weights[gy, gx] = w
            else:
                dropped += w

    kept = weights.sum()
    print(f'// bone cells: {(weights > 0).sum()}, total weight {kept:.1f}, '
          f'clipped outside silhouette: {dropped:.1f}', file=sys.stderr)

    # Encode: one string per grid row, '.' = no bone, hex digit = weight/15.
    lines = []
    for gy in range(GRID + 1):
        row = ''.join(
            '.' if weights[gy, gx] == 0 else format(max(1, round(weights[gy, gx] * 15)), 'x')
            for gx in range(GRID + 1)
        )
        lines.append(row.rstrip('.'))
    top = 0
    while lines and not lines[0]:
        lines.pop(0)
        top += 1
    while lines and not lines[-1]:
        lines.pop()
    print(f'const BONE_MAP_TOP = {top}')
    print('const BONE_MAP = [')
    for line in lines:
        print(f"  '{line}',")
    print(']')

    # Preview: dim green blocks for icon cells, cream alpha for bone weight.
    prev = Image.new('RGB', (RENDER_SIZE, RENDER_SIZE), (10, 12, 10))
    pa = np.asarray(prev).copy()
    for gy in range(GRID + 1):
        for gx in range(GRID + 1):
            if not cells[gy, gx]:
                continue
            ys, xs = gy * CELL, gx * CELL
            block = pa[ys + 1 : ys + CELL - 1, xs + 1 : xs + CELL - 1]
            w = weights[gy, gx]
            if w > 0:
                block[:] = (int(40 + 187 * w), int(50 + 197 * w), int(45 + 189 * w))
            else:
                block[:] = (24, 60, 38)
    Image.fromarray(pa).save(out_dir / 'preview.png')
    print(f'// preview: {out_dir}/preview.png', file=sys.stderr)


if __name__ == '__main__':
    main()
