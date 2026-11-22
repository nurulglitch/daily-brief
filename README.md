# 简报

RSS 驱动的个人日报与周日慢读。抓取、去重和模型写作分开，成品是静态 JSON，网页没有构建步骤。

## 先看效果

安装 [uv](https://docs.astral.sh/uv/)，然后：

```sh
uv sync
uv run brief preview --open
```

没有成品时会显示示例。关闭预览按 Ctrl-C。

手机预览：运行 `uv run brief preview --host 0.0.0.0`，在同一局域网的手机打开 `http://<Mac 的局域网 IP>:8000/?mock=1`。离线缓存仅在 HTTPS 下可用，部署后才会生效。

预览主题和外观可使用 `?theme=espresso|broadsheet|terminal|today|signal|paper|pure&appearance=light|dark`，各参数选择一个值，例如 `?mock=1&theme=signal&appearance=dark`。

## 接入模型

把 `.env.example` 复制为 `.env`，填入 OpenAI 兼容接口地址、密钥和模型名，然后运行 `uv run brief run`。`brief fetch` 单独抓取；`brief build` 只生成。`brief build --date 2026-11-19 --force` 可重做指定日期（抓取窗口仍以当前时间为准）。周日生成慢读。

## GitHub 部署

1. 新建公开仓库，在 Settings → Pages → Source 选择 GitHub Actions，然后将项目推送到 `main`；也可在首次推送后立即设置。
2. 在 Settings → Secrets and variables → Actions 加入 `OPENAI_BASE_URL`、`OPENAI_API_KEY`、`OPENAI_MODEL` 三个 secrets。
3. 在 Actions 中手动运行一次「简报」工作流。之后定时抓取、生成并部署。
4. 若首次部署因 Pages 尚未启用而失败，先启用 Pages，再重新运行工作流。
5. 在 iPhone Safari 打开 Pages 地址，分享 → 添加到主屏幕。

## Docker 单机

Docker 在本环境未安装，以下方案未经实机测试。先创建主机目录 `data`、`site/data`，再构建：

```sh
docker build -t daily-brief .
docker run --rm --env-file .env -v "$PWD/data:/app/data" -v "$PWD/site/data:/app/site/data" daily-brief
```

用主机 cron 定时（以下时间取决于主机时区；例如时区为 Asia/Shanghai）：

```cron
40 5 * * * cd /path/to/daily-brief && docker run --rm --env-file .env -v "$PWD/data:/app/data" -v "$PWD/site/data:/app/site/data" daily-brief run
10 9,13,17,21,1 * * * cd /path/to/daily-brief && docker run --rm --env-file .env -v "$PWD/data:/app/data" -v "$PWD/site/data:/app/site/data" daily-brief fetch
```

用任何静态服务器托管主机 `site/`。如果希望缓存文章正文跨容器运行保留，也可挂载 `.cache`。

## 调口味

信源在 `sources.toml`，提示词在 `brief/prompts.py`，阈值和窗口在 `brief/config.py`。`uv run brief check-sources` 查看信源健康；聚类阈值按一天的真实数据校准，可用 `uv run brief clusters` 重新检查。

`BRIEF_READER_PROFILE` 可填写读者画像，帮助模型提出更贴近读者的问题。

细读的深度与阈值由 `brief/config.py` 中的 `DEEP_*` 常量和 `brief/prompts.py` 中的 `DEEP_SYSTEM` 调整。

正文补抓默认开启：终选后，每条最多从开放或官方信源抓取两个页面，并遵守 robots.txt；设置 `BRIEF_FETCH_ARTICLES=0` 可关闭。

原始 JSONL 只保存标题、链接、摘要等精简字段；正文仅在本地缓存。原始记录和正文缓存自动清理 21 天以前的内容。GitHub 工作流把原始数据放在每次重建的单提交 `data` 孤儿分支，只有 `site/data` 的成品长期保留在主分支。
