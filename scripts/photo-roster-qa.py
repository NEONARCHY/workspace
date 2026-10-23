"""Generate only synthetic export fixtures for local visual review; no database or network."""

import argparse
from datetime import datetime
from io import BytesIO
from pathlib import Path
from uuid import UUID
from zoneinfo import ZoneInfo

from PIL import Image, ImageDraw

from yuksalish_api.dossier_documents import portrait_jpeg
from yuksalish_api.dossier_schemas import PhotoCard
from yuksalish_api.photo_roster_documents import render_excel, render_word


def main() -> None:
    parser = argparse.ArgumentParser()
    parser.add_argument("--output", type=Path, default=Path("tmp/photo-roster-qa"))
    args = parser.parse_args()
    args.output.mkdir(parents=True, exist_ok=True)
    image = Image.new("RGB", (300, 400), "#edf5f6")
    drawing = ImageDraw.Draw(image)
    drawing.ellipse((90, 70, 210, 190), fill="#7a929f")
    drawing.rounded_rectangle((45, 210, 255, 400), radius=70, fill="#293a55")
    output = BytesIO()
    image.save(output, "PNG")
    photo = portrait_jpeg(output.getvalue())
    names = ["Тестовый Сотрудник Полное ФИО", "Синов ходими Қаҳрамон Ўғли",
             "Сотрудник без фотографии и объективки", "Сотрудник \u0441 длинным образованием",
             "Последний сотрудник для проверки переноса"]
    cards = [PhotoCard(
        user_id=UUID(int=index + 1), full_name=name,
        job_title=None if index == 2 else (
            "Сунъий интеллект ва рақамлаштириш бўлими бош мутахассиси"
        ),
        department_id=None, birth_year=None if index == 2 else 1990 + index,
        universities=[] if index == 2 else
        ["Тестовый университет международных отношений",
         "Академия государственного управления"] if index != 3 else
        [f"{n}. Тестовый университет государственного управления и международного сотрудничества"
         for n in range(1, 13)],
    ) for index, name in enumerate(names)]
    photos = [photo, photo, None, None, photo]
    now = datetime.now(ZoneInfo("Asia/Tashkent"))
    for extension, renderer in (("docx", render_word), ("xlsx", render_excel)):
        (args.output / f"photo-roster.{extension}").write_bytes(renderer(cards, photos, now))
    print(f"Generated {len(cards)} synthetic employee records in {args.output}")


if __name__ == "__main__":
    main()
