// 设置页：唯一资源源配置（OpenList / 本地文件夹，二选一）。
// 默认隐藏，按 F1 打开。
import { useEffect, useState } from "react";
import { useStore } from "../../store";
import { createProvider } from "../../storage";
import { tauri } from "../../lib/tauri";
import type { SourceConfig, StorageKind } from "../../storage/types";

interface Props {
  onClose?: () => void;
}

// OpenList 表单默认值：预填，可直接修改
const DEFAULT_SERVER = "127.0.0.1:5244";
const DEFAULT_USER = "admin";
const DEFAULT_PASS = "12345";

interface Mount {
  path: string;
  name: string;
}

export function SourcesPage({ onClose }: Props) {
  const setSource = useStore((s) => s.setSource);
  const downloadDir = useStore((s) => s.downloadDir);
  const setDownloadDir = useStore((s) => s.setDownloadDir);
  const requestScan = useStore((s) => s.requestScan);

  // 打开设置时用当前资源源初始化表单（面板每次 F1 都会重新挂载）
  const initial = useStore.getState().source;

  const [defaultDir, setDefaultDir] = useState("");
  useEffect(() => {
    tauri.defaultDownloadDir().then(setDefaultDir).catch(() => undefined);
  }, []);

  const [kind, setKind] = useState<StorageKind>(initial?.kind ?? "openlist");
  const [root, setRoot] = useState(initial?.kind === "local" ? initial.root ?? "" : "");
  const [server, setServer] = useState(initial?.server ?? DEFAULT_SERVER);
  const [mountPath, setMountPath] = useState(initial?.mountPath ?? "");
  const [mounts, setMounts] = useState<Mount[]>([]);
  const [loadingMounts, setLoadingMounts] = useState(false);
  const [username, setUsername] = useState(initial?.username ?? DEFAULT_USER);
  const [password, setPassword] = useState(initial?.password ?? DEFAULT_PASS);
  const [message, setMessage] = useState<{ ok: boolean; text: string } | null>(null);
  const [testing, setTesting] = useState(false);

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
    if (kind === "local") {
      if (!root.trim()) return null;
      return { id: "main", name: "本地文件夹", kind, romsPath: "Roms", root: root.trim() };
    }
    if (!normalizeServer(server) || !mountPath) return null;
    return {
      id: "main",
      name: mountPath.replace(/^\//, "") || "OpenList",
      kind,
      romsPath: "Roms",
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
    setSource(cfg);
    requestScan();
    setMessage({ ok: true, text: "已保存" });
  }

  return (
    <div className="settings">
      <div className="settings-head">
        <h2>设置</h2>
        <div style={{ display: "flex", gap: 8 }}>
          <button
            className="ghost small"
            onClick={() => {
              requestScan();
              onClose?.();
            }}
          >
            扫描游戏库
          </button>
          {onClose && (
            <button className="ghost small" onClick={onClose}>
              关闭（Esc）
            </button>
          )}
        </div>
      </div>
      <p className="hint">资源服务器二选一：OpenList 或 本地文件夹。游戏库放在「游戏目录」（默认 Roms）下。</p>

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
        <div className="segmented">
          <button className={kind === "openlist" ? "active" : ""} onClick={() => setKind("openlist")}>
            OpenList
          </button>
          <button className={kind === "local" ? "active" : ""} onClick={() => setKind("local")}>
            本地文件夹
          </button>
        </div>

        {kind === "openlist" && (
          <>
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
          </>
        )}

        {kind === "local" && (
          <div className="field">
            <label>根目录</label>
            <input value={root} onChange={(e) => setRoot(e.currentTarget.value)} placeholder="E:\\Games" />
          </div>
        )}

        <div className="actions">
          <button onClick={save}>保存</button>
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
