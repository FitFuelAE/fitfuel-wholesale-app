#!/usr/bin/env python3
"""Generate the home-screen icons for the four apps.

    python3 scripts/make-icons.py

One icon per app rather than one shared icon, because people install more than
one: a storekeeper with admin rights ends up with WS Store and WS Admin side by
side, and four identical black squares are four coin flips every morning.

Black ground and a white mark, matching the apps themselves. No text — at the
size a home screen actually renders these, a word is a smudge and a silhouette
is not. Everything sits inside the maskable safe zone (the middle 80%), so
Android can crop to a circle without taking a wheel off the van.
"""

from PIL import Image, ImageDraw
from pathlib import Path

BG = (17, 17, 17)          # --ink / theme_color
FG = (255, 255, 255)
SIZE = 1024                 # drawn large, downsampled for clean edges
OUT = Path(__file__).resolve().parent.parent


def canvas():
    img = Image.new("RGB", (SIZE, SIZE), BG)
    return img, ImageDraw.Draw(img)


def recentre(img):
    """Sit the mark in the middle of the tile.

    Cheaper and more reliable than balancing coordinates by hand: a van drawn
    with wheels below its body and a key drawn with teeth off one side are both
    optically off-centre no matter how carefully the numbers are chosen.
    """
    mask = img.convert("L").point(lambda v: 255 if v > 60 else 0)
    box = mask.getbbox()
    if not box:
        return img
    dx = SIZE // 2 - (box[0] + box[2]) // 2
    dy = SIZE // 2 - (box[1] + box[3]) // 2
    out = Image.new("RGB", (SIZE, SIZE), BG)
    out.paste(img.crop(box), (box[0] + dx, box[1] + dy))
    return out


def driver():
    """A van, side on."""
    img, d = canvas()
    # body
    d.rounded_rectangle([200, 400, 640, 610], radius=26, fill=FG)
    # bonnet and windscreen
    d.polygon([(640, 430), (762, 500), (824, 500), (824, 610), (640, 610)], fill=FG)
    d.polygon([(660, 452), (742, 500), (660, 500)], fill=BG)
    # wheel arches cut out of the body, then wheels
    for cx in (330, 726):
        d.ellipse([cx - 78, 610 - 78, cx + 78, 610 + 78], fill=BG)
        d.ellipse([cx - 62, 610 - 62, cx + 62, 610 + 62], fill=FG)
        d.ellipse([cx - 26, 610 - 26, cx + 26, 610 + 26], fill=BG)
    # road
    d.rounded_rectangle([180, 668, 844, 692], radius=12, fill=FG)
    return img


def warehouse():
    """A carton, seen straight on, with its tape seam."""
    img, d = canvas()
    d.rounded_rectangle([228, 300, 796, 740], radius=28, fill=FG)
    # lid line
    d.rectangle([228, 430, 796, 452], fill=BG)
    # tape seam down the middle of the lid
    d.rectangle([482, 300, 542, 430], fill=BG)
    # two hand slots, so it reads as a box and not a door
    d.rounded_rectangle([330, 545, 430, 585], radius=20, fill=BG)
    d.rounded_rectangle([594, 545, 694, 585], radius=20, fill=BG)
    return img


def office():
    """A document with a folded corner — the invoice everything starts from."""
    img, d = canvas()
    fold = 150
    x0, y0, x1, y1 = 270, 250, 754, 774
    # The diagonal IS the fold. An earlier version also painted a background
    # triangle over it, which cut a square notch out of the corner instead.
    d.polygon([(x0, y0), (x1 - fold, y0), (x1, y0 + fold), (x1, y1), (x0, y1)], fill=FG)
    # ruled lines
    for i, y in enumerate(range(430, 700, 66)):
        right = x1 - 60 if i % 2 == 0 else x1 - 160
        d.rounded_rectangle([x0 + 60, y, right, y + 26], radius=13, fill=BG)
    return img


def admin():
    """A key: who gets in, and what they may touch."""
    img, d = canvas()
    cx, cy, r = 370, 400, 150
    d.ellipse([cx - r, cy - r, cx + r, cy + r], fill=FG)
    d.ellipse([cx - 62, cy - 62, cx + 62, cy + 62], fill=BG)
    # shaft, running down to the right
    d.rounded_rectangle([cx - 42, cy + 96, cx + 42, 800], radius=20, fill=FG)
    # teeth
    d.rounded_rectangle([cx + 42, 640, cx + 190, 700], radius=18, fill=FG)
    d.rounded_rectangle([cx + 42, 730, cx + 150, 790], radius=18, fill=FG)
    return img


ICONS = {
    "driver/icon-512.png":    driver,
    "warehouse/icon-512.png": warehouse,
    "office/icon-512.png":    office,
    "admin/icon-512.png":     admin,
    # the landing page and anything that still asks for a shared one
    "icon-512.png":           warehouse,
}

for path, make in ICONS.items():
    img = recentre(make())
    for size, suffix in ((512, "-512"), (192, "-192")):
        target = OUT / path.replace("-512.png", f"{suffix}.png")
        target.parent.mkdir(parents=True, exist_ok=True)
        img.resize((size, size), Image.LANCZOS).save(target, "PNG", optimize=True)
        print(f"  {target.relative_to(OUT)}")
