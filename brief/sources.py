import tomllib
from . import config


def load_sources(root=None):
    with config.paths(root).sources.open("rb") as f:
        sources = tomllib.load(f)["source"]
    seen = set()
    for source in sources:
        source_id = source.get("id") or "（未提供 id）"
        for field in ("id", "name", "url", "section", "role"):
            if not isinstance(source.get(field), str) or not source[field].strip():
                raise ValueError(f"信源 {source_id} 的字段 {field} 缺失或无效")
        if source["section"] not in {"world", "security", "macro", "tech", "bio", "longread"}:
            raise ValueError(f"信源 {source_id} 的字段 section 无效")
        if source["role"] not in {"open", "signal", "official", "analysis"}:
            raise ValueError(f"信源 {source_id} 的字段 role 无效")
        if source["id"] in seen:
            raise ValueError(f"信源 {source_id} 的字段 id 重复")
        seen.add(source["id"])
        source.setdefault("lang", "en")
    return sources
