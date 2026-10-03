// 游戏库页：从当前存储源扫描 Pegasus 元数据并展示游戏列表。
import { useMemo, useState } from "react";
import { useStore } from "../../store";
import { createProvider } from "../../storage";
import { scanLibrary, type Game, type ScanResult } from "../../library/scan";
import { Cover } from "../../components/Cover";

export function LibraryPage() {
  const { sources, activeSourceId } = useStore();
  const source = sources.find((s) => s.id === activeSourceId) ?? null;
  const provider = useMemo(() => (source ? createProvider(source) : null), [source]);

  const [result, setResult] = useState<ScanResult | null>(null);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [collection, setCollection] = useState("全部");
  const [selected, setSelected] = useState<Game | null>(null);

  async function scan() {
    if (!provider) return;
    setLoading(true);
    setError(null);
    setResult(null);
    setSelected(null);
    setCollection("全部");
    try {
      setResult(await scanLibrary(provider));
    } catch (e) {
      setError(String(e));
    } finally {
      setLoading(false);
    }
  }

  if (!source || !provider) {
    return (
      <div className="page">
        <h2>游戏库</h2>
        <p className="hint">请先到「存储源」添加并选中一个源。</p>
      </div>
    );
  }

  const games = result?.games ?? [];
  const filtered = collection === "全部" ? games : games.filter((g) => g.collection === collection);

  return (
    <div className="page">
      <div className="library-head">
        <h2>游戏库</h2>
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
              <button key={g.id} className="game-card" onClick={() => setSelected(g)}>
                <Cover provider={provider} path={g.coverPath} title={g.title} />
                <span className="game-title" title={g.title}>
                  {g.title}
                </span>
                <span className="game-sub">{g.collection}</span>
              </button>
            ))}
            {filtered.length === 0 && <p className="hint">没有找到游戏。</p>}
          </div>
        </>
      )}

      {!result && !loading && !error && (
        <p className="hint">点击「扫描游戏库」，EmberHub 会读取 metadata.pegasus.txt 并列出游戏。</p>
      )}

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
              <p className="hint">启动模拟器配置将在下一步实现。</p>
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
