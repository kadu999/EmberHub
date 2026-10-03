// 游戏库页（默认首页）：从当前存储源的 Roms/ 目录扫描 Pegasus 元数据并展示。
import { useMemo, useState } from "react";
import { useStore } from "../../store";
import { createProvider } from "../../storage";
import { scanLibrary, type Game, type ScanResult } from "../../library/scan";
import { Cover } from "../../components/Cover";
import { launchGame } from "../../library/launch";

interface Props {
  onOpenSettings: () => void;
}

export function LibraryPage({ onOpenSettings }: Props) {
  const { sources, activeSourceId } = useStore();
  const source = sources.find((s) => s.id === activeSourceId) ?? null;
  const provider = useMemo(() => (source ? createProvider(source) : null), [source]);

  const [result, setResult] = useState<ScanResult | null>(null);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [collection, setCollection] = useState("全部");
  const [selected, setSelected] = useState<Game | null>(null);
  const [launchMsg, setLaunchMsg] = useState<{ ok: boolean; text: string } | null>(null);

  const scanRoot = (source?.romsPath ?? "Roms").trim();

  async function scan() {
    if (!provider) return;
    setLoading(true);
    setError(null);
    setResult(null);
    setSelected(null);
    setCollection("全部");
    try {
      setResult(await scanLibrary(provider, scanRoot));
    } catch (e) {
      setError(String(e));
    } finally {
      setLoading(false);
    }
  }

  // 未配置存储源
  if (!source || !provider) {
    return (
      <div className="page centered">
        <div className="brand big">
          <span className="flame">🔥</span>
          <span className="brand-name">
            Ember<b>Hub</b>
          </span>
        </div>
        <p className="hint">还没有配置存储源。</p>
        <button onClick={onOpenSettings}>打开设置（F1）</button>
        <p className="key-hint">按 F1 打开设置</p>
      </div>
    );
  }

  const games = result?.games ?? [];
  const filtered = collection === "全部" ? games : games.filter((g) => g.collection === collection);

  return (
    <div className="page">
      <div className="library-head">
        <div className="brand">
          <span className="flame">🔥</span>
          <span className="brand-name">
            Ember<b>Hub</b>
          </span>
        </div>
        <div className="library-actions">
          <span className="src-badge">{source.name}</span>
          <button disabled={loading} onClick={scan}>
            {loading ? "扫描中…" : "扫描游戏库"}
          </button>
        </div>
      </div>

      {error && <p className="error">{error}</p>}

      {result && (
        <>
          <div className="filters">
            <button
              className={collection === "全部" ? "chip active" : "chip"}
              onClick={() => setCollection("全部")}
            >
              全部 {games.length}
            </button>
            {result.collections.map((c) => (
              <button
                key={c}
                className={collection === c ? "chip active" : "chip"}
                onClick={() => setCollection(c)}
              >
                {c} {games.filter((g) => g.collection === c).length}
              </button>
            ))}
          </div>

          {result.warnings.length > 0 && (
            <details className="warnings">
              <summary>{result.warnings.length} 条警告</summary>
              <ul>
                {result.warnings.map((w, i) => (
                  <li key={i}>{w}</li>
                ))}
              </ul>
            </details>
          )}

          <div className="grid">
            {filtered.map((g) => (
              <button key={g.id} className="game-card" onClick={() => { setLaunchMsg(null); setSelected(g); }}>
                <Cover provider={provider} path={g.coverPath} title={g.title} />
                <span className="game-title" title={g.title}>
                  {g.title}
                </span>
                <span className="game-sub">{g.collection}</span>
              </button>
            ))}
            {filtered.length === 0 && (
              <p className="hint">
                在 <code>{scanRoot || "（根目录）"}</code> 下没有找到游戏。
              </p>
            )}
          </div>
        </>
      )}

      {!result && !loading && !error && (
        <p className="hint">
          点击「扫描游戏库」，EmberHub 会在 <code>{scanRoot || "（根目录）"}</code> 下查找
          metadata.pegasus.txt 并列出游戏。
        </p>
      )}

      <p className="key-hint">按 F1 打开设置</p>

      {selected && (
        <div className="detail-overlay" onClick={() => setSelected(null)}>
          <div className="detail" onClick={(e) => e.stopPropagation()}>
            <div className="detail-cover">
              <Cover provider={provider} path={selected.coverPath} title={selected.title} />
            </div>
            <div className="detail-info">
              <h3>{selected.title}</h3>
              <p className="detail-sub">{selected.collection}</p>
              <dl>
                {selected.developer && (
                  <>
                    <dt>开发商</dt>
                    <dd>{selected.developer}</dd>
                  </>
                )}
                {selected.genre && (
                  <>
                    <dt>类型</dt>
                    <dd>{selected.genre}</dd>
                  </>
                )}
                {selected.players && (
                  <>
                    <dt>玩家人数</dt>
                    <dd>{selected.players}</dd>
                  </>
                )}
                {selected.release && (
                  <>
                    <dt>发行日期</dt>
                    <dd>{selected.release}</dd>
                  </>
                )}
                {selected.rating !== undefined && (
                  <>
                    <dt>评分</dt>
                    <dd>{Math.round(selected.rating * 100)}%</dd>
                  </>
                )}
                <dt>文件</dt>
                <dd className="files">{selected.files.join("\n") || "（未指定）"}</dd>
              </dl>
              {selected.description && <p className="desc">{selected.description}</p>}

              <div className="launch-row">
                <button
                  onClick={async () => {
                    setLaunchMsg(null);
                    try {
                      await launchGame(selected, provider);
                      setLaunchMsg({ ok: true, text: "已启动模拟器" });
                    } catch (e) {
                      setLaunchMsg({ ok: false, text: e instanceof Error ? e.message : String(e) });
                    }
                  }}
                >
                  ▶ 启动
                </button>
              </div>
              {launchMsg && <p className={launchMsg.ok ? "ok" : "error"}>{launchMsg.text}</p>}
              {selected.launch ? (
                <p className="hint">
                  launch：<code>{selected.launch}</code>
                </p>
              ) : (
                <p className="hint">该集合未配置 launch 命令。</p>
              )}
            </div>
            <button className="close" onClick={() => setSelected(null)}>
              ×
            </button>
          </div>
        </div>
      )}
    </div>
  );
}
