// 游戏库页（默认首页）：左侧信息面板 + 右侧游戏网格。
// 点击右侧游戏卡片即启动；左侧面板仅作信息展示。
import { useMemo, useState } from "react";
import { getCurrentWindow } from "@tauri-apps/api/window";
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
  const [collection, setCollection] = useState("");
  const [selected, setSelected] = useState<Game | null>(null);
  const [launchMsg, setLaunchMsg] = useState<{ ok: boolean; text: string } | null>(null);

  const scanRoot = (source?.romsPath ?? "Roms").trim();

  async function scan() {
    if (!provider) return;
    setLoading(true);
    setError(null);
    setResult(null);
    setSelected(null);
    setCollection("");
    try {
      const r = await scanLibrary(provider, scanRoot);
      setResult(r);
      setSelected(r.games[0] ?? null);
      setCollection(r.collections[0] ?? "");
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

  // 启动（双击卡片调用）：成功后关闭 EmberHub，交给模拟器
  async function launch(g: Game) {
    setSelected(g);
    setLaunchMsg(null);
    try {
      await launchGame(g, provider!, source!, (s) => setLaunchMsg({ ok: true, text: s }));
      await getCurrentWindow().close();
    } catch (e) {
      setLaunchMsg({ ok: false, text: e instanceof Error ? e.message : String(e) });
    }
  }

  const games = result?.games ?? [];
  const filtered = games.filter((g) => g.collection === collection);

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

      {result ? (
        <div
          className="library-layout"
          style={{
            display: "grid",
            gridTemplateColumns: "clamp(240px, 24vw, 340px) minmax(0, 1fr)",
            gap: 24,
            alignItems: "start",
          }}
        >
          {/* 左侧：信息面板 */}
          <aside className="detail-panel">
            {selected ? (
              <>
                <Cover provider={provider} path={selected.coverPath} title={selected.title} />
                <h3 className="detail-title">{selected.title}</h3>
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
                </dl>

                {launchMsg && <p className={launchMsg.ok ? "ok" : "error"}>{launchMsg.text}</p>}

                {selected.description && <p className="desc">{selected.description}</p>}
                <p className="hint">双击游戏卡片启动</p>
              </>
            ) : (
              <p className="hint">从右侧选择一个游戏</p>
            )}
          </aside>

          {/* 右侧：游戏选择 */}
          <main className="library-main">
            <div className="filters">
              {result.collections.map((c) => (
                <button
                  key={c}
                  className={collection === c ? "chip active" : "chip"}
                  onClick={() => setCollection(c)}
                >
                  {c}
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
                <button
                  key={g.id}
                  className={g.id === selected?.id ? "game-card active" : "game-card"}
                  onClick={() => {
                    setLaunchMsg(null);
                    setSelected(g);
                  }}
                  onDoubleClick={() => launch(g)}
                  title="双击启动"
                >
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
          </main>
        </div>
      ) : (
        !loading &&
        !error && (
          <p className="hint">
            点击「扫描游戏库」，EmberHub 会在 <code>{scanRoot || "（根目录）"}</code> 下读取
            games.json 并列出游戏。
          </p>
        )
      )}

      <p className="key-hint">按 F1 打开设置</p>
    </div>
  );
}
