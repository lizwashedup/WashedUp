#!/usr/bin/env python3
"""Generate the 'happening now' map marker PNG (Android).

Run from the repo root:
    python3 scripts/generate-happening-now-marker.py

Writes to: assets/markers/happening-now.png

128x128 px teardrop pin with "LIVE" text baked in. Gold body (#C5A55A),
warm-brown outline (#2C1810 @ 40%), terracotta (#B5522E) 'live' dot +
soft terracotta glow radiating ~10px beyond edges. Dark (#2C1810) "LIVE"
label centered in the head. anchor={x:0.5, y:1} on the Marker.
"""
from PIL import Image, ImageDraw, ImageFilter, ImageFont
from pathlib import Path

W, H = 128, 128

GOLD = (197, 165, 90, 255)         # #C5A55A body
TERRACOTTA = (181, 82, 46, 255)    # #B5522E live dot + glow
DARK = (44, 24, 16, 255)           # #2C1810 text
OUTLINE = (44, 24, 16, 102)        # #2C1810 @ 40% alpha

SCALE = 4
sw, sh = W * SCALE, H * SCALE

REPO = Path(__file__).resolve().parent.parent
FONT_PATH = REPO / "assets" / "fonts" / "SpaceMono-Regular.ttf"

# ── Step 1: Glow layer ───────────────────────────────────────────────────────
glow = Image.new("RGBA", (sw, sh), (0, 0, 0, 0))
gd = ImageDraw.Draw(glow)

gcx, gcy, gr = 64 * SCALE, 52 * SCALE, 34 * SCALE
gd.ellipse([gcx - gr, gcy - gr, gcx + gr, gcy + gr], fill=TERRACOTTA)
glow_tail = [
    (30 * SCALE, 70 * SCALE),
    (98 * SCALE, 70 * SCALE),
    (64 * SCALE, 118 * SCALE),
]
gd.polygon(glow_tail, fill=TERRACOTTA)

glow = glow.filter(ImageFilter.GaussianBlur(radius=10 * SCALE))

glow_data = glow.load()
for y in range(sh):
    for x in range(sw):
        r, g, b, a = glow_data[x, y]
        if a > 0:
            glow_data[x, y] = (r, g, b, int(a * 0.25))

# ── Step 2: Crisp pin layer ───────────────────────────────────────────────────
pin = Image.new("RGBA", (sw, sh), (0, 0, 0, 0))
d = ImageDraw.Draw(pin)

cx, cy, r = 64 * SCALE, 52 * SCALE, 30 * SCALE
stroke = 2 * SCALE

# Outline
d.ellipse(
    [cx - r - stroke, cy - r - stroke, cx + r + stroke, cy + r + stroke],
    fill=OUTLINE,
)
tail_outline = [
    (32 * SCALE - stroke, 72 * SCALE),
    (96 * SCALE + stroke, 72 * SCALE),
    (64 * SCALE, 120 * SCALE + stroke),
]
d.polygon(tail_outline, fill=OUTLINE)

# Gold body
d.ellipse([cx - r, cy - r, cx + r, cy + r], fill=GOLD)
tail_body = [
    (32 * SCALE, 72 * SCALE),
    (96 * SCALE, 72 * SCALE),
    (64 * SCALE, 120 * SCALE),
]
d.polygon(tail_body, fill=GOLD)

# Live dot: terracotta, radius 6 at 1x, centered at (64, 38)
dot_cx, dot_cy, dot_r = 64 * SCALE, 38 * SCALE, 6 * SCALE
d.ellipse(
    [dot_cx - dot_r, dot_cy - dot_r, dot_cx + dot_r, dot_cy + dot_r],
    fill=TERRACOTTA,
)

# "LIVE" text centered in the head, below the dot
try:
    font = ImageFont.truetype(str(FONT_PATH), size=14 * SCALE)
except Exception:
    font = ImageFont.load_default()

text = "LIVE"
bbox = d.textbbox((0, 0), text, font=font)
tw, th = bbox[2] - bbox[0], bbox[3] - bbox[1]
tx = cx - tw // 2
ty = cy - th // 2 + 4 * SCALE  # nudge slightly below center of head
d.text((tx, ty), text, fill=DARK, font=font)

# ── Step 3: Composite ────────────────────────────────────────────────────────
composite = Image.new("RGBA", (sw, sh), (0, 0, 0, 0))
composite = Image.alpha_composite(composite, glow)
composite = Image.alpha_composite(composite, pin)

final = composite.resize((W, H), Image.LANCZOS)

out = REPO / "assets" / "markers" / "happening-now.png"
out.parent.mkdir(parents=True, exist_ok=True)
final.save(out, "PNG")
print(f"wrote {out}  ({W}x{H})")
