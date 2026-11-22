import time
from datetime import datetime, timezone
from brief import cluster, config

NOW = datetime(2026, 11, 19, tzinfo=timezone.utc)
SOURCES = [{"id": "a", "name": "Same", "role": "open", "section": "world"},
           {"id": "b", "name": "Same", "role": "official", "section": "macro"},
           {"id": "c", "name": "Third", "role": "official", "section": "macro"},
           {"id": "d", "name": "Fourth", "role": "open", "section": "macro"}]


def record(id_, source, title, summary=""):
    return {"id": id_, "source": source, "title": title, "summary": summary, "url": f"https://x/{id_}", "published": "2026-11-18T23:00:00Z"}


def test_cluster_votes_distinct_outlets_and_threshold(tmp_path, monkeypatch):
    items = [record("a", "a", "Indonesia nickel mining quota reduced", "Indonesia nickel mining quota reduced"),
             record("b", "b", "Indonesia nickel mining quota reduced", "Indonesia nickel mining quota reduced"),
             record("c", "c", "Indonesia cuts nickel mining quota", "Indonesia nickel mining quota reduced"),
             record("d", "d", "Indonesia nickel mining quota reduced", "Indonesia nickel mining quota reduced"),
             record("e", "a", "Indonesia volcano eruption evacuates villages", "Volcano eruption emergency response")]
    groups = cluster.clusters(items, SOURCES, NOW, tmp_path)
    group = next(g for g in groups if g["n_sources"] == 3)
    assert len(group["members"]) == 4 and group["section"] == "macro"
    assert len(groups) == 2
    monkeypatch.setattr(config, "SIM_THRESHOLD", 1.1)
    assert len(cluster.clusters(items, SOURCES, NOW, tmp_path)) == 5


def test_1500_items_performance(tmp_path):
    items = [record(str(i), "a", f"Subject{i} unique{i} development{i}", f"detail{i} event{i}") for i in range(1500)]
    start = time.monotonic()
    assert len(cluster.clusters(items, SOURCES, NOW, tmp_path)) == 1500
    assert time.monotonic() - start < 10
