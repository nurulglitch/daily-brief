import os
from datetime import datetime, timedelta, timezone
import httpx
import pytest
from brief import config, fetch, store

NOW = datetime(2026, 11, 19, 12, tzinfo=timezone.utc)
RSS = """<?xml version="1.0"?><rss version="2.0" xmlns:content="http://purl.org/rss/1.0/modules/content/"><channel><title>T</title><link>https://x.test</link><description>T</description>
<item><title>News One</title><link>https://x.test/a?utm_source=x</link><pubDate>Thu, 19 Nov 2026 10:00:00 GMT</pubDate><description><![CDATA[<p>{summary}</p><script>bad</script>]]></description><content:encoded><![CDATA[<p>{content}</p>]]></content:encoded></item>
<item><title>News One!</title><link>https://x.test/new</link><pubDate>Thu, 19 Nov 2026 10:00:00 GMT</pubDate></item>
<item><title>Old</title><link>https://x.test/old</link><pubDate>Thu, 01 Oct 2026 10:00:00 GMT</pubDate></item>
<item><title>Undated</title><link>https://x.test/undated</link></item></channel></rss>""".format(summary="s" * 500, content="c" * 1000)
ATOM = """<feed xmlns="http://www.w3.org/2005/Atom"><title>A</title><id>https://x.test/</id><updated>2026-11-19T12:00:00Z</updated><entry><title>Other title</title><id>x</id><link href="https://x.test/a?gclid=z"/><updated>2026-11-19T10:00:00Z</updated><summary>Atom summary</summary></entry></feed>"""
SOURCES = [{"id": "rss", "name": "RSS", "url": "https://x.test/rss", "section": "world", "role": "open"},
           {"id": "atom", "name": "Atom", "url": "https://x.test/atom", "section": "world", "role": "open"},
           {"id": "bad", "name": "Bad", "url": "https://x.test/bad", "section": "world", "role": "open"}]


def test_fetch_dedup_state_content_and_conditional(tmp_path):
    headers = []
    def handler(request):
        headers.append(request.headers)
        if request.url.path == "/bad": return httpx.Response(503)
        if request.headers.get("if-none-match") == '"abc"': return httpx.Response(304)
        if request.url.path == "/atom": return httpx.Response(200, text=ATOM, headers={"ETag": '"abc"'})
        return httpx.Response(200, text=RSS, headers={"ETag": '"abc"', "Last-Modified": "Thu, 19 Nov 2026 11:00:00 GMT"})
    with httpx.Client(transport=httpx.MockTransport(handler)) as client:
        result = fetch.fetch_all(SOURCES, NOW, root=tmp_path, client=client)
        records = store.load_raw(tmp_path)
        assert result["new"] == 1 and len(result["failed"]) == 1
        assert set(records[0]) == {"id", "source", "title", "url", "published", "fetched", "summary"}
        assert records[0]["url"] == "https://x.test/a"
        assert records[0]["summary"] == "s" * config.SUMMARY_MAX
        assert (config.paths(tmp_path).content / f"{records[0]['id']}.txt").read_text() == "c" * 1000
        state = store.read_json(config.paths(tmp_path).state, {})
        assert state["rss"]["undated"] == 1 and state["bad"]["fail_streak"] == 1
        result = fetch.fetch_all(SOURCES, NOW, root=tmp_path, client=client)
        assert result["new"] == 0 and result["unchanged"] == 2
        assert any(h.get("if-modified-since") for h in headers)
        assert any(h.get("if-none-match") == '"abc"' for h in headers)


def test_prune_never_touches_issues(tmp_path):
    paths = config.paths(tmp_path)
    paths.raw.mkdir(parents=True); paths.content.mkdir(parents=True); paths.issues.mkdir(parents=True)
    (paths.raw / "2026-10-01.jsonl").write_text("")
    (paths.raw / "2026-11-19.jsonl").write_text("")
    old = paths.content / "old.txt"; old.write_text("a")
    recent = paths.content / "recent.txt"; recent.write_text("a")
    os.utime(old, ((NOW - timedelta(days=22)).timestamp(),) * 2)
    os.utime(recent, (NOW.timestamp(),) * 2)
    issue = paths.issues / "2020-01-01.json"; issue.write_text("{}")
    assert store.prune(NOW, tmp_path) == (1, 1)
    assert issue.exists() and recent.exists() and (paths.raw / "2026-11-19.jsonl").exists()


def test_transport_error_retries_once():
    calls = []
    def handler(request):
        calls.append(request)
        if len(calls) == 1:
            raise httpx.RemoteProtocolError("Server disconnected", request=request)
        return httpx.Response(200, text=ATOM)
    with httpx.Client(transport=httpx.MockTransport(handler)) as client:
        response, feed = fetch.request_feed(client, SOURCES[0], {"etag": '"abc"'})
    assert response.status_code == 200 and len(feed.entries) == 1
    assert len(calls) == 2 and all(request.headers["if-none-match"] == '"abc"' for request in calls)


def test_transport_error_stops_after_two_attempts():
    calls = []
    def handler(request):
        calls.append(request)
        raise httpx.RemoteProtocolError("Server disconnected", request=request)
    with httpx.Client(transport=httpx.MockTransport(handler)) as client:
        with pytest.raises(httpx.RemoteProtocolError):
            fetch.request_feed(client, SOURCES[0])
    assert len(calls) == 2
