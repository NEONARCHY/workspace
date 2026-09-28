# ruff: noqa: RUF001 - Russian source labels and stopwords are intentional.
"""Bounded retrieval over reviewed public pages from the official organization site."""

import json
import re
from functools import lru_cache
from importlib.resources import files

TOKEN = re.compile(r"\w{3,}", re.IGNORECASE)
YEARS = re.compile(r"20(?:1\d|2\d)")


@lru_cache(maxsize=1)
def documents() -> list[dict[str, str]]:
    resource = files("yuksalish_api").joinpath("organization_knowledge.json")
    if not resource.is_file():
        return []
    payload = json.loads(resource.read_text(encoding="utf-8"))
    return [
        {key: str(item[key]) for key in ("url", "title", "date", "text")}
        for item in payload["documents"]
        if isinstance(item, dict)
    ]


def relevant_knowledge(question: str, *, limit: int = 10) -> str:
    """Retrieve source-attributed excerpts, never the whole unbounded corpus."""
    terms = {
        term[:5]
        for term in TOKEN.findall(question.casefold())
        if term not in {"какие", "какой", "когда", "своих", "можешь", "расскажи", "юксалиш"}
    }
    mentioned_years = [int(year) for year in YEARS.findall(question)]
    years = {
        str(year)
        for year in (
            range(min(mentioned_years), max(mentioned_years) + 1)
            if len(mentioned_years) >= 2
            else mentioned_years
        )
    }
    if not terms and not years:
        terms = {"движен", "организ", "мисси"}
    ranked: list[tuple[float, dict[str, str], str]] = []
    for document in documents():
        date = document["date"]
        if years and date and date[:4] not in years:
            continue
        title = document["title"].casefold()
        paragraphs = document["text"].split("\n")
        best = ""
        best_score = 0.0
        for index in range(len(paragraphs)):
            excerpt = " ".join(paragraphs[max(0, index - 1) : index + 2])[:1400]
            lowered = excerpt.casefold()
            score = sum(
                (4 if term in title else 0) + (2 if term in lowered else 0) for term in terms
            )
            if score > best_score:
                best, best_score = excerpt, float(score)
        if best_score:
            if date and date[:4] in years:
                best_score += 2
            if "/ru/about" in document["url"]:
                best_score += 1
            ranked.append((best_score, document, best))
    ranked.sort(key=lambda row: (-row[0], row[1]["url"]))
    if not ranked:
        return "По этому вопросу в сохранённом архиве официального сайта совпадений нет."
    selected: list[tuple[float, dict[str, str], str]] = []
    if len(years) > 1:
        for year in sorted(years):
            selected.extend([row for row in ranked if row[1]["date"].startswith(year)][:2])
    selected_urls = {row[1]["url"] for row in selected}
    selected.extend(row for row in ranked if row[1]["url"] not in selected_urls)
    return "\n\n".join(
        f"[{index}] {item['title']} ({item['date'] or 'без даты'})\n"
        f"Источник: {item['url']}\nФрагмент: {excerpt}"
        for index, (_, item, excerpt) in enumerate(selected[:limit], start=1)
    )
