"""
Сборка архива для загрузки в Яндекс Игры.

Требования, которые здесь проверяются:
  - index.html строго в корне архива (не во вложенной папке)
  - никаких пробелов и кириллицы в именах файлов
  - распакованный размер до 100 МБ
  - в архив попадает только игра: tools/, promo/ и README остаются снаружи

    python tools/build.py
"""

import os
import re
import sys
import zipfile

ROOT = os.path.abspath(os.path.join(os.path.dirname(__file__), ".."))
DIST = os.path.join(ROOT, "dist")
ARCHIVE = os.path.join(DIST, "stack-tower.zip")

# Явный список, а не «всё подряд минус исключения»: при добавлении файлов
# лучше получить осознанное решение, чем случайно залить в продакшен черновик.
GAME_FILES = ["index.html", "game.js", "ysdk.js", "debug.js"]

LIMIT_BYTES = 100 * 1024 * 1024
SAFE_NAME = re.compile(r"^[A-Za-z0-9._-]+$")


def main():
    problems = []
    total = 0

    for rel in GAME_FILES:
        path = os.path.join(ROOT, rel)
        if not os.path.exists(path):
            problems.append(f"нет файла: {rel}")
            continue
        if not SAFE_NAME.match(os.path.basename(rel)):
            problems.append(f"недопустимое имя (пробелы/кириллица): {rel}")
        total += os.path.getsize(path)

    if "index.html" not in GAME_FILES:
        problems.append("index.html обязан быть в корне архива")

    if total > LIMIT_BYTES:
        problems.append(f"размер {total/1048576:.1f} МБ превышает лимит 100 МБ")

    if problems:
        print("Сборка остановлена:")
        for p in problems:
            print("  -", p)
        return 1

    os.makedirs(DIST, exist_ok=True)
    with zipfile.ZipFile(ARCHIVE, "w", zipfile.ZIP_DEFLATED) as z:
        for rel in GAME_FILES:
            z.write(os.path.join(ROOT, rel), arcname=rel)

    print(f"{ARCHIVE}")
    print(f"  файлов: {len(GAME_FILES)}, распаковано: {total/1024:.1f} КБ, "
          f"архив: {os.path.getsize(ARCHIVE)/1024:.1f} КБ")
    return 0


if __name__ == "__main__":
    sys.exit(main())
