"""
Собирает десктопные скриншоты 1920x1080 из портретных кадров.

Игра портретная, поэтому на широком экране браузер показывает игровое поле
полосой по центру на фоне страницы. Скрипт воспроизводит ровно эту раскладку:
фон #0b0e18 из CSS, канвас вписан по высоте с сохранением пропорций,
углы скруглены на 14px (масштабированные).

ВАЖНО: это реконструкция раскладки, а не снятый экран. Перед загрузкой
сверьте с реальным видом игры на десктопе — если расходится, снимайте руками.

    python tools/make_desktop_shots.py
"""

import glob
import os

from PIL import Image, ImageDraw

SRC = os.path.join(os.path.dirname(__file__), "..", "promo", "screenshots")
DST = os.path.join(os.path.dirname(__file__), "..", "promo", "screenshots-desktop")

TARGET = (1920, 1080)
PAGE_BG = (11, 14, 24)  # #0b0e18 — фон body
RADIUS_AT_H700 = 14  # border-radius канваса в его собственных координатах
GAME_H = 700  # виртуальная высота игры


def rounded(img, radius):
    mask = Image.new("L", img.size, 0)
    ImageDraw.Draw(mask).rounded_rectangle([0, 0, img.size[0] - 1, img.size[1] - 1],
                                           radius=radius, fill=255)
    out = img.convert("RGBA")
    out.putalpha(mask)
    return out


def build(path, out_path):
    shot = Image.open(path).convert("RGB")
    w, h = shot.size

    # Канвас вписывается по высоте экрана — как это делает fit() в игре.
    scale = TARGET[1] / h
    new = (round(w * scale), TARGET[1])
    shot = shot.resize(new, Image.LANCZOS)
    shot = rounded(shot, round(RADIUS_AT_H700 * (TARGET[1] / GAME_H)))

    canvas = Image.new("RGB", TARGET, PAGE_BG)
    canvas.paste(shot, ((TARGET[0] - new[0]) // 2, 0), shot)
    canvas.save(out_path)
    return new


if __name__ == "__main__":
    os.makedirs(DST, exist_ok=True)
    files = sorted(glob.glob(os.path.join(SRC, "*.png")))
    if not files:
        print("нет исходных кадров в", os.path.abspath(SRC))
    for f in files:
        # Суффикс -desktop обязателен: без него мобильный и десктопный кадр
        # называются одинаково, и в диалоге загрузки консоли их не различить —
        # мобильный уезжает в поле десктопных и отлетает по соотношению сторон.
        name = os.path.splitext(os.path.basename(f))[0] + "-desktop.png"
        inner = build(f, os.path.join(DST, name))
        print(f"{name}: игровое поле {inner[0]}x{inner[1]} на холсте {TARGET[0]}x{TARGET[1]}")
