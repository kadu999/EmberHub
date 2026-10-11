#!/usr/bin/env python3
"""批量把「3DS 汉化补丁」zip 包转成 EmberHub 的 LayeredFS mod，并写回 games.json。

流程：
  1. 读 plugins 目录里的补丁 zip，解出里面的 CIA，识别基础 TitleID 与类型（Update/DLC）。
  2. 每个基础 TitleID 只保留一个补丁（默认优先 Update，其次最新版本）。
  3. 未加密的 CIA 直接转；加密的先用「Batch CIA 3DS Decryptor」解密再转。
  4. 输出 mod 包到 <mods-out>，并把 `mod` 字段写进 <games.json> 里匹配的游戏。

依赖：
  - scripts/media/cia-to-mod.py（本仓库）
  - Batch CIA 3DS Decryptor（--decryptor 指向解压后的目录，含 decrypt.exe/makerom.exe/ctrtool.exe）

用法：
  python scripts/media/build-3ds-mods.py \
      --plugins "G:/EmberHub/Roms/3DS/plugins" \
      --mods-out "G:/EmberHub/Roms/3DS/mods" \
      --games-json "G:/EmberHub/Roms/3DS/games.json" \
      --decryptor "C:/path/to/decryptor" \
      --work "G:/_3ds_build" \
      [--include-dlc]
"""

import argparse
import importlib.util
import os
import re
import shutil
import subprocess
import sys
import zipfile

HERE = os.path.dirname(os.path.abspath(__file__))


def load_converter():
    path = os.path.join(HERE, "cia-to-mod.py")
    spec = importlib.util.spec_from_file_location("cia_to_mod", path)
    mod = importlib.util.module_from_spec(spec)
    spec.loader.exec_module(mod)
    return mod


def ncch_info(cia_path):
    """返回 (base_title_id, kind) —— kind: 'upd' | 'dlc' | 'oth'；无 NCCH 返回 (None,None)。"""
    with open(cia_path, "rb") as f:
        head = f.read(1 << 20)
    pos = head.find(b"NCCH")
    if pos < 0:
        return None, None
    hdr = pos - 0x100
    tid = head[hdr + 0x118: hdr + 0x120][::-1].hex()
    base = tid[:6] + "00" + tid[8:]
    kind = "upd" if tid.startswith("0004000e") else ("dlc" if tid.startswith("0004008c") else "oth")
    return base, kind


def title_of(zipname):
    m = re.match(r"^\d+\s*-\s*(.*?)\s*(?:\(|\[|$)", zipname)
    return m.group(1).strip() if m else zipname


def version_of(zipname):
    nums = []
    for pat in (r"[Uu]pdate\s*([\d.]+)", r"\bv([\d.]+)", r"[Pp]atch\s*([\d.]+)", r"[Dd]LC\s*([\d.]+)"):
        m = re.search(pat, zipname)
        if m:
            nums = [int(x) for x in m.group(1).split(".") if x.isdigit()]
            break
    return tuple(nums)


def norm(s):
    s = re.sub(r"\[[^\]]*\]", "", s)
    s = re.sub(r"\([^)]*\)", "", s)
    s = re.sub(r"[·・．。:：\-–—_/,！!？?＋+]", " ", s)
    return re.sub(r"\s+", " ", s).strip().lower()


def main():
    ap = argparse.ArgumentParser()
    ap.add_argument("--plugins", required=True)
    ap.add_argument("--mods-out", required=True)
    ap.add_argument("--games-json", required=True)
    ap.add_argument("--decryptor", required=True)
    ap.add_argument("--work", required=True)
    ap.add_argument("--include-dlc", action="store_true")
    args = ap.parse_args()

    conv = load_converter()
    os.makedirs(args.work, exist_ok=True)
    cia_dir = os.path.join(args.work, "cia")
    mods_stage = os.path.join(args.work, "mods_stage")
    # 保留已解出的 CIA（重跑时复用，避免重复解包/解密）
    os.makedirs(cia_dir, exist_ok=True)
    shutil.rmtree(mods_stage, ignore_errors=True)
    os.makedirs(mods_stage, exist_ok=True)

    # 1) 解出 CIA，收集候选
    candidates = []  # (base, kind, version, title, cia_path)
    for z in sorted(os.listdir(args.plugins)):
        if not z.lower().endswith(".zip"):
            continue
        try:
            with zipfile.ZipFile(os.path.join(args.plugins, z)) as zf:
                names = [n for n in zf.namelist() if n.lower().endswith(".cia")]
                if not names:
                    continue
                # 抽取 CIA
                for n in names:
                    target = os.path.join(cia_dir, os.path.basename(n))
                    if not (os.path.exists(target) and os.path.getsize(target) > 0):
                        with zf.open(n) as src, open(target, "wb") as dst:
                            shutil.copyfileobj(src, dst)
                    base, kind = ncch_info(target)
                    if base is None:
                        continue
                    if kind == "dlc" and not args.include_dlc:
                        continue
                    candidates.append((base, kind, version_of(z), title_of(z), target))
        except Exception as e:
            print("[ZIP ERR]", z, e)

    # 2) 每个 base 选一个：优先 upd，其次最新版本
    best = {}
    for base, kind, ver, title, path in candidates:
        rank = (0 if kind == "upd" else 1, tuple(-x for x in ver))
        if base not in best or rank < best[base][0]:
            best[base] = (rank, title, path, kind)
    print("候选 %d 个 CIA，选中 %d 个基础标题" % (len(candidates), len(best)))

    # 3) 解密（只处理加密的；未加密的留着）
    def has_decrypted(path):
        stem = os.path.splitext(os.path.basename(path))[0]
        return any(stem in f and "decrypted" in f.lower() for f in os.listdir(cia_dir))

    need_decrypt = [v[2] for v in best.values()
                    if not conv.is_no_crypto(v[2]) and not has_decrypted(v[2])]
    if need_decrypt:
        tool = args.decryptor
        for f in os.listdir(tool):
            src = os.path.join(tool, f)
            if os.path.isfile(src):
                shutil.copy2(src, os.path.join(cia_dir, f))
        # 生成去掉 pause 的 bat
        bat = os.path.join(tool, "Batch CIA 3DS Decryptor.bat")
        with open(bat, encoding="utf-8", errors="ignore") as fh:
            lines = [l for l in fh.read().splitlines() if not l.strip().lower().startswith("pause")]
        run_bat = os.path.join(cia_dir, "run.bat")
        with open(run_bat, "w", encoding="ascii", errors="ignore", newline="\r\n") as fh:
            fh.write("\n".join(lines) + "\n")
        print("解密 %d 个加密 CIA…" % len(need_decrypt))
        subprocess.run(["cmd", "/c", "run.bat"], cwd=cia_dir)

    # 4) 转换（no_crypto 的原始文件 + 解密产物）
    os.makedirs(args.mods_out, exist_ok=True)
    done_bases = set()
    for base, (rank, title, path, kind) in best.items():
        # 优先用解密产物
        dec = None
        stem = os.path.splitext(os.path.basename(path))[0]
        for cand in os.listdir(cia_dir):
            if cand.lower().endswith(".cia") and stem in cand and "decrypted" in cand.lower():
                dec = os.path.join(cia_dir, cand)
        src = dec if dec else path
        if not conv.is_no_crypto(src):
            print("[SKIP] %s 仍加密（解密失败？）" % title)
            continue
        try:
            r = conv.convert(src, mods_stage)
            shutil.copy2(r["zip"], os.path.join(args.mods_out, os.path.basename(r["zip"])))
            done_bases.add((base, title))
            print("[OK] %s -> %s (%d romfs files)" % (title, os.path.basename(r["zip"]), r["romfs_files"]))
        except Exception as e:
            print("[FAIL]", title, e)

    # 5) 写回 games.json
    import json
    gj = json.load(open(args.games_json, encoding="utf-8"))
    titles = {norm(g["title"]): g for g in gj["games"]}
    mapped = 0
    for base, title in done_bases:
        g = titles.get(norm(title))
        if g:
            g["mod"] = "mods/%s.zip" % base
            mapped += 1
        else:
            print("[NO GAME]", title)
    json.dump(gj, open(args.games_json, "w", encoding="utf-8", newline="\n"), ensure_ascii=False, indent=2)
    open(args.games_json, "a", encoding="utf-8", newline="\n").write("\n")
    print("\n生成 mod %d 个，写入 games.json %d 个" % (len(done_bases), mapped))


if __name__ == "__main__":
    sys.exit(main())
