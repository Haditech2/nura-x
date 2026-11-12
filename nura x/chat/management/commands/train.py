"""`python manage.py train` — crawls frashidah.com and rebuilds Nura X's knowledge base."""

import json
import re
from collections import deque
from datetime import datetime, timezone
from urllib.parse import urljoin, urlparse

import requests
from bs4 import BeautifulSoup
from django.conf import settings
from django.core.management.base import BaseCommand

UA = "Mozilla/5.0 (compatible; NuraXTrainer/1.0)"
SKIP_EXT = re.compile(r"\.(png|jpe?g|gif|svg|webp|pdf|css|js|ico|woff2?|mp4|mp3|zip)$", re.I)
BLOCKS = ["h1", "h2", "h3", "h4", "p", "li", "blockquote", "td", "figcaption"]


class Command(BaseCommand):
    help = "Crawl frashidah.com and rebuild Nura X's knowledge base."

    def add_arguments(self, parser):
        parser.add_argument("--max-pages", type=int, default=200)

    def handle(self, *args, max_pages, **opts):
        site = settings.NURA_SITE.rstrip("/")
        session = requests.Session()
        session.headers["User-Agent"] = UA

        def to_site_url(href, base=site):
            try:
                u = urlparse(urljoin(base, href))
            except ValueError:
                return None
            host = (u.hostname or "").removeprefix("www.")
            # The site's sitemap uses a placeholder host (example.com), so accept both.
            if host not in ("frashidah.com", "example.com") or SKIP_EXT.search(u.path):
                return None
            path = re.sub(r"/+", "/", "/" + u.path.strip("/") + "/")
            return site + path

        queue = deque([site + "/"])
        try:
            xml = session.get(f"{site}/sitemap.xml", timeout=30).text
            queue.extend(filter(None, (to_site_url(loc) for loc in re.findall(r"<loc>([^<]+)</loc>", xml))))
        except requests.RequestException as e:
            self.stderr.write(f"No sitemap: {e}")

        visited, pages = set(), []
        while queue and len(visited) < max_pages:
            url = queue.popleft()
            if url in visited:
                continue
            visited.add(url)
            try:
                r = session.get(url, timeout=30)
                r.raise_for_status()
            except requests.RequestException as e:
                self.stderr.write(f"FAIL {url}: {e}")
                continue

            title, body, links = self.extract(r.text, url, to_site_url)
            if len(body) > 80:
                pages.append({"url": url, "title": title, "body": body})
                self.stdout.write(f"OK   {url}  ({len(body)} chars)")
            queue.extend(l for l in links if l not in visited)

        pages.sort(key=lambda p: p["url"])
        out = settings.NURA_KNOWLEDGE_FILE
        out.parent.mkdir(parents=True, exist_ok=True)
        out.with_suffix(".json").write_text(
            json.dumps({"source": site, "crawledAt": datetime.now(timezone.utc).isoformat(), "pages": pages}, indent=2, ensure_ascii=False),
            encoding="utf-8",
        )
        md = "\n\n".join(f'<page url="{p["url"]}" title="{p["title"]}">\n{p["body"]}\n</page>' for p in pages)
        out.write_text(md, encoding="utf-8")
        self.stdout.write(self.style.SUCCESS(f"\nDone: {len(pages)} pages, {len(md):,} chars -> {out}"))

    @staticmethod
    def extract(html, url, to_site_url):
        soup = BeautifulSoup(html, "html.parser")
        h1 = soup.find("h1")
        title = (h1.get_text(" ", strip=True) if h1 else "") or (soup.title.get_text(strip=True) if soup.title else "")
        links = [l for l in (to_site_url(a["href"], url) for a in soup.find_all("a", href=True)) if l]

        for tag in soup(["script", "style", "noscript", "svg", "iframe", "nav", "header", "footer", "form", "button"]):
            tag.decompose()
        root = soup.find("main") or soup.body or soup

        lines, seen = [], set()
        for el in root.find_all(BLOCKS):
            if el.name in ("li", "td") and el.find(["p", "li"]):
                continue  # text is captured by the nested block element
            text = re.sub(r"\s+", " ", el.get_text(" ", strip=True))
            if not text:
                continue
            if el.name.startswith("h"):
                line = f"\n{'#' * (int(el.name[1]) + 1)} {text}"
            elif el.name == "li":
                line = f"- {text}"
            else:
                line = text
            if line not in seen:
                seen.add(line)
                lines.append(line)
        return title, "\n".join(lines).strip(), links
