import { useState, type ReactNode } from "react";
import {
  ChevronDown,
  ChevronRight,
  FileText,
  FolderOpen,
  LockKeyhole,
  MessageSquare,
  Search,
  Sprout,
  X,
} from "lucide-react";
import { childrenOf, lineage, type TreeData, type TreeNode } from "./model";
export const nodeIcons = {
  root: Sprout,
  project: FolderOpen,
  file: FileText,
  chat: MessageSquare,
};
export default function TreePanel({
  data,
  selectedId,
  select,
  mainIds,
  mainDropId,
}: {
  mainIds: Set<string>;
  mainDropId: string | null;
  data: TreeData;
  selectedId: string;
  select: (id: string) => void;
}) {
  const [query, setQuery] = useState("");
  const path = lineage(data, selectedId);
  const children = childrenOf(data, selectedId).filter((node) =>
    `${node.title} ${node.question} ${node.content}`
      .toLowerCase()
      .includes(query.trim().toLowerCase()),
  );
  const parents = new Set(data.nodes.map((node) => node.parentId));
  function row(node: TreeNode, depth: number, nested?: ReactNode): ReactNode {
    const Icon = nodeIcons[node.kind];
    return (
      <div
        key={node.id}
        role="treeitem"
        aria-selected={node.id === selectedId}
        aria-expanded={nested ? true : undefined}
      >
        <div
          data-main-node-id={node.id}
          className={`tree-row ${node.id === selectedId ? "selected" : ""} ${mainDropId === node.id ? "main-drop-target" : ""}`}
          style={{ paddingLeft: Math.min(depth, 8) * 14 + 8 }}
        >
          <button
            className="tree-toggle"
            aria-label={`打开${node.title}`}
            disabled={node.id === selectedId}
            onClick={() => select(node.id)}
          >
            {nested ? <ChevronDown size={13} /> : <ChevronRight size={13} />}
          </button>
          <button
            className="tree-select"
            onClick={() => select(node.id)}
            title={node.title}
            aria-label={node.title}
          >
            <Icon size={16} className={`kind-${node.kind}`} />
            <span>{node.title}</span>
            {mainIds.has(node.id) && <span className="main-badge" aria-label="main 分支">main</span>}
            {parents.has(node.id) && (
              <LockKeyhole size={11} className="tree-lock" />
            )}
          </button>
        </div>
        {nested && <div role="group">{nested}</div>}
      </div>
    );
  }
  let tree: ReactNode = children.length
    ? children.map((child) => row(child, path.length))
    : undefined;
  for (let depth = path.length - 1; depth >= 0; depth--) {
    tree = row(path[depth], depth, tree);
  }
  return (
    <>
      <label className="search">
        <Search size={15} />
        <input
          aria-label="搜索子节点"
          placeholder="搜索子节点"
          value={query}
          onChange={(e) => setQuery(e.target.value)}
        />
        {query && (
          <button aria-label="清空搜索" onClick={() => setQuery("")}>
            <X size={14} />
          </button>
        )}
      </label>
      <div className="tree-section-label">
        学习树 <span>{children.length + path.length}</span>
      </div>
      <nav role="tree" aria-label="学习树" className="tree-list">
        {tree}
        {query && children.length === 0 && (
          <p className="muted small">没有匹配的子节点</p>
        )}
      </nav>
    </>
  );
}
