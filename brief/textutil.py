import calendar
import hashlib
import re
from datetime import datetime, timezone
from email.utils import parsedate_to_datetime
from html.parser import HTMLParser
from urllib.parse import parse_qsl, urlencode, urlsplit, urlunsplit

TRACKING = {"fbclid", "gclid", "mc_cid", "mc_eid", "cmpid", "cmp", "ocid", "smid", "emc", "partner", "ref", "ref_src"}


class TextParser(HTMLParser):
    def __init__(self):
        super().__init__(convert_charrefs=True)
        self.parts = []
        self.hidden = 0

    def handle_starttag(self, tag, attrs):
        if tag in ("script", "style"):
            self.hidden += 1
        if tag in ("p", "br", "div", "li"):
            self.parts.append(" ")

    def handle_endtag(self, tag):
        if tag in ("script", "style") and self.hidden:
            self.hidden -= 1
        if tag in ("p", "div", "li"):
            self.parts.append(" ")

    def handle_data(self, data):
        if not self.hidden:
            self.parts.append(data)


def html_to_text(value):
    parser = TextParser()
    parser.feed(value or "")
    return " ".join("".join(parser.parts).split())


def canonical_url(url):
    parts = urlsplit(url)
    scheme = parts.scheme.lower()
    host = parts.netloc.lower()
    query = [(k, v) for k, v in parse_qsl(parts.query, keep_blank_values=True)
             if not k.lower().startswith(("utm_", "at_")) and k.lower() not in TRACKING]
    path = parts.path.rstrip("/") or "/"
    return urlunsplit((scheme, host, path, urlencode(sorted(query)), ""))


def item_id(url):
    return hashlib.sha1(canonical_url(url).encode()).hexdigest()[:16]


def title_key(source_id, title):
    clean = "".join(c for c in title.lower() if c.isalnum())
    return hashlib.sha1(f"{source_id}|{clean}".encode()).hexdigest()[:16]


def parse_date(entry):
    for key in ("published_parsed", "updated_parsed"):
        value = entry.get(key)
        if value:
            try:
                return datetime.fromtimestamp(calendar.timegm(value), timezone.utc)
            except (ValueError, OverflowError, TypeError):
                pass
    for key in ("published", "updated"):
        value = entry.get(key)
        if not value:
            continue
        for parser in (parsedate_to_datetime, datetime.fromisoformat,
                       lambda s: datetime.strptime(s, "%a, %m/%d/%Y - %H:%M")):
            try:
                result = parser(value)
                if result is not None:
                    return result.replace(tzinfo=result.tzinfo or timezone.utc).astimezone(timezone.utc)
            except (ValueError, TypeError, OverflowError):
                pass
    return None


def utc_string(value):
    return value.astimezone(timezone.utc).replace(microsecond=0).isoformat().replace("+00:00", "Z")
