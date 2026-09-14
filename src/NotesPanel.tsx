import {
  forwardRef,
  useEffect,
  useImperativeHandle,
  useRef,
  useState,
} from "react";
import {
  ArrowLeft,
  BookOpen,
  Copy,
  Download,
  FilePlus2,
  Link,
  Save,
  Trash2,
  X,
} from "lucide-react";
import { type ProjectNote, type TreeData } from "./model";
import { api, download, IconButton, Modal } from "./ui";
import Markdown from "./Markdown";
import { readLocal, writeLocal, registerBeforeClose } from "./local-state";

type Draft = {
  title: string;
  content: string;
  revision: number;
  projectId: string;
};
export type NotesHandle = {
  excerpt: (
    text: string,
    nodeId: string,
    nodeTitle: string,
    projectId: string,
  ) => Promise<void>;
  flush: () => Promise<boolean>;
};
type Props = {
  data: TreeData;
  projectId?: string;
  open: boolean;
  close: () => void;
  onData: (data: TreeData) => void;
  navigate: (id: string) => void;
  quote: (title: string, content: string) => void;
};
export default forwardRef<NotesHandle, Props>(function NotesPanel(
  { data, projectId, open, close, onData, navigate, quote },
  ref,
) {
  const [selected, setSelected] = useState(() =>
    readLocal<string>("treelearning-note-selected", ""),
  );
  const [drafts, setDrafts] = useState<Record<string, Draft>>(() =>
    readLocal("treelearning-note-drafts", {}),
  );
  const draftRef = useRef(drafts);
  const dataRef = useRef(data);
  dataRef.current = data;
  const [statuses, setStatuses] = useState<Record<string, string>>({});
  const [errors, setErrors] = useState<Record<string, string>>({});
  const errorsRef = useRef(errors);
  errorsRef.current = errors;
  const pending = useRef<Promise<void> | null>(null);
  const [library, setLibrary] = useState(false);
  const [libraryProject, setLibraryProject] = useState("");
  const [query, setQuery] = useState("");
  const [preview, setPreview] = useState(false);
  const [deleting, setDeleting] = useState(false);
  const [operationError, setOperationError] = useState("");
  const [creating, setCreating] = useState(false);
  const [width, setWidth] = useState(() =>
    Math.max(
      280,
      Math.min(600, Number(readLocal("treelearning-note-width", 360)) || 360),
    ),
  );
  const note = data.notes?.find((item) => item.id === selected);
  const draft = drafts[selected];
  const activeProject = note?.projectId || projectId;
  const projects = data.nodes.filter((node) => node.kind === "project");
  const sourceProject = projects.find((node) => node.id === note?.projectId);
  function remember(next: Record<string, Draft>) {
    draftRef.current = next;
    setDrafts(next);
    if (!writeLocal("treelearning-note-drafts", next))
      setOperationError("本机草稿空间不足，请保存或导出笔记后再退出");
  }
  function choose(id: string) {
    void flush();
    setSelected(id);
    writeLocal("treelearning-note-selected", id);
    setPreview(false);
    setLibrary(false);
  }
  useEffect(() => {
    if (selected && !data.notes?.some((item) => item.id === selected)) {
      setSelected("");
      writeLocal("treelearning-note-selected", "");
    }
  }, [data, selected]);
  useEffect(() => {
    if (open && !selected && projectId) {
      const existing = data.notes
        ?.filter((item) => item.projectId === projectId)
        .sort((a, b) => b.updatedAt.localeCompare(a.updatedAt))[0];
      if (existing) choose(existing.id);
    }
  }, [open, projectId, selected, data.notes]);
  function edit(patch: Partial<Pick<Draft, "title" | "content">>) {
    if (!note) return;
    remember({
      ...draftRef.current,
      [note.id]: { ...(draftRef.current[note.id] || note), ...patch },
    });
    setErrors((old) => ({ ...old, [note.id]: "" }));
    setStatuses((old) => ({ ...old, [note.id]: "待保存" }));
  }
  async function flush() {
    if (pending.current) {
      await pending.current;
      return;
    }
    const task = async () => {
      for (const [id, value] of Object.entries(draftRef.current)) {
        if (
          !dataRef.current.notes?.some((item) => item.id === id) ||
          errorsRef.current[id]
        )
          continue;
        setStatuses((old) => ({ ...old, [id]: "保存中" }));
        try {
          const result = await api<{ data: TreeData }>("/api/notes", {
            method: "POST",
            body: JSON.stringify({
              action: "save",
              id,
              title: value.title,
              content: value.content,
              revision: value.revision,
            }),
          });
          dataRef.current = result.data;
          onData(result.data);
          const remaining = { ...draftRef.current };
          if (remaining[id] === value) delete remaining[id];
          else if (remaining[id])
            remaining[id] = {
              ...remaining[id],
              revision: result.data.notes!.find((item) => item.id === id)!
                .revision,
            };
          remember(remaining);
          setStatuses((old) => ({ ...old, [id]: "已保存" }));
        } catch (error) {
          const message =
            error instanceof Error ? error.message : "笔记保存失败";
          errorsRef.current = { ...errorsRef.current, [id]: message };
          setErrors(errorsRef.current);
          setStatuses((old) => ({ ...old, [id]: "保存失败 · 草稿已保留" }));
        }
      }
    };
    pending.current = task();
    try {
      await pending.current;
    } finally {
      pending.current = null;
    }
  }
  useEffect(() => {
    const timer = setTimeout(() => {
      void flush();
    }, 800);
    return () => clearTimeout(timer);
  }, [drafts]);
  useEffect(() => registerBeforeClose(flush), []);
  useEffect(() => {
    const leave = () => {
      writeLocal("treelearning-note-drafts", draftRef.current);
      if (pending.current) return;
      for (const [id, value] of Object.entries(draftRef.current)) {
        if (
          !dataRef.current.notes?.some((item) => item.id === id) ||
          errorsRef.current[id]
        )
          continue;
        const body = JSON.stringify({ action: "save", id, ...value });
        if (new Blob([body]).size < 60000)
          void fetch("/api/notes", {
            method: "POST",
            headers: { "Content-Type": "application/json" },
            body,
            keepalive: true,
          }).catch(() => {});
      }
    };
    window.addEventListener("pagehide", leave);
    return () => {
      window.removeEventListener("pagehide", leave);
    };
  }, []);
  // A last-moment keepalive save may have succeeded after the window closed.
  useEffect(() => {
    const next = { ...draftRef.current };
    let changed = false;
    for (const saved of data.notes || []) {
      const local = next[saved.id];
      if (
        local &&
        saved.title === local.title &&
        saved.content === local.content
      ) {
        delete next[saved.id];
        changed = true;
      }
    }
    if (changed) remember(next);
  }, [data.notes]);
  async function create(
    owner = activeProject,
    content = "",
    title = "未命名笔记",
  ) {
    if (!owner) throw new Error("请先选择项目");
    await flush();
    const result = await api<{ data: TreeData; selectedId: string }>(
      "/api/notes",
      {
        method: "POST",
        body: JSON.stringify({
          action: "create",
          projectId: owner,
          title,
          content,
        }),
      },
    );
    dataRef.current = result.data;
    onData(result.data);
    choose(result.selectedId);
    return result.selectedId;
  }
  async function perform(action: () => Promise<unknown>) {
    setCreating(true);
    setOperationError("");
    try {
      await action();
    } catch (error) {
      setOperationError(error instanceof Error ? error.message : "操作失败");
    } finally {
      setCreating(false);
    }
  }
  useImperativeHandle(ref, () => ({
    flush: async () => {
      await flush();
      return !Object.keys(draftRef.current).length;
    },
    excerpt: async (text, nodeId, nodeTitle, owner) => {
      const label = nodeTitle.replace(/[\[\]\\]/g, " ");
      const excerpt = `\n\n> ${text.trim().split("\n").join("\n> ")}\n\n[来源：${label}](#node=${encodeURIComponent(nodeId)})\n`;
      const current = dataRef.current.notes?.find(
        (item) => item.id === selected,
      );
      if (!current) {
        await create(owner, excerpt, nodeTitle.slice(0, 240));
        return;
      }
      const value = draftRef.current[current.id] || current;
      remember({
        ...draftRef.current,
        [current.id]: { ...value, content: value.content + excerpt },
      });
      setErrors((old) => ({ ...old, [current.id]: "" }));
      setStatuses((old) => ({ ...old, [current.id]: "待保存" }));
      setPreview(false);
    },
  }));
  const orphaned = Object.entries(drafts).filter(
    ([id]) => !data.notes?.some((item) => item.id === id),
  );
  const shownProject =
    libraryProject || projectId || activeProject || projects[0]?.id;
  const libraryNotes = (data.notes || [])
    .filter(
      (item) =>
        item.projectId === shownProject &&
        `${drafts[item.id]?.title || item.title} ${drafts[item.id]?.content || item.content}`
          .toLocaleLowerCase()
          .includes(query.toLocaleLowerCase()),
    )
    .sort((a, b) => b.updatedAt.localeCompare(a.updatedAt));
  const title = draft?.title ?? note?.title ?? "";
  const content = draft?.content ?? note?.content ?? "";
  return (
    <aside
      className={`notes-panel ${open ? "notes-open" : ""}`}
      style={{ width }}
      aria-label="项目笔记"
    >
      <div
        className="notes-resizer"
        role="separator"
        aria-label="调整笔记宽度"
        aria-orientation="vertical"
        aria-valuemin={280}
        aria-valuemax={600}
        aria-valuenow={width}
        tabIndex={0}
        onKeyDown={(e) => {
          if (e.key === "ArrowLeft" || e.key === "ArrowRight") {
            e.preventDefault();
            const next = Math.max(
              280,
              Math.min(600, width + (e.key === "ArrowLeft" ? 20 : -20)),
            );
            setWidth(next);
            writeLocal("treelearning-note-width", next);
          }
        }}
        onPointerDown={(e) => {
          e.currentTarget.setPointerCapture(e.pointerId);
        }}
        onPointerMove={(e) => {
          if (e.currentTarget.hasPointerCapture(e.pointerId)) {
            const next = Math.max(
              280,
              Math.min(600, window.innerWidth - e.clientX),
            );
            setWidth(next);
            writeLocal("treelearning-note-width", next);
          }
        }}
        onPointerUp={(e) => e.currentTarget.releasePointerCapture(e.pointerId)}
      />
      <header className="notes-header">
        <strong>项目笔记</strong>
        <div className="node-actions">
          <IconButton
            icon={BookOpen}
            label="项目笔记本"
            onClick={() => {
              setLibraryProject(projectId || activeProject || "");
              setLibrary(true);
            }}
          />
          <IconButton
            icon={FilePlus2}
            label="新建项目笔记"
            disabled={creating || !projectId}
            onClick={() => void perform(() => create(projectId))}
          />
          <IconButton
            icon={X}
            label="收起笔记"
            onClick={() => {
              void flush();
              close();
            }}
          />
        </div>
      </header>
      <button
        className="text-button notes-back"
        onClick={() => {
          void flush();
          close();
        }}
      >
        <ArrowLeft size={16} />
        返回对话
      </button>
      {operationError && <p role="alert">{operationError}</p>}
      {orphaned.map(([id, value]) => (
        <div className="note-recovery" key={id}>
          <p>待恢复草稿：{value.title}</p>
          <button
            className="text-button"
            onClick={() =>
              download(
                `${value.title.slice(0, 60).replace(/[<>:"/\\|?*]/g, "_")}.md`,
                value.content,
                "text/markdown",
              )
            }
          >
            导出草稿
          </button>
          <button
            className="text-button"
            disabled={!projectId || creating}
            onClick={() =>
              void perform(async () => {
                await create(projectId, value.content, value.title);
                const next = { ...draftRef.current };
                delete next[id];
                remember(next);
              })
            }
          >
            另存到当前项目
          </button>
        </div>
      ))}
      {note ? (
        <>
          <button
            className="note-project text-button"
            onClick={() => navigate(note.projectId)}
          >
            {sourceProject?.title}
          </button>
          <input
            className="note-title"
            aria-label="笔记名称"
            value={title}
            maxLength={240}
            onChange={(e) => edit({ title: e.target.value })}
          />
          <div className="notes-toolbar">
            <div className="mode-control">
              <button aria-pressed={!preview} onClick={() => setPreview(false)}>
                编辑
              </button>
              <button aria-pressed={preview} onClick={() => setPreview(true)}>
                预览
              </button>
            </div>
            <div className="node-actions">
              <IconButton
                icon={Save}
                label="保存笔记"
                onClick={() => {
                  errorsRef.current = { ...errorsRef.current, [selected]: "" };
                  setErrors(errorsRef.current);
                  void flush();
                }}
              />
              <IconButton
                icon={Link}
                label="引用笔记到问题"
                disabled={!content.trim() || note.projectId !== projectId}
                onClick={() => quote(title, content)}
              />
              <IconButton
                icon={Trash2}
                label="删除笔记"
                disabled={creating}
                onClick={() => setDeleting(true)}
              />
            </div>
          </div>
          {preview ? (
            <div
              className="note-preview"
              onClick={(e) => {
                const anchor = (e.target as HTMLElement).closest("a");
                if (anchor?.getAttribute("href")?.startsWith("#node=")) {
                  e.preventDefault();
                  const id = decodeURIComponent(
                    anchor.getAttribute("href")!.slice(6),
                  );
                  if (data.nodes.some((node) => node.id === id)) navigate(id);
                  else setOperationError("来源节点已删除或不在当前备份中");
                }
              }}
            >
              <Markdown>{content}</Markdown>
            </div>
          ) : (
            <textarea
              aria-label="笔记正文"
              className="note-editor"
              value={content}
              onChange={(e) => edit({ content: e.target.value })}
            />
          )}
          <footer className="note-save-status" role="status">
            {statuses[selected] || (draft ? "待保存" : "已保存")}
          </footer>
          {errors[selected] && (
            <div className="note-error" role="alert">
              <p>{errors[selected]}</p>
              <button
                className="text-button"
                disabled={creating}
                onClick={() =>
                  void perform(async () => {
                    await create(
                      note.projectId,
                      content,
                      title || "恢复的笔记",
                    );
                    const next = { ...draftRef.current };
                    delete next[note.id];
                    remember(next);
                  })
                }
              >
                另存为新笔记
              </button>
              <IconButton
                icon={Copy}
                label="复制笔记草稿"
                onClick={() =>
                  void navigator.clipboard
                    .writeText(content)
                    .catch(() => setOperationError("复制失败"))
                }
              />
            </div>
          )}
        </>
      ) : (
        <div className="notes-empty">
          <p>{projectId ? "此项目还没有选中的笔记" : "请先选择项目"}</p>
          <button
            className="secondary"
            disabled={!projectId || creating}
            onClick={() => void perform(() => create(projectId))}
          >
            <FilePlus2 size={16} />
            新建笔记
          </button>
        </div>
      )}
      {library && (
        <Modal title="项目笔记本" onClose={() => setLibrary(false)}>
          <label>
            所属项目
            <select
              aria-label="笔记本项目"
              value={shownProject || ""}
              onChange={(e) => setLibraryProject(e.target.value)}
            >
              {projects.map((item) => (
                <option key={item.id} value={item.id}>
                  {item.title}
                </option>
              ))}
            </select>
          </label>
          <input
            aria-label="搜索笔记"
            placeholder="搜索笔记"
            value={query}
            onChange={(e) => setQuery(e.target.value)}
          />
          <div className="jump-results">
            {libraryNotes.map((item) => (
              <button key={item.id} onClick={() => choose(item.id)}>
                <strong>{drafts[item.id]?.title || item.title}</strong>
                <small>{new Date(item.updatedAt).toLocaleString()}</small>
              </button>
            ))}
            {!libraryNotes.length && <p>没有匹配的笔记</p>}
          </div>
          <div className="form-footer">
            <button
              className="secondary"
              disabled={!shownProject || creating}
              onClick={() => void perform(() => create(shownProject))}
            >
              <FilePlus2 size={16} />
              新建笔记
            </button>
            <button
              className="secondary"
              onClick={() =>
                download(
                  "项目笔记.md",
                  (data.notes || [])
                    .filter((item) => item.projectId === shownProject)
                    .map(
                      (item) =>
                        `# ${drafts[item.id]?.title ?? item.title}\n\n${drafts[item.id]?.content ?? item.content}`,
                    )
                    .join("\n\n---\n\n"),
                  "text/markdown",
                )
              }
            >
              <Download size={16} />
              导出笔记本
            </button>
          </div>
        </Modal>
      )}
      {deleting && note && (
        <Modal title="删除笔记" onClose={() => setDeleting(false)}>
          <p>确定删除“{title}”？此操作无法撤销。</p>
          <div className="form-footer">
            <button className="secondary" onClick={() => setDeleting(false)}>
              取消
            </button>
            <button
              className="danger"
              disabled={creating}
              onClick={() =>
                void perform(async () => {
                  await flush();
                  const latest = dataRef.current.notes!.find(
                    (item) => item.id === note.id,
                  )!;
                  const result = await api<{ data: TreeData }>("/api/notes", {
                    method: "POST",
                    body: JSON.stringify({
                      action: "delete",
                      id: note.id,
                      revision: latest.revision,
                    }),
                  });
                  onData(result.data);
                  const next = { ...draftRef.current };
                  delete next[note.id];
                  remember(next);
                  setDeleting(false);
                  choose("");
                })
              }
            >
              删除
            </button>
          </div>
        </Modal>
      )}
    </aside>
  );
});
