import os
from contextlib import closing
from html.parser import HTMLParser
from urllib.parse import urljoin, urlsplit
from urllib.robotparser import RobotFileParser
from . import config


class Paragraphs(HTMLParser):
    def __init__(self):
        super().__init__(convert_charrefs=True)
        self.stack = []
        self.paragraph = None
        self.all = []
        self.article = []
        self.main = []

    def handle_starttag(self, tag, attrs):
        if tag in ("br", "img", "hr", "input", "meta", "link", "source", "wbr"):
            if tag == "br" and self.paragraph is not None:
                self.paragraph.append(" ")
            return
        if tag == "p" and self.paragraph is not None:
            self.handle_endtag("p")
        self.stack.append(tag)
        if tag == "p" and not any(t in self.stack for t in ("script", "style", "nav", "header", "footer", "aside", "form", "figure")):
            self.paragraph = []

    def _finish_paragraph(self):
        if self.paragraph is not None:
            text = " ".join("".join(self.paragraph).split())
            if text:
                self.all.append(text)
                if "article" in self.stack: self.article.append(text)
                if "main" in self.stack: self.main.append(text)
            self.paragraph = None

    def handle_endtag(self, tag):
        if tag == "p" or (tag in self.stack and "p" in self.stack and self.stack.index(tag) < self.stack.index("p")):
            self._finish_paragraph()
        if tag in self.stack:
            self.stack = self.stack[:len(self.stack) - 1 - self.stack[::-1].index(tag)]

    def close(self):
        super().close()
        self._finish_paragraph()

    def handle_data(self, data):
        if self.paragraph is not None and not any(t in self.stack for t in ("script", "style", "nav", "header", "footer", "aside", "form", "figure")):
            self.paragraph.append(data)


def _request(client, url):
    request = client.build_request("GET", url, timeout=15, headers={"User-Agent": config.UA})
    request.headers.pop("cookie", None)
    return client.send(request, stream=True, follow_redirects=False)


def _robots(client, origin):
    url = f"{origin}/robots.txt"
    for _ in range(6):
        with closing(_request(client, url)) as response:
            if response.is_redirect and response.headers.get("location"):
                url = urljoin(url, response.headers["location"])
                if urlsplit(url).scheme not in ("http", "https"):
                    return False
                continue
            if 400 <= response.status_code < 500:
                return True
            if response.status_code != 200:
                return False
            parser = RobotFileParser()
            parser.parse(response.read().decode(response.encoding or "utf-8", errors="replace").splitlines())
            return parser
    return False


def fetch_article_text(url, client, robots_cache):
    if os.environ.get("BRIEF_FETCH_ARTICLES") == "0":
        return None
    try:
        for _ in range(6):
            parts = urlsplit(url)
            if parts.scheme not in ("http", "https") or not parts.netloc:
                return None
            origin = f"{parts.scheme}://{parts.netloc}"
            if origin not in robots_cache:
                robots_cache[origin] = _robots(client, origin)
            robots = robots_cache[origin]
            if robots is False or (robots is not True and not robots.can_fetch(config.UA, url)):
                return None
            with closing(_request(client, url)) as response:
                if response.is_redirect and response.headers.get("location"):
                    url = urljoin(url, response.headers["location"])
                    continue
                if response.status_code != 200 or "html" not in response.headers.get("content-type", "").lower():
                    return None
                chunks, size = [], 0
                for chunk in response.iter_bytes():
                    size += len(chunk)
                    if size > 3 * 1024 * 1024:
                        return None
                    chunks.append(chunk)
                text = b"".join(chunks).decode(response.encoding or "utf-8", errors="replace")
            parser = Paragraphs()
            parser.feed(text)
            parser.close()
            for paragraphs in (parser.article, parser.main, parser.all):
                text = "\n".join(paragraphs)
                if len(text) >= config.ARTICLE_MIN_CHARS:
                    return text
            return None
    except Exception:
        return None
    return None
