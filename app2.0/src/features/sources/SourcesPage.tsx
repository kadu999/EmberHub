// 设置页：OpenList 资源源配置 + 下载目录 + 缓存清理（测试用）。
import { useEffect, useState } from "react";
import { createProvider } from "../../storage";
import { APP_CONFIG } from "../../config/config";
import { native } from "../../shared/native";
import { joinPath } from "../../shared/path";
import type { SourceConfig } from "../../storage/types";

const DEFAULT_SERVER = APP_CONFIG.openlist.server;
const DEFAULT_USER = APP_CONFIG.openlist.username;
const DEFAULT_PASS = APP_CONFIG.openlist.password;
const DEFAULT_ROMS = APP_CONFIG.defaults.romsPath;
const DEFAULT_EMULATORS = APP_CONFIG.defaults.emulatorsPath;

interface Mount {
  path: string;
  name: string;
}

/** 可清理的缓存/数据项（相对下载目录）。 */
const CACHE_ITEMS = [
  { key: "library", label: "游戏库缓存", desc: "manifest + 各平台 games.json", dir: ".cache/library", isCache: true },
  { key: "media", label: "媒体缓存", desc: "封面 / 视频预览", dir: ".cache/media", isCache: true },
  { key: "emuCache", label: "模拟器压缩包缓存", desc: "下载的模拟器 zip", dir: ".cache/Emulators", isCache: true },
  { key: "roms", label: "已下载游戏", desc: "Roms/", dir: "Roms", isCache: false },
  { key: "emulators", label: "已安装模拟器", desc: "Emulators/", dir: "Emulators", isCache: false },
] as const;

function formatSize(n: number | null | undefined): string {
  if (n == null) return "—";
  if (n < 1024) return `${n} B`;
  if (n < 1024 * 1024) return `${(n / 1024).toFixed(1)} KB`;
  if (n < 1024 ** 3) return `${(n / 1024 / 1024).toFixed(1)} MB`;
  return `${(n / 1024 ** 3).toFixed(2)} GB`;
}

/** 只填 IP:端口 也能用，自动补 http:// 并去掉结尾斜杠。 */
function normalizeServer(v: string): string {
  const s = v.trim().replace(/\/+$/, "");
  if (!s) return "";
  return /^https?:\/\//i.test(s) ? s : `http://${s}`;
}

interface Props {
  source: SourceConfig;
  onSave: (cfg: SourceConfig) => void;
  onClose: () => void;
}

export function SourcesPage({ source, onSave, onClose }: Props) {
  const [defaultDir, setDefaultDir] = useState("");
  useEffect(() => {
    native.fs.defaultDownloadDir().then(setDefaultDir).catch(() => undefined);
  }, []);

  const [downloadDir, setDownloadDir] = useState(source.downloadDir ?? "");
  const [server, setServer] = useState(source.server ?? DEFAULT_SERVER);
  const [mountPath, setMountPath] = useState(source.mountPath ?? "");
  const [mounts, setMounts] = useState<Mount[]>([]);
  const [loadingMounts, setLoadingMounts] = useState(false);
  const [username, setUsername] = useState(source.username ?? DEFAULT_USER);
  const [password, setPassword] = useState(source.password ?? DEFAULT_PASS);
  const [romsPath, setRomsPath] = useState(source.romsPath ?? DEFAULT_ROMS);
  const [emulatorsPath, setEmulatorsPath] = useState(source.emulatorsPath ?? DEFAULT_EMULATORS);
  const [message, setMessage] = useState<{ ok: boolean; text: string } | null>(null);
  const [testing, setTesting] = useState(false);

  const [sizes, setSizes] = useState<Record<string, number | null>>({});
  const [clearingKey, setClearingKey] = useState<string | null>(null);

  const baseDir = (downloadDir.trim() || defaultDir).replace(/\\/g, "/");

  async function refreshSizes() {
    if (!baseDir) return;
    const next: Record<string, number | null> = {};
    for (const it of CACHE_ITEMS) {
      try {
        next[it.key] = await native.fs.pathSize(joinPath(baseDir, it.dir));
      } catch {
        next[it.key] = null;
      }
    }
    setSizes(next);
  }

  useEffect(() => {
    void refreshSizes();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [baseDir]);

  async function clearDir(it: (typeof CACHE_ITEMS)[number]) {
    setClearingKey(it.key);
    try {
      await native.fs.removePath(joinPath(baseDir, it.dir));
      await refreshSizes();
      setMessage({ ok: true, text: `已清理：${it.label}` });
    } catch (e) {
      setMessage({ ok: false, text: `清理失败：${String(e)}` });
    } finally {
      setClearingKey(null);
    }
  }

  async function clearAllCaches() {
    setClearingKey("__all__");
    try {
      for (const it of CACHE_ITEMS.filter((x) => x.isCache)) {
        await native.fs.removePath(joinPath(baseDir, it.dir));
      }
      await refreshSizes();
      setMessage({ ok: true, text: "已清理全部缓存" });
    } catch (e) {
      setMessage({ ok: false, text: `清理失败：${String(e)}` });
    } finally {
      setClearingKey(null);
    }
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
      const entries = await native.dav.list(
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
      romsPath: romsPath.trim() || DEFAULT_ROMS,
      emulatorsPath: emulatorsPath.trim() || DEFAULT_EMULATORS,
      downloadDir: downloadDir.trim(),
      server: server.trim(),
      mountPath,
      username: username.trim(),
      password,
    };
  }

  async function test(cfg: SourceConfig) {
    setTesting(true);
    setMessage(null);
    try {
      const provider = createProvider(cfg);
      const entries = await provider.list(cfg.romsPath ?? "");
      setMessage({ ok: true, text: `连接成功，游戏目录下有 ${entries.length} 项` });
    } catch (e) {
      setMessage({ ok: false, text: `连接失败：${String(e)}` });
    } finally {
      setTesting(false);
    }
  }

  function save() {
    const cfg = buildConfig();
    if (!cfg) {
      setMessage({ ok: false, text: "请填写必填项（地址与资源源）" });
      return;
    }
    onSave(cfg);
    setMessage({ ok: true, text: "已保存" });
  }

  return (
    <div className="settings">
      <div className="settings-head">
        <h2>设置</h2>
        <button className="ghost small" onClick={onClose}>
          关闭（Esc）
        </button>
      </div>
      <p className="hint">
        通过 OpenList（WebDAV）读取游戏库。游戏库放在「游戏目录」（默认 Roms）下。
      </p>

      <div className="card">
        <h3>下载目录</h3>
        <p className="hint">
          ROM / 模拟器 / 缓存的存放位置（其下自动创建 <code>Roms/</code>、<code>Emulators/</code>、
          <code>.cache/</code>）。留空则使用默认目录。
        </p>
        <div className="field">
          <label>下载目录</label>
          <input
            value={downloadDir}
            onChange={(e) => setDownloadDir(e.currentTarget.value)}
            placeholder={defaultDir || "默认"}
          />
        </div>
        <div className="actions">
          <button className="ghost small" onClick={() => setDownloadDir("")}>
            重置为默认
          </button>
          <button className="ghost small" onClick={() => void refreshSizes()}>
            刷新占用
          </button>
        </div>
        <p className="hint">
          当前基准：<code>{baseDir || "—"}</code>
        </p>
      </div>

      <div className="card">
        <h3>缓存与数据（清理后可用于测试）</h3>
        <ul className="cache-list">
          {CACHE_ITEMS.map((it) => (
            <li key={it.key}>
              <div className="cache-info">
                <span className="cache-name">{it.label}</span>
                <span className="cache-meta">
                  {it.desc} · <code>{it.dir}</code> · {formatSize(sizes[it.key])}
                </span>
              </div>
              <button
                className="ghost small"
                disabled={clearingKey !== null}
                onClick={() => void clearDir(it)}
              >
                {clearingKey === it.key ? "清理中…" : "清理"}
              </button>
            </li>
          ))}
        </ul>
        <div className="actions">
          <button className="ghost small" disabled={clearingKey !== null} onClick={() => void clearAllCaches()}>
            {clearingKey === "__all__" ? "清理中…" : "清理全部缓存"}
          </button>
        </div>
        <p className="hint">
          「清理全部缓存」只清 <code>.cache/</code>（游戏库/媒体/模拟器包），不动已下载的 Roms 与已安装模拟器。
        </p>
      </div>

      <div className="card">
        <h3>OpenList 资源源</h3>

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
          <input
            type="password"
            value={password}
            onChange={(e) => setPassword(e.currentTarget.value)}
          />
        </div>
        <div className="field">
          <label>资源源（OpenList 挂载）</label>
          <div className="field-row">
            <select
              value={mountPath}
              onChange={(e) => setMountPath(e.currentTarget.value)}
              disabled={mounts.length === 0}
            >
              {mounts.length === 0 ? (
                <option value="">{loadingMounts ? "获取中…" : "点击右侧按钮获取"}</option>
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
        {mountPath && (
          <p className="hint">
            将使用：<code>{normalizeServer(server)}/dav{mountPath}</code>
          </p>
        )}

        <div className="field">
          <label>游戏目录（服务器 Roms 目录名，可改）</label>
          <input
            value={romsPath}
            onChange={(e) => setRomsPath(e.currentTarget.value)}
            placeholder={DEFAULT_ROMS}
          />
        </div>
        <div className="field">
          <label>模拟器目录（服务器 Emulators 目录名，可改）</label>
          <input
            value={emulatorsPath}
            onChange={(e) => setEmulatorsPath(e.currentTarget.value)}
            placeholder={DEFAULT_EMULATORS}
          />
        </div>

        <div className="actions">
          <button className="primary" onClick={save}>
            保存
          </button>
          <button
            className="ghost"
            disabled={testing}
            onClick={() => {
              const cfg = buildConfig();
              if (cfg) void test(cfg);
              else setMessage({ ok: false, text: "请填写必填项（地址与资源源）" });
            }}
          >
            {testing ? "测试中…" : "测试连接"}
          </button>
        </div>

        {message && <p className={message.ok ? "ok" : "error"}>{message.text}</p>}
      </div>
    </div>
  );
}
