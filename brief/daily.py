import os
import sys
from concurrent.futures import ThreadPoolExecutor
from datetime import date, datetime, timedelta
import httpx
from . import article, cluster, config, prompts, publish, sources, store


def _parallel(fn, items):
    try: workers = max(1, int(os.environ.get("BRIEF_LLM_CONCURRENCY", "3")))
    except ValueError: workers = 3
    with ThreadPoolExecutor(max_workers=workers) as pool:
        return list(pool.map(fn, items))


def _nonempty(value):
    return isinstance(value, str) and bool(value.strip())


def _takes(value, limit):
    result = []
    for take in value if isinstance(value, list) else []:
        if isinstance(take, dict) and _nonempty(take.get("text")):
            result.append({"label": take.get("label") if take.get("label") in prompts.TAKE_LABELS else "另一面", "text": take["text"]})
            if len(result) == limit: break
    return result


def _deep(output):
    if not isinstance(output, dict) or output.get("usable") is False:
        return None
    if not all(_nonempty(output.get(key)) for key in ("background", "analysis")):
        return None
    facts = [fact for fact in output.get("facts", []) if _nonempty(fact)] if isinstance(output.get("facts"), list) else []
    if len(facts) < config.DEEP_FACTS_MIN:
        return None
    result = {"background": output["background"], "facts": facts[:config.DEEP_FACTS_MAX], "analysis": output["analysis"]}
    voices = output.get("voices")
    if isinstance(voices, list):
        voices = [{"who": voice["who"], "says": voice["says"]} for voice in voices
                  if isinstance(voice, dict) and _nonempty(voice.get("who")) and _nonempty(voice.get("says"))][:config.DEEP_VOICES_MAX]
        if voices: result["voices"] = voices
    takes = _takes(output.get("takes"), 1)
    if takes: result["takes"] = takes
    drill = output.get("drill")
    if isinstance(drill, dict) and _nonempty(drill.get("question")) and _nonempty(drill.get("reveal")):
        result["drill"] = {"question": drill["question"], "reveal": drill["reveal"]}
        if drill.get("kind") in prompts.DRILL_KINDS: result["drill"]["kind"] = drill["kind"]

    def text_chars(value):
        if isinstance(value, str): return len(value)
        if isinstance(value, dict): return sum(text_chars(v) for v in value.values())
        if isinstance(value, list): return sum(text_chars(v) for v in value)
        return 0

    result["minutes"] = max(1, round(text_chars(result) / config.READ_CHARS_PER_MIN))
    return result


def _shortlist_score(value):
    if isinstance(value, bool) or not isinstance(value, (int, float, str)):
        return None
    try:
        return max(1, min(10, int(round(float(value)))))
    except (ValueError, TypeError, OverflowError):
        return None


def _past(day, root):
    result = []
    for days in range(config.PAST_DAYS, 0, -1):
        file = config.paths(root).issues / f"{day - timedelta(days=days)}.json"
        issue = store.read_json(file, {})
        if issue.get("type") != "daily": continue
        for item in issue.get("items", []):
            result.append({"date": issue["date"], "section": item["section"], "title": item["title"],
                           "gist": item.get("gist", ""), "sources": item.get("sources", [])})
    return result


def _candidate(group, cid, source_map, past, now):
    members = group["members"]
    distinct = {}
    for member in members:
        source = source_map[member["source"]]
        distinct.setdefault(source["name"], (source, member))
    entries = list(distinct.values())
    flags = []
    for item in past:
        if any(s.get("url") == m["url"] for s in item["sources"] for m in members):
            flags.append(f"其中的报道已在 {item['date'][5:]} 的简报中用过")
    return {"cid": cid, "n_sources": group["n_sources"], "hours_ago": max(0, (now - group["newest"]).total_seconds() / 3600),
            "sources": [{"name": s["name"], "role": s["role"], "note": s.get("note", "")} for s, _ in entries],
            "title": group["lead"]["title"], "summary": group["lead"].get("summary", ""),
            "other_titles": [m["title"] for _, m in entries[1:3]], "all_analysis": group["all_analysis"], "flags": list(dict.fromkeys(flags)),
            "_group": group}


def _select(shortlisted, editor):
    candidates = {c["cid"]: c for values in shortlisted.values() for c in values}
    dropped_values = editor.get("dropped")
    dropped = {v["cid"] for v in dropped_values if isinstance(v, dict) and isinstance(v.get("cid"), str)} if isinstance(dropped_values, list) else set()
    final, used, counts = [], set(), {}
    def add(cid, section=None, kind=None):
        if not isinstance(cid, str): return
        c = candidates.get(cid)
        if not c or cid in used: return
        section = section if isinstance(section, str) and section in prompts.SECTIONS else c["_group"]["section"]
        if counts.get(section, 0) >= config.MAX_PER_SECTION: return
        final.append({"candidate": c, "section": section, "kind": kind if kind in ("new", "update") else c["kind"]})
        used.add(cid)
        counts[section] = counts.get(section, 0) + 1
    for pick in editor.get("final", []) if isinstance(editor.get("final"), list) else []:
        if isinstance(pick, dict): add(pick.get("cid"), pick.get("section"), pick.get("kind"))
    while len(final) > config.MAX_ITEMS:
        eligible = [item for item in final if counts[item["section"]] > 1]
        if not eligible: break
        item = min(eligible, key=lambda item: item["candidate"]["score"])
        final.remove(item)
        used.remove(item["candidate"]["cid"])
        counts[item["section"]] -= 1
    for section in prompts.SECTION_ORDER:
        if counts.get(section, 0) == 0:
            for candidate in sorted(shortlisted.get(section, []), key=lambda c: -c["score"]):
                if candidate["cid"] not in dropped and candidate["cid"] not in used:
                    if len(final) >= config.MAX_ITEMS:
                        eligible = [item for item in final if counts[item["section"]] > 1]
                        if not eligible: break
                        item = min(eligible, key=lambda item: item["candidate"]["score"])
                        final.remove(item); used.remove(item["candidate"]["cid"]); counts[item["section"]] -= 1
                    add(candidate["cid"], section)
                    break
    for candidate in sorted(candidates.values(), key=lambda c: -c["score"]):
        if len(final) >= config.MIN_ITEMS: break
        if candidate["score"] >= config.FILL_MIN_SCORE and candidate["cid"] not in dropped:
            add(candidate["cid"])
    return final, dropped


def build_daily(day, llm, now, force=False, root=None):
    if isinstance(day, str): day = date.fromisoformat(day)
    paths = config.paths(root)
    if (paths.issues / f"{day}.json").exists() and not force:
        print(f"{day} 已存在，跳过。", file=sys.stderr)
        return None
    source_list = sources.load_sources(root)
    source_map = {s["id"]: s for s in source_list}
    window = config.WINDOW_HOURS_MONDAY if day.weekday() == 0 else config.WINDOW_HOURS
    groups = cluster.clusters(store.load_raw(root), source_list, now, root, window)
    groups = [g for g in groups if any(datetime.fromisoformat(m["published"].replace("Z", "+00:00")) >= now - timedelta(hours=window) for m in g["members"])]
    past = _past(day, root)
    pools = {}
    counter = 0
    for section in prompts.SECTION_ORDER:
        ordered = sorted((g for g in groups if g["section"] == section), key=lambda g: (-g["score"], g["lead"]["id"]))
        selected = ordered[:config.SHORTLIST_POOL]
        selected_ids = {id(g) for g in selected}
        selected.extend(g for g in ordered[config.SHORTLIST_POOL:] if id(g) not in selected_ids and any(source_map[m["source"]]["role"] == "official" for m in g["members"]))
        pools[section] = []
        for group in selected[:60]:
            counter += 1
            pools[section].append(_candidate(group, f"c{counter}", source_map, past, now))
    def shortlist(section):
        if not pools[section]: return section, [], False
        try:
            output = llm.chat_json(prompts.shortlist_messages(day.isoformat(), section, pools[section], past))
            allowed = {c["cid"]: c for c in pools[section]}
            picks, used = [], set()
            for pick in output.get("picks", []) if isinstance(output.get("picks"), list) else []:
                if not isinstance(pick, dict) or not isinstance(pick.get("cid"), str) or pick["cid"] not in allowed or pick["cid"] in used: continue
                score = _shortlist_score(pick.get("score"))
                if score is None or score < 6: continue
                used.add(pick["cid"])
                picks.append({**allowed[pick["cid"]], "score": score, "kind": pick.get("kind") if pick.get("kind") in ("new", "update") else "new", "reason": pick.get("reason", "")})
                if len(picks) == 5: break
            return section, picks, False
        except Exception as exc:
            print(f"{section} 初选失败：{exc}", file=sys.stderr)
            return section, [], True
    results = _parallel(shortlist, prompts.SECTION_ORDER)
    for section, picks, _ in results:
        print(f"{prompts.SECTIONS[section]}：候选 {len(pools[section])} / 入围 {len(picks)}", file=sys.stderr)
    if sum(failed for _, _, failed in results) >= 3:
        raise RuntimeError("三个或更多板块初选失败")
    shortlisted = {section: picks for section, picks, _ in results}
    try:
        editor = llm.chat_json(prompts.editor_messages(day.isoformat(), shortlisted, past))
    except Exception as exc:
        print(f"终选失败，使用初选回退：{exc}", file=sys.stderr)
        editor = {"final": [{"cid": c["cid"], "section": section} for section in prompts.SECTION_ORDER for c in sorted(shortlisted[section], key=lambda c: -c["score"])[:2]]}
    final, dropped = _select(shortlisted, editor)
    def log_selection(selection):
        c = selection["candidate"]
        print(f"{c['cid']}｜{prompts.SECTIONS[selection['section']]}｜{selection['kind']}｜{c['title']}", file=sys.stderr)
    for selection in final:
        log_selection(selection)
    attempted = set()
    backfilled_count = 0
    robots = {}
    with httpx.Client(timeout=15, follow_redirects=True, headers={"User-Agent": config.UA}) as client:
        def write(selection):
            c, section, kind = selection["candidate"], selection["section"], selection["kind"]
            group = c["_group"]
            materials, seen, pages = [], set(), 0
            for member in group["members"]:
                source = source_map[member["source"]]
                if source["name"] in seen: continue
                seen.add(source["name"])
                cache = paths.content / f"{member['id']}.txt"
                text, full = "", False
                if cache.exists():
                    text = cache.read_text(encoding="utf-8")
                    full = bool(text)
                if len(text) < config.ARTICLE_MIN_CHARS and source["role"] in ("open", "official") and pages < config.PAGES_PER_ITEM:
                    pages += 1
                    page_text = article.fetch_article_text(member["url"], client, robots) or ""
                    if len(page_text) > len(text):
                        text, full = page_text, True
                if not text: text = member.get("summary", "")
                materials.append({"source": source["name"], "role": source["role"], "note": source.get("note", ""),
                                  "published": member["published"], "title": member["title"], "text": text,
                                  "full": full, "url": member["url"]})
                if len(materials) >= config.MATERIALS_PER_ITEM: break
            previous = [{key: p[key] for key in ("date", "title", "gist")} for p in
                        sorted((p for p in past if p["section"] == section), key=lambda p: p["date"], reverse=True)[:6]] if kind == "update" else []
            try:
                writer_materials = [{**m, "text": m["text"][:config.MATERIAL_CHARS]} for m in materials]
                output = llm.chat_json(prompts.writer_messages(day.isoformat(), section, kind, c, writer_materials, previous))
                if output.get("usable") is False or not all(_nonempty(output.get(k)) for k in ("title", "gist", "facts", "why", "watch")): return None
                takes = _takes(output.get("takes"), 2)
                item = {"id": group["lead"]["id"][:10], "section": section, "kind": kind,
                        **{key: output[key] for key in ("title", "gist", "facts", "why", "watch")}, "takes": takes}
                if _nonempty(output.get("craft")): item["craft"] = output["craft"]
                item["sources"] = [{"name": m["source"], "url": m["url"]} for m in materials]
                item["source_count"] = group["n_sources"]
                item["basis"] = "summary" if not any(m["full"] for m in materials) else ("single" if len(materials) == 1 else "multi")
                return item, materials
            except Exception as exc:
                print(f"{c['cid']} 撰写失败：{exc}", file=sys.stderr)
                return None
        attempted.update(s["candidate"]["cid"] for s in final)
        written = [item for item in _parallel(write, final) if item]
        if len(written) < config.MIN_ITEMS:
            counts = {section: sum(item["section"] == section for item, _ in written) for section in prompts.SECTION_ORDER}
            backfill = []
            available = sorted((c for group in shortlisted.values() for c in group), key=lambda c: -c["score"])
            for c in available:
                section = c["_group"]["section"]
                if len(written) + len(backfill) >= config.MIN_ITEMS: break
                if c["cid"] in attempted or c["cid"] in dropped or c["score"] < config.FILL_MIN_SCORE or counts[section] >= config.MAX_PER_SECTION: continue
                backfill.append({"candidate": c, "section": section, "kind": c["kind"]})
                counts[section] += 1
            for selection in backfill:
                log_selection(selection)
            backfilled = [item for item in _parallel(write, backfill) if item]
            backfilled_count = len(backfilled)
            written.extend(backfilled)
    print(f"成稿 {len(written)} 条（补位 {backfilled_count}）", file=sys.stderr)
    if len(written) < config.MIN_PUBLISH_ITEMS:
        raise RuntimeError(f"可用条目不足 {config.MIN_PUBLISH_ITEMS} 条，不发布")
    written.sort(key=lambda pair: prompts.SECTION_ORDER.index(pair[0]["section"]))
    eligible = [(item, materials) for item, materials in written
                if any(m["full"] and len(m["text"]) >= config.DEEP_MIN_FULL_CHARS for m in materials)]
    def write_deep(pair):
        item, materials = pair
        selected = [{**m, "text": m["text"][:config.DEEP_MATERIAL_CHARS]} for m in materials[:config.DEEP_MATERIALS]]
        try:
            return _deep(llm.chat_json(prompts.deep_messages(day.isoformat(), item["section"], item, selected)))
        except Exception as exc:
            print(f"{item['id']} 细读生成失败：{exc}", file=sys.stderr)
            return None
    deep_results = _parallel(write_deep, eligible)
    for (item, _), deep in zip(eligible, deep_results):
        if deep is not None: item["deep"] = deep
    print(f"细读 {sum(deep is not None for deep in deep_results)} / {len(written)} 条", file=sys.stderr)
    written = [item for item, _ in written]
    chars = sum(len(item[k]) for item in written for k in ("title", "gist", "facts", "why", "watch")) + sum(len(t["text"]) for item in written for t in item["takes"])
    issue = {"schema": 1, "type": "daily", "date": day.isoformat(), "generated_at": now.astimezone(config.timezone()).isoformat(timespec="seconds"),
             "read_minutes": max(1, round(chars / config.READ_CHARS_PER_MIN)), "items": written}
    egg_reason = "模型未返回有效彩蛋"
    try:
        preferred = "flaw" if len({item["section"] for item in written}) == 1 else prompts.EGG_TYPES[day.toordinal() % 3]
        output = llm.chat_json(prompts.egg_messages(day.isoformat(), written, preferred))
        egg = output.get("egg")
        if isinstance(egg, dict) and egg.get("type") in prompts.EGG_TYPES and _nonempty(egg.get("question")) and _nonempty(egg.get("reveal")):
            options = egg.get("options")
            valid_options = isinstance(options, list) and 2 <= len(options) <= 3 and all(_nonempty(o) for o in options)
            if egg["type"] != "hunch" or valid_options:
                clean = {"type": egg["type"], "kicker": prompts.EGG_KICKERS[egg["type"]], "question": egg["question"], "reveal": egg["reveal"]}
                if egg["type"] == "hunch": clean["options"] = options
                clean["refs"] = [ref for ref in egg.get("refs", []) if isinstance(ref, str) and ref in {i["id"] for i in written}] if isinstance(egg.get("refs"), list) else []
                issue["egg"] = clean
            else:
                egg_reason = "直觉推演缺少有效选项"
        if _nonempty(output.get("reflection")): issue["reflection"] = output["reflection"]
    except Exception as exc:
        egg_reason = f"生成失败：{exc}"
    print(f"彩蛋：{issue['egg']['type']}" if "egg" in issue else f"彩蛋：无（{egg_reason}）", file=sys.stderr)
    publish.publish(issue, root)
    return issue
