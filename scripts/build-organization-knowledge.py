"""Refresh the public, reviewable yumh.uz corpus bundled with the API.

Run manually before a release. Fail rather than silently publishing a partial index.
Only public HTML and linked PDFs from the organization's own domain are ingested.
"""

import asyncio
import json
import re
from datetime import UTC, datetime
from io import BytesIO
from pathlib import Path
from urllib.parse import urljoin, urlparse

import httpx
from bs4 import BeautifulSoup
from pypdf import PdfReader

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


async def fetch_pdf(client: httpx.AsyncClient, url: str, semaphore: asyncio.Semaphore) -> bytes:
    async with semaphore:
        response = await client.get(url)
        response.raise_for_status()
        if len(response.content) > 45_000_000:
            raise ValueError(f"Official PDF exceeds the index size limit: {url}")
        return response.content


def extract_pdf(url: str, content: bytes) -> list[dict[str, str]]:
    reader = PdfReader(BytesIO(content))
    title = "Публикация движения «Юксалиш»"
    if reader.metadata and reader.metadata.title:
        title = str(reader.metadata.title)
    records = []
    for number, page in enumerate(reader.pages, start=1):
        body = SPACE.sub(" ", page.extract_text() or "").strip()
        if len(body) < 80:
            continue
        records.append({
            "url": f"{url}#page={number}",
            "title": f"{title[:220]} — стр. {number}",
            "date": "",
            "text": body[:16000],
        })
    if records:
        cover = records[0]["text"][:140].strip(" ,.;:-")
        if len(cover) > 20:
            title = cover
        for record in records:
            page_number = record["url"].rsplit("=", 1)[-1]
            record["title"] = f"{title[:220]} — стр. {page_number}"
    return records


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
        books_soup = BeautifulSoup(sections[SECTIONS.index("/ru/books")], "html.parser")
        pdf_urls = sorted({
            urljoin(BASE, link["href"])
            for link in books_soup.select('a[href*=".pdf"]')
            if urlparse(urljoin(BASE, link["href"])).hostname == "yumh.uz"
        })
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
        pdfs = await asyncio.gather(
            *(fetch_pdf(client, url, semaphore) for url in pdf_urls), return_exceptions=True
        )
    failures = [
        path for path, page in zip(articles, pages, strict=True) if isinstance(page, Exception)
    ]
    if failures:
        raise RuntimeError(
            f"Official site returned {len(failures)} failed pages; first: {failures[0]}"
        )
    failed_pdfs = [
        url for url, pdf in zip(pdf_urls, pdfs, strict=True) if isinstance(pdf, Exception)
    ]
    if failed_pdfs:
        raise RuntimeError(
            f"Official site returned {len(failed_pdfs)} failed PDFs; first: {failed_pdfs[0]}"
        )
    records = [extract(path, html) for path, html in zip(SECTIONS, sections, strict=True)]
    records.extend(
        extract(path, page)
        for path, page in zip(articles, pages, strict=True)
        if isinstance(page, str)
    )
    documents = [item for item in records if item is not None]
    for url, pdf in zip(pdf_urls, pdfs, strict=True):
        if isinstance(pdf, bytes):
            documents.extend(extract_pdf(url, pdf))
    payload = {"source": BASE, "updatedAt": datetime.now(UTC).isoformat(), "documents": documents}
    OUTPUT.write_text(
        json.dumps(payload, ensure_ascii=False, separators=(",", ":")), encoding="utf-8"
    )
    print(f"Indexed {len(documents)} official pages into {OUTPUT}")


if __name__ == "__main__":
    asyncio.run(main())
