#!/usr/bin/env python3
# -*- coding: utf-8 -*-
"""把 OldmanEmu 风格的 NDS ROM 目录整理成 EmberHub 游戏库（games.json + media 匹配）。

NDS 的命名和 GBA 不太一样，汉化组是放在**圆括号**里、和区域/容量混在一起的：

    牧场物语 风之集市 2024精修版v1.2日语配音(JP)(SOMA+YOME+家在矿石镇汉化组)(1024Mb).7z
    最终幻想3(简)(JP)(NdsBBS汉化组&NDSMAN&LevelUp&天幻网)(1024Mb).7z
    口袋妖怪(精灵宝可梦) 珍珠 官译修正版v2.1.1(简)(JP)(YYJoy汉化组+Xzonn)(1024Mb).7z

所以解析规则是「从右往左剥掉连续的元数据括号」（第一组像元数据就整段剥），
再清掉结尾残留的版本/字体/汉化说明；括号里长一点的纯中文当别名保留
（如 ``口袋妖怪(精灵宝可梦)``）。

规则（只依据文件名，不联网）：
  * title   = 干净标题；同名多版本追加 ``[n]汉化组`` 区分
  * file    = ROM 文件名（不改名）
  * 元数据   = 优先复用 ``--reuse-games-json`` 里同名游戏的 description/genre/publisher/...
  * media   = 按标题在 ``--media-pool`` 里匹配到的目录（写进 games.json 的 media 字段）

匹配沿用了 ``build-gba-library.py`` 的归一化与打分逻辑（精确 → 折叠译名/罗马数字 →
前缀 → 包含 → 去数字 → 相似度），另外因为 NDS 两边译名差异更大，兜底相似度放宽到 0.80。

用法::

    python scripts/media/build-nds-library.py \
        --src "G:/EmberHub/NDS-OldmanEmu" \
        --out "G:/EmberHub/NDS-OldmanEmu" \
        --media-pool "G:/EmberHub/Roms/NDS/media" \
        --reuse-games-json "G:/EmberHub/Roms/NDS/games.json"
"""

import argparse
import difflib
import importlib.util
import json
import os
import re
import shutil
import sys
import time
from collections import defaultdict

try:
    sys.stdout.reconfigure(encoding="utf-8")
except Exception:
    pass

ROM_EXTS = (".zip", ".7z", ".rar", ".nds")

# 复用 GBA 脚本里的归一化 / 媒体匹配（避免两套规则漂移）
_spec = importlib.util.spec_from_file_location(
    "build_gba_library", os.path.join(os.path.dirname(os.path.abspath(__file__)), "build-gba-library.py"))
gba = importlib.util.module_from_spec(_spec)
_spec.loader.exec_module(gba)

# NDS 这边额外见到的译名差异
gba.SYNONYMS += [("马力奥", "马里奥"), ("玛利欧", "马里奥"), ("瑪利歐", "马里奥"),
                 ("馬利歐", "马里奥"), ("马力歐", "马里奥")]

REGION = re.compile(r"^(JP|US|EU|UE|CN|KS|KR|JPN|USA|EUR|CHN|HK|TW|J|U|E|K|W)$", re.I)
SIZE = re.compile(r"^\d+(?:\.\d+)?\s*M(?:b)?$", re.I)
LANG = {"简", "繁", "简繁", "繁简", "中", "中文", "汉", "汉化", "英", "日", "英文", "日文",
        "简&繁", "繁&简", "简/繁", "官方中文", "官中"}
DESC_HINT = re.compile(
    r"汉化|简体|繁体|修正|配音|补丁|测试|公测|完整|完全|润色|完美|语音|文本|剧情|菜单|图形|"
    r"字库|字体|立绘|方言|解说|三语|双语|多语|存档|模拟器|烧录|卡带|模拟|版|组|\d+%|[Vv]\d")

PAREN_TAIL = re.compile(r"\(([^()]*(?:\([^()]*\)[^()]*)*)\)\s*$")
PAREN_ANY = re.compile(r"\(([^()]*(?:\([^()]*\)[^()]*)*)\)")

# 结尾常见的“版本/字体/汉化说明”残留
DESC_PATS = [
    r"\s+\d+(?:\.\d+)?M(?:b)?$",
    r"\s+\d+%汉化.*$",
    r"\s+\S*(?:汉化|修正|配音|补丁|测试|公测|润色|美化|语音)\S*.*$",
    r"\s*[Vv]\d+(?:[.\-]\d+)*\+?$",
    r"\s+\d+(?:\.\d+)+\s+\S+$",                       # "1.01 华康少女"
    r"\s+\d+(?:\.\d+)+$",
    r"\s+\d{4,}$",
    r"\s*\S*(?:幼圆|雅黑|黑体|宋体|楷体|像素|华康少女|大号|小号|字体).*$",
    r"\s*fix\d*$",
    r"\s*(?:模拟器|烧录卡|不死机|无头|标准|大体字|高清)\S*版$",
    r"\s*\S*(?:解说|方言)版$",
    r"\s*(?:免死机)?存档?补丁[\d.]*$",
    r"\s*(?:别字|剧情|文本|菜单|图形|完美|完整|完全|美化)?修正版$",
    r"\s*(?:完整|完全|测试|公测|典藏|豪华|最终|简体|繁体|中文|汉化|美化|完美|大字库)版$",
    r"\s*(?:简体|繁体|完整|完全|剧情|文本|菜单|图形|大字体|小字体|中文|官译)?汉化$",
    r"\s*\+?中(?:文)?配音$",
    r"\s*官方?中文$",
    r"\s*\S*(?:三语|双语|多语)版$",
]

# 自动匹配会选错 / 本就无对应的，手工钉死
MEDIA_OVERRIDES = {
    "流星洛克人2 恐龙": "流星洛克人2 - 狂战士x恐龙",
    "流星洛克人2 忍者": "流星洛克人2 - 狂战士x忍者",
}
FORCE_UNMATCH = set()


def is_meta(g):
    g = g.strip()
    if not g:
        return False
    if SIZE.match(g) or REGION.match(g) or g in LANG:
        return True
    # 短的全中文括号基本都是标注（神游/像素/楷体/简大/原版立绘…）
    if len(g) <= 4 and not re.search(r"[A-Za-z0-9]", g):
        return True
    if DESC_HINT.search(g):
        return True
    return bool(re.search(r"[A-Za-z0-9]", g))


def strip_trailing_run(s):
    """剥掉结尾那段连续的括号；只要其中第一组像元数据，就整段剥掉。"""
    end, groups = len(s), []
    while True:
        m = PAREN_TAIL.search(s[:end])
        if not m:
            break
        groups.insert(0, m.group(1))
        end = m.start()
    if not groups or not is_meta(groups[0]):
        return s, []
    rest = s[:end].rstrip()
    # 剩下的散落区域/语言/容量括号也清掉
    rest = PAREN_ANY.sub(
        lambda m: " " if (SIZE.match(m.group(1)) or REGION.match(m.group(1))
                          or m.group(1).strip() in LANG) else m.group(0), rest)
    return rest, groups


def cleanup(s):
    s = s.strip()
    for _ in range(4):
        before = s
        for p in DESC_PATS:
            n = re.sub(p, "", s).rstrip()
            if n and n != s:
                s = n
        if s == before:
            break
    return re.sub(r"\s+", " ", s).strip(" -_")


def parse_name(stem):
    body, groups = strip_trailing_run(stem)
    title = cleanup(body) or stem
    tag = [g for g in groups if not SIZE.match(g) and not REGION.match(g)]
    return title, tag


def match_media(title, recs, uniq_dl, threshold=0.80):
    if title in FORCE_UNMATCH:
        return None, ""
    if title in MEDIA_OVERRIDES:
        return MEDIA_OVERRIDES[title], "override"
    d, how = gba.match_media(title, recs, uniq_dl)
    if d:
        return d, how
    kt = gba.fold(title)
    if len(kt) < 4:
        return None, ""
    best, br = None, 0.0
    for rec in recs:
        r = difflib.SequenceMatcher(None, kt, rec["f"]).ratio()
        if r > br:
            best, br = rec["dir"], r
    if best and br >= threshold:
        return best, "fuzzy %.2f" % br
    return None, ""


def main():
    ap = argparse.ArgumentParser(description="把 NDS ROM 目录整理成 EmberHub 游戏库")
    ap.add_argument("--src", required=True, help="ROM 目录（zip/7z/rar，按文件名解析）")
    ap.add_argument("--out", help="输出目录（缺省与 --src 相同）")
    ap.add_argument("--media-pool", default="", help="媒体池目录，按标题复用")
    ap.add_argument("--reuse-games-json", default="", help="旧 games.json，用于复用元数据")
    ap.add_argument("--platform", default="NDS")
    ap.add_argument("--name", default="NDS")
    ap.add_argument("--dry-run", action="store_true", help="只分析，不写 games.json")
    args = ap.parse_args()

    src = os.path.abspath(args.src)
    out = os.path.abspath(args.out or args.src)
    roms = sorted(f for f in os.listdir(src) if f.lower().endswith(ROM_EXTS))
    if not roms:
        sys.exit("源目录里没有 ROM: " + src)

    rows = []
    for f in roms:
        title, tag = parse_name(os.path.splitext(f)[0])
        rows.append({"file": f, "title": title, "tag": tag})

    # 同名多版本 -> 追加 [n]汉化组
    groups = defaultdict(list)
    for r in rows:
        groups[r["title"]].append(r)
    dup = 0
    for t, items in groups.items():
        if len(items) < 2:
            continue
        for i, r in enumerate(items, 1):
            tag = " ".join(r["tag"])[:36]
            r["title"] = "%s [%d]%s" % (t, i, tag) if tag else "%s [%d]" % (t, i)
            dup += 1

    # 复用旧库元数据
    fields = ("description", "developer", "genre", "publisher", "release", "rating", "players")
    reused = 0
    if args.reuse_games_json and os.path.isfile(args.reuse_games_json):
        old = json.load(open(args.reuse_games_json, encoding="utf-8"))
        meta = {}
        for g in old.get("games", []):
            k = gba.norm_key(g.get("title", ""))
            if k:
                meta.setdefault(k, g)
        for r in rows:
            g = meta.get(gba.norm_key(r["title"].split(" [")[0]))
            if not g:
                continue
            for fld in fields:
                if g.get(fld) not in (None, ""):
                    r[fld] = g[fld]
            reused += 1

    # 媒体池匹配
    recs, uniq_dl, dk_count = [], set(), defaultdict(int)
    if args.media_pool and os.path.isdir(args.media_pool):
        seen = set()
        for d in sorted(os.listdir(args.media_pool)):
            if not os.path.isdir(os.path.join(args.media_pool, d)):
                continue
            k = gba.norm_key(gba.clean_title(d))
            if not k or k in seen:
                continue
            seen.add(k)
            recs.append({"dir": d, "k": k, "f": gba.fold(d), "dk": gba.digitless(k)})
            dk_count[gba.digitless(k)] += 1
        uniq_dl = {k for k, c in dk_count.items() if c == 1 and k}

    tm = {}
    for r in rows:
        base = r["title"].split(" [")[0]
        if base not in tm:
            tm[base] = match_media(base, recs, uniq_dl)
        d, how = tm[base]
        if d:
            r["media"], r["media_how"] = d, how

    used = sorted({r["media"] for r in rows if r.get("media")})
    no_cover = sorted({r["title"].split(" [")[0] for r in rows if not r.get("media")})

    games = []
    for r in rows:
        g = {"title": r["title"], "file": r["file"]}
        for fld in fields:
            if r.get(fld) not in (None, ""):
                g[fld] = r[fld]
        if r.get("media"):
            g["media"] = "media/" + r["media"]
        games.append(g)
    data = {"platform": args.platform, "name": args.name, "games": games}

    if not args.dry_run:
        os.makedirs(out, exist_ok=True)
        with open(os.path.join(out, "games.json"), "w", encoding="utf-8") as fh:
            json.dump(data, fh, ensure_ascii=False, indent=2)
        if used and args.media_pool:
            media_out = os.path.join(out, "media")
            os.makedirs(media_out, exist_ok=True)
            for d in used:
                shutil.copytree(os.path.join(args.media_pool, d),
                                os.path.join(media_out, d), dirs_exist_ok=True)

    lines = [
        "NDS 游戏库整理报告  %s" % time.strftime("%Y-%m-%d %H:%M:%S"),
        "源目录   : %s" % src,
        "输出目录 : %s%s" % (out, "   (dry-run)" if args.dry_run else ""),
        "媒体池   : %s" % (args.media_pool or "(未指定)"),
        "",
        "ROM 条目       : %d" % len(rows),
        "干净标题       : %d（多版本加后缀 %d 条）" % (len(groups), dup),
        "复用旧库元数据 : %d 条" % reused,
        "匹配上媒体     : %d 个目录 / 覆盖 %d 条" % (len(used), len(rows) - sum(1 for r in rows if not r.get("media"))),
        "无封面标题     : %d" % len(no_cover),
        "",
        "=== 无封面的标题 ===",
    ]
    lines += ["  - " + t for t in no_cover]
    lines.append("")
    lines.append("=== 借用了旧池目录（非同名）的条目 ===")
    for r in rows:
        if r.get("media") and r["media"] != r["title"]:
            lines.append("  %-50s -> %s  (%s)" % (r["title"][:50], r["media"], r.get("media_how", "")))
    report = "\n".join(lines)

    repo_root = os.path.abspath(os.path.join(os.path.dirname(__file__), "..", ".."))
    rp = os.path.join(repo_root, "data", "reports", "nds-library-%s.txt" % time.strftime("%Y%m%d-%H%M%S"))
    os.makedirs(os.path.dirname(rp), exist_ok=True)
    open(rp, "w", encoding="utf-8").write(report + "\n")

    print("ROM %d 条 | 干净标题 %d | 复用元数据 %d | 匹配媒体 %d 目录 | 无封面 %d"
          % (len(rows), len(groups), reused, len(used), len(no_cover)))
    print("报告:", rp)


if __name__ == "__main__":
    main()
