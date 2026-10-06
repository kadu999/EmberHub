// 设置页：OpenList 资源源配置 + 下载目录 + 媒体缓存。
// 默认隐藏，按 F1 打开。
import { useEffect, useState } from "react";
import { useStore } from "../../state/store";
import { APP_CONFIG } from "../../config/config";
import { createProvider } from "../../storage";
import { tauri } from "../../shared/tauri";
import { mediaCacheRoot } from "../../domain/ensure";
import { platform } from "../../platform";
import type { SourceConfig } from "../../storage/types";

interface Props {
  onClose?: () => void;
}

// OpenList 表单默认值来自 src/config.json
const DEFAULT_SERVER = APP_CONFIG.openlist.server;
const DEFAULT_USER = APP_CONFIG.openlist.username;
const DEFAULT_PASS = APP_CONFIG.openlist.password;

interface Mount {
  path: string;
  name: string;
}

function formatSize(n: number | null): string {
  if (n === null) return "—";
  if (n < 1024) return `${n} B`;
  if (n < 1024 * 1024) return `${(n / 1024).toFixed(1)} KB`;
  if (n < 1024 ** 3) return `${(n / 1024 / 1024).toFixed(1)} MB`;
  return `${(n / 1024 ** 3).toFixed(2)} GB`;
}

export function SourcesPage({ onClose }: Props) {
  const setSource = useStore((s) => s.setSource);
  const downloadDir = useStore((s) => s.downloadDir);
  const setDownloadDir = useStore((s) => s.setDownloadDir);
  const requestScan = useStore((s) => s.requestScan);
  const fullscreen = useStore((s) => s.fullscreen);
  const toggleFullscreen = useStore((s) => s.toggleFullscreen);

  // 打开设置时用当前资源源初始化表单（面板每次 F1 都会重新挂载）
  const initial = useStore.getState().source;

  // Android：存储位置（私有目录 / 共享存储）
  const mobile = platform.isMobile;
  const storageMode = useStore((s) => s.storageMode);
  const setStorageMode = useStore((s) => s.setStorageMode);
  const [sharedDir, setSharedDir] = useState("");
  useEffect(() => {
    if (!mobile) return;
    tauri.sharedStorageDir().then(setSharedDir).catch(() => undefined);
  }, [mobile]);

  const [defaultDir, setDefaultDir] = useState("");
  useEffect(() => {
    tauri.defaultDownloadDir().then(setDefaultDir).catch(() => undefined);
  }, []);

  const [server, setServer] = useState(initial?.server ?? DEFAULT_SERVER);
  const [mountPath, setMountPath] = useState(
    initial?.mountPath ?? APP_CONFIG.openlist.mountPath,
  );
  const [mounts, setMounts] = useState<Mount[]>([]);
  const [loadingMounts, setLoadingMounts] = useState(false);
  const [username, setUsername] = useState(initial?.username ?? DEFAULT_USER);
  const [password, setPassword] = useState(initial?.password ?? DEFAULT_PASS);
  const [romsPath, setRomsPath] = useState(initial?.romsPath ?? APP_CONFIG.defaults.romsPath);
  const [emulatorsPath, setEmulatorsPath] = useState(
    initial?.emulatorsPath ?? APP_CONFIG.defaults.emulatorsPath,
  );
  // romsPath / emulatorsPath 固定用默认值，界面上不再暴露
  void setRomsPath;
  void setEmulatorsPath;
  const [message, setMessage] = useState<{ ok: boolean; text: string } | null>(null);
  const [testing, setTesting] = useState(false);
  const [cacheSize, setCacheSize] = useState<number | null>(null);
  const [clearing, setClearing] = useState(false);

  async function refreshCacheSize() {
    try {
      setCacheSize(await tauri.pathSize(await mediaCacheRoot()));
    } catch {
      setCacheSize(null);
    }
  }

  // 下载目录变化时刷新缓存占用
  useEffect(() => {
    void refreshCacheSize();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [downloadDir]);

  async function clearMediaCache() {
    setClearing(true);
    try {
      await tauri.removePath(await mediaCacheRoot());
      await refreshCacheSize();
      setMessage({ ok: true, text: "媒体缓存已清理" });
    } catch (e) {
      setMessage({ ok: false, text: `清理失败：${String(e)}` });
    } finally {
      setClearing(false);
    }
  }

  /** Android：切换存储位置（私有目录 / 共享存储）。共享存储需要「所有文件访问」权限。 */
  async function chooseStorage(mode: "private" | "shared") {
    if (mode === "private") {
      setStorageMode("private");
      setDownloadDir("");
      setMessage({ ok: true, text: "已使用 App 私有目录（不需要权限）" });
      return;
    }
    try {
      if (!(await tauri.hasAllFilesAccess())) {
        await tauri.requestAllFilesAccess();
        setMessage({
          ok: false,
          text: "请在系统设置里允许 EmberHub「所有文件访问」，回来后再点一次「共享存储」",
        });
        return;
      }
      const dir = sharedDir || (await tauri.sharedStorageDir());
      setSharedDir(dir);
      setDownloadDir(dir);
      setStorageMode("shared");
      setMessage({ ok: true, text: `已使用共享存储：${dir}` });
    } catch (e) {
      setMessage({ ok: false, text: `切换失败：${String(e)}` });
    }
  }

  /** 只填 IP:端口 也能用，自动补 http:// 并去掉结尾斜杠。 */
  function normalizeServer(v: string): string {
    const s = v.trim().replace(/\/+$/, "");
    if (!s) return "";
    return /^https?:\/\//i.test(s) ? s : `http://${s}`;
  }

  /** 从 OpenList 拉取资源源（挂载）列表。 */
  async function fetchMounts() {
    const base = normalizeServer(server);
    if (!base) {
      setMessage({ ok: false, text: "请先填写 OpenList 地址（IP:端口）" });
      return;
    }
    setLoadingMounts(true);
    setMessage(null);
    try {
      const entries = await tauri.webdavList(
        { root: `${base}/dav`, username: username.trim(), password },
        "",
      );
      const dirs: Mount[] = entries
        .filter((e) => e.is_dir)
        .map((e) => ({ path: `/${e.path || e.name}`, name: e.name }));
      setMounts(dirs);
      if (dirs.length === 0) {
        setMessage({ ok: false, text: "没有找到资源源（检查账号密码，或 OpenList 里还没挂载存储）" });
      } else {
        setMountPath((prev) => (prev && dirs.some((d) => d.path === prev) ? prev : dirs[0].path));
        setMessage({ ok: true, text: `找到 ${dirs.length} 个资源源` });
      }
    } catch (e) {
      setMounts([]);
      setMessage({ ok: false, text: `获取失败：${String(e)}` });
    } finally {
      setLoadingMounts(false);
    }
  }

  function buildConfig(): SourceConfig | null {
    if (!normalizeServer(server) || !mountPath) return null;
    return {
      id: "main",
      name: mountPath.replace(/^\//, "") || "OpenList",
      kind: "openlist",
      romsPath: romsPath.trim() || APP_CONFIG.defaults.romsPath,
      emulatorsPath: emulatorsPath.trim() || APP_CONFIG.defaults.emulatorsPath,
      server: server.trim(),
      mountPath,
      username: username.trim(),
      password,
    };
  }

  /** 连接：连上了才保存设置（一步到位；游戏库会自动重新扫描） */
  async function connect() {
    const cfg = buildConfig();
    if (!cfg) {
      setMessage({ ok: false, text: "请填写必填项（地址与资源源）" });
      return;
    }
    setTesting(true);
    setMessage(null);
    try {
      const provider = createProvider(cfg);
      const entries = await provider.list(cfg.romsPath ?? "");
      setSource(cfg); // 连接成功才保存
      requestScan();
      setMessage({ ok: true, text: `连接成功，游戏目录下有 ${entries.length} 项` });
    } catch (e) {
      setMessage({ ok: false, text: `连接失败：${String(e)}` });
    } finally {
      setTesting(false);
    }
  }

  return (
    <div className="settings">
      <div className="settings-head">
        <h2>设置</h2>
        <div style={{ display: "flex", gap: 8 }}>
          <button className="ghost small" onClick={() => toggleFullscreen()}>
            {fullscreen ? "退出全屏" : "全屏"}
          </button>
          {onClose && (
            <button className="ghost small" onClick={onClose}>
              关闭（Esc）
            </button>
          )}
        </div>
      </div>
      <p className="hint">通过 OpenList（WebDAV）读取游戏库。游戏库放在「游戏目录」（默认 Roms）下。</p>

      {mobile && (
        <div className="card">
          <h3 style={{ marginTop: 0 }}>存储位置（固定：共享存储）</h3>
          <p className="hint">
            ROM / 模拟器 / APK 一律放 <code>{sharedDir || "/sdcard/EmberHub"}</code>，需要「所有文件访问」权限。
            模拟器是<b>另一个 App</b>，只能按路径读共享存储（App 私有目录它读不到），所以这里不做选择。
          </p>
          <div className="actions">
            <button
              className={storageMode === "shared" ? "" : "ghost"}
              onClick={() => void chooseStorage("shared")}
            >
              重新授权 / 使用共享存储
            </button>
          </div>
        </div>
      )}

      <div className="card">
        <h3 style={{ marginTop: 0 }}>下载目录</h3>
        <p className="hint">
          ROM 与模拟器的存放位置（其下自动创建 <code>Roms/</code> 与 <code>Emulators/</code>）。留空则使用程序目录。
        </p>
        <div className="field">
          <label>下载目录</label>
          <input
            value={downloadDir}
            onChange={(e) => setDownloadDir(e.currentTarget.value)}
            placeholder={defaultDir || "程序所在目录"}
          />
        </div>
        <div className="actions">
          <button className="ghost small" onClick={() => setDownloadDir("")}>
            重置为默认
          </button>
        </div>
        <p className="hint">
          当前默认：<code>{defaultDir || "程序所在目录"}</code>
        </p>
      </div>

      <div className="card">
        <h3 style={{ marginTop: 0 }}>媒体缓存</h3>
        <p className="hint">
          看过的封面/视频会缓存到本地，下次直接读取。当前占用：
          <code>{formatSize(cacheSize)}</code>
        </p>
        <div className="actions">
          <button className="ghost small" onClick={() => void refreshCacheSize()}>
            刷新
          </button>
          <button className="ghost small" disabled={clearing} onClick={() => void clearMediaCache()}>
            {clearing ? "清理中…" : "清理媒体缓存"}
          </button>
        </div>
      </div>

      <div className="card">
        <h3 style={{ marginTop: 0 }}>OpenList 资源源</h3>

        <div className="field">
          <label>OpenList 地址（IP:端口）</label>
          <input
            value={server}
            onChange={(e) => setServer(e.currentTarget.value)}
            placeholder="127.0.0.1:5244"
          />
        </div>
        <div className="field">
          <label>用户名</label>
          <input value={username} onChange={(e) => setUsername(e.currentTarget.value)} />
        </div>
        <div className="field">
          <label>密码</label>
          <input type="password" value={password} onChange={(e) => setPassword(e.currentTarget.value)} />
        </div>
        <div className="field">
          <label>资源源（OpenList 挂载，固定）</label>
          <div className="field-row">
            <select
              value={mountPath}
              onChange={(e) => setMountPath(e.currentTarget.value)}
              disabled
            >
              {mounts.length === 0 ? (
                <option value={mountPath}>
                  {mountPath || (loadingMounts ? "获取中…" : "点击右侧按钮获取")}
                </option>
              ) : (
                mounts.map((m) => (
                  <option key={m.path} value={m.path}>
                    {m.name}
                  </option>
                ))
              )}
            </select>
            <button className="ghost small" onClick={() => void fetchMounts()} disabled={loadingMounts}>
              {loadingMounts ? "获取中…" : "获取资源源"}
            </button>
          </div>
        </div>
        <div className="actions">
          <button disabled={testing} onClick={() => void connect()}>
            {testing ? "连接中…" : "连接"}
          </button>
        </div>

        {message && <p className={message.ok ? "ok" : "error"}>{message.text}</p>}
      </div>
    </div>
  );
}
