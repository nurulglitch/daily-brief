import json
import sys
from concurrent.futures import ThreadPoolExecutor
from datetime import timedelta
import feedparser
import httpx
from . import config, store
from .textutil import canonical_url, html_to_text, item_id, parse_date, title_key, utc_string


def request_feed(client, source, state=None, conditional=True):
    headers = {}
    if conditional and state:
        if state.get("etag"): headers["If-None-Match"] = state["etag"]
        if state.get("modified"): headers["If-Modified-Since"] = state["modified"]
    for attempt in range(2):
        try:
            response = client.get(source["url"], headers=headers)
            if response.status_code == 304:
                return response, None
            response.raise_for_status()
            parsed = feedparser.parse(response.content)
            if parsed.bozo and not parsed.entries:
                raise ValueError("RSS 解析失败")
            return response, parsed
        except httpx.TransportError:
            if attempt == 1:
                raise


def fetch_all(sources, now, conditional=True, root=None, client=None):
    paths = config.paths(root)
    state = store.read_json(paths.state, {})
    old = store.load_raw(root)
    ids = {record["id"] for record in old}
    titles = {title_key(record["source"], record["title"]) for record in old}
    owned = client is None
    client = client or httpx.Client(timeout=20, follow_redirects=True, headers={"User-Agent": config.UA})
    def one(source):
        try:
            return request_feed(client, source, state.get(source["id"]), conditional), None
        except Exception as exc:
            return None, str(exc)
    try:
        with ThreadPoolExecutor(max_workers=8) as pool:
            results = list(pool.map(one, sources))
    finally:
        if owned: client.close()
    new, failures, unchanged = [], [], 0
    for source, (result, error) in zip(sources, results):
        key = source["id"]
        previous = state.get(key, {})
        if error is not None:
            state[key] = {"etag": previous.get("etag"), "modified": previous.get("modified"),
                          "last_ok": previous.get("last_ok"), "last_new": previous.get("last_new"),
                          "fail_streak": previous.get("fail_streak", 0) + 1, "last_error": error[:300],
                          "undated": previous.get("undated", 0)}
            failures.append((key, error))
            continue
        response, feed = result
        undated = added = 0
        if feed is None:
            unchanged += 1
            undated = previous.get("undated", 0)
        else:
            max_age = source.get("max_age_days", config.LONGREAD_MAX_AGE_DAYS if source["section"] == "longread" else config.MAX_AGE_DAYS[source["role"]])
            for entry in feed.entries:
                title, link = html_to_text(entry.get("title", "")), entry.get("link")
                if not title or not link:
                    continue
                published = parse_date(entry)
                if not published:
                    undated += 1
                    continue
                if published < now - timedelta(days=max_age):
                    continue
                if published > now + timedelta(hours=1):
                    published = now
                url = canonical_url(link)
                id_ = item_id(url)
                summary = html_to_text(entry.get("summary", ""))[:config.SUMMARY_MAX]
                content = entry.get("content") or []
                text = html_to_text(content[0].get("value", "") if content else entry.get("summary", ""))
                if len(text) >= len(summary) + 200:
                    paths.content.mkdir(parents=True, exist_ok=True)
                    file = paths.content / f"{id_}.txt"
                    if not file.exists():
                        limit = config.LONGREAD_CONTENT_MAX if source["section"] == "longread" else config.CONTENT_MAX
                        file.write_text(text[:limit], encoding="utf-8")
                tk = title_key(key, title)
                if id_ in ids or tk in titles:
                    continue
                ids.add(id_)
                titles.add(tk)
                record = {"id": id_, "source": key, "title": title, "url": url,
                          "published": utc_string(published), "fetched": utc_string(now), "summary": summary}
                if source["section"] == "longread" and entry.get("author"):
                    record["author"] = html_to_text(entry["author"])
                new.append(record)
                added += 1
        state[key] = {"etag": response.headers.get("etag", previous.get("etag")),
                      "modified": response.headers.get("last-modified", previous.get("modified")),
                      "last_ok": utc_string(now), "last_new": utc_string(now) if added else previous.get("last_new"),
                      "fail_streak": 0, "last_error": None, "undated": undated}
    if new:
        paths.raw.mkdir(parents=True, exist_ok=True)
        filename = paths.raw / f"{now.astimezone(config.timezone()).date()}.jsonl"
        with filename.open("a", encoding="utf-8") as f:
            for record in new:
                f.write(json.dumps(record, ensure_ascii=False, separators=(",", ":")) + "\n")
    store.write_json(paths.state, state)
    deleted = store.prune(now, root)
    print(f"抓取：{len(sources) - len(failures)}/{len(sources)} 成功，{unchanged} 未变，新增 {len(new)} 条，失败 {len(failures)}；清理 {deleted[0]} 份原始文件、{deleted[1]} 份缓存。", file=sys.stderr)
    for key, error in failures:
        print(f"  {key}: {error}", file=sys.stderr)
    if sources and len(failures) == len(sources):
        raise RuntimeError("全部信源抓取失败")
    return {"new": len(new), "failed": failures, "unchanged": unchanged}


def check_sources(sources, now, client=None):
    owned = client is None
    client = client or httpx.Client(timeout=20, follow_redirects=True, headers={"User-Agent": config.UA})
    def one(source):
        try:
            response, feed = request_feed(client, source, conditional=False)
            dates = [d for entry in feed.entries if (d := parse_date(entry))]
            age = max(0, (now - max(dates)).total_seconds() / 86400) if dates else None
            flag = "EMPTY" if not feed.entries else ("STALE" if age is None or age > 30 else "OK")
            return source["id"], str(response.status_code), len(feed.entries), age, flag
        except Exception as exc:
            return source["id"], "-", 0, None, f"FAIL {str(exc)[:100]}"
    try:
        with ThreadPoolExecutor(max_workers=8) as pool:
            return list(pool.map(one, sources))
    finally:
        if owned: client.close()
