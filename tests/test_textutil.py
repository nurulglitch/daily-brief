from datetime import datetime, timezone
from brief.textutil import canonical_url, html_to_text, item_id, parse_date, title_key


def test_canonical_and_ids():
    a = "HTTPS://Example.COM/path/?utm_source=x&b=2&a=1&ref=z#hi"
    b = "https://example.com/path?a=1&b=2"
    assert canonical_url(a) == b
    assert item_id(a) == item_id(b)
    assert canonical_url("https://EXAMPLE.com/?CMP=x") == "https://example.com/"
    assert title_key("one", "Hello, 世界!") == title_key("one", "hello 世界")
    assert title_key("two", "Hello 世界") != title_key("one", "Hello 世界")


def test_html_and_dates():
    assert html_to_text("<p>A &amp; B</p><style>x</style><script>bad</script><p>你好</p>") == "A & B 你好"
    assert parse_date({"published": "Tue, 11/17/2026 - 16:49"}) == datetime(2026, 11, 17, 16, 49, tzinfo=timezone.utc)
    assert parse_date({"updated": "2026-11-17T18:49:00+02:00"}) == datetime(2026, 11, 17, 16, 49, tzinfo=timezone.utc)
    assert parse_date({"published_parsed": (2026, 11, 17, 16, 49, 0, 1, 321, 0)}) == datetime(2026, 11, 17, 16, 49, tzinfo=timezone.utc)
    assert parse_date({"published": "bad"}) is None
