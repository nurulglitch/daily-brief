import json
import httpx
import pytest
from brief.llm import Client, LLMError, extract_json


def test_extract():
    assert extract_json('<think>bad</think>```json\n{"a":1}\n```') == {"a": 1}
    assert extract_json('prefix {"a":2} suffix') == {"a": 2}
    with pytest.raises(ValueError): extract_json("[1,2]")


def test_retry_json_and_http(monkeypatch):
    monkeypatch.setenv("OPENAI_API_KEY", "secret")
    monkeypatch.setenv("OPENAI_MODEL", "model")
    monkeypatch.setenv("OPENAI_EXTRA_BODY", '{"extra":1}')
    calls = []
    responses = [httpx.Response(500), httpx.Response(200, json={"choices": [{"message": {"content": "bad"}}], "usage": {"total_tokens": 3}}),
                 httpx.Response(200, json={"choices": [{"message": {"content": [{"type": "text", "text": '{"ok":true}'}]}}], "usage": {"total_tokens": 4}})]
    def handler(request):
        calls.append(json.loads(request.content))
        return responses.pop(0)
    waits = []
    with httpx.Client(transport=httpx.MockTransport(handler)) as http:
        client = Client(http, sleep=waits.append)
        assert client.chat_json([{"role": "user", "content": "x"}]) == {"ok": True}
    assert set(calls[0]) == {"model", "messages", "extra"} and waits == [2]
    assert len(calls[-1]["messages"]) == 3 and client.usage["total_tokens"] == 7


def test_two_bad_outputs(monkeypatch):
    monkeypatch.setenv("OPENAI_API_KEY", "secret"); monkeypatch.setenv("OPENAI_MODEL", "model")
    with httpx.Client(transport=httpx.MockTransport(lambda r: httpx.Response(200, json={"choices": [{"message": {"content": "bad"}}]}))) as http:
        with pytest.raises(LLMError, match="两次"):
            Client(http).chat_json([])


@pytest.mark.parametrize("payload", [
    {"error": {"message": "proxy error with secret"}},
    {"choices": []},
    {"choices": [{"message": {"content": ""}}]},
    {"choices": [{"message": {"content": [{"type": "text", "text": ""}]}}]},
])
def test_invalid_success_body_is_reported_and_key_redacted(monkeypatch, payload):
    monkeypatch.setenv("OPENAI_API_KEY", "secret"); monkeypatch.setenv("OPENAI_MODEL", "model")
    with httpx.Client(transport=httpx.MockTransport(lambda r: httpx.Response(200, json=payload))) as http:
        with pytest.raises(LLMError) as error:
            Client(http).chat_json([])
    message = str(error.value)
    assert "模型响应无有效内容" in message
    assert "secret" not in message
    assert httpx.Response(200, json=payload).text.replace("secret", "[已隐藏]")[:300] in message
