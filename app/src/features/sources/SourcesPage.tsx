// 设置页：存储源配置（本地文件夹 / WebDAV / FTP）。
// 默认隐藏，按 F1 打开。
import { useEffect, useState } from "react";
import { useStore } from "../../store";
import { createProvider } from "../../storage";
import { tauri } from "../../lib/tauri";
import type { SourceConfig, StorageKind } from "../../storage/types";

interface Props {
  onClose?: () => void;
}

function uid(): string {
  if (typeof crypto !== "undefined" && "randomUUID" in crypto) return crypto.randomUUID();
  return Math.random().toString(36).slice(2) + Date.now().toString(36);
}

function describe(s: SourceConfig): string {
  if (s.kind === "webdav") return s.url ?? "";
  if (s.kind === "ftp") return `ftp://${s.host ?? ""}:${s.port ?? 21}${s.basePath ?? ""}`;
  return s.root ?? "";
}

export function SourcesPage({ onClose }: Props) {
  const {
    sources,
    activeSourceId,
    addSource,
    removeSource,
    setActiveSource,
    downloadDir,
    setDownloadDir,
  } = useStore();

  const [defaultDir, setDefaultDir] = useState("");
  useEffect(() => {
    tauri.defaultDownloadDir().then(setDefaultDir).catch(() => undefined);
  }, []);

  const [kind, setKind] = useState<StorageKind>("ftp");
  const [name, setName] = useState("");
  const [romsPath, setRomsPath] = useState("Roms");
  const [root, setRoot] = useState("");
  const [url, setUrl] = useState("");
  const [host, setHost] = useState("");
  const [port, setPort] = useState("21");
  const [basePath, setBasePath] = useState("");
  const [username, setUsername] = useState("");
  const [password, setPassword] = useState("");
  const [message, setMessage] = useState<{ ok: boolean; text: string } | null>(null);
  const [testing, setTesting] = useState(false);

  function buildConfig(): SourceConfig | null {
    if (kind === "local") {
      if (!root.trim()) return null;
      return {
        id: uid(),
        name: name.trim() || "本地文件夹",
        kind,
        romsPath: romsPath.trim(),
        root: root.trim(),
      };
    }
    if (kind === "ftp") {
      if (!host.trim()) return null;
      return {
        id: uid(),
        name: name.trim() || "FTP",
        kind,
        romsPath: romsPath.trim(),
        host: host.trim(),
        port: Number(port) || 21,
        basePath: basePath.trim(),
        username: username.trim(),
        password,
      };
    }
    if (!url.trim()) return null;
    return {
      id: uid(),
      name: name.trim() || "WebDAV",
      kind,
      romsPath: romsPath.trim(),
      url: url.trim(),
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

  async function add() {
    const cfg = buildConfig();
    if (!cfg) {
      setMessage({ ok: false, text: "请填写必填项" });
      return;
    }
    addSource(cfg);
    setName("");
    setRoot("");
    setUrl("");
    setHost("");
    setPort("21");
    setBasePath("");
    setUsername("");
    setPassword("");
    setMessage({ ok: true, text: "已添加存储源" });
  }

  return (
    <div className="settings">
      <div className="settings-head">
        <h2>设置 · 存储源</h2>
        {onClose && (
          <button className="ghost small" onClick={onClose}>
            关闭（Esc）
          </button>
        )}
      </div>
      <p className="hint">
        资源服务器支持：FTP（默认）、WebDAV（OpenList）、本地文件夹。游戏库放在「游戏目录」下，按平台分子文件夹。
      </p>

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
          <button className={kind === "ftp" ? "active" : ""} onClick={() => setKind("ftp")}>
            FTP
          </button>
          <button className={kind === "webdav" ? "active" : ""} onClick={() => setKind("webdav")}>
            WebDAV
          </button>
          <button className={kind === "local" ? "active" : ""} onClick={() => setKind("local")}>
            本地文件夹
          </button>
        </div>

        <div className="field">
          <label>名称</label>
          <input value={name} onChange={(e) => setName(e.currentTarget.value)} placeholder="例如：我的游戏库" />
        </div>

        <div className="field">
          <label>游戏目录（相对存储源根，默认 Roms）</label>
          <input value={romsPath} onChange={(e) => setRomsPath(e.currentTarget.value)} placeholder="Roms" />
        </div>

        {kind === "webdav" && (
          <>
            <div className="field">
              <label>WebDAV 地址</label>
              <input
                value={url}
                onChange={(e) => setUrl(e.currentTarget.value)}
                placeholder="http://127.0.0.1:5244/dav"
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
          </>
        )}

        {kind === "ftp" && (
          <>
            <div className="field">
              <label>主机</label>
              <input value={host} onChange={(e) => setHost(e.currentTarget.value)} placeholder="192.168.1.10" />
            </div>
            <div className="field">
              <label>端口</label>
              <input value={port} onChange={(e) => setPort(e.currentTarget.value)} placeholder="21" />
            </div>
            <div className="field">
              <label>根路径（可选，如 /games）</label>
              <input value={basePath} onChange={(e) => setBasePath(e.currentTarget.value)} placeholder="/games" />
            </div>
            <div className="field">
              <label>用户名</label>
              <input value={username} onChange={(e) => setUsername(e.currentTarget.value)} />
            </div>
            <div className="field">
              <label>密码</label>
              <input type="password" value={password} onChange={(e) => setPassword(e.currentTarget.value)} />
            </div>
          </>
        )}

        {kind === "local" && (
          <div className="field">
            <label>根目录</label>
            <input value={root} onChange={(e) => setRoot(e.currentTarget.value)} placeholder="E:\\Games" />
          </div>
        )}

        <div className="actions">
          <button onClick={add}>添加</button>
          <button
            className="ghost"
            disabled={testing}
            onClick={() => {
              const cfg = buildConfig();
              if (cfg) void test(cfg);
              else setMessage({ ok: false, text: "请填写必填项" });
            }}
          >
            {testing ? "测试中…" : "测试连接"}
          </button>
        </div>

        {message && <p className={message.ok ? "ok" : "error"}>{message.text}</p>}
      </div>

      <h3>已配置（{sources.length}）</h3>
      <ul className="source-list">
        {sources.map((s) => (
          <li key={s.id} className={s.id === activeSourceId ? "active" : ""}>
            <label className="radio">
              <input
                type="radio"
                checked={s.id === activeSourceId}
                onChange={() => setActiveSource(s.id)}
              />
              <span className="src-name">{s.name}</span>
            </label>
            <span className="src-detail">
              {describe(s)}
              {s.romsPath ? `  ·  ${s.romsPath}` : ""}
            </span>
            <button className="ghost small" onClick={() => removeSource(s.id)}>
              删除
            </button>
          </li>
        ))}
        {sources.length === 0 && <li className="empty">还没有存储源</li>}
      </ul>
    </div>
  );
}
