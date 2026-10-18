#!/usr/bin/env python3
# -*- coding: utf-8 -*-
"""把 OldmanEmu 风格的 NDS 压缩包「解压拍平 + 重新压成 zip」。

这类合集只放压缩包，而且：

* 有的包内部是 ``<名字>/<名字>.nds``（还带 readme.txt）→ 必须拍平，只取 .nds
* 有的包加了密码（OldmanEmu 常用 ``oldmanemu.net``）
* 有的是 .rar

所以流程是：``7z e``（平铺解压，自动丢掉外层目录）→ 取最大的 .nds →
``7z a -tzip`` 重新压成 zip。不会留下未压缩的 .nds。

输出 ``<out>/<源包名>.zip``；同名文件已存在则跳过，可随时重跑续做。

依赖 7-Zip（``7z`` 在 PATH 里，或用 ``--seven`` 指定）。

用法::

    python scripts/media/extract-nds-archives.py \
        --src "F:/EDownload/NDS中文游戏全集(OldmanEmu.net)" \
        --out "G:/EmberHub/NDS-OldmanEmu"
"""

import argparse
import json
import os
import re
import shutil
import subprocess
import sys
import tempfile
import time

try:
    sys.stdout.reconfigure(encoding="utf-8")
except Exception:
    pass

ARCHIVE_EXTS = (".7z", ".rar", ".zip")


def run(seven, args):
    return subprocess.run([seven] + args, capture_output=True)


def entries_of(seven, archive, password=None):
    """列出包内条目 [(path, size, is_dir)]；读不了返回 None。"""
    cmd = ["l", "-slt"]
    if password:
        cmd.append("-p" + password)
    cmd.append(archive)
    r = run(seven, cmd)
    txt = r.stdout.decode("utf-8", "replace") + r.stderr.decode("utf-8", "replace")
    if r.returncode != 0 or "Path = " not in txt:
        return None
    out = []
    for blk in re.split(r"\n\s*\n", txt):
        m = re.search(r"^Path = (.+)$", blk, re.M)
        if not m:
            continue
        ms = re.search(r"^Size = (\d+)", blk, re.M)
        ma = re.search(r"^Attributes = (\S+)", blk, re.M)
        out.append((m.group(1).strip(), int(ms.group(1)) if ms else 0,
                    "D" in (ma.group(1) if ma else "")))
    return out


def pick_nds(entries):
    nds = [(p, s) for p, s, d in entries if not d and p.lower().endswith(".nds")]
    if not nds:
        return None, 0
    nds.sort(key=lambda x: -x[1])
    return nds[0][0], len(nds)


def convert_one(seven, src_dir, out_dir, archive, password):
    stem = os.path.splitext(archive)[0]
    dest = os.path.join(out_dir, stem + ".zip")
    if os.path.isfile(dest):
        return {"archive": archive, "status": "skip-exists"}
    path = os.path.join(src_dir, archive)

    ent = entries_of(seven, path)
    used_pwd = None
    if ent is None:
        ent = entries_of(seven, path, password)
        used_pwd = password
    if ent is None:
        return {"archive": archive, "status": "unreadable"}
    nds, nds_count = pick_nds(ent)
    if not nds:
        return {"archive": archive, "status": "no-nds", "entries": len(ent)}
    wrapped = ("\\" in nds or "/" in nds)

    work = tempfile.mkdtemp(prefix="ndsx_")
    try:
        args = ["e", "-y", "-o" + work]
        if used_pwd:
            args.append("-p" + password)
        args.append(path)
        r = run(seven, args)
        if r.returncode != 0 and not used_pwd:          # 可能是加密包
            r = run(seven, ["e", "-y", "-p" + password, "-o" + work, path])
            used_pwd = password
        if r.returncode != 0:
            return {"archive": archive, "status": "extract-fail",
                    "err": r.stderr.decode("utf-8", "replace")[-200:]}
        cands = [f for f in os.listdir(work) if f.lower().endswith(".nds")]
        if not cands:
            return {"archive": archive, "status": "empty"}
        cands.sort(key=lambda f: -os.path.getsize(os.path.join(work, f)))
        raw = os.path.join(work, cands[0])
        r2 = run(seven, ["a", "-tzip", "-mx=5", "-mmt=on", "-y", dest, raw])
        if r2.returncode != 0 or not os.path.isfile(dest):
            return {"archive": archive, "status": "zip-fail",
                    "err": r2.stderr.decode("utf-8", "replace")[-200:]}
        return {"archive": archive, "status": "ok", "nds": os.path.getsize(raw),
                "zip": os.path.getsize(dest), "pwd": bool(used_pwd),
                "wrapped": wrapped, "nds_count": nds_count}
    finally:
        shutil.rmtree(work, ignore_errors=True)


def main():
    ap = argparse.ArgumentParser(description="NDS 压缩包拍平解压并重压成 zip")
    ap.add_argument("--src", required=True, help="压缩包目录")
    ap.add_argument("--out", required=True, help="输出目录（存重压后的 zip）")
    ap.add_argument("--password", default="oldmanemu.net", help="加密包的密码")
    ap.add_argument("--seven", default="7z", help="7-Zip 可执行文件（默认取 PATH 里的 7z）")
    ap.add_argument("--limit", type=int, default=0, help="只处理前 N 个（调试用）")
    ap.add_argument("--only", default="", help="只处理文件名包含该串的（调试用）")
    args = ap.parse_args()

    os.makedirs(args.out, exist_ok=True)
    files = sorted(f for f in os.listdir(args.src)
                   if f.lower().endswith(ARCHIVE_EXTS))
    if args.only:
        files = [f for f in files if args.only in f]
    if args.limit:
        files = files[:args.limit]
    if not files:
        sys.exit("源目录里没有压缩包: " + args.src)

    t0 = time.time()
    stats = []
    for i, f in enumerate(files, 1):
        r = convert_one(args.seven, args.src, args.out, f, args.password)
        stats.append(r)
        if i % 20 == 0 or i == len(files):
            print("[%d/%d] %.0fs  %s" % (i, len(files), time.time() - t0,
                                          r.get("status", "")) +
                  ("  " + r["archive"][:50] if r.get("status") not in ("ok", "skip-exists") else ""),
                  flush=True)

    from collections import Counter
    c = Counter(x["status"] for x in stats)
    ok = [x for x in stats if x["status"] == "ok"]
    print("完成: %s | 耗时 %.1f 分钟" % (dict(c), (time.time() - t0) / 60))
    if ok:
        print("  .nds %.1f GB -> .zip %.1f GB（压缩率 %.0f%%）"
              % (sum(x["nds"] for x in ok) / 1073741824,
                 sum(x["zip"] for x in ok) / 1073741824,
                 100 * sum(x["zip"] for x in ok) / sum(x["nds"] for x in ok)))
        print("  加密包 %d 个，套文件夹 %d 个" % (sum(1 for x in ok if x.get("pwd")),
                                              sum(1 for x in ok if x.get("wrapped"))))

    repo_root = os.path.abspath(os.path.join(os.path.dirname(__file__), "..", ".."))
    rp = os.path.join(repo_root, "data", "reports",
                      "nds-extract-%s.json" % time.strftime("%Y%m%d-%H%M%S"))
    os.makedirs(os.path.dirname(rp), exist_ok=True)
    with open(rp, "w", encoding="utf-8") as fh:
        json.dump(stats, fh, ensure_ascii=False, indent=1)
    print("报告:", rp)


if __name__ == "__main__":
    main()
