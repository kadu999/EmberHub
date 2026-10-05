#!/usr/bin/env python3
# -*- coding: utf-8 -*-
"""
百度网盘 refresh_token 获取工具（给 OpenList / EmberHub 用）

只用 Python 标准库，无需 pip 安装任何东西。

用法：
  1. 在下面「填写参数」区域填入 APP_KEY / SECRET_KEY（可选 APP_ID）
  2. 在百度开放平台控制台 → 你的应用 → 安全设置 → OAuth 回调地址，
     填成与 REDIRECT_URI 完全一致的值（默认 oob）
  3. 运行：python scripts/media/baidu_token.py
  4. 浏览器登录并授权后，把地址栏整条 URL（或只把 code）粘回终端

拿到 refresh_token 后，填进 OpenList 的百度网盘存储，并【取消勾选】「使用在线 API」。
"""

import json
import os
import re
import sys
import urllib.error
import urllib.parse
import urllib.request
import webbrowser

# ============================ 填写参数 ============================
APP_KEY = "HOVSD4Xn89hAXcs6KzxFGweo0KAavalW"          # 必填：百度开放平台 AppKey（百度 OAuth 里的 client_id）
SECRET_KEY = "QTsfmYkNP2FGdTeMvOMwtq3GeftRswRk"       # 必填：百度开放平台 SecretKey（百度 OAuth 里的 client_secret）
APP_ID = "124406017"           # 选填：AppID（仅硬件应用会作为 device_id 传，软件应用留空）
REDIRECT_URI = "oob"  # 必须与百度应用「安全设置 → OAuth 回调地址」完全一致
SCOPE = "basic,netdisk"

# ==================== 可选：拿到 token 后自动写入 OpenList ====================
AUTO_CREATE_OPENLIST = False        # 改成 True 即可自动在 OpenList 建存储
OPENLIST_URL = "http://127.0.0.1:5244"
OPENLIST_USER = "admin"
OPENLIST_PASS = ""                  # 填你的 OpenList 密码
MOUNT_PATH = "/Baidu"               # OpenList 里的挂载路径（不能与已有存储重复）
ROOT_FOLDER_PATH = "/"              # 挂载网盘的根文件夹
# ==================================================================

AUTHORIZE_URL = "https://openapi.baidu.com/oauth/2.0/authorize"
TOKEN_URL = "https://openapi.baidu.com/oauth/2.0/token"
UINFO_URL = "https://pan.baidu.com/rest/2.0/xpan/nas"

# Windows 控制台按 UTF-8 输出，避免中文报错
for _stream in (sys.stdout, sys.stderr, sys.stdin):
    try:
        _stream.reconfigure(encoding="utf-8")  # type: ignore[attr-defined]
    except Exception:
        pass


def http_get(url):
    """GET 请求，返回 (status, text)。不抛异常，方便打印百度的错误信息。"""
    req = urllib.request.Request(url, headers={"User-Agent": "pan.baidu.com"})
    try:
        with urllib.request.urlopen(req, timeout=30) as resp:
            return resp.status, resp.read().decode("utf-8", "replace")
    except urllib.error.HTTPError as e:
        return e.code, e.read().decode("utf-8", "replace")
    except Exception as e:  # 网络错误
        return -1, str(e)


def http_post_json(url, payload, token=None):
    data = json.dumps(payload).encode("utf-8")
    headers = {"Content-Type": "application/json"}
    if token:
        headers["Authorization"] = token
    req = urllib.request.Request(url, data=data, headers=headers, method="POST")
    with urllib.request.urlopen(req, timeout=30) as resp:
        return json.loads(resp.read().decode("utf-8", "replace"))


def build_authorize_url():
    params = {
        "response_type": "code",
        "client_id": APP_KEY,
        "redirect_uri": REDIRECT_URI,
        "scope": SCOPE,
        "display": "page",
    }
    if APP_ID:
        params["device_id"] = APP_ID
    # 让 scope 的逗号保持字面量（百度文档要求英文逗号 basic,netdisk）
    return AUTHORIZE_URL + "?" + urllib.parse.urlencode(params).replace("%2C", ",")


def extract_code(text):
    """从粘贴内容里解析 code：支持整条 URL、'code=xxx'、或直接粘 code。"""
    text = text.strip().strip('"').strip("'")
    m = re.search(r"[?&#]code=([^&\s#]+)", text)
    if m:
        return urllib.parse.unquote(m.group(1))
    m = re.search(r"code[：:\s=]+([0-9A-Za-z_\-]{16,})", text)
    if m:
        return m.group(1)
    m = re.search(r"([0-9A-Za-z_\-]{16,})", text)
    if m:
        return m.group(1)
    return text


def exchange_code(code):
    params = {
        "grant_type": "authorization_code",
        "code": code,
        "client_id": APP_KEY,
        "client_secret": SECRET_KEY,
        "redirect_uri": REDIRECT_URI,
    }
    status, text = http_get(TOKEN_URL + "?" + urllib.parse.urlencode(params))
    try:
        return json.loads(text)
    except Exception:
        return {"_status": status, "_raw": text}


def verify_account(access_token):
    status, text = http_get(
        UINFO_URL + "?method=uinfo&access_token=" + urllib.parse.quote(access_token)
    )
    try:
        return json.loads(text)
    except Exception:
        return {"_status": status, "_raw": text}


def create_openlist_storage(refresh_token):
    print("\n正在写入 OpenList ...")
    try:
        lj = http_post_json(
            OPENLIST_URL + "/api/auth/login",
            {"username": OPENLIST_USER, "password": OPENLIST_PASS},
        )
        token = lj["data"]["token"]
        addition = {
            "root_folder_path": ROOT_FOLDER_PATH,
            "order_by": "name",
            "order_direction": "asc",
            "download_api": "official",
            "use_online_api": False,
            "client_id": APP_KEY,
            "client_secret": SECRET_KEY,
            "custom_crack_ua": "netdisk",
            "refresh_token": refresh_token,
            "upload_thread": "3",
            "upload_timeout": 60,
            "upload_api": "https://d.pcs.baidu.com",
            "use_dynamic_upload_api": True,
            "custom_upload_part_size": 0,
            "low_bandwith_upload_mode": False,
            "only_list_video_file": False,
        }
        payload = {
            "mount_path": MOUNT_PATH,
            "order": 0,
            "driver": "BaiduNetdisk",
            "cache_expiration": 30,
            "status": "work",
            "addition": json.dumps(addition, ensure_ascii=False),
            "web_proxy": True,
            "webdav_policy": "native_proxy",
        }
        res = http_post_json(
            OPENLIST_URL + "/api/admin/storage/create", payload, token=token
        )
        print("OpenList 返回：", json.dumps(res, ensure_ascii=False))
        if res.get("code") == 200:
            print("已在 OpenList 建好存储，挂载路径：", MOUNT_PATH)
    except Exception as e:
        print("写入 OpenList 失败：", e)


def main():
    if not APP_KEY or not SECRET_KEY:
        print("请先在脚本顶部填写 APP_KEY 与 SECRET_KEY。")
        sys.exit(1)

    url = build_authorize_url()
    print("=" * 72)
    print("第 1 步：在浏览器打开下面的授权链接（已尝试自动打开）")
    print("=" * 72)
    print(url)
    print()
    print("提示：授权前请确认百度应用「安全设置 → OAuth 回调地址」=", REDIRECT_URI)
    print("      （回调地址配置后约 1 小时才生效）")
    print()
    try:
        webbrowser.open(url)
    except Exception:
        pass

    raw = input(
        "第 2 步：登录并授权后，把跳转地址栏的整条 URL（或只把 code）粘贴到这里：\n> "
    )
    code = extract_code(raw)
    if not code:
        print("没有解析到 code。")
        sys.exit(1)

    print("\n正在用 code 换取 token ...")
    data = exchange_code(code)
    if "refresh_token" not in data:
        print("换取失败，百度返回：")
        print(json.dumps(data, ensure_ascii=False, indent=2))
        print("\n常见原因：redirect_uri 与应用回调地址不一致（redirect_uri_mismatch）、")
        print("code 已过期或重复使用、scope 不是 basic,netdisk（英文逗号）。")
        sys.exit(1)

    access_token = data.get("access_token", "")
    refresh_token = data["refresh_token"]

    print("\n" + "=" * 72)
    print("成功！")
    print("=" * 72)
    print("refresh_token :", refresh_token)
    print("access_token  :", (access_token[:40] + "...") if access_token else "(空)")
    print("expires_in    :", data.get("expires_in"))
    print()

    info = verify_account(access_token)
    if isinstance(info, dict) and info.get("errno") == 0:
        print(
            "账号验证成功：",
            info.get("baidu_name") or info.get("netdisk_name"),
            "| vip_type =",
            info.get("vip_type"),
        )
    else:
        print("账号验证返回：", json.dumps(info, ensure_ascii=False))

    out = {
        "app_key": APP_KEY,
        "redirect_uri": REDIRECT_URI,
        "refresh_token": refresh_token,
        "access_token": access_token,
    }
    try:
        out_dir = os.path.join(os.path.dirname(os.path.abspath(__file__)), "..", "..", "data", "secrets")
        os.makedirs(out_dir, exist_ok=True)
        with open(os.path.join(out_dir, "baidu_token.json"), "w", encoding="utf-8") as f:
            json.dump(out, f, ensure_ascii=False, indent=2)
        print("\n已保存到 data/secrets/baidu_token.json（注意：含密钥，已被 .gitignore 排除）")
    except Exception as e:
        print("\n保存文件失败（不影响使用）：", e)

    print("\n下一步：把 refresh_token 填进 OpenList 的百度网盘存储，")
    print("        client_id = AppKey，client_secret = SecretKey，并【取消勾选】「使用在线 API」。")

    if AUTO_CREATE_OPENLIST:
        create_openlist_storage(refresh_token)


if __name__ == "__main__":
    main()
