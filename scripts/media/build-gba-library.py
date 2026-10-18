#!/usr/bin/env python3
# -*- coding: utf-8 -*-
"""把 OldmanEmu 风格的「中文游戏全集」整理成 EmberHub 的游戏库。

输入是一堆「天马/旧人」命名风格的 ROM 压缩包，例如：

    口袋妖怪 - 火红[电光一闪23333](官译汉化版v20230724)(简)(JP)(128Mb).zip
    高级战争[CGP][简](US)(36.54Mb).zip
    黄金太阳 - 开启的封印 润色美化版_IDK-if-its-final.zip

输出一个可以直接当 `Roms/<平台>/` 用的目录：

    <out>/
    ├─ games.json                     # title / file / developer / description / media
    ├─ media/<媒体目录名>/            # 从旧媒体池复用（boxFront / logo / mini_* / video）
    └─ *.zip                          # 原样拷贝的 ROM（--no-copy 可跳过）

规则（都只依据文件名，不联网、不猜测）：
  * title       = 文件名去掉 [..]/(..) 等元数据后的干净标题；同名多版本会追加 [汉化组 版本] 区分
  * developer   = title + 汉化组/版本等元数据
  * file        = 保持 ROM 原始文件名（不改名，可回溯）
  * description = 优先复用旧库 games.json 里同名游戏的简介，缺失留空
  * media       = 按标题在旧媒体池里模糊匹配得到的目录，写进 games.json 的 media 字段

用法：
  python scripts/media/build-gba-library.py \
      --src "F:/EDownload/GBA中文游戏全集(OldmanEmu.net)" \
      --out "G:/EmberHub/GBA-OldmanEmu" \
      --media-pool "G:/EmberHub/Roms/GBA/media" \
      --reuse-games-json "G:/EmberHub/Roms/GBA/games.json"

  # 只出报告、不拷贝任何文件：
  python scripts/media/build-gba-library.py ... --dry-run
"""

import argparse
import datetime
import difflib
import json
import os
import re
import shutil
import sys
from collections import defaultdict

try:  # Windows 控制台默认 GBK，强制 UTF-8 输出
    sys.stdout.reconfigure(encoding="utf-8")
except Exception:
    pass

ROM_EXTS = {".zip", ".7z", ".gba", ".gbc", ".gb", ".rar"}

BRACKET_RE = re.compile(r"\[[^\]]*\]")
PAREN_RE = re.compile(r"\([^)]*\)")

# 只作为「版本/说明」的括号内容；其余括号（汉化组、区域、容量、语言）都当元数据
DESC_SUFFIXES = [
    "剧情汉化版", "汉化测试版", "汉化公测版", "完全汉化版", "汉化修正版",
    "个人汉化版", "润色美化版", "AI汉化版", "美化版", "修正版",
    "典藏版", "测试版", "同人版", "完全版", "汉化版",
]

REGION_RE = re.compile(r"^(JP|US|UE|EU|JPN|USA|EUR|CH|CN|HK|TW|J|U|E|K|W)$", re.I)
SIZE_RE = re.compile(r"^[\d.]+\s*(Mb|M|MB)$", re.I)
LANG_CHARS = set("简繁汉日英美官中&/ 简体繁体中文英文日文")


def classify_meta(text: str) -> str:
    """把一段元数据分类为 lang / region / size / desc。"""
    t = text.strip()
    if t == "":
        return "desc"
    if REGION_RE.match(t):
        return "region"
    if SIZE_RE.match(t):
        return "size"
    if set(t) <= LANG_CHARS:
        return "lang"
    return "desc"


def clean_title(stem: str) -> str:
    """从 ROM 文件名（不含扩展名）里提取干净标题。"""
    s = BRACKET_RE.sub(" ", stem)
    s = PAREN_RE.sub(" ", s)
    s = s.replace("（", " ").replace("）", " ")
    s = re.sub(r"[_＿]\S*$", " ", s)  # 结尾 _IDK-if-its-final 之类的尾巴
    for _ in range(4):
        before = s
        # 结尾裸容量，形如 "64.00"（必须带小数点，否则会把 "洛克人Zero 2" 这类名字的编号切掉）
        s = re.sub(r"\s+\d+\.\d+\s*$", " ", s)
        s = re.sub(r"\s*[vV]\d+(?:[.\-]\d+)*\+?\s*$", " ", s)  # 结尾 v1.1 / v20120723-3
        stripped = s.rstrip()
        for suf in DESC_SUFFIXES:
            if stripped.endswith(suf):
                s = stripped[: -len(suf)] + " "
                break
        if s == before:
            break
    s = re.sub(r"[–—－~〜‐]", " ", s)
    s = re.sub(r"\s*-\s*", " ", s)
    s = re.sub(r"\s+", " ", s).strip()
    return s


def parse_meta(stem: str):
    """返回 (brackets, parens)；brackets=汉化组等，parens=版本/语言/区域/容量。

    注意 findall 返回的是整段匹配（含括号），这里要去掉外层括号。
    """
    brackets = [b[1:-1].strip() for b in BRACKET_RE.findall(stem) if b[1:-1].strip()]
    parens = [p[1:-1].strip() for p in PAREN_RE.findall(stem) if p[1:-1].strip()]
    return brackets, parens


def build_developer(title: str, brackets, parens) -> str:
    parts = []
    for b in brackets:
        if classify_meta(b) == "lang":
            continue
        parts.append(b)
    for p in parens:
        if classify_meta(p) != "desc":
            continue
        parts.append(p)
    # 去掉重复项，保持顺序
    seen, uniq = set(), []
    for p in parts:
        if p not in seen:
            seen.add(p)
            uniq.append(p)
    if not uniq:
        return title
    return (title + " " + " ".join(uniq)).strip()


def norm_key(s: str) -> str:
    """用于匹配的归一化：小写、去空白与标点。"""
    s = s.lower()
    s = re.sub(r"[\s\-_·・．。:：!！?？&+/、，,．.]", "", s)
    return s


# 罗马数字 → 阿拉伯数字（只认独立出现的，且不含 X，免得把「X战警」改了）
ROMAN_MAP = [
    ("VIII", "8"), ("VII", "7"), ("VI", "6"), ("IV", "4"), ("IX", "9"),
    ("III", "3"), ("II", "2"), ("V", "5"), ("I", "1"),
]

# 常见译名/写法差异（折叠到同一写法再去比对）
SYNONYMS = [
    ("Original Generation", "OG"),
    ("钢弹", "高达"), ("敢达", "高达"),
    ("马力欧", "马里奥"), ("玛莉欧", "马里奥"), ("玛利欧", "马里奥"),
    ("路易基", "路易吉"),
    ("瓦力欧", "瓦里奥"),
    ("与", ""),
]


def roman_to_arabic(s: str) -> str:
    for r, d in ROMAN_MAP:
        s = re.sub(r"(?<![A-Za-z])" + r + r"(?![A-Za-z])", d, s)
    return s


def fold(s: str) -> str:
    s = roman_to_arabic(s)
    for a, b in SYNONYMS:
        s = s.replace(a, b)
    return norm_key(s)


def digitless(s: str) -> str:
    return re.sub(r"\d+", "", s)


# ---------------------------------------------------------------- 媒体匹配

# 少数标题有多义，自动匹配会选错，这里手工钉死（键 = 干净标题，值 = 媒体池目录名）
MEDIA_OVERRIDES = {
    "游戏王! 怪兽决斗EX 2": "游戏王 怪兽决斗6 EX2",
    "牧场物语 矿石镇的伙伴们": "牧场物语 矿石镇的伙伴们 男孩篇",
}


def match_media(title: str, recs: list, uniq_digitless: set):
    """在媒体池里给一个标题找目录。

    按优先级打分：精确 → 折叠后精确 → 前缀 → 包含 → 去数字（唯一时）→ 相似度。
    返回 (目录名, 命中方式)。宁可漏配，也不乱配。
    """
    b = norm_key(title)
    fb = fold(title)
    db = digitless(b)
    fdb = digitless(fb)
    if len(b) < 2:
        return None, ""

    best_rank, best_key, best_dir, best_how = 99, "", None, ""
    for rec in recs:
        k, fk, dk = rec["k"], rec["f"], rec["dk"]
        rank, how = 99, ""
        if b == k:
            rank, how = 0, "exact"
        elif fb == fk:
            rank, how = 1, "fold"
        else:
            for x, y, r, name in ((b, k, 2, "prefix"), (fb, fk, 3, "fold-prefix")):
                if len(x) >= 4 and len(y) >= 4 and (y.startswith(x) or x.startswith(y)):
                    extra = abs(len(x) - len(y))
                    if extra <= 12:
                        rank, how = r, "%s(%s)" % (name, y if x.startswith(y) else x)
                        break
            if rank == 99:
                for x, y, r, name in ((b, k, 4, "contains"), (fb, fk, 5, "fold-contains")):
                    if len(x) >= 5 and len(y) >= 5 and (x in y or y in x):
                        rank, how = r, "%s(%s)" % (name, y if x in y else x)
                        break
            if rank == 99 and db and dk and db == dk and db in uniq_digitless:
                rank, how = 6, "digitless"
        # 同分时取「长度最接近标题」的那个：避免 "高级战争" 被配到 "高级战争1+2"
        if rank < best_rank or (rank == best_rank and abs(len(b) - len(k)) < abs(len(b) - len(best_key))):
            best_rank, best_key, best_dir, best_how = rank, k, rec["dir"], how

    if best_dir is not None and best_rank <= 6:
        return best_dir, best_how

    best_ratio = 0.0
    for rec in recs:
        if len(rec["k"]) < 4 or len(b) < 4:
            continue
        r = difflib.SequenceMatcher(None, b, rec["k"]).ratio()
        if r > best_ratio:
            best_ratio, best_dir = r, rec["dir"]
    if best_dir is not None and best_ratio >= 0.92:
        return best_dir, "fuzzy %.2f" % best_ratio
    return None, ""


# ---------------------------------------------------------------- 主流程

def main():
    ap = argparse.ArgumentParser(description="把 OldmanEmu 中文游戏全集整理成 EmberHub 游戏库")
    ap.add_argument("--src", required=True, help="源 ROM 目录（完整游戏库）")
    ap.add_argument("--out", required=True, help="输出目录（将作为 Roms/<平台>/）")
    ap.add_argument("--media-pool", default="", help="旧媒体池目录（media/），按标题复用")
    ap.add_argument("--reuse-games-json", default="", help="旧 games.json，用于复用 description")
    ap.add_argument("--platform", default="GBA")
    ap.add_argument("--dry-run", action="store_true", help="只分析出报告，不写任何文件")
    ap.add_argument("--no-copy", action="store_true", help="写 games.json/media，但不拷贝 ROM")
    ap.add_argument("--force", action="store_true", help="输出目录已存在且非空时也继续")
    args = ap.parse_args()

    src = os.path.abspath(args.src)
    out = os.path.abspath(args.out)
    if not os.path.isdir(src):
        sys.exit(f"源目录不存在: {src}")
    if not args.dry_run and not args.no_copy and os.path.isdir(out) and os.listdir(out) and not args.force:
        sys.exit(f"输出目录已存在且非空: {out}\n如确认覆盖请加 --force")

    roms = sorted(
        e.name for e in os.scandir(src)
        if e.is_file() and os.path.splitext(e.name)[1].lower() in ROM_EXTS
    )
    if not roms:
        sys.exit(f"源目录里没有找到 ROM: {src}")

    # ---- 解析文件名
    entries = []
    for name in roms:
        stem = os.path.splitext(name)[0]
        title = clean_title(stem)
        brackets, parens = parse_meta(stem)
        developer = build_developer(title, brackets, parens)
        entries.append({
            "file": name,
            "title": title or stem,
            "developer": developer,
            "brackets": brackets,
            "parens": parens,
        })

    # ---- 同名多版本：追加区分后缀，保证 title 唯一
    groups = defaultdict(list)
    for e in entries:
        groups[e["title"]].append(e)
    renamed = 0
    for title, items in groups.items():
        if len(items) < 2:
            continue
        for i, e in enumerate(items, 1):
            tag_bits = [b for b in e["brackets"] if classify_meta(b) != "lang"]
            tag_bits += [p for p in e["parens"] if classify_meta(p) == "desc"]
            tag = " ".join(dict.fromkeys(tag_bits)).strip()
            tag = re.sub(r"\s+", " ", tag)[:36]
            e["title"] = f"{title} [{i}]{tag}" if tag else f"{title} [{i}]"
            renamed += 1

    # ---- 旧库描述复用
    desc_map = {}
    if args.reuse_games_json and os.path.isfile(args.reuse_games_json):
        with open(args.reuse_games_json, encoding="utf-8") as f:
            old = json.load(f)
        for g in old.get("games", []):
            d = (g.get("description") or "").strip()
            if not d:
                continue
            for k in {norm_key(g.get("title", "")), norm_key(clean_title(os.path.splitext(g.get("file", ""))[0]))}:
                if k:
                    desc_map.setdefault(k, d)

    reused = 0
    for e in entries:
        d = desc_map.get(norm_key(e["title"].split(" [")[0]))
        if d:
            e["description"] = d
            reused += 1

    # ---- 媒体池索引
    media_dirs, recs, dk_count = [], [], defaultdict(int)
    if args.media_pool and os.path.isdir(args.media_pool):
        seen_k = set()
        for d in sorted(os.listdir(args.media_pool)):
            p = os.path.join(args.media_pool, d)
            if not os.path.isdir(p):
                continue
            media_dirs.append(d)
            k = norm_key(clean_title(d))
            if not k or k in seen_k:
                continue
            seen_k.add(k)
            recs.append({"dir": d, "k": k, "f": fold(d), "dk": digitless(k)})
            dk_count[digitless(k)] += 1
        uniq_digitless = {k for k, c in dk_count.items() if c == 1 and k}

    # 匹配以「干净标题」为单位，同名多版本共用同一个媒体目录
    title_to_media = {}
    for e in entries:
        base = e["title"].split(" [")[0]
        if base not in title_to_media:
            if base in MEDIA_OVERRIDES:
                title_to_media[base] = (MEDIA_OVERRIDES[base], "override")
            else:
                title_to_media[base] = match_media(base, recs, uniq_digitless)
    for e in entries:
        d, how = title_to_media[e["title"].split(" [")[0]]
        if d:
            e["media_dir"] = d
            e["media_how"] = how

    used_media = sorted({e["media_dir"] for e in entries if e.get("media_dir")})
    unmatched = sorted({e["title"].split(" [")[0] for e in entries if not e.get("media_dir")})

    # ---- 同体积疑似重复
    size_groups = defaultdict(list)
    for e in entries:
        size_groups[os.path.getsize(os.path.join(src, e["file"]))].append(e["file"])
    dup_size = {k: v for k, v in size_groups.items() if len(v) > 1}

    # ---- 输出 games.json
    games_json = {"platform": args.platform, "name": args.platform, "games": []}
    for e in entries:
        g = {"title": e["title"], "file": e["file"]}
        if e.get("developer"):
            g["developer"] = e["developer"]
        if e.get("description"):
            g["description"] = e["description"]
        md = e.get("media_dir")
        if md and md != e["title"]:
            g["media"] = f"media/{md}"
        games_json["games"].append(g)

    total_bytes = sum(os.path.getsize(os.path.join(src, e["file"])) for e in entries)

    # ---- 写盘
    if not args.dry_run:
        os.makedirs(out, exist_ok=True)
        with open(os.path.join(out, "games.json"), "w", encoding="utf-8") as f:
            json.dump(games_json, f, ensure_ascii=False, indent=2)

        if used_media and args.media_pool:
            media_out = os.path.join(out, "media")
            os.makedirs(media_out, exist_ok=True)
            for i, d in enumerate(used_media, 1):
                shutil.copytree(os.path.join(args.media_pool, d), os.path.join(media_out, d),
                                dirs_exist_ok=True)
                if i % 50 == 0 or i == len(used_media):
                    print(f"  媒体 {i}/{len(used_media)}")

        if not args.no_copy:
            for i, e in enumerate(entries, 1):
                shutil.copy2(os.path.join(src, e["file"]), os.path.join(out, e["file"]))
                if i % 50 == 0 or i == len(entries):
                    print(f"  ROM {i}/{len(entries)}")

    # ---- 报告
    lines = []
    A = lines.append
    A(f"GBA 游戏库整理报告  {datetime.datetime.now():%Y-%m-%d %H:%M:%S}")
    A(f"源目录   : {src}")
    A(f"输出目录 : {out}{'   (DRY-RUN，未写盘)' if args.dry_run else ''}")
    A(f"媒体池   : {args.media_pool or '(未指定)'}")
    A("")
    A(f"ROM 总数      : {len(entries)}   体积 {total_bytes / 1024 / 1024:.1f} MB")
    A(f"媒体池目录数  : {len(media_dirs)}")
    A(f"匹配上媒体    : {len(used_media)} 个目录 / 覆盖 {len(entries) - sum(1 for e in entries if not e.get('media_dir'))} 个 ROM")
    A(f"复用旧简介    : {reused} 条")
    A(f"标题重名加后缀: {renamed} 条")
    A("")

    A("─" * 70)
    A(f"【1】没匹配到媒体的游戏 ({len(unmatched)} 个干净标题)")
    A("─" * 70)
    for t in unmatched:
        A(f"  - {t}")

    A("")
    A("─" * 70)
    A(f"【2】媒体池里没被用到的目录 ({len([d for d in media_dirs if d not in used_media])} 个)")
    A("─" * 70)
    for d in media_dirs:
        if d not in used_media:
            A(f"  - {d}")

    A("")
    A("─" * 70)
    A(f"【3】同体积疑似重复 ({len(dup_size)} 组，仅供参考，未必是同一款游戏)")
    A("─" * 70)
    for size, files in sorted(dup_size.items(), key=lambda kv: -kv[0]):
        A(f"  {size / 1024 / 1024:.2f} MB × {len(files)}")
        for fn in files:
            A(f"      {fn}")

    A("")
    A("─" * 70)
    A("【4】游戏 → 媒体目录 全量对照")
    A("─" * 70)
    for e in entries:
        A(f"  {e['title']}")
        A(f"      file : {e['file']}")
        if e.get("media_dir"):
            A(f"      media: media/{e['media_dir']}  ({e.get('media_how', '')})")
        else:
            A(f"      media: —— 未匹配")

    report = "\n".join(lines)

    repo_root = os.path.abspath(os.path.join(os.path.dirname(__file__), "..", ".."))
    report_dir = os.path.join(repo_root, "data", "reports")
    os.makedirs(report_dir, exist_ok=True)
    report_path = os.path.join(report_dir, f"gba-library-{datetime.datetime.now():%Y%m%d-%H%M%S}.txt")
    with open(report_path, "w", encoding="utf-8") as f:
        f.write(report + "\n")

    print("")
    print(f"ROM {len(entries)} 个 | 匹配媒体 {len(used_media)}/{len(media_dirs)} 目录 | "
          f"未匹配 {len(unmatched)} | 复用简介 {reused} | 疑似重复 {len(dup_size)} 组")
    if not args.dry_run:
        print(f"games.json -> {os.path.join(out, 'games.json')}")
    print(f"报告 -> {report_path}")


if __name__ == "__main__":
    main()
