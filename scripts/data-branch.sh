#!/usr/bin/env bash
set -euo pipefail

remote="${DATA_REMOTE:-}"
if [[ -z "$remote" ]]; then remote="$(git remote get-url origin)"; fi
tmp="$(mktemp -d)"
trap 'rm -rf "$tmp"' EXIT

case "${1:-}" in
  restore)
    refs="$(git ls-remote --heads "$remote" refs/heads/data)"
    if [[ -z "$refs" ]]; then
      echo "数据分支不存在，跳过恢复。"
      exit 0
    fi
    git clone --quiet --depth=1 --single-branch --branch data "$remote" "$tmp/repo"
    mkdir -p data
    tar -C "$tmp/repo" --exclude=.git -cf - . | tar -C data -xf -
    echo "已恢复数据。"
    ;;
  save)
    if [[ ! -d data ]] || [[ -z "$(find data -mindepth 1 -type f -print -quit)" ]]; then
      echo "数据目录为空，拒绝保存。" >&2
      exit 1
    fi
    mkdir "$tmp/repo"
    cp -R data/. "$tmp/repo/"
    git -C "$tmp/repo" init -q -b data
    git -C "$tmp/repo" add -f -A
    git -C "$tmp/repo" -c user.name=daily-brief-bot -c user.email=daily-brief-bot@users.noreply.github.com commit -q -m "更新原始数据"
    git -C "$tmp/repo" push --force "$remote" data
    echo "已保存数据。"
    ;;
  *)
    echo "用法：data-branch.sh restore|save" >&2
    exit 2
    ;;
esac
