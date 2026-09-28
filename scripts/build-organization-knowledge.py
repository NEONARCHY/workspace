"""Refresh the public, reviewable yumh.uz corpus bundled with the API.

Run manually before a release. Fail rather than silently publishing a partial index.
Only public HTML from the organization's own domain is ingested.
"""

import asyncio
import json
import re
from datetime import UTC, datetime
from pathlib import Path
from urllib.parse import urljoin

import httpx
from bs4 import BeautifulSoup

BASE = "https://yumh.uz"
SECTIONS = (
    "/ru/about",
    "/?lang=ru",
    "/ru/jamoatchilik",
    "/ru/report",
    "/ru/project",
    "/ru/partners",
    "/ru/activity",
    "/ru/team",
    "/ru/hududiy",
    "/ru/books",
    "/ru/csonewsletter",
    "/ru/membership",
    "/ru/projects",
    "/ru/news",
)
OUTPUT = (
    Path(__file__).resolve().parents[1] / "apps/api/src/yuksalish_api/organization_knowledge.json"
)
SPACE = re.compile(r"\s+")


async def fetch(client: httpx.AsyncClient, path: str, semaphore: asyncio.Semaphore) -> str:
    async with semaphore:
        response = await client.get(urljoin(BASE, path))
        response.raise_for_status()
        return response.text


def extract(path: str, html: str) -> dict[str, str] | None:
    soup = BeautifulSoup(html, "html.parser")
    article = soup.select_one(".newsall") if "/news_detail/" in path else None
    date_match = (
        re.search(r"20\d{2}-\d{2}-\d{2}", article.get_text(" ", strip=True)) if article else None
    )
    content = article or soup.select_one("main") or soup.select_one(".content") or soup.body
    if content is None:
        return None
    for unwanted in content.select("script,style,nav,footer,header,form,.topsmmg,.mobinf2"):
        unwanted.decompose()
    title_element = article.select_one("h2") if article else content.select_one("h1,h2")
    title = SPACE.sub(" ", title_element.get_text(" ", strip=True)) if title_element else path
    if article and title_element:
        title_element.decompose()
    blocks = [
        SPACE.sub(" ", part.get_text(" ", strip=True)) for part in content.select("p,li,h2,h3")
    ]
    text = "\n".join(block for block in blocks if len(block) > 25)
    if not text:
        text = SPACE.sub(" ", content.get_text(" ", strip=True))
    if len(text) < 80:
        return None
    return {
        "url": urljoin(BASE, path),
        "title": title[:250],
        "date": date_match.group() if date_match else "",
        "text": text[:16000],
    }


async def main() -> None:
    limits = httpx.Limits(max_connections=12)
    async with httpx.AsyncClient(
        timeout=25,
        follow_redirects=True,
        limits=limits,
        headers={"User-Agent": "YuksalishWorkspaceKnowledge/1.0"},
    ) as client:
        semaphore = asyncio.Semaphore(10)
        sections = await asyncio.gather(*(fetch(client, path, semaphore) for path in SECTIONS))
        news_soup = BeautifulSoup(sections[-1], "html.parser")
        articles = sorted(
            {
                link.get("href")
                for link in news_soup.select('a[href^="/ru/news_detail/"]')
                if link.get("href") and re.fullmatch(r"/ru/news_detail/\d+", link["href"])
            }
        )
        if len(articles) < 100:
            raise RuntimeError(
                f"The official news archive appears incomplete: {len(articles)} links"
            )
        pages = await asyncio.gather(
            *(fetch(client, path, semaphore) for path in articles), return_exceptions=True
        )
    failures = [
        path for path, page in zip(articles, pages, strict=True) if isinstance(page, Exception)
    ]
    if failures:
        raise RuntimeError(
            f"Official site returned {len(failures)} failed pages; first: {failures[0]}"
        )
    records = [extract(path, html) for path, html in zip(SECTIONS, sections, strict=True)]
    records.extend(
        extract(path, page)
        for path, page in zip(articles, pages, strict=True)
        if isinstance(page, str)
    )
    documents = [item for item in records if item is not None]
    payload = {"source": BASE, "updatedAt": datetime.now(UTC).isoformat(), "documents": documents}
    OUTPUT.write_text(
        json.dumps(payload, ensure_ascii=False, separators=(",", ":")), encoding="utf-8"
    )
    print(f"Indexed {len(documents)} official pages into {OUTPUT}")


if __name__ == "__main__":
    asyncio.run(main())
