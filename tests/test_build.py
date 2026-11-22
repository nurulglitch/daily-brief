import json
import re
import threading
from datetime import date, datetime, timedelta, timezone
import pytest
from brief import config, daily, prompts, publish, store, weekly
from brief.textutil import item_id

NOW = datetime(2026, 11, 19, 12, tzinfo=timezone.utc)


def write_sources(root):
    chunks = []
    for section in prompts.SECTION_ORDER + ["longread"]:
        chunks.append(f'[[source]]\nid = "{section}"\nname = "{section}"\nurl = "https://{section}.test/feed"\nsection = "{section}"\nrole = "open"\n')
    (root / "sources.toml").write_text("\n".join(chunks), encoding="utf-8")


def raw(root, entries):
    paths = config.paths(root)
    paths.raw.mkdir(parents=True, exist_ok=True)
    (paths.raw / "2026-11-19.jsonl").write_text("".join(json.dumps(e) + "\n" for e in entries))


def record(section, title, suffix):
    url = f"https://{section}.test/{suffix}"
    return {"id": item_id(url), "source": section, "title": title, "url": url,
            "published": "2026-11-19T11:00:00Z", "fetched": "2026-11-19T12:00:00Z", "summary": "summary"}


class Stub:
    def __init__(self, fail_writer=True):
        self.fail_writer = fail_writer
        self.lock = threading.Lock()

    def chat_json(self, messages):
        system, text = messages[0]["content"], messages[1]["content"]
        if system == prompts.SHORTLIST_SYSTEM:
            return {"picks": [{"cid": cid, "score": 8, "kind": "new"} for cid in re.findall(r"\[(c\d+)\]", text)]}
        if system == prompts.EDITOR_SYSTEM: return {"final": [], "dropped": []}
        if system == prompts.WRITER_SYSTEM:
            with self.lock:
                if self.fail_writer and "板块：全球局势" in text:
                    self.fail_writer = False
                    return {"usable": False}
            return {"title": re.search(r"事件：(.*)", text).group(1), "gist": "梗概", "facts": "事实", "why": "重要", "watch": "后续",
                    "takes": [{"label": "不合法", "text": "旁批"}]}
        if system == prompts.DEEP_SYSTEM: return {"usable": False}
        if system == prompts.EGG_SYSTEM:
            return {"egg": {"type": "hunch", "question": "问题", "reveal": "解释"}, "reflection": "一念"}
        if system == prompts.WEEKLY_SYSTEM:
            ids = re.findall(r"\(([0-9a-f]{10})\)", text)
            return {"title": "复盘", "lede": "引言", "closing": "看点", "reflection": "一念",
                    "threads": [{"title": "一", "body": "正文", "refs": [ids[0], "unknown", {}]}, {"title": "二", "body": "正文", "refs": []}]}
        if system == prompts.LONGREAD_PICK_SYSTEM: return {"picks": [{"lid": "L1"}, {"lid": "L2"}]}
        if system == prompts.LONGREAD_GUIDE_SYSTEM:
            return {"usable": True, "title_zh": "长文", "pitch": "导读", "summary": "摘要", "tags": ["甲", "乙", "丙"]}
        raise AssertionError("unexpected prompt")


def test_daily_backfill_limits_and_noop(tmp_path, monkeypatch):
    monkeypatch.setenv("BRIEF_FETCH_ARTICLES", "0")
    write_sources(tmp_path)
    records = [record(section, f"{section}unique{i} {section}story{i} {section}event{i}", str(i)) for section in prompts.SECTION_ORDER for i in range(4)]
    raw(tmp_path, records)
    issue = daily.build_daily(date(2026, 11, 19), Stub(), NOW, root=tmp_path)
    assert len(issue["items"]) == 8
    assert set(i["section"] for i in issue["items"]) == set(prompts.SECTION_ORDER)
    assert all(sum(i["section"] == section for i in issue["items"]) <= 2 for section in prompts.SECTION_ORDER)
    assert all(i["takes"][0]["label"] == "另一面" for i in issue["items"])
    assert "egg" not in issue and issue["reflection"] == "一念"
    index = store.read_json(config.paths(tmp_path).issues / "index.json", {})
    assert index["issues"] == [{"date": "2026-11-19", "type": "daily", "count": 8}]
    assert daily.build_daily("2026-11-19", Stub(), NOW, root=tmp_path) is None


def test_daily_fewer_than_three_does_not_publish(tmp_path, monkeypatch):
    monkeypatch.setenv("BRIEF_FETCH_ARTICLES", "0")
    write_sources(tmp_path)
    raw(tmp_path, [record("world", "Only one event", "1")])
    with pytest.raises(RuntimeError, match="不足"):
        daily.build_daily("2026-11-19", Stub(fail_writer=False), NOW, root=tmp_path)
    assert not config.paths(tmp_path).issues.exists()


def test_editor_selection_max_and_section_floor():
    short = {}
    for section in prompts.SECTION_ORDER:
        short[section] = [{"cid": f"{section}{n}", "score": 8 - n, "kind": "new", "_group": {"section": section}} for n in range(3)]
    editor = {"final": [{"cid": [], "section": {}}, {"cid": short["world"][0]["cid"], "section": {}}] + [{"cid": c["cid"], "section": "bad"} for group in short.values() for c in group] + [{"cid": "unknown"}], "dropped": [{"cid": []}]}
    selected, _ = daily._select(short, editor)
    assert len(selected) == 10
    assert all(sum(x["section"] == section for x in selected) == 2 for section in prompts.SECTION_ORDER)


def test_weekly_review_refs_and_next_longread(tmp_path, monkeypatch):
    monkeypatch.setattr(weekly.article, "fetch_article_text", lambda *args: None)
    write_sources(tmp_path)
    for d in (date(2026, 11, 9), date(2026, 11, 10)):
        publish.publish({"type": "daily", "date": d.isoformat(), "items": [{"id": f"{d.day:010x}", "section": "world", "title": "标题", "gist": "摘要", "why": "重要", "watch": "看点"}]}, tmp_path)
    items = [record("longread", f"Long read {i}", str(i)) for i in (1, 2)]
    raw(tmp_path, items)
    cache = config.paths(tmp_path).content; cache.mkdir(parents=True)
    (cache / f"{items[0]['id']}.txt").write_text("short")
    (cache / f"{items[1]['id']}.txt").write_text("word " * 1400)
    issue = weekly.build_weekly("2026-11-15", Stub(), NOW, root=tmp_path)
    assert issue["review"]["threads"][0]["refs"] == [{"date": "2026-11-09", "id": "0000000009", "title": "标题"}]
    assert len(issue["longreads"]) == 1 and issue["longreads"][0]["url"] == items[1]["url"]
    assert issue["longreads"][0]["tags"] == ["甲", "乙"]
    assert store.read_json(config.paths(tmp_path).issues / "index.json", {})["issues"][0]["title"] == "复盘"


def test_weekly_no_review_and_empty(tmp_path):
    write_sources(tmp_path)
    assert weekly.build_weekly("2026-11-15", Stub(), NOW, root=tmp_path) is None
    assert not config.paths(tmp_path).issues.exists()
    item = record("longread", "Long read", "1")
    raw(tmp_path, [item])
    cache = config.paths(tmp_path).content; cache.mkdir(parents=True)
    (cache / f"{item['id']}.txt").write_text("word " * 1400)
    issue = weekly.build_weekly("2026-11-15", Stub(), NOW, root=tmp_path)
    assert "review" not in issue and len(issue["longreads"]) == 1
    assert store.read_json(config.paths(tmp_path).issues / "index.json", {})["issues"][0]["title"] == "周日慢读"


@pytest.mark.parametrize(("value", "expected"), [
    (8, 8), (8.0, 8), ("8", 8), ("7.6", 8), (5.5, 6),
    (99, 10), (-3, 1), ("bad", None), ("NaN", None),
    ("Infinity", None), (None, None), (True, None),
])
def test_shortlist_score(value, expected):
    assert daily._shortlist_score(value) == expected


def test_numeric_shortlist_scores_flow_into_build(tmp_path, monkeypatch, capsys):
    monkeypatch.setenv("BRIEF_FETCH_ARTICLES", "0")
    write_sources(tmp_path)
    records = [record(section, f"{section}unique{i} {section}story{i} {section}event{i}", str(i)) for section in prompts.SECTION_ORDER for i in range(4)]
    raw(tmp_path, records)
    class NumericStub(Stub):
        def chat_json(self, messages):
            if messages[0]["content"] == prompts.SHORTLIST_SYSTEM:
                ids = re.findall(r"\[(c\d+)\]", messages[1]["content"])
                return {"picks": [{"cid": cid, "score": score} for cid, score in zip(ids, [8.0, "8", "bad", "NaN"])]}
            return super().chat_json(messages)
    issue = daily.build_daily("2026-11-19", NumericStub(fail_writer=False), NOW, root=tmp_path)
    assert len(issue["items"]) == 8
    logs = capsys.readouterr().err
    for section in prompts.SECTION_ORDER:
        assert f"{prompts.SECTIONS[section]}：候选 4 / 入围 2" in logs
    assert "成稿 8 条（补位 0）" in logs
    assert "彩蛋：无（直觉推演缺少有效选项）" in logs


@pytest.mark.parametrize(("cached_length", "page_length", "expect_page_call"), [
    (900, 2000, True), (900, 500, True), (1500, 2000, False),
])
def test_daily_thin_cache_and_update_previous(tmp_path, monkeypatch, cached_length, page_length, expect_page_call):
    write_sources(tmp_path)
    records = [record(section, f"{section}unique{i} {section}story{i} {section}event{i}", str(i)) for section in prompts.SECTION_ORDER for i in range(2)]
    raw(tmp_path, records)
    cache = config.paths(tmp_path).content
    cache.mkdir(parents=True)
    for item in records:
        (cache / f"{item['id']}.txt").write_text("C" * cached_length)
    for days in range(1, 8):
        d = date(2026, 11, 19) - timedelta(days=days)
        publish.publish({"type": "daily", "date": d.isoformat(), "items": [
            {"id": f"w{days}", "section": "world", "title": f"中文旧稿{days}", "gist": f"摘要{days}"},
            {"id": f"t{days}", "section": "tech", "title": f"其他板块{days}", "gist": "其他"},
        ]}, tmp_path)
    requests, captured = [], []
    def fetch_page(url, client, robots):
        requests.append(url)
        return "P" * page_length
    monkeypatch.setattr(daily.article, "fetch_article_text", fetch_page)
    writer_messages = prompts.writer_messages
    def capture(day, section, kind, candidate, materials, previous=None):
        captured.append((section, kind, materials, previous))
        return writer_messages(day, section, kind, candidate, materials, previous)
    monkeypatch.setattr(prompts, "writer_messages", capture)
    class UpdateStub(Stub):
        def chat_json(self, messages):
            result = super().chat_json(messages)
            if messages[0]["content"] == prompts.SHORTLIST_SYSTEM:
                for pick in result["picks"]: pick["kind"] = "update"
            return result
    issue = daily.build_daily("2026-11-19", UpdateStub(fail_writer=False), NOW, root=tmp_path)
    assert len(issue["items"]) == 8
    assert len(requests) == (len(captured) if expect_page_call else 0)
    expected = "P" * page_length if expect_page_call and page_length > cached_length else "C" * cached_length
    assert all(materials[0]["text"] == expected and materials[0]["full"] for _, _, materials, _ in captured)
    world = next(previous for section, kind, _, previous in captured if section == "world" and kind == "update")
    assert world == [{"date": f"2026-11-{19 - n:02d}", "title": f"中文旧稿{n}", "gist": f"摘要{n}"} for n in range(1, 7)]


def test_weekly_thin_cache_uses_longer_page(tmp_path, monkeypatch, capsys):
    write_sources(tmp_path)
    items = [record("longread", f"Long read {i}", str(i)) for i in (1, 2)]
    raw(tmp_path, items)
    cache = config.paths(tmp_path).content
    cache.mkdir(parents=True)
    (cache / f"{items[0]['id']}.txt").write_text("teaser")
    (cache / f"{items[1]['id']}.txt").write_text("cached " * 1000)
    requests = []
    def fetch_page(url, client, robots):
        requests.append(url)
        return "article " * 900
    monkeypatch.setattr(weekly.article, "fetch_article_text", fetch_page)
    captured = []
    guide_messages = prompts.longread_guide_messages
    def capture(candidate, text, minutes):
        captured.append((candidate["url"], text))
        return guide_messages(candidate, text, minutes)
    monkeypatch.setattr(prompts, "longread_guide_messages", capture)
    issue = weekly.build_weekly("2026-11-15", Stub(), NOW, root=tmp_path)
    assert [item["url"] for item in issue["longreads"]] == [item["url"] for item in items]
    assert requests == [items[0]["url"]]
    assert captured[0][1] == "article " * 900
    logs = capsys.readouterr().err
    assert "周复盘：无（日报不足两期）" in logs
    assert "长文 L1｜Long read 1：已入选" in logs
    assert "长文 L2｜Long read 2：已入选" in logs


def test_daily_deep_uses_original_materials_and_is_optional(tmp_path, monkeypatch, capsys):
    write_sources(tmp_path)
    with (tmp_path / "sources.toml").open("a") as f:
        for n in range(1, 4):
            f.write(f'\n[[source]]\nid = "extra{n}"\nname = "extra{n}"\nurl = "https://extra{n}.test/feed"\nsection = "world"\nrole = "open"\n')
    primary = [record(section, f"{section} unique event", section) for section in prompts.SECTION_ORDER]
    summary = record("bio", "bio another distinct event", "summary")
    summary["summary"] = "S" * (config.DEEP_MIN_FULL_CHARS + 100)
    extra = [record("world", f"extra distinct {n}", f"extra{n}") for n in range(1, 4)]
    for n, member in enumerate(extra, 1): member["source"] = f"extra{n}"
    groups = []
    for member in [*primary, summary]:
        members = [member, *extra] if member["source"] == "world" else [member]
        groups.append({"section": member["source"], "lead": member, "members": members, "n_sources": len(members),
                       "newest": NOW, "score": 5, "all_analysis": False})
    monkeypatch.setattr(daily.cluster, "clusters", lambda *args: groups)
    cache = config.paths(tmp_path).content
    cache.mkdir(parents=True)
    for member in [*primary[:4], *extra]:
        (cache / f"{member['id']}.txt").write_text("A" * 6001)
    (cache / f"{primary[4]['id']}.txt").write_text("B" * (config.DEEP_MIN_FULL_CHARS - 1))
    (cache / f"{primary[1]['id']}.txt").write_text("C" * 900)
    (cache / f"{extra[0]['id']}.txt").write_text("C" * 900)
    requests = []
    def page(url, client, robots):
        requests.append(url)
        if url == extra[0]["url"]: return "P" * 6100
        if url == primary[1]["url"]: return "Q" * config.DEEP_MIN_FULL_CHARS
        return None
    monkeypatch.setattr(daily.article, "fetch_article_text", page)
    writer_calls, deep_calls = [], []
    writer_messages, deep_messages = prompts.writer_messages, prompts.deep_messages
    def writer_capture(day, section, kind, candidate, materials, previous=None):
        writer_calls.append((section, materials))
        return writer_messages(day, section, kind, candidate, materials, previous)
    def deep_capture(day, section, item, materials):
        deep_calls.append((section, materials))
        return deep_messages(day, section, item, materials)
    monkeypatch.setattr(prompts, "writer_messages", writer_capture)
    monkeypatch.setattr(prompts, "deep_messages", deep_capture)
    class DeepStub(Stub):
        def chat_json(self, messages):
            if messages[0]["content"] != prompts.DEEP_SYSTEM:
                return super().chat_json(messages)
            text = messages[1]["content"]
            if "板块：战争与安全" in text: return {"usable": False}
            if "板块：金融宏观" in text: return {"background": "前情", "analysis": "分析", "facts": ["仅一条"]}
            if "板块：AI 与硬科技" in text: raise RuntimeError("stub deep failure")
            return {"usable": True, "background": "背景", "analysis": "分析" * 500,
                    "facts": ["", None, *[f"事实{n}" for n in range(8)]],
                    "voices": [{"who": "", "says": "忽略"}, {"who": "缺立场", "says": " "},
                               *[{"who": f"来源{n}", "says": f"立场{n}"} for n in range(6)]],
                    "takes": [{"label": "未知", "text": "旁批"}, {"label": "挑刺", "text": "丢弃"}],
                    "drill": {"kind": "不存在", "question": "问题", "reveal": "思路"}}
    issue = daily.build_daily("2026-11-19", DeepStub(fail_writer=False), NOW, root=tmp_path)
    assert len(issue["items"]) == 6
    assert [item["section"] for item in issue["items"] if "deep" in item] == ["world"]
    deep = issue["items"][0]["deep"]
    assert deep["facts"] == [f"事实{n}" for n in range(6)]
    assert deep["voices"] == [{"who": f"来源{n}", "says": f"立场{n}"} for n in range(4)]
    assert deep["takes"] == [{"label": "另一面", "text": "旁批"}]
    assert deep["drill"] == {"question": "问题", "reveal": "思路"}
    chars = (len(deep["background"]) + len(deep["analysis"]) + sum(map(len, deep["facts"]))
             + sum(len(v["who"]) + len(v["says"]) for v in deep["voices"])
             + sum(len(t["label"]) + len(t["text"]) for t in deep["takes"])
             + len(deep["drill"]["question"]) + len(deep["drill"]["reveal"]))
    assert deep["minutes"] == max(1, round(chars / config.READ_CHARS_PER_MIN))
    short_chars = sum(len(item[k]) for item in issue["items"] for k in ("title", "gist", "facts", "why", "watch"))
    short_chars += sum(len(t["text"]) for item in issue["items"] for t in item["takes"])
    assert issue["read_minutes"] == max(1, round(short_chars / config.READ_CHARS_PER_MIN))
    assert set(section for section, _ in deep_calls) == set(prompts.SECTION_ORDER[:4])
    world_deep = next(materials for section, materials in deep_calls if section == "world")
    world_writer = next(materials for section, materials in writer_calls if section == "world")
    assert [m["source"] for m in world_deep] == ["world", "extra1", "extra2"]
    assert world_deep[0]["text"] == "A" * config.DEEP_MATERIAL_CHARS
    assert world_deep[1]["text"] == "P" * config.DEEP_MATERIAL_CHARS
    assert world_writer[0]["text"] == "A" * config.MATERIAL_CHARS
    assert sorted(requests) == sorted([extra[0]["url"], primary[1]["url"], primary[4]["url"], summary["url"]])
    assert "细读 1 / 6 条" in capsys.readouterr().err


def test_deep_runs_after_writer_backfill(tmp_path, monkeypatch, capsys):
    monkeypatch.setenv("BRIEF_FETCH_ARTICLES", "0")
    write_sources(tmp_path)
    records = [record(section, f"{section}unique{i} {section}story{i} {section}event{i}", str(i))
               for section in prompts.SECTION_ORDER for i in range(4)]
    raw(tmp_path, records)
    cache = config.paths(tmp_path).content
    cache.mkdir(parents=True)
    for item in records:
        (cache / f"{item['id']}.txt").write_text("F" * config.DEEP_MIN_FULL_CHARS)
    calls = []
    original = prompts.deep_messages
    def capture(day, section, item, materials):
        calls.append(item["title"])
        return original(day, section, item, materials)
    monkeypatch.setattr(prompts, "deep_messages", capture)
    class DeepStub(Stub):
        def chat_json(self, messages):
            if messages[0]["content"] == prompts.DEEP_SYSTEM:
                return {"background": "前情", "facts": ["一", "二"], "analysis": "分析"}
            return super().chat_json(messages)
    issue = daily.build_daily("2026-11-19", DeepStub(), NOW, root=tmp_path)
    assert len(issue["items"]) == 8
    assert all("deep" in item for item in issue["items"])
    assert sorted(calls) == sorted(item["title"] for item in issue["items"])
    logs = capsys.readouterr().err
    assert "成稿 8 条（补位 1）" in logs and "细读 8 / 8 条" in logs


@pytest.mark.parametrize("output", [
    None, [], {"usable": False, "background": "前情", "analysis": "分析", "facts": ["一", "二"]},
    {"background": " ", "analysis": "分析", "facts": ["一", "二"]},
    {"background": "前情", "analysis": None, "facts": ["一", "二"]},
    {"background": "前情", "analysis": "分析", "facts": ["一", "", None]},
])
def test_invalid_deep_output_is_rejected(output):
    assert daily._deep(output) is None


def test_deep_optional_fields_and_known_drill_kind():
    output = {"background": "前情", "analysis": "分析", "facts": ["一", "二"], "voices": [{}],
              "takes": [{"text": " "}], "drill": {"kind": "反事实", "question": "问题", "reveal": "思路"}}
    result = daily._deep(output)
    assert "voices" not in result and "takes" not in result
    assert result["drill"] == output["drill"]
    output["drill"]["reveal"] = " "
    assert "drill" not in daily._deep(output)
