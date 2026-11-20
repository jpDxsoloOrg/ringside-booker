#!/usr/bin/env python3
"""Render the three 3D ring icon variants with Blender, then build PNGs, .ico files and a sheet.

    python build_ring_icons.py [--variants ABC] [--samples 128] [--skip-render]
                               [--blender <blender.exe>] [--compare <compare.png>]

Needs Pillow (`pip install pillow`, a venv is fine). Runs from WSL with the Windows Blender (paths
are converted with `wslpath -w`) or from Windows/Linux with a native Blender.

For each variant V it writes:
    game/branding/blender/.renders/ring-V-large.png   raw Blender render, 1024 px (gitignored)
    game/branding/blender/.renders/ring-V-small.png   raw simplified render, 512 px (gitignored)
    game/branding/ring-V-1024.png                     the finished 1024 px icon
    game/branding/ring-V.ico                          16, 20, 24, 32, 40, 48, 64, 96, 128, 256
Sizes up to SMALL_MAX come from the simplified render (thick ropes, no apron text, big "RB").
B and C sit on the navy rounded tile of the flat icon; C is cropped to the tile.
"""

import argparse
import os
import shutil
import subprocess
import sys
import time

from PIL import Image, ImageDraw, ImageFilter, ImageFont

HERE = os.path.dirname(os.path.abspath(__file__))
BRANDING = os.path.dirname(HERE)
GAME = os.path.dirname(BRANDING)
RENDERS = os.path.join(HERE, ".renders")
FONT = os.path.join(GAME, "Assets", "UI", "Fonts", "BarlowCondensed-ExtraBold.ttf")
DEFAULT_BLENDER = "/mnt/c/Program Files/Blender Foundation/Blender 5.3/blender.exe"

ICO_SIZES = [16, 20, 24, 32, 40, 48, 64, 96, 128, 256]
SMALL_MAX = 32
UNITY_SIZES = [16, 32, 48, 64, 128, 256, 512, 1024]  # Assets/UI/AppIcon, read by BuildScripts

# UNITY-11 tokens (the flat icon's tile: elev-3 -> elev-0 gradient, line-strong border).
TILE_TOP = (0x19, 0x25, 0x3F)
TILE_BOTTOM = (0x08, 0x0C, 0x15)
TILE_LINE = (0x34, 0x47, 0x6A)

# How each variant is placed: tile or not, and the ring's scale inside the 1024 canvas.
LAYOUT = {
    "A": {"tile": False, "scale": 1.0, "small_scale": 1.0},
    "B": {"tile": True, "scale": 0.86, "small_scale": 0.8},
    "C": {"tile": True, "scale": 1.0, "small_scale": 0.8, "crop": True},
}


def win_path(path):
    if sys.platform.startswith("linux") and shutil.which("wslpath"):
        return subprocess.check_output(["wslpath", "-w", path], text=True).strip()
    return path


def render(blender, variant, small, size, samples):
    out = os.path.join(RENDERS, f"ring-{variant}-{'small' if small else 'large'}.png")
    args = [blender, "-b", "-P", win_path(os.path.join(HERE, "ring_icon.py")), "--"]
    args += ["--variant", variant, "--size", str(size), "--samples", str(samples), "--out", win_path(out)]
    if small:
        args.append("--small")
    started = time.time()
    result = subprocess.run(args, capture_output=True, text=True)
    if result.returncode != 0 or not os.path.exists(out):
        sys.stderr.write(result.stdout[-4000:] + result.stderr[-4000:])
        raise SystemExit(f"Blender failed for {variant} ({'small' if small else 'large'})")
    print(f"  rendered {os.path.basename(out)} in {time.time() - started:.1f} s")
    return out


def rounded_mask(size, inset, radius):
    """An antialiased rounded-square mask (drawn at 4x and reduced)."""
    big = Image.new("L", (size * 4, size * 4), 0)
    ImageDraw.Draw(big).rounded_rectangle(
        (inset * 4, inset * 4, (size - inset) * 4 - 1, (size - inset) * 4 - 1), radius * 4, fill=255
    )
    return big.resize((size, size), Image.LANCZOS)


def tile(size):
    """The navy tile of the flat icon, scaled from its 256 px design (inset 6, radius 48, 4 px line)."""
    k = size / 256
    gradient = Image.new("RGBA", (size, size))
    draw = ImageDraw.Draw(gradient)
    for y in range(size):
        t = y / max(1, size - 1)
        colour = tuple(round(a + (b - a) * t) for a, b in zip(TILE_TOP, TILE_BOTTOM))
        draw.line((0, y, size, y), fill=colour + (255,))
    outer = rounded_mask(size, 6 * k, 48 * k)
    inner = rounded_mask(size, 10 * k, 44 * k)
    line = Image.new("RGBA", (size, size), TILE_LINE + (255,))
    body = Image.new("RGBA", (size, size), (0, 0, 0, 0))
    body.paste(line, (0, 0), outer)
    body.paste(gradient, (0, 0), inner)
    return body, inner


def compose(render_path, variant, size, small):
    layout = LAYOUT[variant]
    ring = Image.open(render_path).convert("RGBA").resize((size, size), Image.LANCZOS)
    scale = layout["small_scale"] if small else layout["scale"]
    if scale != 1.0:
        scaled = ring.resize((round(size * scale), round(size * scale)), Image.LANCZOS)
        ring = Image.new("RGBA", (size, size), (0, 0, 0, 0))
        ring.alpha_composite(scaled, ((size - scaled.width) // 2, (size - scaled.height) // 2))
    if not layout["tile"]:
        return ring
    body, inner = tile(size)
    if layout.get("crop"):
        clipped = Image.new("RGBA", (size, size), (0, 0, 0, 0))
        clipped.paste(ring, (0, 0), Image.composite(ring.getchannel("A"), Image.new("L", (size, size), 0), inner))
        ring = clipped
    body.alpha_composite(ring)
    return body


def build_sizes(variant):
    large = compose(os.path.join(RENDERS, f"ring-{variant}-large.png"), variant, 1024, small=False)
    small = compose(os.path.join(RENDERS, f"ring-{variant}-small.png"), variant, 512, small=True)
    images = {1024: large}
    for size in ICO_SIZES:
        source = small if size <= SMALL_MAX else large
        img = source.resize((size, size), Image.LANCZOS)
        if size <= SMALL_MAX:
            img = img.filter(ImageFilter.UnsharpMask(radius=0.6, percent=60, threshold=1))
        images[size] = img
    return images


def write_icon(variant, images):
    png = os.path.join(BRANDING, f"ring-{variant}-1024.png")
    ico = os.path.join(BRANDING, f"ring-{variant}.ico")
    images[1024].save(png, optimize=True)
    biggest = images[ICO_SIZES[-1]]
    others = [images[s] for s in ICO_SIZES[:-1]]
    biggest.save(ico, format="ICO", sizes=[(s, s) for s in ICO_SIZES], append_images=others)
    print(f"  wrote {os.path.relpath(png, GAME)} and {os.path.relpath(ico, GAME)}")


def install(variant, images):
    ico = os.path.join(BRANDING, f"ring-{variant}.ico")
    for target in (os.path.join(BRANDING, "app-icon.ico"), os.path.join(GAME, "installer", "RingsideBooker.ico")):
        shutil.copyfile(ico, target)
        print(f"  copied to {os.path.relpath(target, GAME)}")
    unity = os.path.join(GAME, "Assets", "UI", "AppIcon")
    for size in UNITY_SIZES:
        img = images.get(size) or images[1024].resize((size, size), Image.LANCZOS)
        img.save(os.path.join(unity, f"AppIcon-{size}.png"), optimize=True)
    print(f"  wrote {os.path.relpath(unity, GAME)}/AppIcon-<size>.png for {UNITY_SIZES}")


def flat_icon(size):
    path = os.path.join(BRANDING, f"app-icon-{size}.png")
    return Image.open(path).convert("RGBA") if os.path.exists(path) else None


def compare_sheet(rows, out):
    """Each row at 256/64/32/16 plus 4x/8x pixel zooms of 32/16, on a light and a dark panel."""
    sizes = [256, 64, 32, 16]
    zooms = [(32, 4), (16, 8)]
    gap, label_w, head_h = 24, 170, 110
    panel_w = sum(sizes) + sum(s * z for s, z in zooms) + gap * (len(sizes) + len(zooms) + 1)
    row_h = 256 + gap
    width = label_w + panel_w * 2 + gap
    height = head_h + row_h * len(rows) + gap
    sheet = Image.new("RGBA", (width, height), (0x2B, 0x2F, 0x36, 255))
    draw = ImageDraw.Draw(sheet)
    title = ImageFont.truetype(FONT, 34)
    small = ImageFont.truetype(FONT, 20)
    panels = [((0xF3, 0xF4, 0xF6), (0x1F, 0x29, 0x37), "LIGHT"), ((0x0B, 0x0F, 0x19), (0xE5, 0xE7, 0xEB), "DARK")]
    for p, (bg, _fg, name) in enumerate(panels):
        x0 = label_w + p * (panel_w + gap)
        draw.rectangle((x0, head_h - 8, x0 + panel_w, height - gap + 8), fill=bg + (255,))
        x = x0 + gap
        for s in sizes:
            draw.text((x, head_h - 30), f"{s}", font=small, fill=(0xE5, 0xE7, 0xEB))
            x += s + gap
        for s, z in zooms:
            draw.text((x, head_h - 30), f"{s} px x{z}", font=small, fill=(0xE5, 0xE7, 0xEB))
            x += s * z + gap
        draw.text((x0, 50), f"{name} BACKGROUND", font=small, fill=(0x9C, 0xA3, 0xAF))
    draw.text((16, 8), "RINGSIDE BOOKER ICONS", font=title, fill=(0xF1, 0xF5, 0xF9))
    for r, (name, images) in enumerate(rows):
        y0 = head_h + r * row_h + gap // 2
        draw.text((16, y0 + 110), name, font=title, fill=(0xF1, 0xF5, 0xF9))
        for p, (bg, _fg, _n) in enumerate(panels):
            x = label_w + p * (panel_w + gap) + gap
            for s in sizes:
                img = images.get(s)
                if img is not None:
                    sheet.alpha_composite(img, (x, y0 + (256 - s) // 2))
                x += s + gap
            for s, z in zooms:
                img = images.get(s)
                if img is not None:
                    zoomed = img.resize((s * z, s * z), Image.NEAREST)
                    sheet.alpha_composite(zoomed, (x, y0 + (256 - s * z) // 2))
                x += s * z + gap
    os.makedirs(os.path.dirname(out), exist_ok=True)
    sheet.convert("RGB").save(out)
    print(f"  wrote {out}")


def main():
    parser = argparse.ArgumentParser(description=__doc__, formatter_class=argparse.RawDescriptionHelpFormatter)
    parser.add_argument("--variants", default="ABC")
    parser.add_argument("--samples", type=int, default=128)
    parser.add_argument("--blender", default=os.environ.get("BLENDER", DEFAULT_BLENDER))
    parser.add_argument("--skip-render", action="store_true", help="reuse .renders/ from the last run")
    parser.add_argument("--compare", help="also write a comparison sheet PNG here")
    parser.add_argument(
        "--install",
        metavar="V",
        help="make variant V the game's icon: copy ring-V.ico to app-icon.ico and the installer, "
        "and write the Unity player icon PNGs (run after the owner picks; implies --variants V)",
    )
    args = parser.parse_args()

    if args.install:
        args.variants = args.install
    os.makedirs(RENDERS, exist_ok=True)
    started = time.time()
    rows = [("CURRENT", {s: flat_icon(s) for s in (256, 64, 32, 16)})]
    for variant in args.variants.upper():
        print(f"Variant {variant}")
        if not args.skip_render:
            render(args.blender, variant, False, 1024, args.samples)
            render(args.blender, variant, True, 512, args.samples)
        images = build_sizes(variant)
        write_icon(variant, images)
        rows.append((variant, images))
    if args.install:
        install(args.install.upper(), images)
    if args.compare:
        compare_sheet(rows, args.compare)
    print(f"Done in {time.time() - started:.1f} s")


main()
