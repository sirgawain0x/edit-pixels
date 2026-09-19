#!/usr/bin/env python3
"""Generate Creative Pixels brand icons from pixels-mark.png (1024×1024, white bg)."""

from __future__ import annotations

import base64
import io
import os
import struct
from pathlib import Path

import numpy as np
from PIL import Image

ROOT = Path(__file__).resolve().parents[1]
SOURCE_CANDIDATES = [
    ROOT / "pixels-brand" / "pixels-mark.png",
    ROOT / "public" / "assets" / "brand" / "pixels-mark.png",
]
BRAND_DIR = ROOT / "public" / "assets" / "brand"
ICONS_DIR = ROOT / "public" / "icons"
PUBLIC_DIR = ROOT / "public"
MASKABLE_BG = (17, 24, 39, 255)  # #111827


def resolve_source() -> Path:
    for candidate in SOURCE_CANDIDATES:
        if candidate.is_file():
            return candidate
    raise FileNotFoundError(
        "Authoritative source not found. Place pixels-mark.png at pixels-brand/pixels-mark.png"
    )


def load_master(path: Path) -> Image.Image:
    master = Image.open(path).convert("RGBA")
    if master.size != (1024, 1024):
        master = master.resize((1024, 1024), Image.Resampling.LANCZOS)
    return master


def white_background_to_alpha(image: Image.Image, threshold: int = 245) -> Image.Image:
    """Key white/near-white background to alpha; preserve interior highlight pixels."""
    arr = np.array(image.convert("RGBA"))
    h, w = arr.shape[:2]
    near_white = (
        (arr[:, :, 0] >= threshold)
        & (arr[:, :, 1] >= threshold)
        & (arr[:, :, 2] >= threshold)
    )

    # Flood-fill background white from image edges (preserves yellow tip sparkles).
    background = np.zeros((h, w), dtype=bool)
    stack: list[tuple[int, int]] = []
    for x in range(w):
        stack.append((x, 0))
        stack.append((x, h - 1))
    for y in range(h):
        stack.append((0, y))
        stack.append((w - 1, y))

    while stack:
        x, y = stack.pop()
        if x < 0 or y < 0 or x >= w or y >= h:
            continue
        if background[y, x] or not near_white[y, x]:
            continue
        background[y, x] = True
        stack.extend([(x + 1, y), (x - 1, y), (x, y + 1), (x, y - 1)])

    arr[background, 3] = 0
    return Image.fromarray(arr, "RGBA")


def fit_on_canvas(
    image: Image.Image,
    size: int,
    fill_ratio: float,
    bg_color: tuple[int, int, int, int] | None,
) -> Image.Image:
    if bg_color is None:
        canvas = Image.new("RGBA", (size, size), (0, 0, 0, 0))
    else:
        canvas = Image.new("RGBA", (size, size), bg_color)

    scale = min(size * fill_ratio / image.width, size * fill_ratio / image.height)
    nw = max(1, int(image.width * scale))
    nh = max(1, int(image.height * scale))
    resized = image.resize((nw, nh), Image.Resampling.LANCZOS)
    ox, oy = (size - nw) // 2, (size - nh) // 2
    if resized.mode == "RGBA":
        canvas.paste(resized, (ox, oy), resized)
    else:
        canvas.paste(resized, (ox, oy))
    return canvas


def save_png(image: Image.Image, path: Path) -> None:
    path.parent.mkdir(parents=True, exist_ok=True)
    if image.mode == "RGB":
        image.save(path, "PNG", optimize=True)
    else:
        image.save(path, "PNG", optimize=True)


def write_favicon_svg(png_path: Path, svg_path: Path) -> None:
    data = base64.b64encode(png_path.read_bytes()).decode()
    svg_path.write_text(
        f'<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 48 48" width="48" height="48">\n'
        f'  <image href="data:image/png;base64,{data}" width="48" height="48"/>\n'
        f"</svg>\n"
    )


def write_favicon_ico(images: list[Image.Image], path: Path) -> None:
    images[0].save(
        path,
        format="ICO",
        sizes=[(img.width, img.height) for img in images],
        append_images=images[1:],
    )


def main() -> None:
    source = resolve_source()
    master_rgb = Image.open(source).convert("RGB")
    master_rgba = white_background_to_alpha(master_rgb)

    BRAND_DIR.mkdir(parents=True, exist_ok=True)
    save_png(master_rgb, BRAND_DIR / "pixels-mark.png")
    save_png(master_rgba, BRAND_DIR / "pixels-mark-transparent.png")
    save_png(fit_on_canvas(master_rgba, 256, 0.88, None), BRAND_DIR / "pixels-mark-icon-256.png")

    transparent_master = master_rgba

    favicon_sizes = [16, 32, 48]
    favicon_images: list[Image.Image] = []
    for size in favicon_sizes:
        icon = fit_on_canvas(transparent_master, size, 0.9, None)
        out = PUBLIC_DIR / f"favicon-{size}.png"
        save_png(icon, out)
        favicon_images.append(icon)

    write_favicon_ico(favicon_images, PUBLIC_DIR / "favicon.ico")
    write_favicon_svg(PUBLIC_DIR / "favicon-48.png", PUBLIC_DIR / "favicon.svg")

    apple_canvas = Image.new("RGB", (180, 180), (255, 255, 255))
    scale = min(180 * 0.82 / master_rgb.width, 180 * 0.82 / master_rgb.height)
    nw, nh = max(1, int(master_rgb.width * scale)), max(1, int(master_rgb.height * scale))
    apple_resized = master_rgb.resize((nw, nh), Image.Resampling.LANCZOS)
    apple_canvas.paste(apple_resized, ((180 - nw) // 2, (180 - nh) // 2))
    save_png(apple_canvas, PUBLIC_DIR / "apple-touch-icon.png")
    save_png(fit_on_canvas(transparent_master, 192, 0.82, None), ICONS_DIR / "icon-192.png")
    save_png(fit_on_canvas(transparent_master, 512, 0.82, None), ICONS_DIR / "icon-512.png")
    save_png(
        fit_on_canvas(transparent_master, 512, 0.64, MASKABLE_BG),
        ICONS_DIR / "icon-maskable-512.png",
    )

    print(f"Source: {source} ({source.stat().st_size} bytes)")
    print("Generated brand icons from white-background master.")


if __name__ == "__main__":
    main()
