import { useEffect, useState } from "react";
import { Search } from "lucide-react";
import { lineage, type TreeData } from "./model";
import { Modal } from "./ui";
import { readLocal, writeLocal } from "./local-state";

type History = { ids: string[]; index: number };
type Page = History & { id: string; view: "node" | "map" };
type Pages = { activeId: string; pages: Page[] };
function validHistory(value: any): value is History {
  return !!value && Array.isArray(value.ids) && value.ids.every((id: unknown) => typeof id === "string") &&
    Number.isInteger(value.index) && value.index >= -1 && value.index < value.ids.length;
}
export function useNavigation(data: TreeData | null) {
  const [state, setState] = useState<Pages>(() => {
    const saved = readLocal<Pages | null>("treelearning-pages", null);
    if (saved && Array.isArray(saved.pages) && saved.pages.length &&
        saved.pages.every(page => validHistory(page) && typeof page.id === "string" && ["node", "map"].includes(page.view)) &&
        new Set(saved.pages.map(page => page.id)).size === saved.pages.length &&
        saved.pages.some(page => page.id === saved.activeId)) return saved;
    const old = readLocal<History>("treelearning-navigation", { ids: [], index: -1 });
    const page: Page = { ...(validHistory(old) ? old : { ids: [], index: -1 }), id: crypto.randomUUID(), view: "node" };
    return { activeId: page.id, pages: [page] };
  });
  const current = state.pages.find(page => page.id === state.activeId)!;
  useEffect(() => {
    if (!data) return;
    const existing = new Set(data.nodes.map(node => node.id));
    setState(old => {
      let changed = false;
      const pages = old.pages.map(page => {
        const selected = page.ids[page.index];
        const ids = page.ids.filter(id => existing.has(id));
        if (!ids.length) ids.push(data.rootId);
        const index = ids.includes(selected)
          ? page.ids.slice(0, page.index + 1).filter(id => existing.has(id)).length - 1
          : ids.length - 1;
        if (index === page.index && ids.length === page.ids.length && ids.every((id, i) => id === page.ids[i])) return page;
        changed = true;
        return { ...page, ids, index };
      });
      return changed ? { ...old, pages } : old;
    });
  }, [data]);
  useEffect(() => {
    writeLocal("treelearning-pages", state);
    writeLocal("treelearning-navigation", { ids: current.ids, index: current.index });
  }, [state]);
  function update(change: (page: Page) => Page) {
    setState(old => ({ ...old, pages: old.pages.map(page => page.id === current.id ? change(page) : page) }));
  }
  const selectedId = data?.nodes.some(node => node.id === current.ids[current.index])
    ? current.ids[current.index] : data?.rootId || "";
  function select(id: string) {
    update(page => {
      if (page.ids[page.index] === id) return page;
      const ids = [...page.ids.slice(0, page.index + 1), id].slice(-100);
      return { ...page, ids, index: ids.length - 1 };
    });
  }
  function move(delta: number) {
    update(page => ({ ...page, index: Math.max(0, Math.min(page.ids.length - 1, page.index + delta)) }));
  }
  return {
    selectedId, select, move,
    view: current.view,
    setView: (view: "node" | "map") => update(page => ({ ...page, view })),
    pages: state.pages,
    activeId: state.activeId,
    open: () => {
      const page: Page = { id: crypto.randomUUID(), ids: [selectedId], index: 0, view: current.view };
      setState(old => ({ activeId: page.id, pages: [...old.pages, page] }));
    },
    activate: (id: string) => setState(old => old.pages.some(page => page.id === id) ? { ...old, activeId: id } : old),
    close: (id: string) => setState(old => {
      if (old.pages.length === 1) return old;
      const index = old.pages.findIndex(page => page.id === id);
      if (index < 0) return old;
      const pages = old.pages.filter(page => page.id !== id);
      return { pages, activeId: old.activeId === id ? pages[Math.max(0, index - 1)].id : old.activeId };
    }),
    canBack: current.index > 0,
    canForward: current.index < current.ids.length - 1,
    recent: [...new Set([...current.ids].reverse())],
  };
}

export function QuickJump({
  data,
  currentId,
  recent,
  select,
  close,
}: {
  data: TreeData;
  currentId: string;
  recent: string[];
  select: (id: string) => void;
  close: () => void;
}) {
  const [query, setQuery] = useState("");
  const [all, setAll] = useState(false);
  const project = lineage(data, currentId).find(
    (node) => node.kind === "project",
  );
  const candidates = data.nodes.filter(
    (node) =>
      all ||
      !project ||
      lineage(data, node.id).some((part) => part.id === project.id),
  );
  const items = query.trim()
    ? candidates.filter((node) =>
        `${node.title} ${node.question}`
          .toLocaleLowerCase()
          .includes(query.trim().toLocaleLowerCase()),
      )
    : recent.flatMap((id) => candidates.filter((node) => node.id === id));
  return (
    <Modal title="快速跳转" onClose={close}>
      <label className="search">
        <Search size={16} />
        <input
          autoFocus
          aria-label="搜索节点"
          value={query}
          onChange={(e) => setQuery(e.target.value)}
        />
      </label>
      <label className="checkbox-label">
        <input
          type="checkbox"
          checked={all}
          onChange={(e) => setAll(e.target.checked)}
        />
        全部项目
      </label>
      <div className="jump-results">
        {items.slice(0, 100).map((node) => (
          <button
            key={node.id}
            onClick={() => {
              select(node.id);
              close();
            }}
          >
            <strong>{node.title}</strong>
            <small>
              {lineage(data, node.id)
                .slice(0, -1)
                .map((part) => part.title)
                .join(" / ")}
            </small>
          </button>
        ))}
        {!items.length && <p className="muted">没有匹配的节点</p>}
      </div>
    </Modal>
  );
}
