"""Generate app icons for 时光 (Shiguang Chat).

Draws a dark rounded-square with a clock + speech-bubble mark, then exports
192/512 PNGs plus a maskable variant.
"""
import os
from PIL import Image, ImageDraw, ImageFilter

HERE = os.path.dirname(os.path.abspath(__file__))
OUT = os.path.join(os.path.dirname(HERE), "icons")
os.makedirs(OUT, exist_ok=True)

S = 1024  # supersampled canvas


def lerp(a, b, t):
    return tuple(round(a[i] + (b[i] - a[i]) * t) for i in range(3))


def base_canvas(pad_ratio=0.0, rounded=True):
    top = (18, 24, 38)
    bottom = (12, 15, 24)
    img = Image.new("RGB", (S, S), bottom)
    px = img.load()
    for y in range(S):
        t = y / (S - 1)
        c = lerp(top, bottom, t)
        for x in range(S):
            px[x, y] = c

    accent = Image.new("RGBA", (S, S), (0, 0, 0, 0))
    ad = ImageDraw.Draw(accent)
    # soft accent glow behind the mark
    ad.ellipse(
        [S * 0.18, S * 0.20, S * 0.82, S * 0.84],
        fill=(77, 141, 255, 46),
    )
    accent = accent.filter(ImageFilter.GaussianBlur(120))
    img = Image.alpha_composite(img.convert("RGBA"), accent)

    if rounded:
        mask = Image.new("L", (S, S), 0)
        md = ImageDraw.Draw(mask)
        r = int(S * 0.225)
        md.rounded_rectangle([0, 0, S - 1, S - 1], radius=r, fill=255)
        out = Image.new("RGBA", (S, S), (0, 0, 0, 0))
        out.paste(img, (0, 0), mask)
        img = out
    return img


def draw_mark(img, scale=1.0):
    """Clock ring on the right, speech bubble tail bottom-left."""
    d = ImageDraw.Draw(img)
    cx, cy = S * 0.54, S * 0.50
    rr = S * 0.275 * scale
    w = int(S * 0.062 * scale)
    ring = (245, 248, 255, 255)
    d.ellipse([cx - rr, cy - rr, cx + rr, cy + rr], fill=ring)

    inner = (17, 22, 34, 255)
    r2 = rr - w
    d.ellipse([cx - r2, cy - r2, cx + r2, cy + r2], fill=inner)

    # hands, rounded
    def hand(angle_deg, length, width):
        import math
        a = math.radians(angle_deg)
        x2 = cx + math.cos(a) * length
        y2 = cy + math.sin(a) * length
        d.line([cx, cy, x2, y2], fill=ring, width=int(width), joint="curve")
        d.ellipse([x2 - width / 2, y2 - width / 2, x2 + width / 2, y2 + width / 2], fill=ring)

    hand(-90 + 0, r2 * 0.58, S * 0.040 * scale)  # hour hand -> 12
    hand(30, r2 * 0.80, S * 0.032 * scale)       # minute hand -> 4

    # speech bubble tail
    bx, by = S * 0.30, S * 0.70
    d.polygon(
        [(bx - S * 0.055 * scale, by), (bx + S * 0.085 * scale, by), (bx - S * 0.02 * scale, by + S * 0.115 * scale)],
        fill=ring,
    )
    return img


def rounded_alpha(img, radius_ratio=0.225):
    mask = Image.new("L", img.size, 0)
    md = ImageDraw.Draw(mask)
    r = int(img.size[0] * radius_ratio)
    md.rounded_rectangle([0, 0, img.size[0] - 1, img.size[1] - 1], radius=r, fill=255)
    out = img.copy()
    out.putalpha(mask)
    return out


def save(img, name, size):
    img.resize((size, size), Image.LANCZOS).save(os.path.join(OUT, name), "PNG", optimize=True)


big = draw_mark(base_canvas(), scale=1.0)
save(big, "icon-512.png", 512)
save(big, "icon-192.png", 192)
save(big, "apple-touch-icon.png", 180)

# maskable: full-bleed background, mark shrunk into the 80% safe zone
mask = base_canvas(rounded=False).resize((S, S))
mask = draw_mark(mask, scale=0.78)
save(mask, "icon-maskable-512.png", 512)

favicon = draw_mark(base_canvas(), scale=1.0).resize((64, 64), Image.LANCZOS)
favicon.save(os.path.join(OUT, "favicon.png"), "PNG", optimize=True)
print("icons written to", OUT)
for f in sorted(os.listdir(OUT)):
    print(" -", f)
