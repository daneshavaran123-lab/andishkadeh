"""
App icons for every target, drawn from one geometric motif (a wrestling mat seen from above:
blue contest area, red passivity band, white centre ring). No text, so no font shaping issues.

Usage: python3 tools/icons/generate.py [--android <android/app/src/main/res>]
"""
import argparse
import os
from PIL import Image, ImageDraw

ROOT = os.path.abspath(os.path.join(os.path.dirname(__file__), '..', '..'))
S = 1024  # master size


def lerp(a, b, t):
    return tuple(round(a[i] + (b[i] - a[i]) * t) for i in range(3))


def hexrgb(h):
    h = h.lstrip('#')
    return tuple(int(h[i:i + 2], 16) for i in (0, 2, 4))


def background(size, rounded):
    top, bottom = hexrgb('#112342'), hexrgb('#050b18')
    grad = Image.new('RGB', (1, size))
    for y in range(size):
        grad.putpixel((0, y), lerp(top, bottom, y / (size - 1)))
    grad = grad.resize((size, size))
    img = Image.new('RGBA', (size, size), (0, 0, 0, 0))
    mask = Image.new('L', (size, size), 0)
    d = ImageDraw.Draw(mask)
    if rounded:
        d.rounded_rectangle((0, 0, size - 1, size - 1), radius=round(size * 0.22), fill=255)
    else:
        d.rectangle((0, 0, size - 1, size - 1), fill=255)
    img.paste(grad, (0, 0), mask)
    return img


def mat(size, scale, inner='#1689ff'):
    """Transparent layer with the mat motif; `scale` = diameter of the red band relative to size."""
    layer = Image.new('RGBA', (size, size), (0, 0, 0, 0))
    d = ImageDraw.Draw(layer)
    c = size / 2
    r_out = size * scale / 2
    r_blue = r_out * 0.84
    ring_r, ring_w = r_out * 0.22, max(2, round(r_out * 0.045))

    def disk(r, fill):
        d.ellipse((c - r, c - r, c + r, c + r), fill=fill)

    # soft glow
    disk(r_out * 1.06, (255, 40, 76, 40))
    disk(r_out, hexrgb('#ff284c') + (255,))
    disk(r_blue, hexrgb(inner) + (255,))
    d.ellipse((c - ring_r, c - ring_r, c + ring_r, c + ring_r), outline=(255, 255, 255, 255), width=ring_w)
    # starting marks (red / blue corners of the centre circle)
    m = r_out * 0.09
    for dx, col in ((-ring_r * 1.9, '#ff284c'), (ring_r * 1.9, '#ffffff')):
        d.rectangle((c + dx - m / 2, c - m * 0.18, c + dx + m / 2, c + m * 0.18), fill=hexrgb(col) + (255,))
    return layer


def icon(size, rounded=True, scale=0.72, inner='#1689ff', transparent=False):
    base = Image.new('RGBA', (S, S), (0, 0, 0, 0)) if transparent else background(S, rounded)
    base.alpha_composite(mat(S, scale, inner))
    return base.resize((size, size), Image.LANCZOS)


def save(img, *parts):
    path = os.path.join(ROOT, *parts)
    os.makedirs(os.path.dirname(path), exist_ok=True)
    img.save(path)
    print('wrote', os.path.relpath(path, ROOT))


def main():
    ap = argparse.ArgumentParser()
    ap.add_argument('--android', help='res directory of the Android app module')
    args = ap.parse_args()

    # Web app (PWA)
    web = ('apps', 'kiosk', 'src', 'renderer', 'public-web', 'icons')
    save(icon(192), *web, 'icon-192.png')
    save(icon(512), *web, 'icon-512.png')
    save(icon(512, rounded=False, scale=0.56), *web, 'icon-maskable-512.png')

    # Windows installer / Electron window
    save(icon(512), 'apps', 'kiosk', 'build-resources', 'icon.png')
    ico = icon(256)
    path = os.path.join(ROOT, 'apps', 'kiosk', 'build-resources', 'icon.ico')
    ico.save(path, sizes=[(16, 16), (24, 24), (32, 32), (48, 48), (64, 64), (128, 128), (256, 256)])
    print('wrote', os.path.relpath(path, ROOT))

    # Admin panel (PWA): same motif, cyan contest area
    adm = ('apps', 'admin', 'public', 'icons')
    save(icon(192, inner='#00a8b5'), *adm, 'icon-192.png')
    save(icon(512, inner='#00a8b5'), *adm, 'icon-512.png')
    save(icon(512, rounded=False, scale=0.56, inner='#00a8b5'), *adm, 'icon-maskable-512.png')

    if args.android:
        res = os.path.abspath(args.android)
        legacy = {'mdpi': 48, 'hdpi': 72, 'xhdpi': 96, 'xxhdpi': 144, 'xxxhdpi': 192}
        fg = {'mdpi': 108, 'hdpi': 162, 'xhdpi': 216, 'xxhdpi': 324, 'xxxhdpi': 432}
        for dpi, px in legacy.items():
            d = os.path.join(res, f'mipmap-{dpi}')
            os.makedirs(d, exist_ok=True)
            icon(px).save(os.path.join(d, 'ic_launcher.png'))
            round_icon = icon(px, rounded=False)
            mask = Image.new('L', (px, px), 0)
            ImageDraw.Draw(mask).ellipse((0, 0, px - 1, px - 1), fill=255)
            out = Image.new('RGBA', (px, px), (0, 0, 0, 0))
            out.paste(round_icon, (0, 0), mask)
            out.save(os.path.join(d, 'ic_launcher_round.png'))
            # adaptive icon foreground: motif inside the 66dp safe zone of 108dp
            icon(fg[dpi], scale=0.5, transparent=True).save(os.path.join(d, 'ic_launcher_foreground.png'))
        # launch screen: every splash.png of the template, regenerated at its own size
        for dirpath, _dirs, files in os.walk(res):
            if 'splash.png' in files:
                path = os.path.join(dirpath, 'splash.png')
                w, h = Image.open(path).size
                splash = background(max(w, h), rounded=False).resize((w, h), Image.LANCZOS)
                m = round(min(w, h) * 0.42)
                motif = mat(S, 0.9).resize((m, m), Image.LANCZOS)
                splash.alpha_composite(motif, ((w - m) // 2, (h - m) // 2))
                splash.convert('RGB').save(path)
        print('wrote android mipmaps and splash screens in', os.path.relpath(res, ROOT))


if __name__ == '__main__':
    main()
