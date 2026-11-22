import os
from dataclasses import dataclass
from pathlib import Path
from zoneinfo import ZoneInfo

ROOT = Path(os.environ.get("BRIEF_HOME", Path(__file__).resolve().parent.parent))
DATA = ROOT / "data"
RAW = DATA / "raw"
STATE = DATA / "state" / "sources.json"
CACHE = ROOT / ".cache"
CONTENT_CACHE = CACHE / "content"
SITE = ROOT / "site"
ISSUES = SITE / "data"
TZ = os.environ.get("BRIEF_TZ", "Asia/Shanghai")

UA = "Mozilla/5.0 (compatible; daily-brief/1.0; RSS reader)"
RAW_RETENTION_DAYS = 21
CONTENT_CACHE_DAYS = 21
SUMMARY_MAX = 400
CONTENT_MAX = 8000
LONGREAD_CONTENT_MAX = 40000
MAX_AGE_DAYS = {"open": 3, "signal": 3, "official": 5, "analysis": 7}
LONGREAD_MAX_AGE_DAYS = 21
WINDOW_HOURS = 26
WINDOW_HOURS_MONDAY = 50
CLUSTER_WINDOW_HOURS = 48
SIM_THRESHOLD = 0.30
MIN_SHARED_TITLE_TOKENS = 2
ROLE_WEIGHT = {"open": 1.0, "signal": 1.0, "official": 1.5, "analysis": 0.5}
SHORTLIST_POOL = 45
PAST_DAYS = 7
MIN_ITEMS = 8
MAX_ITEMS = 10
MAX_PER_SECTION = 2
FILL_MIN_SCORE = 6
MIN_PUBLISH_ITEMS = 3
MATERIALS_PER_ITEM = 4
MATERIAL_CHARS = 3500
PAGES_PER_ITEM = 2
ARTICLE_MIN_CHARS = 1500
LONGREAD_WINDOW_DAYS = 14
LONGREAD_MIN_CHARS = 6000
LONGREAD_GUIDE_CHARS = 24000
LONGREAD_MAX = 2
LONGREAD_RECENT_WEEKS = 8
READ_CHARS_PER_MIN = 450
READ_WORDS_PER_MIN = 200
DEEP_MATERIALS = 3
DEEP_MATERIAL_CHARS = 5000
DEEP_MIN_FULL_CHARS = 1500
DEEP_FACTS_MIN = 2
DEEP_FACTS_MAX = 6
DEEP_VOICES_MAX = 4


@dataclass(frozen=True)
class Paths:
    root: Path

    @property
    def data(self): return self.root / "data"
    @property
    def raw(self): return self.data / "raw"
    @property
    def state(self): return self.data / "state" / "sources.json"
    @property
    def content(self): return self.root / ".cache" / "content"
    @property
    def site(self): return self.root / "site"
    @property
    def issues(self): return self.site / "data"
    @property
    def sources(self): return self.root / "sources.toml"


def paths(root=None):
    return Paths(Path(root) if root is not None else Path(os.environ.get("BRIEF_HOME", ROOT)))


def timezone():
    return ZoneInfo(os.environ.get("BRIEF_TZ", TZ))


def load_env(root=None):
    filename = paths(root).root / ".env"
    if not filename.exists():
        return
    for line in filename.read_text(encoding="utf-8").splitlines():
        line = line.strip()
        if not line or line.startswith("#") or "=" not in line:
            continue
        key, value = line.split("=", 1)
        key, value = key.strip(), value.strip()
        if not key or not key.replace("_", "a").isalnum() or key[0].isdigit():
            continue
        if len(value) >= 2 and value[0] == value[-1] and value[0] in "\"'":
            value = value[1:-1]
        else:
            value = value.split(" #", 1)[0].rstrip()
        os.environ.setdefault(key, value)
