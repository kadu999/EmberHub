#!/usr/bin/env python3
# -*- coding: utf-8 -*-
"""给 NDS 游戏库里没有封面的条目补封面（Libretro Thumbnails，无需 API key）。

中文标题对不上英文封面名，所以走「用 ROM 自身指纹定位」：

1. 读 ROM 头部 ``0x0C-0x0F`` 的**游戏代码**（如 ``A8AJ``、``TDJE``）——
   汉化补丁一般不动这里
2. 拿代码去查 Libretro 的 No-Intro DS 表（``metadat/no-intro/Nintendo - Nintendo DS.dat``，
   自带 ``serial`` 字段）拿到官方名
3. 按官方名去 Libretro Thumbnails 下 ``boxFront.png``

只会处理 ``games.json`` 里**没有 ``media`` 字段**的条目，下完写回 ``media: media/<标题>``；
已有封面文件会自动跳过，可重复运行。

用法::

    python scripts/media/fetch-nds-covers.py --roms "G:/EmberHub/Roms/NDS"
"""

import argparse
import difflib
import json
import os
import re
import sys
import time
import urllib.parse
import urllib.request
import zipfile

try:
    sys.stdout.reconfigure(encoding="utf-8")
except Exception:
    pass

UA = {"User-Agent": "Mozilla/5.0"}
DAT_URL = ("https://raw.githubusercontent.com/libretro/libretro-database/master/"
           "metadat/no-intro/Nintendo%20-%20Nintendo%20DS.dat")
BOX_URL = "https://thumbnails.libretro.com/Nintendo%20-%20Nintendo%20DS/Named_Boxarts/"

ROM_EXTS = (".nds", ".bin", ".zip", ".7z", ".rar")


def get(url, timeout=120):
    return urllib.request.urlopen(urllib.request.Request(url, headers=UA), timeout=timeout).read()


def norm(s):
    return re.sub(r"[^a-z0-9]", "", s.lower())


def base_of(n):
    return re.sub(r"\s*\([^)]*\)\s*$", "", n).strip()


def load_serial_table(cache_dir):
    path = os.path.join(cache_dir, "nds-no-intro.dat")
    if not os.path.isfile(path):
        os.makedirs(cache_dir, exist_ok=True)
        open(path, "wb").write(get(DAT_URL))
    text = open(path, encoding="utf-8", errors="replace").read()
    table = {}
    for blk in re.split(r"\n(?=game \()", text):
        mn = re.search(r'\n\s*name "([^"]+)"', blk)
        ms = re.search(r'\n\s*serial "([^"]+)"', blk)
        if mn and ms:
            table.setdefault(ms.group(1).strip(), []).append(mn.group(1))
    return table


def load_boxart_index(cache_dir):
    path = os.path.join(cache_dir, "libretro-nds-boxarts.txt")
    if not os.path.isfile(path):
        html = get(BOX_URL).decode("utf-8", "replace")
        names = sorted(urllib.parse.unquote(n) for n in re.findall(r'href="([^"]+\.png)"', html))
        open(path, "w", encoding="utf-8").write("\n".join(names))
    return [l for l in open(path, encoding="utf-8").read().splitlines() if l]


REGION_RANK = {"(USA)": 0, "(USA, Europe)": 1, "(Europe)": 2, "(World)": 3, "(Japan)": 5}


def pick_boxart(official, box, box_norm):
    hit = box_norm.get(norm(official))
    if hit:
        return hit, "exact"
    b = base_of(official)
    cands = [x for x in box if base_of(os.path.splitext(x)[0]) == b]
    if not cands:
        cands = [x for x in box
                 if norm(b) and len(norm(b)) >= 5 and norm(b) in norm(os.path.splitext(x)[0])]
    if cands:
        cands.sort(key=lambda x: next(
            (v for k, v in REGION_RANK.items() if os.path.splitext(x)[0].endswith(k)), 9))
        return cands[0], "same-title"
    best, br = None, 0.0
    no = norm(official)
    for x in box:
        r = difflib.SequenceMatcher(None, no, norm(os.path.splitext(x)[0])).ratio()
        if r > br:
            best, br = x, r
    if best and br >= 0.93:
        return best, "fuzzy %.2f" % br
    return None, ""


def read_header_code(rom_path):
    """返回 (游戏代码, 内部标题)。"""
    try:
        if rom_path.lower().endswith(".nds"):
            with open(rom_path, "rb") as f:
                h = f.read(0x20)
        else:
            with zipfile.ZipFile(rom_path) as z:
                cand = [n for n in z.namelist() if n.lower().endswith(ROM_EXTS[:2])]
                if not cand:
                    cand = [n for n in z.namelist() if not n.endswith("/")]
                if not cand:
                    return "", ""
                with z.open(cand[0]) as f:
                    h = f.read(0x20)
        return (h[0x0C:0x10].decode("ascii", "replace").strip(),
                h[0x00:0x0C].decode("utf-16le", "replace").strip("\x00 "))
    except Exception as e:
        return "", "ERR:" + str(e)[:40]


def main():
    ap = argparse.ArgumentParser(description="给 NDS 游戏库补封面")
    ap.add_argument("--roms", required=True, help="游戏库目录（含 games.json 与 media/）")
    ap.add_argument("--cache", default=os.path.join(os.path.expanduser("~"), ".cache", "emberhub-media"),
                    help="No-Intro 表与封面名单的缓存目录")
    args = ap.parse_args()

    root = os.path.abspath(args.roms)
    gj_path = os.path.join(root, "games.json")
    gj = json.load(open(gj_path, encoding="utf-8"))

    table = load_serial_table(args.cache)
    box = load_boxart_index(args.cache)
    box_norm = {}
    for b in box:
        box_norm.setdefault(norm(os.path.splitext(b)[0]), b)
    print("No-Intro serial %d 个 | 可用封面 %d 张" % (len(table), len(box)))

    todo = [g for g in gj["games"] if not g.get("media")]
    print("需要补封面: %d 条" % len(todo))

    done, failed = [], []
    for i, g in enumerate(todo, 1):
        code, inner = read_header_code(os.path.join(root, g["file"]))
        art, how = None, ""
        for nm in table.get(code, []):
            art, how = pick_boxart(nm, box, box_norm)
            if art:
                break
        if not art:
            failed.append({"title": g["title"], "code": code, "inner": inner})
            continue
        dest_dir = os.path.join(root, "media", g["title"])
        os.makedirs(dest_dir, exist_ok=True)
        dest = os.path.join(dest_dir, "boxFront.png")
        if not os.path.isfile(dest):
            try:
                open(dest, "wb").write(get(BOX_URL + urllib.parse.quote(art)))
                time.sleep(0.1)
            except Exception as e:
                failed.append({"title": g["title"], "code": code, "err": str(e)[:60]})
                continue
        g["media"] = "media/" + g["title"]
        done.append({"title": g["title"], "code": code, "art": art, "how": how})
        if i % 25 == 0:
            print("  %d/%d ..." % (i, len(todo)), flush=True)

    with open(gj_path, "w", encoding="utf-8") as fh:
        json.dump(gj, fh, ensure_ascii=False, indent=2)

    lines = ["NDS 补封面: 成功 %d / 未识别 %d / 共 %d" % (len(done), len(failed), len(todo)), ""]
    lines.append("=== 成功 ===")
    lines += ["%-52s %-5s %s" % (x["title"][:52], x["code"], x["art"][:70]) for x in done]
    lines.append("")
    lines.append("=== 未识别（保持无封面）===")
    lines += ["%-46s code=%-5s %s" % (x["title"][:46], x["code"],
                                      (x.get("inner") or x.get("err") or "")[:50]) for x in failed]
    repo_root = os.path.abspath(os.path.join(os.path.dirname(__file__), "..", ".."))
    rp = os.path.join(repo_root, "data", "reports", "nds-covers-%s.txt" % time.strftime("%Y%m%d-%H%M%S"))
    os.makedirs(os.path.dirname(rp), exist_ok=True)
    open(rp, "w", encoding="utf-8").write("\n".join(lines) + "\n")

    print(lines[0])
    print("报告:", rp)


if __name__ == "__main__":
    main()
