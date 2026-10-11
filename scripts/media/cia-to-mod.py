#!/usr/bin/env python3
"""把 3DS 汉化 / 更新 / DLC 补丁（CIA）转成 EmberHub 的 LayeredFS mod 包。

Azahar（及 Citra）启动游戏时会自动加载 `<用户目录>/load/mods/<基础TitleID>/`
下的 LayeredFS mod。因此本脚本把 CIA 的内容（RomFS/ExeFS）解出来，按
`load/mods/<基础TitleID>/{romfs,exefs}/...` 的结构打包成 zip：

    输出：<输出目录>/<基础TitleID>.zip
    落点：资源服务器  Roms/<平台>/mods/<基础TitleID>.zip
    引用：games.json 对应游戏里加  "mod": "mods/<基础TitleID>.zip"

依赖：pyctr（pip install pyctr）。
限制：只支持**未加密（no_crypto）**的 CIA。加密的 CIA 需要真实 3DS 密钥
（boot9.bin）——本脚本不提供、也不内置任何密钥。

用法：
    python scripts/media/cia-to-mod.py <cia文件或目录> <输出目录> [--name base|title]
"""

import argparse
import os
import re
import shutil
import sys
import tempfile
import zipfile
from collections import defaultdict

# --- 让 pyctr 在无密钥环境下读取「未加密」内容 -----------------------------
# 未加密（NCCH flags bit2 = no_crypto）的内容是明文，不需要任何密钥；
# pyctr 默认仍要求 boot9/ticket，这里把相关步骤置空，并用零值补齐缺失的 keyslot。
from pyctr.crypto.engine import CryptoEngine  # noqa: E402

CryptoEngine.setup_keys_from_boot9_file = lambda self, path=None: None
CryptoEngine.setup_keys_from_boot9 = lambda self, b9: None
CryptoEngine.load_from_ticket = lambda self, ticket: None
CryptoEngine.load_encrypted_titlekey = lambda self, *a, **k: None
CryptoEngine.load_from_ticketfile = lambda self, *a, **k: None
_orig_init = CryptoEngine.__init__


def _patched_init(self, *a, **k):
    _orig_init(self, *a, **k)
    self.key_x = defaultdict(lambda: 0, self.key_x or {})
    self.key_y = defaultdict(lambda: 0, self.key_y or {})
    self.key_normal = defaultdict(lambda: b"\x00" * 16, self.key_normal or {})


CryptoEngine.__init__ = _patched_init

from pyctr.type.cia import CIAReader  # noqa: E402
from pyctr.type.ncch import NCCHSection  # noqa: E402


def base_title_id(tid: str) -> str:
    """更新/追加标题 ID（0004000E… / 0004008C…）→ 基础游戏标题 ID（00040000…）。"""
    t = tid.lower().replace("-", "")
    if len(t) == 16:
        # 第 4 个字节（第 7、8 个十六进制字符）表示类型，基础游戏为 00
        return t[:6] + "00" + t[8:]
    return t


def is_no_crypto(cia_path: str) -> bool:
    with open(cia_path, "rb") as f:
        head = f.read(1 << 20)
    pos = head.find(b"NCCH")
    if pos < 0:
        return False
    hdr = pos - 0x100
    if hdr + 0x18F >= len(head):
        return False
    return bool(head[hdr + 0x18F] & 0x04)


def dump_romfs(romfs, dest_root: str) -> int:
    count = 0
    root = romfs._tree_root  # pyctr 内部树：{'type','contents','name','offset','size'}

    def rec(node, fs_path, rom_path):
        nonlocal count
        for child in node.get("contents", {}).values():
            name = child["name"]
            fsp = os.path.join(fs_path, name)
            rmp = f"{rom_path}/{name}"
            if child["type"] == "dir":
                os.makedirs(fsp, exist_ok=True)
                rec(child, fsp, rmp)
            else:
                os.makedirs(os.path.dirname(fsp), exist_ok=True)
                with romfs.open(rmp) as r, open(fsp, "wb") as w:
                    shutil.copyfileobj(r, w)
                count += 1

    rec(root, dest_root, "")
    return count


def dump_exefs_raw(content, dest_root: str) -> int:
    """按 ExeFS 原始布局导出（不自动解压 .code），与补丁内的字节一致。"""
    try:
        raw = content.open_raw_section(NCCHSection.ExeFS).read()
    except Exception:
        return 0
    if len(raw) < 0x200:
        return 0
    os.makedirs(dest_root, exist_ok=True)
    count = 0
    for i in range(10):
        ent = raw[i * 16:(i + 1) * 16]
        name = ent[0:8].rstrip(b"\x00").decode("ascii", "ignore")
        off = int.from_bytes(ent[8:12], "little")
        size = int.from_bytes(ent[12:16], "little")
        if not name or size == 0:
            continue
        with open(os.path.join(dest_root, name), "wb") as w:
            w.write(raw[0x200 + off:0x200 + off + size])
        count += 1
    return count


def dump_exheader(content, dest_root: str) -> int:
    """导出 ExHeader（0x400）为 exheader.bin（Citra/Azahar 的 mod 会用它）。"""
    try:
        raw = content.open_raw_section(NCCHSection.ExtendedHeader).read()
    except Exception:
        return 0
    if not raw:
        return 0
    with open(os.path.join(dest_root, "exheader.bin"), "wb") as w:
        w.write(raw[:0x400])
    return 1


def convert(cia_path: str, out_dir: str, name_mode: str = "base") -> dict:
    if not is_no_crypto(cia_path):
        raise RuntimeError("不是未加密（no_crypto）CIA，需要真实 3DS 密钥，已跳过")

    tmp = tempfile.mkdtemp(prefix="mod_")
    try:
        with CIAReader(cia_path) as r:
            tid = r.tmd.title_id
            base = base_title_id(tid)
            root = os.path.join(tmp, "load", "mods", base)
            os.makedirs(root, exist_ok=True)
            n_rom = n_exe = 0
            for _, content in r.contents.items():
                romfs = getattr(content, "romfs", None)
                if romfs:
                    n_rom += dump_romfs(romfs, os.path.join(root, "romfs"))
                n_exe += dump_exefs_raw(content, os.path.join(root, "exefs"))
                if not romfs:
                    # 没有 RomFS 的补丁（代码/ExHeader 补丁）额外带上 exheader
                    dump_exheader(content, root)
        zip_name = f"{base if name_mode == 'base' else tid}.zip"
        out_zip = os.path.join(out_dir, zip_name)
        os.makedirs(out_dir, exist_ok=True)
        # 打包 load/mods/<base>/... 保持目录结构
        with zipfile.ZipFile(out_zip, "w", zipfile.ZIP_DEFLATED) as zf:
            for dirpath, _, files in os.walk(tmp):
                for fn in files:
                    full = os.path.join(dirpath, fn)
                    rel = os.path.relpath(full, tmp).replace(os.sep, "/")
                    zf.write(full, rel)
        size = os.path.getsize(out_zip)
        return {"cia": os.path.basename(cia_path), "title_id": tid, "base": base,
                "romfs_files": n_rom, "exefs_files": n_exe, "zip": out_zip, "zip_size": size}
    finally:
        shutil.rmtree(tmp, ignore_errors=True)


def main():
    ap = argparse.ArgumentParser(description="3DS 补丁 CIA → EmberHub LayeredFS mod 包")
    ap.add_argument("input", help="CIA 文件，或包含 CIA 的目录")
    ap.add_argument("out", help="输出目录（放到 Roms/<平台>/mods/）")
    ap.add_argument("--name", choices=["base", "title"], default="base",
                    help="zip 命名：base=基础 TitleID（默认），title=补丁 TitleID")
    args = ap.parse_args()

    if os.path.isdir(args.input):
        files = [os.path.join(args.input, f) for f in os.listdir(args.input)
                 if f.lower().endswith(".cia")]
    else:
        files = [args.input]

    ok = skipped = 0
    for f in files:
        try:
            r = convert(f, args.out, args.name)
            ok += 1
            print(f"[OK] {r['cia']} -> {os.path.basename(r['zip'])} "
                  f"(title {r['title_id']}, base {r['base']}, "
                  f"romfs {r['romfs_files']} / exefs {r['exefs_files']} files, "
                  f"{r['zip_size']/1e6:.1f} MB)")
        except Exception as e:
            skipped += 1
            print(f"[SKIP] {os.path.basename(f)}: {e}")
    print(f"\n完成：成功 {ok}，跳过 {skipped}")
    return 0 if ok else 1


if __name__ == "__main__":
    sys.exit(main())
