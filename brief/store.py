import json
from datetime import date, timedelta
from . import config


def load_raw(root=None):
    records = []
    for file in sorted(config.paths(root).raw.glob("*.jsonl")):
        with file.open(encoding="utf-8") as f:
            for line in f:
                try:
                    record = json.loads(line)
                    if isinstance(record, dict):
                        records.append(record)
                except json.JSONDecodeError:
                    continue
    return records


def read_json(path, default):
    try:
        return json.loads(path.read_text(encoding="utf-8"))
    except (OSError, ValueError):
        return default


def write_json(path, value):
    path.parent.mkdir(parents=True, exist_ok=True)
    temp = path.with_name(path.name + ".tmp")
    temp.write_text(json.dumps(value, ensure_ascii=False, indent=1) + "\n", encoding="utf-8")
    temp.replace(path)


def prune(now, root=None):
    paths = config.paths(root)
    cutoff = now.astimezone(config.timezone()).date() - timedelta(days=config.RAW_RETENTION_DAYS)
    raw_deleted = cache_deleted = 0
    for file in paths.raw.glob("*.jsonl"):
        try:
            if date.fromisoformat(file.stem) < cutoff:
                file.unlink()
                raw_deleted += 1
        except ValueError:
            continue
    for file in paths.content.glob("*.txt"):
        if file.stat().st_mtime < (now - timedelta(days=config.CONTENT_CACHE_DAYS)).timestamp():
            file.unlink()
            cache_deleted += 1
    return raw_deleted, cache_deleted
