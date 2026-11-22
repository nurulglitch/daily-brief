import argparse
import os
import sys
import webbrowser
from datetime import date, datetime, timedelta
from functools import partial
from http.server import SimpleHTTPRequestHandler, ThreadingHTTPServer
from . import cluster, config, daily, fetch, llm, sources, store, weekly


def preview_url(host, port, root=None):
    query = "" if (config.paths(root).issues / "index.json").exists() else "?mock=1"
    display = "127.0.0.1" if host in ("0.0.0.0", "::") else host
    if ":" in display: display = f"[{display}]"
    return f"http://{display}:{port}/{query}"


def main(argv=None):
    config.load_env()
    parser = argparse.ArgumentParser(prog="brief", description="每日简报")
    sub = parser.add_subparsers(dest="command", required=True)
    f = sub.add_parser("fetch", help="抓取信源")
    f.add_argument("--full", action="store_true")
    for name in ("build", "run"):
        p = sub.add_parser(name)
        p.add_argument("--date", type=date.fromisoformat)
        p.add_argument("--force", action="store_true")
    sub.add_parser("check-sources")
    c = sub.add_parser("clusters")
    c.add_argument("--hours", type=int, default=config.WINDOW_HOURS)
    c.add_argument("--section")
    c.add_argument("--min-size", type=int, default=2)
    c.add_argument("--limit", type=int, default=40)
    p = sub.add_parser("preview")
    p.add_argument("--port", type=int, default=8000)
    p.add_argument("--host", default="127.0.0.1")
    p.add_argument("--open", action="store_true")
    sub.add_parser("prune")
    args = parser.parse_args(argv)
    now = datetime.now(config.timezone())
    try:
        if args.command == "preview":
            url = preview_url(args.host, args.port)
            print(f"预览：{url}", file=sys.stderr, flush=True)
            if args.open: webbrowser.open(url)
            handler = partial(SimpleHTTPRequestHandler, directory=str(config.paths().site))
            with ThreadingHTTPServer((args.host, args.port), handler) as server:
                server.serve_forever()
        elif args.command == "prune":
            raw, cache = store.prune(now)
            print(f"清理：{raw} 份原始文件，{cache} 份缓存。", file=sys.stderr)
        elif args.command == "check-sources":
            rows = fetch.check_sources(sources.load_sources(), now)
            print("信源\t状态\t条目\t最新距今(天)\t结果")
            for key, status, count, age, flag in rows:
                print(f"{key}\t{status}\t{count}\t{age:.1f}\t{flag}" if age is not None else f"{key}\t{status}\t{count}\t-\t{flag}")
        elif args.command == "clusters":
            source_list = sources.load_sources()
            source_map = {s["id"]: s for s in source_list}
            groups = cluster.clusters(store.load_raw(), source_list, now, hours=args.hours)
            groups = [g for g in groups if g["newest"] >= now - timedelta(hours=args.hours) and g["n_sources"] >= args.min_size and (not args.section or g["section"] == args.section)]
            for group in sorted(groups, key=lambda g: -g["score"])[:args.limit]:
                print(f"{group['n_sources']} / {group['section']} / {group['score']:.2f}")
                for member in group["members"]:
                    similarity = cluster.cosine(group["vectors"][member["id"]], group["centroid"])
                    print(f"  [{source_map[member['source']]['name']}] {member['title']} (cos={similarity:.2f})")
        else:
            if args.command in ("fetch", "run"):
                fetch.fetch_all(sources.load_sources(), now, conditional=args.command == "fetch" and not args.full)
            if args.command in ("build", "run"):
                client = llm.Client()
                day = args.date or now.date()
                builder = weekly.build_weekly if day.weekday() == 6 else daily.build_daily
                try:
                    issue = builder(day, client, now, args.force)
                    if issue: print(f"已发布 {day}。", file=sys.stderr)
                finally:
                    print("模型用量：" + (", ".join(f"{k}={v}" for k, v in client.usage.items()) or "无"), file=sys.stderr)
    except KeyboardInterrupt:
        return 0
    except Exception as exc:
        print(f"错误：{exc}", file=sys.stderr)
        return 1
    return 0


if __name__ == "__main__":
    sys.exit(main())
