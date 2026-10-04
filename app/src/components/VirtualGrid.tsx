// 虚拟网格：只渲染可见区域的项，支持动态加载/卸载。
import { useEffect, useRef, useState, type ReactNode, type UIEvent } from "react";

/** 命令式句柄：供手柄/键盘导航定位 */
export interface VirtualGridHandle {
  /** 当前列数 */
  cols: () => number;
  /** 让第 index 项滚动到可见区域 */
  scrollToIndex: (index: number) => void;
}

interface Props<T> {
  items: T[];
  /** 最小列宽 */
  minColWidth?: number;
  /** 封面高宽比（height / width），默认 4/3 */
  aspect?: number;
  /** 封面之外的高度（标题 + 间距） */
  extraHeight?: number;
  gap?: number;
  /** 视口外多渲染几行 */
  overscan?: number;
  /** 命令式句柄（手柄导航用） */
  handleRef?: { current: VirtualGridHandle | null };
  renderItem: (item: T, index: number) => ReactNode;
}

export function VirtualGrid<T>({
  items,
  minColWidth = 150,
  aspect = 4 / 3,
  extraHeight = 46,
  gap = 18,
  overscan = 3,
  handleRef,
  renderItem,
}: Props<T>) {
  const ref = useRef<HTMLDivElement>(null);
  const rafRef = useRef<number | null>(null);
  const pendingTop = useRef(0);
  const [size, setSize] = useState({ width: 0, height: 0 });
  const [scrollTop, setScrollTop] = useState(0);

  useEffect(() => {
    const el = ref.current;
    if (!el) return;
    const update = () => setSize({ width: el.clientWidth, height: el.clientHeight });
    const ro = new ResizeObserver(update);
    ro.observe(el);
    update();
    return () => {
      ro.disconnect();
      if (rafRef.current !== null) cancelAnimationFrame(rafRef.current);
    };
  }, []);

  // 滚动用 rAF 节流，避免每个 scroll 事件都触发一次 React 重渲染
  const onScroll = (e: UIEvent<HTMLDivElement>) => {
    pendingTop.current = e.currentTarget.scrollTop;
    if (rafRef.current !== null) return;
    rafRef.current = requestAnimationFrame(() => {
      rafRef.current = null;
      setScrollTop(pendingTop.current);
    });
  };

  const cols = Math.max(1, Math.floor((size.width + gap) / (minColWidth + gap)));
  const colWidth = cols > 0 ? (size.width - gap * (cols - 1)) / cols : minColWidth;
  const rowHeight = Math.round(colWidth * aspect) + extraHeight;
  const rows = Math.ceil(items.length / cols);
  const totalHeight = rows * rowHeight;

  // 布局信息放在 ref 里，供命令式句柄读取（避免句柄随布局变化重建）
  const layoutRef = useRef({ cols: 1, rowHeight: 1 });
  layoutRef.current = { cols, rowHeight };

  useEffect(() => {
    if (!handleRef) return;
    handleRef.current = {
      cols: () => layoutRef.current.cols,
      scrollToIndex: (index: number) => {
        const el = ref.current;
        const { cols: c, rowHeight: rh } = layoutRef.current;
        if (!el || c <= 0 || rh <= 0) return;
        const row = Math.floor(index / c);
        const top = row * rh;
        const bottom = top + rh;
        if (top < el.scrollTop) el.scrollTop = top;
        else if (bottom > el.scrollTop + el.clientHeight) el.scrollTop = bottom - el.clientHeight;
      },
    };
    return () => {
      handleRef.current = null;
    };
  }, [handleRef]);

  const visibleRows = Math.ceil(size.height / rowHeight) + 1;
  const startRow = Math.max(0, Math.floor(scrollTop / rowHeight) - overscan);
  const endRow = Math.min(rows, startRow + visibleRows + overscan * 2);

  const cells: ReactNode[] = [];
  if (colWidth > 0 && rowHeight > 0) {
    for (let r = startRow; r < endRow; r++) {
      for (let c = 0; c < cols; c++) {
        const i = r * cols + c;
        if (i >= items.length) break;
        cells.push(
          <div
            key={i}
            style={{
              position: "absolute",
              top: r * rowHeight,
              left: c * (colWidth + gap),
              width: colWidth,
              height: rowHeight - gap,
            }}
          >
            {renderItem(items[i], i)}
          </div>,
        );
      }
    }
  }

  return (
    <div ref={ref} className="vgrid" onScroll={onScroll}>
      <div style={{ position: "relative", height: totalHeight }}>{cells}</div>
    </div>
  );
}
