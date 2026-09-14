import { useEffect, useState } from "react";
import { Search } from "lucide-react";
import { lineage, type TreeData } from "./model";
import { Modal } from "./ui";
import { readLocal, writeLocal } from "./local-state";

type History = { ids: string[]; index: number };
export function useNavigation(data: TreeData | null) {
  const [history, setHistory] = useState<History>(() => {
    const value = readLocal<History>("treelearning-navigation", {
      ids: [],
      index: -1,
    });
    return Array.isArray(value.ids) &&
      value.ids.every((id) => typeof id === "string") &&
      Number.isInteger(value.index)
      ? value
      : { ids: [], index: -1 };
  });
  useEffect(() => {
    if (!data) return;
    setHistory((old) => {
      const current = old.ids[old.index];
      const ids = old.ids.filter((id) =>
        data.nodes.some((node) => node.id === id),
      );
      if (!ids.length) ids.push(data.rootId);
      const index = ids.includes(current)
        ? old.ids
            .slice(0, old.index + 1)
            .filter((id) => data.nodes.some((node) => node.id === id)).length -
          1
        : ids.length - 1;
      if (index === old.index && ids.length === old.ids.length && ids.every((id, i) => id === old.ids[i])) return old;
      return { ids, index };
    });
  }, [data]);
  useEffect(() => {
    writeLocal("treelearning-navigation", history);
  }, [history]);
  const selectedId = data?.nodes.some(
    (node) => node.id === history.ids[history.index],
  )
    ? history.ids[history.index]
    : data?.rootId || "";
  function select(id: string) {
    setHistory((old) => {
      if (old.ids[old.index] === id) return old;
      const ids = [...old.ids.slice(0, old.index + 1), id].slice(-100);
      return { ids, index: ids.length - 1 };
    });
  }
  function move(delta: number) {
    setHistory((old) => ({
      ...old,
      index: Math.max(0, Math.min(old.ids.length - 1, old.index + delta)),
    }));
  }
  return {
    selectedId,
    select,
    move,
    canBack: history.index > 0,
    canForward: history.index < history.ids.length - 1,
    recent: [...new Set([...history.ids].reverse())],
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
