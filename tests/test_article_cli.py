from datetime import date, datetime, timedelta, timezone
import httpx
from brief import article, cli, config


def test_article_robots_and_extraction(monkeypatch):
    monkeypatch.delenv("BRIEF_FETCH_ARTICLES", raising=False)
    calls = []
    def handler(request):
        assert "cookie" not in request.headers
        calls.append(request.url.path)
        if request.url.path == "/robots.txt": return httpx.Response(200, text="User-agent: *\nDisallow: /blocked", headers={"Set-Cookie": "track=1"})
        if request.url.path == "/redirect": return httpx.Response(302, headers={"Location": "/article", "Set-Cookie": "other=2"})
        return httpx.Response(200, headers={"content-type": "text/html"}, text="<nav><p>ignored</p></nav><article><p>" + "body " * 400 + "</p></article>")
    with httpx.Client(transport=httpx.MockTransport(handler), cookies={"existing": "value"}) as client:
        robots = {}
        assert article.fetch_article_text("https://x.test/blocked", client, robots) is None
        result = article.fetch_article_text("https://x.test/article", client, robots)
        assert result.startswith("body") and "ignored" not in result
        assert article.fetch_article_text("https://x.test/redirect", client, robots).startswith("body")
        assert calls.count("/robots.txt") == 1


def test_unclosed_paragraphs_are_flushed():
    parser = article.Paragraphs()
    parser.feed("<article><p>第一段 <b>加粗<p>第二段<p>第三段</article><nav><p>忽略</p></nav><p>末尾")
    parser.close()
    assert parser.article == ["第一段 加粗", "第二段", "第三段"]
    assert parser.all == ["第一段 加粗", "第二段", "第三段", "末尾"]


def test_preview_url(tmp_path):
    assert cli.preview_url("127.0.0.1", 8011, tmp_path).endswith("/?mock=1")
    config.paths(tmp_path).issues.mkdir(parents=True)
    (config.paths(tmp_path).issues / "index.json").write_text("{}")
    assert cli.preview_url("127.0.0.1", 8011, tmp_path).endswith("/")


def test_sunday_dispatch(tmp_path, monkeypatch):
    monkeypatch.setenv("BRIEF_HOME", str(tmp_path))
    class Dummy:
        usage = {}
    monkeypatch.setattr(cli.llm, "Client", Dummy)
    called = []
    monkeypatch.setattr(cli.weekly, "build_weekly", lambda *args: called.append(args) or None)
    assert cli.main(["build", "--date", "2026-11-15"]) == 0
    assert called[0][0] == date(2026, 11, 15)


def test_cluster_command_window(monkeypatch, capsys):
    source = {"id": "a", "name": "A"}
    now = datetime.now(timezone.utc)
    def group(title, hours):
        return {"newest": now - timedelta(hours=hours), "n_sources": 2, "section": "world", "score": 2,
                "members": [{"source": "a", "id": title, "title": title}],
                "vectors": {title: {"x": 1}}, "centroid": {"x": 1}}
    monkeypatch.setattr(cli.sources, "load_sources", lambda: [source])
    monkeypatch.setattr(cli.store, "load_raw", lambda: [])
    monkeypatch.setattr(cli.cluster, "clusters", lambda *a, **kw: [group("recent", 1), group("old", 30)])
    assert cli.main(["clusters", "--hours", "26"]) == 0
    output = capsys.readouterr().out
    assert "recent" in output and "old" not in output
