"""
Приводит скриншоты к единому формату 720x1280 (9:16) для карточки Яндекс Игр.

Снятые вручную кадры получаются разного размера (541x937, 538x941, ...) —
в карточке такой разнобой выглядит неаккуратно. Скрипт обрезает по центру
до соотношения 9:16 и масштабирует к общему размеру.

Кроп, а не растяжение: растяжение исказило бы пропорции блоков.

    python tools/normalize_screenshots.py
"""

import glob
import os

from PIL import Image

SRC = os.path.join(os.path.dirname(__file__), "..", "promo", "screenshots")
TARGET = (720, 1280)
RATIO = TARGET[0] / TARGET[1]


def normalize(path):
    img = Image.open(path).convert("RGB")
    w, h = img.size

    if w / h > RATIO:
        # слишком широкий — срезаем по бокам
        new_w = round(h * RATIO)
        left = (w - new_w) // 2
        img = img.crop((left, 0, left + new_w, h))
    else:
        # слишком высокий — срезаем сверху и снизу
        new_h = round(w / RATIO)
        top = (h - new_h) // 2
        img = img.crop((0, top, w, top + new_h))

    img = img.resize(TARGET, Image.LANCZOS)
    img.save(path)
    return img.size


if __name__ == "__main__":
    files = sorted(glob.glob(os.path.join(SRC, "*.png")))
    if not files:
        print("нет файлов в", os.path.abspath(SRC))
    for f in files:
        before = Image.open(f).size
        after = normalize(f)
        print(f"{os.path.basename(f)}: {before[0]}x{before[1]} -> {after[0]}x{after[1]}")
