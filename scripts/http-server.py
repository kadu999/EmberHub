#!/usr/bin/env python3
# EmberHub HTTP 静态服务器（GUI）
#
# 用 Python 起一个纯静态 HTTP 服务器，托管资源目录（与网盘一致的 manifest.json / Roms / Emulators），
# 供 EmberHub「HTTP」存储源使用。支持：选择目录、设置端口、开/关外网、启动/停止、打开网页。
#
# 用法：
#   双击 scripts\http-server.bat
#   python scripts\http-server.py
#
# 注意事项：
#   - 服务器必须能「列目录」，Python 的 http.server 默认已开启。
#   - 「外网」默认开启：绑定 0.0.0.0，允许局域网 / 其它设备访问（Windows 防火墙可能需放行）；
#     取消勾选则绑 127.0.0.1，仅本机可访问。

import json
import os
import re
import socket
import sys
import threading
import webbrowser
from functools import partial
from http.server import SimpleHTTPRequestHandler, ThreadingHTTPServer

try:
    import tkinter as tk
    from tkinter import filedialog, messagebox, ttk
except Exception as exc:  # tkinter 缺失（极少见）
    print("无法加载 tkinter（需要 Python 自带的 Tk）：", exc, file=sys.stderr)
    sys.exit(1)

REPO_ROOT = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))
DATA_DIR = os.path.join(REPO_ROOT, "data")
STATE_FILE = os.path.join(DATA_DIR, "http-server.json")
DEFAULT_ROOT = os.path.join(REPO_ROOT, "server")


_VIRTUAL_RE = re.compile(
    r"vmware|virtualbox|hyper-?v|vethernet|loopback|tap-|tap |wsl|docker|"
    r"bluetooth|npcap|virtual adapter|vpn|wireguard|openvpn|tailscale|zerotier",
    re.I,
)

_WIN_IP_MAP = None  # 缓存：{ip: 网卡描述}


def _windows_ip_map():
    """Windows：返回 {ip: 网卡描述}；失败或非 Windows 返回 None。"""
    global _WIN_IP_MAP
    if _WIN_IP_MAP is not None:
        return _WIN_IP_MAP or None
    if os.name != "nt":
        _WIN_IP_MAP = {}
        return None
    try:
        import subprocess

        ps = (
            "[Console]::OutputEncoding=[System.Text.Encoding]::UTF8; "
            "Get-NetIPAddress -AddressFamily IPv4 | "
            "Select-Object IPAddress,InterfaceAlias | ConvertTo-Json -Compress"
        )
        r = subprocess.run(
            ["powershell", "-NoProfile", "-NonInteractive", "-Command", ps],
            capture_output=True,
            encoding="utf-8",
            errors="replace",
            timeout=8,
            creationflags=getattr(subprocess, "CREATE_NO_WINDOW", 0),
        )
        if r.returncode != 0 or not r.stdout.strip():
            _WIN_IP_MAP = {}
            return None
        data = json.loads(r.stdout)
        if isinstance(data, dict):
            data = [data]
        _WIN_IP_MAP = {
            item["IPAddress"]: (item.get("InterfaceAlias") or "")
            for item in data
            if item.get("IPAddress")
        }
    except Exception:
        _WIN_IP_MAP = {}
    return _WIN_IP_MAP or None


def local_ips(only_real=True):
    """本机可用于对外访问的 IPv4（默认路由优先，过滤回环 / 链路本地）。

    only_real=True 时进一步过滤 VMware / VirtualBox / Hyper-V 等虚拟网卡。
    """
    ips = []
    try:
        s = socket.socket(socket.AF_INET, socket.SOCK_DGRAM)
        try:
            # 不会真正发包，仅取本机出口 IP
            s.connect(("8.8.8.8", 80))
            ips.append(s.getsockname()[0])
        finally:
            s.close()
    except OSError:
        pass
    try:
        for info in socket.getaddrinfo(socket.gethostname(), None, socket.AF_INET):
            ip = info[4][0]
            if ip not in ips:
                ips.append(ip)
    except OSError:
        pass
    ips = [ip for ip in ips if not ip.startswith("127.") and not ip.startswith("169.254.")]

    if only_real:
        ipmap = _windows_ip_map()
        if ipmap is not None:
            real = [ip for ip in ips if ip in ipmap and not _VIRTUAL_RE.search(ipmap[ip])]
            if real:  # 过滤后为空则退回全部，避免什么都看不到
                return real
    return ips


class _QuietHandler(SimpleHTTPRequestHandler):
    """静态文件处理器；静默日志避免刷屏。"""

    def log_message(self, fmt, *args):  # noqa: A003
        pass


class Server:
    """后台线程里运行的静态 HTTP 服务器。"""

    def __init__(self, root: str, host: str, port: int):
        handler = partial(_QuietHandler, directory=root)
        self.httpd = ThreadingHTTPServer((host, port), handler)
        self.host = host
        # 端口为 0 时由系统分配，取实际端口
        self.port = self.httpd.server_address[1]
        self._thread = None

    def start(self) -> None:
        self._thread = threading.Thread(target=self.httpd.serve_forever, daemon=True)
        self._thread.start()

    def stop(self) -> None:
        try:
            self.httpd.shutdown()
            self.httpd.server_close()
        except Exception:
            pass

    @property
    def running(self) -> bool:
        return self._thread is not None and self._thread.is_alive()


class App(tk.Tk):
    def __init__(self):
        super().__init__()
        self.title("EmberHub - HTTP 静态服务器")
        self.resizable(False, False)
        self.server = None
        self._load_state()
        self._build_ui()
        self.protocol("WM_DELETE_WINDOW", self._on_close)

    # ---------- 状态 ----------
    def _load_state(self):
        state = {}
        try:
            with open(STATE_FILE, "r", encoding="utf-8") as f:
                state = json.load(f)
        except Exception:
            pass
        root = state.get("root") or DEFAULT_ROOT
        if not os.path.isdir(root):
            root = DEFAULT_ROOT
        self.var_root = tk.StringVar(value=root)
        self.var_port = tk.StringVar(value=str(state.get("port", 8000)))
        # 「外网」（绑 0.0.0.0，允许局域网 / 其它设备访问）默认开启。
        # 兼容旧配置：以前用 bind == "0.0.0.0" 表示外网、bind == "127.0.0.1" 表示仅本机。
        external = state.get("external")
        if external is None:
            bind = state.get("bind")
            external = True if bind is None else (bind == "0.0.0.0")
        self.var_external = tk.BooleanVar(value=bool(external))

    def _save_state(self):
        try:
            os.makedirs(DATA_DIR, exist_ok=True)
            with open(STATE_FILE, "w", encoding="utf-8") as f:
                json.dump(
                    {
                        "root": self.var_root.get(),
                        "port": int(self.var_port.get() or 8000),
                        "external": bool(self.var_external.get()),
                    },
                    f,
                    ensure_ascii=False,
                    indent=2,
                )
        except Exception:
            pass

    # ---------- 界面 ----------
    def _build_ui(self):
        frm = ttk.Frame(self, padding=12)
        frm.grid(sticky="nsew")

        ttk.Label(frm, text="目录").grid(row=0, column=0, sticky="w")
        self.ent_root = ttk.Entry(frm, textvariable=self.var_root, width=48)
        self.ent_root.grid(row=0, column=1, columnspan=2, sticky="we", padx=8)
        ttk.Button(frm, text="浏览…", command=self._browse).grid(row=0, column=3)

        ttk.Label(frm, text="端口").grid(row=1, column=0, sticky="w", pady=(10, 0))
        self.ent_port = ttk.Entry(frm, textvariable=self.var_port, width=10)
        self.ent_port.grid(row=1, column=1, sticky="w", padx=8, pady=(10, 0))
        self.chk_external = ttk.Checkbutton(
            frm,
            text="外网（允许其它设备访问）",
            variable=self.var_external,
            command=self._preview,
        )
        self.chk_external.grid(row=1, column=2, columnspan=2, sticky="w", pady=(10, 0))

        btns = ttk.Frame(frm)
        btns.grid(row=2, column=0, columnspan=4, sticky="w", pady=(14, 0))
        self.btn_start = ttk.Button(btns, text="启动", command=self._start)
        self.btn_start.grid(row=0, column=0)
        self.btn_stop = ttk.Button(btns, text="停止", command=self._stop, state="disabled")
        self.btn_stop.grid(row=0, column=1, padx=8)
        self.btn_open = ttk.Button(btns, text="打开网页", command=self._open, state="disabled")
        self.btn_open.grid(row=0, column=2)

        self.lbl_status = ttk.Label(frm, text="未运行", justify="left")
        self.lbl_status.grid(row=3, column=0, columnspan=4, sticky="w", pady=(14, 0))

        urlfrm = ttk.Frame(frm)
        urlfrm.grid(row=4, column=0, columnspan=4, sticky="we", pady=(6, 0))
        urlfrm.columnconfigure(0, weight=1)
        self.var_url = tk.StringVar(value="")
        self.ent_url = ttk.Entry(urlfrm, textvariable=self.var_url, state="readonly")
        self.ent_url.grid(row=0, column=0, sticky="we")
        self.btn_copy = ttk.Button(urlfrm, text="复制", command=self._copy, state="disabled")
        self.btn_copy.grid(row=0, column=1, padx=(8, 0))

        self.bind("<Return>", lambda _e: self._start() if not self._running() else None)

        self.update_idletasks()
        self.minsize(self.winfo_reqwidth(), self.winfo_reqheight())
        self._preview()

    # ---------- 逻辑 ----------
    def _running(self) -> bool:
        return self.server is not None and self.server.running

    @staticmethod
    def _port_in_use(host: str, port: int) -> bool:
        """检测端口是否已被占用（含只绑 127.0.0.1 的旧实例）。"""
        target = "127.0.0.1" if host in ("0.0.0.0", "::") else host
        try:
            with socket.create_connection((target, port), timeout=0.4):
                return True
        except OSError:
            return False

    def _browse(self):
        initial = self.var_root.get() if os.path.isdir(self.var_root.get()) else REPO_ROOT
        chosen = filedialog.askdirectory(title="选择要托管的资源目录", initialdir=initial)
        if chosen:
            self.var_root.set(os.path.normpath(chosen))

    def _preview(self):
        """未运行时，提前显示将要使用的地址（打开外网时给出完整 IP）。"""
        if self._running():
            return
        try:
            port = int(self.var_port.get())
        except ValueError:
            port = 8000
        if self.var_external.get():
            ips = local_ips()
            primary = ips[0] if ips else None
            if primary:
                lines = ["未运行（外网）—— 启动后可用：", f"对外地址：http://{primary}:{port}/"]
                extras = ips[1:]
                if extras:
                    lines.append("其它网卡（可能为虚拟网卡，一般无需使用）：")
                    lines.extend(f"  http://{ip}:{port}/" for ip in extras)
                self.var_url.set(f"http://{primary}:{port}/")
            else:
                self.lbl_status.config(text="未运行（外网）—— 未找到局域网 IP")
                self.var_url.set("")
                return
            self.lbl_status.config(text="\n".join(lines))
        else:
            url = f"http://127.0.0.1:{port}/"
            self.lbl_status.config(text="未运行（仅本机）")
            self.var_url.set(url)

    def _start(self):
        if self._running():
            return
        root = self.var_root.get().strip().strip('"')
        if not os.path.isdir(root):
            messagebox.showerror("目录无效", f"目录不存在：\n{root}")
            return
        try:
            port = int(self.var_port.get())
            if not (0 <= port < 65536):
                raise ValueError
        except ValueError:
            messagebox.showerror("端口无效", "端口需为 0-65535 的整数。")
            return
        external = bool(self.var_external.get())
        host = "0.0.0.0" if external else "127.0.0.1"

        # 目录完整性提示：资源根应有 manifest.json（缺失通常是选错了目录）
        if not os.path.isfile(os.path.join(root, "manifest.json")):
            if not messagebox.askyesno(
                "目录可能不完整",
                "该目录下没有 manifest.json：\n"
                f"{root}\n\n"
                "完整的资源根应包含 manifest.json、Roms、Emulators。\n"
                "仍要启动吗？",
            ):
                return

        # 端口占用提示：旧实例可能只绑了 127.0.0.1，导致 localhost 命中错误的服务
        if port != 0 and self._port_in_use(host, port):
            messagebox.showerror(
                "端口已被占用",
                f"端口 {port} 已在监听，可能是之前启动的旧实例。\n"
                "请先关闭它（或换一个端口），否则 http://127.0.0.1 可能连到错误的服务。",
            )
            return

        try:
            self.server = Server(root, host, port)
            self.server.start()
        except OSError as exc:
            self.server = None
            messagebox.showerror("启动失败", f"端口 {port} 可能已被占用。\n\n{exc}")
            return
        self.var_root.set(root)
        self.var_port.set(str(self.server.port))
        self._save_state()
        self._apply_running(True, root, external, self.server.port)

    def _stop(self):
        if self.server:
            self.server.stop()
            self.server = None
        self._apply_running(False)
        self._preview()

    def _open(self):
        if self._running():
            webbrowser.open(self.var_url.get())

    def _copy(self):
        url = self.var_url.get()
        if url:
            self.clipboard_clear()
            self.clipboard_append(url)

    def _apply_running(self, running, root="", external=False, port=0):
        self.btn_start.config(state="disabled" if running else "normal")
        self.btn_stop.config(state="normal" if running else "disabled")
        self.btn_open.config(state="normal" if running else "disabled")
        self.btn_copy.config(state="normal" if running else "disabled")
        self.ent_root.config(state="disabled" if running else "normal")
        self.ent_port.config(state="disabled" if running else "normal")
        self.chk_external.config(state="disabled" if running else "normal")
        if not running:
            self.var_url.set("")
            return

        if external:
            ips = local_ips()
            primary = ips[0] if ips else None
            lines = ["运行中（外网）："]
            if primary:
                lines.append(f"对外地址：http://{primary}:{port}/")
                extras = ips[1:]
                if extras:
                    lines.append("其它网卡（可能为虚拟网卡，一般无需使用）：")
                    lines.extend(f"  http://{ip}:{port}/" for ip in extras)
            else:
                lines.append("未找到局域网 IP，请检查网络")
            lines.append(f"本机：http://127.0.0.1:{port}/")
            lines.append(f"资源目录：{root}")
            self.var_url.set(f"http://{primary or '127.0.0.1'}:{port}/")
            self.lbl_status.config(text="\n".join(lines))
        else:
            url = f"http://127.0.0.1:{port}/"
            self.var_url.set(url)
            self.lbl_status.config(text=f"运行中（仅本机）：{url}\n资源目录：{root}")

    def _on_close(self):
        self._stop()
        self.destroy()


def main():
    App().mainloop()


if __name__ == "__main__":
    try:
        main()
    except Exception as exc:  # 让 pythonw 下的错误也能被看到
        import traceback

        traceback.print_exc()
        try:
            messagebox.showerror("EmberHub HTTP 服务器", f"启动出错：\n{exc}")
        except Exception:
            pass
        sys.exit(1)
