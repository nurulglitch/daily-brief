import json
import pytest
from brief.sources import load_sources


@pytest.mark.parametrize("field", ["id", "name", "url", "section", "role"])
def test_required_fields(tmp_path, field):
    source = {"id": "sample", "name": "Name", "url": "https://example.test/feed", "section": "world", "role": "open"}
    del source[field]
    (tmp_path / "sources.toml").write_text("[[source]]\n" + "\n".join(f"{key} = {json.dumps(value)}" for key, value in source.items()), encoding="utf-8")
    with pytest.raises(ValueError, match=field) as error:
        load_sources(tmp_path)
    assert ("sample" if field != "id" else "未提供 id") in str(error.value)


@pytest.mark.parametrize(("field", "value"), [("section", "unknown"), ("role", "unknown"), ("name", ""), ("url", "")])
def test_invalid_source_fields(tmp_path, field, value):
    source = {"id": "sample", "name": "Name", "url": "https://example.test/feed", "section": "world", "role": "open"}
    source[field] = value
    (tmp_path / "sources.toml").write_text("[[source]]\n" + "\n".join(f"{key} = {json.dumps(value)}" for key, value in source.items()), encoding="utf-8")
    with pytest.raises(ValueError, match=f"sample.*{field}"):
        load_sources(tmp_path)


def test_valid_source_defaults_and_duplicate_id(tmp_path):
    text = '[[source]]\nid = "sample"\nname = "Name"\nurl = "https://example.test/feed"\nsection = "world"\nrole = "open"\n'
    filename = tmp_path / "sources.toml"
    filename.write_text(text, encoding="utf-8")
    assert load_sources(tmp_path)[0]["lang"] == "en"
    filename.write_text(text * 2, encoding="utf-8")
    with pytest.raises(ValueError, match="sample.*id"):
        load_sources(tmp_path)
