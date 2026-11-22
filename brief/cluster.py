import math
import re
from collections import Counter, defaultdict
from datetime import datetime, timedelta
from . import config

STOP = set("""a an the and or but if while of at by for with about against between into through during before after above below to from up down in out on off over under again further then once here there when where why how all any both each few more most other some such no nor not only own same so than too very can will just should now is am are was were be been being have has had having do does did doing would could ought i'm you're he's she's it's we're they're i've you've we've they've i'll you'll he'll she'll we'll they'll this that these those what which who whom whose as until because as while although though it its their they them he she his her we our you your i me my us also says said say new report reports according after amid amid amid government president minister officials official news latest world first time year years day days week weeks month months one two three may might must still across over under since amid amid amid reuters update updates""".split())
TOKEN_RE = re.compile(r"[a-z0-9]+(?:['’\-][a-z0-9]+)*|[\u4e00-\u9fff]+")


def tokens(text):
    result = []
    for word in TOKEN_RE.findall((text or "").lower()):
        if "\u4e00" <= word[0] <= "\u9fff":
            result.extend([word[i:i+2] for i in range(len(word)-1)] if len(word) > 1 else [word])
        else:
            word = re.sub(r"['’]s$", "", word)
            if len(word) > 3 and word.endswith("s") and not word.endswith("ss"):
                word = word[:-1]
            if len(word) > 1 and word not in STOP:
                result.append(word)
    return result


def norm(vector):
    length = math.sqrt(sum(value * value for value in vector.values()))
    return {key: value / length for key, value in vector.items()} if length else {}


def cosine(a, b):
    if len(a) > len(b):
        a, b = b, a
    return sum(value * b.get(key, 0) for key, value in a.items())


def clusters(items, sources, now, root=None, hours=None):
    source_map = {s["id"]: s for s in sources}
    window = max(config.CLUSTER_WINDOW_HOURS, hours or config.CLUSTER_WINDOW_HOURS)
    start = now - timedelta(hours=window)
    selected = []
    for item in items:
        source = source_map.get(item.get("source"))
        if not source or source["section"] == "longread":
            continue
        try:
            published = datetime.fromisoformat(item["published"].replace("Z", "+00:00"))
        except (ValueError, KeyError):
            continue
        if start <= published <= now + timedelta(hours=1):
            selected.append((published, item, source))
    selected.sort(key=lambda x: (x[0], x[1]["id"]))
    documents = []
    df = Counter()
    for published, item, source in selected:
        title = tokens(item["title"])
        weights = Counter(tokens(item.get("summary", "")[:240]))
        for token in title: weights[token] += 3
        df.update(weights.keys())
        documents.append((published, item, source, set(title), weights))
    count = len(documents)
    index = defaultdict(set)
    groups = []
    paths = config.paths(root)
    for published, item, source, title, weights in documents:
        vector = norm({t: weight * (math.log((count + 1) / (df[t] + 1)) + 1) for t, weight in weights.items()})
        top = sorted(vector, key=lambda t: (-vector[t], t))[:8]
        candidates = set().union(*(index[t] for t in top))
        best, best_score = None, -1.0
        for idx in sorted(candidates):
            group = groups[idx]
            if published - group["newest_dt"] > timedelta(hours=config.CLUSTER_WINDOW_HOURS):
                continue
            if len(title & group["title_tokens"]) < config.MIN_SHARED_TITLE_TOKENS:
                continue
            similarity = cosine(vector, group["centroid"])
            if similarity > best_score:
                best, best_score = idx, similarity
        if best is None or best_score < config.SIM_THRESHOLD:
            best = len(groups)
            groups.append({"records": [], "sum": Counter(), "centroid": {}, "title_tokens": set(), "newest_dt": published})
        group = groups[best]
        group["records"].append((item, source, vector, published))
        group["sum"].update(vector)
        group["centroid"] = norm(group["sum"])
        group["title_tokens"].update(title)
        group["newest_dt"] = published
        for token in vector:
            index[token].add(best)
    result = []
    for group in groups:
        records = sorted(group["records"], key=lambda r: (
            0 if r[1]["role"] in ("open", "official") else 1,
            0 if (paths.content / f"{r[0]['id']}.txt").exists() else 1,
            -len(r[0].get("summary", "")), -r[3].timestamp(), r[0]["id"]))
        members = [r[0] for r in records]
        outlets = {}
        for _, source, _, _ in records:
            outlets.setdefault(source["name"], source)
        votes = Counter()
        for source in outlets.values():
            votes[source["section"]] += config.ROLE_WEIGHT[source["role"]]
        lead_section = records[0][1]["section"]
        section = min(votes, key=lambda s: (-votes[s], s != lead_section, s))
        recency = max(0, min(1, (group["newest_dt"] - start).total_seconds() / (window * 3600)))
        has_content = any((paths.content / f"{item['id']}.txt").exists() for item in members)
        result.append({"members": members, "lead": members[0], "outlets": list(outlets), "n_sources": len(outlets),
                       "section": section, "newest": group["newest_dt"],
                       "score": sum(config.ROLE_WEIGHT[s["role"]] for s in outlets.values()) + (0.3 if has_content else 0) + 0.5 * recency,
                       "all_analysis": all(s["role"] == "analysis" for s in outlets.values()),
                       "centroid": group["centroid"], "vectors": {r[0]["id"]: r[2] for r in records}})
    return result
