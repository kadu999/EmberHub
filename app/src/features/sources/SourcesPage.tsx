// 存储源配置页：添加/管理本地文件夹或 WebDAV（OpenList）。
import { useState } from "react";
import { useStore } from "../../store";
import { createProvider } from "../../storage";
import type { SourceConfig, StorageKind } from "../../storage/types";

function uid(): string {
  if (typeof crypto !== "undefined" && "randomUUID" in crypto) return crypto.randomUUID();
  return Math.random().toString(36).slice(2) + Date.now().toString(36);
}

export function SourcesPage() {
  const { sources, activeSourceId, addSource, removeSource, setActiveSource } = useStore();

  const [kind, setKind] = useState<StorageKind>("webdav");
  const [name, setName] = useState("");
  const [root, setRoot] = useState("");
  const [url, setUrl] = useState("");
  const [username, setUsername] = useState("");
  const [password, setPassword] = useState("");
  const [message, setMessage] = useState<{ ok: boolean; text: string } | null>(null);
  const [testing, setTesting] = useState(false);

  function buildConfig(): SourceConfig | null {
    if (kind === "local") {
      if (!root.trim()) return null;
      return { id: uid(), name: name.trim() || "本地文件夹", kind, root: root.trim() };
    }
    if (!url.trim()) return null;
    return {
      id: uid(),
      name: name.trim() || "WebDAV",
      kind,
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
      const entries = await provider.list("");
      setMessage({ ok: true, text: `连接成功，根目录下有 ${entries.length} 项` });
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
    setUsername("");
    setPassword("");
    setMessage({ ok: true, text: "已添加存储源" });
  }

  return (
    <div className="page">
      <h2>存储源</h2>
      <p className="hint">
        推荐用 OpenList 把阿里云盘/百度/115 等挂载为 WebDAV，再在这里填入地址即可。
      </p>

      <div className="card">
        <div className="segmented">
          <button
            className={kind === "webdav" ? "active" : ""}
            onClick={() => setKind("webdav")}
          >
            WebDAV
          </button>
          <button
            className={kind === "local" ? "active" : ""}
            onClick={() => setKind("local")}
          >
            本地文件夹
          </button>
        </div>

        <div className="field">
          <label>名称</label>
          <input value={name} onChange={(e) => setName(e.currentTarget.value)} placeholder="例如：我的游戏库" />
        </div>

        {kind === "webdav" ? (
          <>
            <div className="field">
              <label>WebDAV 地址</label>
              <input
                value={url}
                onChange={(e) => setUrl(e.currentTarget.value)}
                placeholder="http://127.0.0.1:5244/dav/游戏库"
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
          </>
        ) : (
          <div className="field">
            <label>根目录</label>
            <input
              value={root}
              onChange={(e) => setRoot(e.currentTarget.value)}
              placeholder="E:\\Games\\天马G"
            />
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

        {message && (
          <p className={message.ok ? "ok" : "error"}>{message.text}</p>
        )}
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
              {s.kind === "webdav" ? s.url : s.root}
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
