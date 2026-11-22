# 项目约定

- `uv sync` 安装；`uv run pytest -q` 运行离线测试。
- 前端测试：`BASE_URL=http://localhost:8765 OUTPUT_DIR=/tmp/daily-brief-shots PLAYWRIGHT_DIR=/tmp/db-e2e node tests/e2e/smoke.mjs`（另行启动 `python3 -m http.server 8765 --directory site`，并在 `/tmp/db-e2e` 安装 playwright-core）。
- `uv run brief preview` 本地预览。
- `site/` 是原生 HTML/CSS/JS，没有构建步骤。模型生成文本不可信，只用 DOM 节点和 `textContent` 渲染。
- `sources.toml`、`brief/prompts.py` 和 `brief/config.py` 的常量是编辑配置，不要随意更改。
- RSS 抓取与模型分析分离；原始 JSONL 只存精简字段，正文缓存和原始数据定期清理，成品长期保留。
