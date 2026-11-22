import json
import os
import re
import threading
import time
from datetime import datetime, timezone
from email.utils import parsedate_to_datetime
import httpx


class LLMError(RuntimeError):
    pass


def extract_json(text):
    text = re.sub(r"<think\b[^>]*>.*?</think\s*>", "", text, flags=re.I | re.S)
    text = re.sub(r"```(?:json)?\s*|```", "", text, flags=re.I).strip()
    try:
        value = json.loads(text)
    except ValueError:
        start, end = text.find("{"), text.rfind("}")
        if start < 0 or end < start:
            raise ValueError("没有 JSON 对象")
        value = json.loads(text[start:end + 1])
    if not isinstance(value, dict):
        raise ValueError("输出不是 JSON 对象")
    return value


class Client:
    def __init__(self, client=None, sleep=time.sleep):
        self.key = os.environ.get("OPENAI_API_KEY", "").strip()
        self.model = os.environ.get("OPENAI_MODEL", "").strip()
        if not self.key: raise LLMError("请设置 OPENAI_API_KEY")
        if not self.model: raise LLMError("请设置 OPENAI_MODEL")
        self.base = os.environ.get("OPENAI_BASE_URL", "https://api.openai.com/v1").rstrip("/")
        try:
            self.extra = json.loads(os.environ.get("OPENAI_EXTRA_BODY", "{}"))
            if not isinstance(self.extra, dict): raise ValueError()
            self.timeout = float(os.environ.get("OPENAI_TIMEOUT", "180"))
        except ValueError as exc:
            raise LLMError("OPENAI_EXTRA_BODY 必须是 JSON 对象，OPENAI_TIMEOUT 必须是数字") from exc
        self.client = client or httpx.Client(timeout=self.timeout)
        self.sleep = sleep
        self.usage = {}
        self.lock = threading.Lock()

    def request(self, messages):
        body = {**self.extra, "model": self.model, "messages": messages}
        for attempt in range(3):
            try:
                response = self.client.post(f"{self.base}/chat/completions", json=body,
                                            headers={"Authorization": f"Bearer {self.key}"}, timeout=self.timeout)
                if response.status_code in (408, 409, 429) or response.status_code >= 500:
                    if attempt < 2:
                        try:
                            retry_after = response.headers["retry-after"]
                            try:
                                delay = float(retry_after)
                            except ValueError:
                                delay = (parsedate_to_datetime(retry_after) - datetime.now(timezone.utc)).total_seconds()
                            delay = max(0, delay) if delay <= 30 else (2, 6)[attempt]
                        except (KeyError, ValueError, TypeError):
                            delay = (2, 6)[attempt]
                        self.sleep(delay)
                        continue
                if response.status_code >= 400:
                    raise LLMError(f"模型请求失败 HTTP {response.status_code}: {response.text.replace(self.key, '[已隐藏]')[:300]}")
                excerpt = response.text.replace(self.key, "[已隐藏]")[:300]
                try:
                    payload = response.json()
                    usage = payload.get("usage")
                    if isinstance(usage, dict):
                        with self.lock:
                            for key, value in usage.items():
                                if isinstance(value, (int, float)):
                                    self.usage[key] = self.usage.get(key, 0) + value
                    content = payload["choices"][0]["message"]["content"]
                except (AttributeError, KeyError, IndexError, ValueError, TypeError) as exc:
                    raise LLMError(f"模型响应无有效内容：{excerpt}") from exc
                if isinstance(content, list):
                    content = "".join(part["text"] for part in content if isinstance(part, dict) and part.get("type") == "text" and isinstance(part.get("text"), str))
                if not isinstance(content, str) or not content.strip():
                    raise LLMError(f"模型响应无有效内容：{excerpt}")
                return content
            except (httpx.RequestError, httpx.TimeoutException) as exc:
                if attempt == 2:
                    raise LLMError(f"模型连接失败：{type(exc).__name__}") from exc
                self.sleep((2, 6)[attempt])
        raise LLMError("模型请求失败")

    def chat_json(self, messages):
        turns = list(messages)
        for attempt in range(2):
            text = self.request(turns)
            try:
                return extract_json(text)
            except ValueError as exc:
                if attempt:
                    raise LLMError("模型两次未返回合法 JSON 对象") from exc
                turns.extend([{"role": "assistant", "content": text[:2000]},
                              {"role": "user", "content": "上一次输出不是合法的 JSON 对象。请只输出一个 JSON 对象，不要代码块和解释。"}])
