"""
App icons for every target, from one artwork: assets/brand/app-icon.png (two wrestlers face to face in
red and blue neon inside a rounded square, on dark navy). Where the platform shows the icon as it is
(Windows, the browser tab, an installed web app, iOS), the rounded square itself is used, its corners
made transparent where they can be. Android's adaptive and round icons and the maskable web icon,
which the system cuts to its own shape, get the wrestlers alone on the dark background.

Usage: python3 tools/icons/generate.py [--android <android/app/src/main/res>]
"""
import argparse
import os
from PIL import Image, ImageDraw, ImageFilter

ROOT = os.path.abspath(os.path.join(os.path.dirname(__file__), '..', '..'))
SRC = Image.open(os.path.join(ROOT, 'assets', 'brand', 'app-icon.png')).convert('RGB')

# Measured on the artwork: the neon frame (its line) and its corner radius, the wrestlers with their
# floor ring (centre and half-diagonal), and the colour of the background around them.
FRAME = (73, 73, 1177, 1148)
FRAME_R = 218
SCENE_C, SCENE_HALF_DIAG = (627, 665), 602
BG = (3, 13, 36)


def frame_box(margin=14):
    """Square crop around the frame, a little of its glow included."""
    cx, cy = (FRAME[0] + FRAME[2]) / 2, (FRAME[1] + FRAME[3]) / 2
    half = (FRAME[2] - FRAME[0]) / 2 + margin
    return round(cx - half), round(cy - half), round(cx + half), round(cy + half)


def rounded_mask(size, radius, aa=4):
    big = Image.new('L', (size * aa, size * aa), 0)
    ImageDraw.Draw(big).rounded_rectangle((0, 0, size * aa - 1, size * aa - 1), radius=radius * aa, fill=255)
    return big.resize((size, size), Image.LANCZOS)


def rounded(size):
    """The rounded square with transparent corners."""
    box = frame_box()
    crop = SRC.crop(box).convert('RGBA')
    crop.putalpha(rounded_mask(crop.width, FRAME_R + 14))
    return crop.resize((size, size), Image.LANCZOS)


def square(size):
    """The same crop, opaque (iOS rounds the corners itself and shows transparency as black)."""
    return SRC.crop(frame_box()).resize((size, size), Image.LANCZOS)


def scene(size, fit):
    """The wrestlers without the frame on the dark background; `fit`: their half-diagonal / half the size."""
    s = fit * (size / 2) / SCENE_HALF_DIAG  # output px per artwork px
    canvas = Image.new('RGB', (round(size / s), round(size / s)), BG)
    inner = (FRAME[0] + 20, FRAME[1] + 20, FRAME[2] - 20, FRAME[3] - 20)
    region = SRC.crop(inner)
    mask = Image.new('L', region.size, 0)
    ImageDraw.Draw(mask).rounded_rectangle((90, 90, region.width - 91, region.height - 91), radius=FRAME_R - 90, fill=255)
    mask = mask.filter(ImageFilter.GaussianBlur(60))  # fades into the background well before the frame
    off = (round(canvas.width / 2 - (SCENE_C[0] - inner[0])), round(canvas.height / 2 - (SCENE_C[1] - inner[1])))
    canvas.paste(region, off, mask)
    return canvas.resize((size, size), Image.LANCZOS)


def save(img, *parts):
    path = os.path.join(ROOT, *parts)
    os.makedirs(os.path.dirname(path), exist_ok=True)
    img.save(path)
    print('wrote', os.path.relpath(path, ROOT))


def web_icons(*folder):
    save(rounded(32), *folder, 'favicon-32.png')
    save(rounded(192), *folder, 'icon-192.png')
    save(rounded(512), *folder, 'icon-512.png')
    save(scene(512, 0.8), *folder, 'icon-maskable-512.png')  # inside the 80 % safe circle
    save(square(180), *folder, 'apple-touch-icon.png')


def main():
    ap = argparse.ArgumentParser()
    ap.add_argument('--android', help='res directory of the Android app module')
    args = ap.parse_args()

    # Web app (PWA, served at /) and admin panel (/admin): the same icon
    web_icons('apps', 'kiosk', 'src', 'renderer', 'public-web', 'icons')
    ico = os.path.join(ROOT, 'apps', 'kiosk', 'src', 'renderer', 'public-web', 'favicon.ico')
    rounded(256).save(ico, sizes=[(16, 16), (32, 32), (48, 48)])
    print('wrote', os.path.relpath(ico, ROOT))
    web_icons('apps', 'admin', 'public', 'icons')

    # Windows installer, program and taskbar
    save(rounded(512), 'apps', 'kiosk', 'build-resources', 'icon.png')
    path = os.path.join(ROOT, 'apps', 'kiosk', 'build-resources', 'icon.ico')
    rounded(256).save(path, sizes=[(16, 16), (24, 24), (32, 32), (48, 48), (64, 64), (128, 128), (256, 256)])
    print('wrote', os.path.relpath(path, ROOT))

    if args.android:
        res = os.path.abspath(args.android)
        legacy = {'mdpi': 48, 'hdpi': 72, 'xhdpi': 96, 'xxhdpi': 144, 'xxxhdpi': 192}
        fg = {'mdpi': 108, 'hdpi': 162, 'xhdpi': 216, 'xxhdpi': 324, 'xxxhdpi': 432}
        for dpi, px in legacy.items():
            d = os.path.join(res, f'mipmap-{dpi}')
            os.makedirs(d, exist_ok=True)
            rounded(px).save(os.path.join(d, 'ic_launcher.png'))
            circle = Image.new('L', (px * 4, px * 4), 0)
            ImageDraw.Draw(circle).ellipse((0, 0, px * 4 - 1, px * 4 - 1), fill=255)
            out = scene(px, 0.9).convert('RGBA')
            out.putalpha(circle.resize((px, px), Image.LANCZOS))
            out.save(os.path.join(d, 'ic_launcher_round.png'))
            # adaptive icon foreground (opaque, the launcher cuts it to its shape): the wrestlers inside
            # the 66dp safe circle of the 108dp layer
            scene(fg[dpi], 0.61).save(os.path.join(d, 'ic_launcher_foreground.png'))
        with open(os.path.join(res, 'values', 'ic_launcher_background.xml'), 'w') as f:
            f.write('<?xml version="1.0" encoding="utf-8"?>\n<resources>\n    <color name="ic_launcher_background">#%02X%02X%02X</color>\n</resources>' % BG)
        # launch screen: every splash.png of the template, regenerated at its own size
        for dirpath, _dirs, files in os.walk(res):
            if 'splash.png' in files:
                path = os.path.join(dirpath, 'splash.png')
                w, h = Image.open(path).size
                splash = Image.new('RGBA', (w, h), BG + (255,))
                m = round(min(w, h) * 0.5)
                splash.alpha_composite(rounded(m), ((w - m) // 2, (h - m) // 2))
                splash.convert('RGB').save(path)
        print('wrote android mipmaps and splash screens in', os.path.relpath(res, ROOT))


if __name__ == '__main__':
    main()
