from . import config, store


def publish(issue, root=None):
    paths = config.paths(root)
    entry = {"date": issue["date"], "type": issue["type"],
             "count": len(issue["items"] if issue["type"] == "daily" else issue["longreads"])}
    if issue["type"] == "weekly":
        entry["title"] = issue.get("review", {}).get("title") or "周日慢读"
    index = store.read_json(paths.issues / "index.json", {"issues": []})
    entries = [item for item in index.get("issues", []) if item.get("date") != issue["date"]]
    entries.append(entry)
    entries.sort(key=lambda item: item["date"], reverse=True)
    store.write_json(paths.issues / f"{issue['date']}.json", issue)
    store.write_json(paths.issues / "index.json", {"issues": entries})
