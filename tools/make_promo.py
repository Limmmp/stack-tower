"""
Генератор промо-материалов для карточки Яндекс Игр.

Требования платформы:
  - обложка строго 800x470 PNG
  - иконка без рамок и скруглённых углов (платформа скругляет сама)
  - скриншоты 16:9
  - иконку/обложку НЕЛЬЗЯ делать скриншотом из игры — нужна отдельная композиция

Промо генерируется кодом, а не рисуется руками, потому что иконку придётся
перебирать по CTR: поменял пару констант — получил новый вариант.

    python tools/make_promo.py
"""

import colorsys
import math
import os

from PIL import Image, ImageDraw, ImageFont

OUT = os.path.join(os.path.dirname(__file__), "..", "promo")

# Палитра совпадает с игрой, чтобы карточка не обманывала ожидания:
# расхождение промо и реального вида — повод для отказа на модерации.
SKY_TOP = (18, 22, 39)
SKY_BOTTOM = (42, 30, 61)


def hsl(h, s, l):
    r, g, b = colorsys.hls_to_rgb((h % 360) / 360, l / 100, s / 100)
    return int(r * 255), int(g * 255), int(b * 255)


def sky(size, warm=0.0):
    """Вертикальный градиент неба. warm сдвигает его к рассвету, как в игре."""
    w, h = size
    img = Image.new("RGB", size)
    d = ImageDraw.Draw(img)
    top = hsl(228 - warm * 30, 38 - warm * 12, 11 + warm * 20)
    bot = hsl(272 - warm * 40, 33 - warm * 8, 18 + warm * 22)
    for y in range(h):
        t = y / max(1, h - 1)
        d.line(
            [(0, y), (w, y)],
            fill=tuple(int(top[i] + (bot[i] - top[i]) * t) for i in range(3)),
        )
    return img


def stars(d, size, count, seed=7):
    w, h = size
    for i in range(count):
        x = (i * 977 + seed * 31) % w
        y = (i * 613 + seed * 17) % h
        r = 0.8 + ((i * 7) % 10) / 7
        a = 90 + ((i * 13) % 10) * 12
        d.ellipse([x - r, y - r, x + r, y + r], fill=(255, 255, 255, a))


def slab(d, x, y, w, hgt, hue):
    """Блок с верхней подсветкой и тёмным низом — тот же псевдо-объём, что в игре."""
    edge = max(3, hgt // 6)
    d.rectangle([x, y, x + w, y + hgt], fill=hsl(hue, 62, 54))
    d.rectangle([x, y, x + w, y + edge], fill=hsl(hue, 70, 70))
    d.rectangle([x, y + hgt - edge, x + w, y + hgt], fill=hsl(hue, 55, 40))


def font(px, bold=True):
    for name in ("segoeuib.ttf", "arialbd.ttf", "segoeui.ttf", "arial.ttf"):
        try:
            return ImageFont.truetype(name, px)
        except OSError:
            continue
    return ImageFont.load_default()


def tower(d, cx, base_y, widths, block_h, gap, hue0=200, hue_step=14):
    """Рисует башню снизу вверх со смещениями, чтобы читалась механика укладки."""
    y = base_y
    for i, w in enumerate(widths):
        # Небольшой зигзаг: ровная башня выглядит как столбик и не сообщает суть игры.
        off = math.sin(i * 1.1) * (w * 0.10)
        slab(d, cx - w / 2 + off, y - block_h, w, block_h, hue0 + i * hue_step)
        y -= block_h + gap


def make_icon(path, size=512):
    img = sky((size, size), warm=0.15).convert("RGBA")
    d = ImageDraw.Draw(img, "RGBA")
    stars(d, (size, size), 26)

    # Крупные формы и всего 5 блоков: иконка в каталоге видна размером с ноготь,
    # мелкая детализация там превращается в кашу.
    widths = [round(size * w) for w in (0.62, 0.56, 0.50, 0.43, 0.35)]
    tower(d, size / 2, size * 0.90, widths, round(size * 0.115), round(size * 0.022))

    # Падающий кусок — намёк на главную механику, отличает от других башен в каталоге.
    slab(d, size * 0.74, size * 0.30, size * 0.16, size * 0.075, 96)

    img.convert("RGB").save(path)
    return path


def make_cover(path, size=(800, 470)):
    w, h = size
    img = sky(size, warm=0.2).convert("RGBA")
    d = ImageDraw.Draw(img, "RGBA")
    stars(d, size, 40)

    widths = [round(w * x) for x in (0.30, 0.27, 0.24, 0.205, 0.17, 0.13)]
    tower(d, w * 0.27, h * 0.99, widths, 44, 8)
    # Падающий блок держим над башней и левее текста: на прошлой версии
    # он налезал на первую букву заголовка.
    slab(d, w * 0.20, h * 0.13, 70, 30, 96)

    title = font(84)
    sub = font(30, bold=False)
    d.text((w * 0.52, h * 0.34), "БАШНЯ", font=title, fill=(255, 255, 255), anchor="lm")
    d.text((w * 0.52, h * 0.52), "Ставь блоки точно", font=sub, fill=(228, 224, 245), anchor="lm")
    d.text((w * 0.52, h * 0.62), "и расти до небес", font=sub, fill=(228, 224, 245), anchor="lm")

    img.convert("RGB").save(path)
    return path


if __name__ == "__main__":
    os.makedirs(OUT, exist_ok=True)
    print(make_icon(os.path.join(OUT, "icon-512.png")))
    print(make_cover(os.path.join(OUT, "cover-800x470.png")))
