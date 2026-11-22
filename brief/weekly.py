import sys
from datetime import date, datetime, timedelta
import httpx
from . import article, config, prompts, publish, sources, store
from .daily import _nonempty


def build_weekly(day, llm, now, force=False, root=None):
    if isinstance(day, str): day = date.fromisoformat(day)
    paths = config.paths(root)
    if (paths.issues / f"{day}.json").exists() and not force:
        print(f"{day} 已存在，跳过。", file=sys.stderr)
        return None
    start, end = day - timedelta(days=6), day - timedelta(days=1)
    issues = []
    for offset in range(6):
        issue = store.read_json(paths.issues / f"{start + timedelta(days=offset)}.json", {})
        if issue.get("type") == "daily": issues.append(issue)
    result = {"schema": 1, "type": "weekly", "date": day.isoformat(),
              "generated_at": now.astimezone(config.timezone()).isoformat(timespec="seconds"),
              "week": {"from": start.isoformat(), "to": end.isoformat()}, "longreads": []}
    review_reason = "日报不足两期"
    if len(issues) >= 2:
        review_reason = "模型返回内容无效"
        try:
            output = llm.chat_json(prompts.weekly_messages(start.isoformat(), end.isoformat(), issues))
            threads = output.get("threads")
            if all(_nonempty(output.get(k)) for k in ("title", "lede", "closing")) and isinstance(threads, list) and 2 <= len(threads) <= 4 and all(isinstance(t, dict) and _nonempty(t.get("title")) and _nonempty(t.get("body")) for t in threads):
                item_map = {item["id"]: {"date": issue["date"], "id": item["id"], "title": item["title"]}
                            for issue in issues for item in issue["items"]}
                clean = [{"title": t["title"], "body": t["body"],
                          "refs": [item_map[ref] for ref in t.get("refs", []) if isinstance(ref, str) and ref in item_map] if isinstance(t.get("refs"), list) else []}
                         for t in threads]
                chars = sum(len(output[k]) for k in ("title", "lede", "closing")) + sum(len(t["title"]) + len(t["body"]) for t in clean)
                result["review"] = {"title": output["title"], "lede": output["lede"], "threads": clean,
                                    "closing": output["closing"], "read_minutes": max(1, round(chars / config.READ_CHARS_PER_MIN))}
                if _nonempty(output.get("reflection")): result["reflection"] = output["reflection"]
        except Exception as exc:
            review_reason = f"生成失败：{exc}"
    print("周复盘：有" if "review" in result else f"周复盘：无（{review_reason}）", file=sys.stderr)
    used_urls, recommended = set(), []
    for weeks in range(1, config.LONGREAD_RECENT_WEEKS + 1):
        old = store.read_json(paths.issues / f"{day - timedelta(weeks=weeks)}.json", {})
        for item in old.get("longreads", []):
            used_urls.add(item.get("url"))
            recommended.append(item.get("original_title") or item.get("title", ""))
    source_map = {source["id"]: source for source in sources.load_sources(root)}
    candidates = []
    for item in store.load_raw(root):
        source = source_map.get(item["source"])
        if not source or source["section"] != "longread" or item["url"] in used_urls: continue
        published = datetime.fromisoformat(item["published"].replace("Z", "+00:00"))
        if not now - timedelta(days=config.LONGREAD_WINDOW_DAYS) <= published <= now + timedelta(hours=1): continue
        cache = paths.content / f"{item['id']}.txt"
        text = cache.read_text(encoding="utf-8") if cache.exists() else ""
        words = (len(text) if source["lang"] == "zh" else len(text.split())) if text else None
        candidates.append({"lid": f"L{len(candidates) + 1}", "source": source["name"], "title": item["title"],
                           "summary": item.get("summary", ""), "words": words, "author": item.get("author"),
                           "url": item["url"], "_item": item, "_source": source, "_text": text})
    picks = []
    if candidates:
        try:
            output = llm.chat_json(prompts.longread_pick_messages(candidates, recommended))
            valid = {c["lid"]: c for c in candidates}
            seen = set()
            for pick in output.get("picks", []) if isinstance(output.get("picks"), list) else []:
                lid = pick.get("lid") if isinstance(pick, dict) else None
                if isinstance(lid, str) and lid in valid and lid not in seen:
                    picks.append(valid[lid]); seen.add(lid)
                if len(picks) == 4: break
        except Exception as exc:
            print(f"长文初选失败：{exc}", file=sys.stderr)
    robots = {}
    with httpx.Client(timeout=15, follow_redirects=True, headers={"User-Agent": config.UA}) as client:
        for cand in picks:
            if len(result["longreads"]) >= config.LONGREAD_MAX: break
            source, raw = cand["_source"], cand["_item"]
            text = cand["_text"]
            if len(text) < config.LONGREAD_MIN_CHARS and source["role"] in ("open", "official"):
                page_text = article.fetch_article_text(raw["url"], client, robots) or ""
                if len(page_text) > len(text):
                    text = page_text
            if len(text) < config.LONGREAD_MIN_CHARS:
                print(f"长文 {cand['lid']}｜{cand['title']}：正文不足", file=sys.stderr)
                continue
            lang = source["lang"]
            words = len(text) if lang == "zh" else len(text.split())
            minutes = max(5, round(words / (config.READ_CHARS_PER_MIN if lang == "zh" else config.READ_WORDS_PER_MIN)))
            try:
                guide = llm.chat_json(prompts.longread_guide_messages(cand, text[:config.LONGREAD_GUIDE_CHARS], minutes))
                if guide.get("usable") is False or not all(_nonempty(guide.get(k)) for k in ("title_zh", "pitch", "summary")):
                    print(f"长文 {cand['lid']}｜{cand['title']}：导读不可用", file=sys.stderr)
                    continue
                entry = {"id": raw["id"][:10], "title": guide["title_zh"], "original_title": raw["title"], "source": source["name"]}
                if raw.get("author"): entry["author"] = raw["author"]
                entry.update({"published": raw["published"][:10], "url": raw["url"], "lang": lang, "minutes": minutes,
                              "tags": [v for v in guide.get("tags", []) if _nonempty(v)][:2] if isinstance(guide.get("tags"), list) else [],
                              "pitch": guide["pitch"], "summary": guide["summary"]})
                for key in ("argument", "questions"):
                    if isinstance(guide.get(key), list):
                        values = [v for v in guide[key] if _nonempty(v)]
                        if values: entry[key] = values
                if _nonempty(guide.get("caveat")): entry["caveat"] = guide["caveat"]
                result["longreads"].append(entry)
                print(f"长文 {cand['lid']}｜{cand['title']}：已入选", file=sys.stderr)
            except Exception as exc:
                print(f"长文 {cand['lid']}｜{cand['title']}：导读失败（{exc}）", file=sys.stderr)
    if not result.get("review") and not result["longreads"]:
        print("没有可用复盘或长文，本周不发布。", file=sys.stderr)
        return None
    publish.publish(result, root)
    return result
