import { useEffect, useRef, useState, type FormEvent } from "react";
import {
  ArrowDownToLine,
  ArrowLeft,
  ArrowRight,
  Search,
  ArrowUp,
  Bug,
  Check,
  ChevronRight,
  Copy,
  Download,
  Eye,
  FilePlus2,
  FileText,
  FolderPlus,
  FolderOpen,
  GitBranch,
  Leaf,
  LoaderCircle,
  LockKeyhole,
  Menu,
  PanelLeftClose,
  PanelLeftOpen,
  MessageSquare,
  Network,
  Pencil,
  Plus,
  RefreshCw,
  Settings2,
  Sprout,
  Square,
  Trash2,
  Upload,
  X,
} from "lucide-react";
import Markdown from "./Markdown";
import { deepSeekModels, deepSeekPreset, isDeepSeekApi } from "./model-providers";
import { normalizeMathDelimiters } from "./math-markdown";
import { copyMathSelection } from "./math-clipboard";
import TreePanel, { nodeIcons } from "./TreePanel";
import TreeMap from "./TreeMap";
import NodeScroll from "./NodeScroll";
import FileReference from "./FileReference";
import { SelectionMenu } from "./SelectionMenu";
import useReplySound from "./useReplySound";
import { QuickJump, useNavigation } from "./navigation";
import { readLocal, writeLocal } from "./local-state";
import { api, download, IconButton, Modal } from "./ui";
import {
  childrenOf,
  fileChars,
  contextMessages,
  defaultSettings,
  isEditable,
  kindLabel,
  lineage,
  mainPathIds,
  modeLabels,
  nodeById,
  subtreeIds,
  validateTree,
  type Command,
  type DebugRequest,
  type Editable,
  type FileRef,
  type Settings,
  type TreeData,
  type TreeNode,
} from "./model";

type Dialog =
  | { type: "project" | "file"; parentId: string }
  | { type: "edit"; id: string }
  | { type: "delete"; id: string }
  | { type: "settings" | "context" | "debug" | "projects" }
  | { type: "restore"; data?: TreeData; file?: File }
  | null;
export default function App() {
  useEffect(() => {
    document.addEventListener("copy", copyMathSelection);
    return () => document.removeEventListener("copy", copyMathSelection);
  }, []);
  const playReplySound = useReplySound();
  const [data, setData] = useState<TreeData | null>(null);
  const dataRef = useRef<TreeData | null>(null);
  const navigation = useNavigation(data);
  const selectedId = navigation.selectedId;
  useEffect(() => {
    document.querySelector(".page-tab.active")?.scrollIntoView({ block: "nearest", inline: "nearest" });
  }, [navigation.activeId]);
  const [draggingMain, setDraggingMain] = useState(false);
  const [mainDropId, setMainDropId] = useState<string | null>(null);
  const [quickJump, setQuickJump] = useState(false);
  const composerRef = useRef<HTMLTextAreaElement>(null);
  const [settings, setSettings] = useState<Settings>({ ...defaultSettings });
  const [dialog, setDialog] = useState<Dialog>(null);
  const [error, setError] = useState("");
  const [notice, setNotice] = useState("");
  const [busy, setBusy] = useState(false);
  const [generatingIds, setGeneratingIds] = useState<string[]>([]);
  const localGenerations = useRef(new Set<string>());
  const generating = generatingIds.includes(selectedId) ? selectedId : null;
  const tab = navigation.view;
  const setTab = navigation.setView;
  const [sidebar, setSidebar] = useState(false);
  const [sidebarHidden, setSidebarHidden] = useState(() =>
    readLocal<boolean>("treelearning-sidebar-hidden", false),
  );
  useEffect(() => {
    writeLocal("treelearning-sidebar-hidden", sidebarHidden);
  }, [sidebarHidden]);
  const [drafts, setDrafts] = useState<Record<string, string>>(() =>
    readLocal("treelearning-question-drafts", {}),
  );
  const importRef = useRef<HTMLInputElement>(null);
  const activeRequest = useRef(false);
  const replaceData = (next: TreeData) => {
    if (
      dataRef.current &&
      next.rootId === dataRef.current.rootId &&
      next.revision < dataRef.current.revision
    )
      return;
    dataRef.current = next;
    setData(next);
  };
  async function reload() {
    const result = await api<{ data: TreeData; generatingIds: string[] }>(
      "/api/tree",
    );
    replaceData(result.data);
    setGeneratingIds([...new Set([...result.generatingIds, ...localGenerations.current])]);
  }
  useEffect(() => {
    void Promise.all([
      reload(),
      api<Settings>("/api/settings").then(setSettings),
    ]).catch((e) => setError(e.message));
  }, []);
  useEffect(() => {
    if (!notice) return;
    const timer = setTimeout(() => setNotice(""), 3500);
    return () => clearTimeout(timer);
  }, [notice]);
  useEffect(() => {
    if (!generatingIds.length) return;
    const timer = setInterval(() => {
      void reload().catch((e) => setError(e.message));
    }, 1500);
    return () => clearInterval(timer);
  }, [generatingIds.length]);
  function select(id: string) {
    if (!dataRef.current?.nodes.some((node) => node.id === id)) return;
    navigation.select(id);
    if (id === dataRef.current?.rootId) setTab("node");
    setSidebar(false);
  }
  useEffect(() => {
    writeLocal("treelearning-question-drafts", drafts);
  }, [drafts]);
  useEffect(() => {
    if (!data) return;
    const ids = new Set(data.nodes.map((node) => node.id));
    setDrafts((old) =>
      Object.keys(old).some((id) => !ids.has(id))
        ? Object.fromEntries(Object.entries(old).filter(([id]) => ids.has(id)))
        : old,
    );
    const positions = readLocal<Record<string, number>>(
      "treelearning-scroll",
      {},
    );
    writeLocal(
      "treelearning-scroll",
      Object.fromEntries(
        Object.entries(positions).filter(([id]) => ids.has(id)),
      ),
    );
  }, [data]);
  useEffect(() => {
    const key = (event: KeyboardEvent) => {
      if (document.querySelector("dialog[open]")) return;
      if ((event.ctrlKey || event.metaKey) && event.key.toLowerCase() === "k") {
        event.preventDefault();
        if (!dialog) setQuickJump((old) => !old);
      }
      if (
        event.altKey &&
        ["ArrowLeft", "ArrowRight"].includes(event.key) &&
        !dialog &&
        !quickJump
      ) {
        event.preventDefault();
        navigation.move(event.key === "ArrowLeft" ? -1 : 1);
      }
    };
    window.addEventListener("keydown", key);
    return () => window.removeEventListener("keydown", key);
  }, [dialog, quickJump]);
  async function run<T>(operation: () => Promise<T>): Promise<T | undefined> {
    if (activeRequest.current) return;
    activeRequest.current = true;
    setBusy(true);
    setError("");
    try {
      return await operation();
    } catch (e) {
      setError(e instanceof Error ? e.message : "操作失败");
      await reload().catch(() => {});
    } finally {
      activeRequest.current = false;
      setBusy(false);
    }
  }
  async function command(command: Command) {
    const result = await api<{ data: TreeData; selectedId: string }>(
      "/api/commands",
      {
        method: "POST",
        body: JSON.stringify({ command, revision: dataRef.current!.revision }),
      },
    );
    replaceData(result.data);
    select(result.selectedId);
    return result;
  }
  async function generate(id: string) {
    if (!modelReady() || localGenerations.current.has(id)) return;
    localGenerations.current.add(id);
    setGeneratingIds((old) => [...new Set([...old, id])]);
    setError("");
    try {
      const result = await api<{ data: TreeData }>("/api/generate", {
        method: "POST",
        body: JSON.stringify({ id, revision: dataRef.current!.revision }),
      });
      replaceData(result.data);
      playReplySound();
    } catch (e) {
      setError(e instanceof Error ? e.message : "生成失败");
    } finally {
      localGenerations.current.delete(id);
      setGeneratingIds((old) => old.filter((item) => item !== id));
      await reload().catch(() => {});
    }
  }
  async function submitQuestion(event: FormEvent) {
    event.preventDefault();
    const question = drafts[selectedId]?.trim();
    if (!question) return;
    if (!modelReady()) return;
    const parentId = selectedId;
    const created = await run(async () => {
      const result = await command({
        type: "create",
        parentId,
        kind: "chat",
        title: question.slice(0, 70),
        question,
      });
      setDrafts((current) => ({ ...current, [parentId]: "" }));
      setTab("node");
      return result.selectedId;
    });
    if (created) void generate(created);
  }
  function modelReady() {
    if (
      settings.mode !== "demo" &&
      settings.webEnabled &&
      settings.webProvider === "tavily" &&
      !settings.webApiKey
    ) {
      setError("请填写 Tavily API 密钥或关闭联网搜索");
      setDialog({ type: "settings" });
      return false;
    }
    if (settings.mode !== "demo" && (!settings.baseUrl || !settings.model)) {
      setError("请先在模型设置中填写 API 地址和模型名称");
      setDialog({ type: "settings" });
      return false;
    }
    return true;
  }
  async function restoreFile(file?: File) {
    if (!file) return;
    if (file.name.toLowerCase().endsWith(".zip")) {
      setDialog({ type: "restore", file });
      return;
    }
    try {
      if (file.size > 40 * 1024 * 1024) throw new Error("备份不能超过 40 MB");
      const value: unknown = JSON.parse(await file.text());
      validateTree(value);
      setDialog({ type: "restore", data: value });
    } catch (e) {
      setError(e instanceof Error ? e.message : "备份格式无效");
    }
  }
  if (!data)
    return (
      <div className="loading-screen">
        <Sprout size={36} />
        <h1>TreeLearning 树学</h1>
        {error ? (
          <>
            <p role="alert">{error}</p>
            <button
              className="primary"
              onClick={() => void reload().catch((e) => setError(e.message))}
            >
              重新加载
            </button>
          </>
        ) : (
          <LoaderCircle className="spin" size={22} />
        )}
      </div>
    );
  const node = nodeById(data, selectedId || data.rootId);
  const path = lineage(data, node.id);
  const project = path.find((part) => part.kind === "project");
  const mainIds = mainPathIds(data);
  const mainNext = data.nodes.find((item) => item.parentId === node.id && mainIds.has(item.id));
  const markMain = (id: string) => void run(async () => {
    await command({ type: "set-main", id });
    setNotice("已更新 main 分支");
  });
  const messages = contextMessages(data, node.id);
  const children = childrenOf(data, node.id);
  const editable = isEditable(data, node.id);
  const working = busy || !!generating;
  const contextLocked = generatingIds.some((id) =>
    data.nodes.some((item) => item.id === id) &&
    lineage(data, id).some((item) => item.id === node.id),
  );
  const Icon = nodeIcons[node.kind];
  return (
    <div className={`app-shell ${draggingMain ? "dragging-main" : ""}`}
      onDragOver={(event) => {
        if (!event.dataTransfer.types.includes("application/x-treelearning-main")) return;
        const target = (event.target as Element).closest<HTMLElement>("[data-main-node-id]");
        const id = target?.dataset.mainNodeId;
        if (!id || id === data.rootId || busy) { setMainDropId(null); return; }
        event.preventDefault();
        event.dataTransfer.dropEffect = "copy";
        setMainDropId(id);
      }}
      onDrop={(event) => {
        if (!event.dataTransfer.types.includes("application/x-treelearning-main")) return;
        event.preventDefault();
        const id = (event.target as Element).closest<HTMLElement>("[data-main-node-id]")?.dataset.mainNodeId;
        setDraggingMain(false);
        setMainDropId(null);
        if (id && id !== data.rootId && !busy) markMain(id);
      }}
    >
      {sidebar && (
        <button
          className="sidebar-backdrop"
          aria-label="关闭侧栏"
          onClick={() => setSidebar(false)}
        />
      )}
      <aside id="learning-sidebar" className={`sidebar ${sidebar ? "mobile-open" : ""} ${sidebarHidden ? "desktop-hidden" : ""}`}>
        <button
          className="brand"
          onClick={() => {
            select(data.rootId);
            setTab("node");
          }}
        >
          <span className="brand-mark">
            <Sprout size={24} />
          </span>
          <span>
            <strong>TreeLearning</strong>
            <small>树学 · 学习空间</small>
          </span>
        </button>
        <div className="sidebar-new">
          <button
            className="primary"
            onClick={() =>
              setDialog({ type: "project", parentId: data.rootId })
            }
            disabled={busy}
          >
            <Plus size={16} />
            新建项目
          </button>
          <button
            type="button"
            className="secondary my-projects-button"
            onClick={() => setDialog({ type: "projects" })}
          >
            <FolderOpen size={16} />
            我的项目
          </button>
        </div>
        <TreePanel
          mainIds={mainIds}
          mainDropId={mainDropId}
          key={node.id}
          data={data}
          selectedId={node.id}
          select={select}
        />
        <div className="sidebar-bottom">
          <div className="sidebar-tools">
            <button
              className="settings-button"
              onClick={() => setDialog({ type: "settings" })}
            >
              <Settings2 size={17} />
              模型设置
            </button>
            <IconButton
              icon={Download}
              label="导出完整备份"
              onClick={() =>
                void run(async () => {
                  window.location.href = "/api/backup";
                })
              }
            />
            <IconButton
              icon={Upload}
              label="恢复备份"
              disabled={busy || generatingIds.length > 0}
              onClick={() => importRef.current?.click()}
            />
          </div>
          <div className="local-status">
            <span />
            已保存到本机 <small>v0.1.9</small>
          </div>
        </div>
      </aside>
      <div className="workspace">
        <nav className="page-tabs" aria-label="打开的窗口">
          <div className="page-tabs-list">
            {navigation.pages.map((page, index) => {
              const title = data.nodes.find(item => item.id === page.ids[page.index])?.title || "学习空间";
              return <div className={`page-tab ${page.id === navigation.activeId ? "active" : ""}`} key={page.id}>
                <button type="button" aria-current={page.id === navigation.activeId ? "page" : undefined}
                  title={title} aria-label={`窗口 ${index + 1}：${title}`} onClick={() => navigation.activate(page.id)}>
                  <FileText size={14} /><span>{title}</span>
                </button>
                <button type="button" className="page-tab-close" aria-label={`关闭窗口 ${index + 1}`}
                  disabled={navigation.pages.length === 1} onClick={() => navigation.close(page.id)}><X size={13} /></button>
              </div>;
            })}
          </div>
          <button type="button" className="icon-button" title="新建窗口" aria-label="新建窗口" onClick={navigation.open}><Plus size={16} /></button>
        </nav>
        <header className="topbar">
          <button
            type="button"
            className="icon-button sidebar-toggle"
            title={sidebarHidden ? "展开侧栏" : "收起侧栏"}
            aria-label={sidebarHidden ? "展开侧栏" : "收起侧栏"}
            aria-expanded={!sidebarHidden}
            aria-controls="learning-sidebar"
            onClick={() => setSidebarHidden((hidden) => !hidden)}
          >
            {sidebarHidden ? <PanelLeftOpen size={17} /> : <PanelLeftClose size={17} />}
          </button>
          <IconButton
            icon={Menu}
            label="打开侧栏"
            className="mobile-menu"
            onClick={() => setSidebar(true)}
          />
          <div className="navigation-actions">
            <IconButton
              icon={ArrowLeft}
              label="后退"
              disabled={!navigation.canBack}
              onClick={() => navigation.move(-1)}
            />
            <IconButton
              icon={ArrowRight}
              label="前进"
              disabled={!navigation.canForward}
              onClick={() => navigation.move(1)}
            />
          </div>
          <div className="view-tabs" role="tablist" aria-label="视图">
            <button
              role="tab"
              aria-selected={tab === "node"}
              className={tab === "node" ? "active" : ""}
              onClick={() => setTab("node")}
            >
              <FileText size={15} />
              节点内容
            </button>
            {project && (
              <button
                role="tab"
                aria-selected={tab === "map"}
                className={tab === "map" ? "active" : ""}
                onClick={() => setTab("map")}
              >
                <Network size={15} />
                学习树图<span>{subtreeIds(data, project.id).size}</span>
              </button>
            )}
          </div>
          <IconButton
            icon={Search}
            label="快速跳转"
            onClick={() => setQuickJump(true)}
          />
          <button
            className={`model-status ${settings.mode}`}
            title={
              settings.mode === "demo"
                ? "演示模式"
                : settings.model || "未配置模型"
            }
            onClick={() => setDialog({ type: "settings" })}
          >
            <span />
            {modeLabels[settings.mode]}
          </button>
          {settings.mode === "debug" && (
            <IconButton
              icon={Bug}
              label="查看 API 请求"
              onClick={() => setDialog({ type: "debug" })}
            />
          )}
          <IconButton
            icon={Eye}
            label="显示上下文"
            onClick={() => setDialog({ type: "context" })}
          />
          <button type="button" className="main-branch-tool"
            draggable={!busy} disabled={busy}
            aria-label="设置 main 分支"
            title="拖到节点设为 main 分支；点击可将当前节点设为终点"
            onDragStart={(event) => {
              event.dataTransfer.setData("application/x-treelearning-main", "main");
              event.dataTransfer.effectAllowed = "copy";
              setDraggingMain(true);
            }}
            onDragEnd={() => { setDraggingMain(false); setMainDropId(null); }}
            onClick={() => node.kind !== "root" ? markMain(node.id) : setNotice("请将 main 拖到项目中的节点")}
          ><GitBranch size={15} />main</button>
        </header>
        {error && (
          <div className="error-banner" role="alert">
            <span>{error}</span>
            <IconButton
              icon={X}
              label="关闭错误提示"
              onClick={() => setError("")}
            />
          </div>
        )}
        <div className="workspace-body">
          <main className="main-pane">
            <div className={`node-header ${mainDropId === node.id ? "main-drop-target" : ""}`} data-main-node-id={node.id}>
              <div>
                <div className={`eyebrow kind-${node.kind}`}>
                  <Icon size={15} />
                  {kindLabel[node.kind]}
                  {mainIds.has(node.id) && <span className="main-badge">main</span>}
                  <span className={`node-state ${editable ? "leaf" : ""}`}>
                    {editable ? <Leaf size={11} /> : <LockKeyhole size={11} />}
                    {editable ? "叶节点" : "已锁定"}
                  </span>
                </div>
                <h1 title={node.title}>{node.title}</h1>
              </div>
              <div className="node-actions">
                <IconButton
                  icon={Pencil}
                  label="编辑节点"
                  disabled={!editable || busy || contextLocked}
                  onClick={() => setDialog({ type: "edit", id: node.id })}
                />
                {node.kind !== "root" && (
                  <IconButton
                    icon={Trash2}
                    label="删除节点"
                    disabled={busy || contextLocked}
                    onClick={() => setDialog({ type: "delete", id: node.id })}
                  />
                )}
              </div>
            </div>
            {tab === "map" && project ? (
              <TreeMap
                mainIds={mainIds}
                mainDropId={mainDropId}
                data={data}
                projectId={project.id}
                selectedId={node.id}
                select={select}
              />
            ) : (
              <NodeScroll
                nodeId={node.id}
                parentId={mainIds.has(node.id) && node.parentId && !mainIds.has(node.parentId) ? null : node.parentId}
                nextId={mainNext?.id ?? null}
                disabled={!!dialog || sidebar}
                onParent={select}
              >
                {node.kind === "chat" ? (
                  <SelectionMenu key={node.id} onError={setError} quote={(text) => {
                    const quote = text.split(/\r?\n/).map((line) => `> ${line}`).join("\n");
                    setDrafts((old) => ({ ...old, [node.id]: `${old[node.id] || ""}${old[node.id] ? "\n\n" : ""}引用「${node.title}」：\n${quote}\n\n` }));
                    requestAnimationFrame(() => {
                      const input = composerRef.current;
                      input?.focus();
                      input?.setSelectionRange(input.value.length, input.value.length);
                    });
                  }}>
                    <section className="question-section">
                      <div className="section-caption">
                        <span className="avatar user">我</span>
                        <strong>问题</strong>
                        {editable && (
                          <div className="answer-actions">
                            <IconButton
                              icon={Pencil}
                              label="修改发送内容"
                              disabled={working}
                              onClick={() =>
                                setDialog({ type: "edit", id: node.id })
                              }
                            />
                          </div>
                        )}
                      </div>
                      <Markdown>{node.question}</Markdown>
                    </section>
                    <section className="answer-section">
                      <div className="section-caption">
                        <span className="avatar ai">
                          <Sprout size={17} />
                        </span>
                        <strong>树学</strong>
                        {node.answerSource === "demo" && (
                          <span className="source-tag">演示</span>
                        )}
                        {node.answerSource === "manual" && (
                          <span className="source-tag">已编辑</span>
                        )}
                        <div className="answer-actions">
                          {node.answer && (
                            <IconButton
                              icon={Copy}
                              label="复制回复"
                              onClick={() =>
                                void navigator.clipboard
                                  .writeText(normalizeMathDelimiters(node.answer))
                                  .then(() => setNotice("回复已复制"))
                                  .catch(() => setError("复制失败"))
                              }
                            />
                          )}
                          <IconButton
                            icon={RefreshCw}
                            label="重新生成回复"
                            disabled={!editable || working}
                            onClick={() => void generate(node.id)}
                          />
                        </div>
                      </div>
                      {generating === node.id ? (
                        <div className="generating">
                          <LoaderCircle size={18} className="spin" />
                          正在思考…
                        </div>
                      ) : node.answer ? (
                        <Markdown>{node.answer}</Markdown>
                      ) : (
                        <div className="unanswered">
                          <p>尚无回复</p>
                          <button
                            className="secondary"
                            disabled={!editable || working}
                            onClick={() => void generate(node.id)}
                          >
                            <RefreshCw size={14} />
                            生成回复
                          </button>
                        </div>
                      )}
                      {!!node.fileReads?.length && (
                        <div
                          className="file-readings"
                          aria-label="本次文件阅读"
                        >
                          <h3>本次阅读 · {node.fileReads.length} 个片段</h3>
                          {node.fileReads.map((read, index) => (
                            <details key={index}>
                              <summary>
                                <FileText size={14} />
                                {read.title}
                                <span>
                                  字符 {read.offset + 1}–
                                  {read.offset + read.content.length}
                                </span>
                              </summary>
                              <pre>{read.content}</pre>
                              {data.nodes.some(
                                (item) => item.id === read.fileId,
                              ) && (
                                <button
                                  type="button"
                                  className="text-button"
                                  onClick={() => select(read.fileId)}
                                >
                                  打开文件节点
                                  <ChevronRight size={14} />
                                </button>
                              )}
                            </details>
                          ))}
                        </div>
                      )}
                      {!!node.webSources?.length && (
                        <div
                          className="file-readings"
                          aria-label="本次联网来源"
                        >
                          <h3>联网来源</h3>
                          {node.webSources.map((source) => (
                            <p key={source.url}>
                              <a
                                href={source.url}
                                target="_blank"
                                rel="noreferrer"
                              >
                                {source.title}
                              </a>
                            </p>
                          ))}
                        </div>
                      )}
                    </section>
                  </SelectionMenu>
                ) : (
                  <section className="content-section">
                    <div className="section-heading">
                      <h2>
                        {node.kind === "root"
                          ? "全局基础知识"
                          : node.kind === "project"
                            ? "学习内容"
                            : "引用文件"}
                      </h2>
                      <span>{fileChars(node).toLocaleString()} 字符</span>
                    </div>
                    {node.kind === "file" ? (
                      <FileReference
                        name={node.filename || node.title}
                        chars={fileChars(node)}
                      />
                    ) : node.content ? (
                      <Markdown>{node.content}</Markdown>
                    ) : (
                      <div className="empty-content">
                        <p>暂未设置学习内容</p>
                        {editable && (
                          <button
                            className="text-button"
                            onClick={() =>
                              setDialog({ type: "edit", id: node.id })
                            }
                          >
                            <Pencil size={14} />
                            添加内容
                          </button>
                        )}
                      </div>
                    )}
                  </section>
                )}
                {node.kind === "root" && <section className="children-section">
                  <div className="section-heading">
                    <h2>
                      {node.kind === "root" ? "项目" : "子节点"}
                      <span className="count">{children.length}</span>
                    </h2>
                    {node.kind === "root" ? (
                      <button
                        className="text-button"
                        disabled={working}
                        onClick={() =>
                          setDialog({ type: "project", parentId: node.id })
                        }
                      >
                        <FolderPlus size={15} />
                        新建项目
                      </button>
                    ) : (
                      <button
                        className="text-button"
                        disabled={working}
                        onClick={() =>
                          setDialog({ type: "file", parentId: node.id })
                        }
                      >
                        <FilePlus2 size={15} />
                        添加文件
                      </button>
                    )}
                  </div>
                  {children.length ? (
                    <div className="children-list">
                      {children.map((child) => {
                        const ChildIcon = nodeIcons[child.kind];
                        return (
                          <button
                            key={child.id}
                            data-main-node-id={child.id}
                            className={mainDropId === child.id ? "main-drop-target" : ""}
                            onClick={() => select(child.id)}
                          >
                            <span className={`child-icon kind-${child.kind}`}>
                              <ChildIcon size={18} />
                            </span>
                            <span className="child-text">
                              <strong>{child.title}</strong>
                              {mainIds.has(child.id) && <span className="main-badge">main</span>}
                              <small>
                                {kindLabel[child.kind]} ·{" "}
                                {child.kind === "chat"
                                  ? child.answer
                                    ? "已有回复"
                                    : "待回复"
                                  : `${fileChars(child).toLocaleString()} 字符`}
                              </small>
                            </span>
                            {!isEditable(data, child.id) && (
                              <LockKeyhole size={12} />
                            )}
                            <ChevronRight size={15} />
                          </button>
                        );
                      })}
                    </div>
                  ) : (
                    <div className="empty-children">
                      <GitBranch size={24} />
                      <span>
                        {node.kind === "root"
                          ? "还没有学习项目"
                          : "还没有子节点"}
                      </span>
                      {node.kind === "root" && (
                        <button
                          className="secondary"
                          disabled={working}
                          onClick={() =>
                            setDialog({ type: "project", parentId: node.id })
                          }
                        >
                          <Plus size={15} />
                          创建第一个项目
                        </button>
                      )}
                    </div>
                  )}
                </section>}
              </NodeScroll>
            )}
            {node.kind !== "root" && (
              <form className="composer-area" onSubmit={submitQuestion}>
                {children.length > 0 && (
                  <nav className="composer-children" aria-label="直接子节点">
                    {children.map((child) => (
                      <button
                        type="button"
                        key={child.id}
                        data-main-node-id={child.id}
                        className={mainDropId === child.id ? "main-drop-target" : ""}
                        title={child.title}
                        aria-label={child.title}
                        onClick={() => select(child.id)}
                      >
                        {mainIds.has(child.id) && <span className="main-badge">main</span>}
                        {[...child.title].slice(0, 6).join("")}
                        {[...child.title].length > 6 ? "…" : ""}
                      </button>
                    ))}
                  </nav>
                )}
                <div className="composer-parent">
                  <GitBranch size={13} />
                  <span>接续：{node.title}</span>
                  <span>{path.length + 1} 个上下文节点</span>
                </div>
                <div className="composer">
                  <textarea
                    ref={composerRef}
                    aria-label="新问题"
                    enterKeyHint="send"
                    placeholder="写下新的问题…"
                    rows={2}
                    value={drafts[node.id] || ""}
                    onChange={(e) =>
                      setDrafts((current) => ({
                        ...current,
                        [node.id]: e.target.value,
                      }))
                    }
                    onKeyDown={(e) => {
                      if (
                        e.key !== "Enter" ||
                        e.nativeEvent.isComposing ||
                        e.nativeEvent.keyCode === 229
                      )
                        return;
                      e.preventDefault();
                      if (e.shiftKey || e.ctrlKey || e.metaKey) {
                        const input = e.currentTarget;
                        const start = input.selectionStart;
                        const value =
                          input.value.slice(0, start) +
                          "\n" +
                          input.value.slice(input.selectionEnd);
                        setDrafts((current) => ({
                          ...current,
                          [node.id]: value,
                        }));
                        requestAnimationFrame(() => {
                          if (input.isConnected)
                            input.setSelectionRange(start + 1, start + 1);
                        });
                      } else if (
                        !e.altKey &&
                        !e.repeat &&
                        !working &&
                        drafts[node.id]?.trim()
                      ) {
                        e.currentTarget.form?.requestSubmit();
                      }
                    }}
                  />
                  <div className="composer-tools">
                    <IconButton
                      icon={FilePlus2}
                      label="添加文件节点"
                      disabled={working}
                      onClick={() =>
                        setDialog({ type: "file", parentId: node.id })
                      }
                    />
                    <div>
                      {generating ? (
                        <button
                          className="stop-button"
                          type="button"
                          onClick={() =>
                            void api("/api/cancel", {
                              method: "POST",
                              body: JSON.stringify({ id: node.id }),
                            }).catch((e) => setError(e.message))
                          }
                        >
                          <Square size={13} />
                          停止生成
                        </button>
                      ) : (
                        <button
                          type="submit"
                          className="send-button"
                          aria-label="发送问题"
                          title="发送问题"
                          disabled={working || !drafts[node.id]?.trim()}
                        >
                          <ArrowUp size={19} />
                        </button>
                      )}
                    </div>
                  </div>
                </div>
              </form>
            )}
          </main>

        </div>
      </div>
      {quickJump && (
        <QuickJump
          data={data}
          currentId={node.id}
          recent={navigation.recent}
          select={select}
          close={() => setQuickJump(false)}
        />
      )}
      <input
        ref={importRef}
        type="file"
        accept=".json,.zip"
        hidden
        onChange={(e) => {
          void restoreFile(e.target.files?.[0]);
          e.target.value = "";
        }}
      />
      {notice && (
        <div className="toast" role="status">
          <Check size={15} />
          {notice}
        </div>
      )}
      {dialog && (
        <Modal
          title={
            dialog.type === "projects" ? "我的项目" : dialog.type === "project"
              ? "新建项目"
              : dialog.type === "file"
                ? "添加文件节点"
                : dialog.type === "edit"
                  ? "编辑叶节点"
                  : dialog.type === "settings"
                    ? "模型设置"
                    : dialog.type === "debug"
                      ? "API 请求"
                      : dialog.type === "context"
                        ? "完整上下文"
                        : dialog.type === "restore"
                          ? "恢复学习树"
                          : "删除节点"
          }
          onClose={() => {
            if (!busy || dialog.type === "debug") setDialog(null);
          }}
          wide={dialog.type === "context" || dialog.type === "debug"}
        >
          {dialog.type === "projects" && (
            <div className="children-list project-picker">
              {data.nodes.filter((item) => item.kind === "project").map((item) => (
                <button key={item.id} type="button" aria-label={item.title}
                  onClick={() => { select(item.id); setTab("node"); setDialog(null); }}>
                  <span className="child-icon kind-project"><FolderOpen size={18} /></span>
                  <span className="child-text"><strong>{item.title}</strong></span>
                  <ChevronRight size={15} />
                </button>
              ))}
              {!data.nodes.some((item) => item.kind === "project") && (
                <div className="empty-children">
                  <FolderOpen size={24} />
                  <span>还没有项目</span>
                  <button type="button" className="text-button"
                    onClick={() => setDialog({ type: "project", parentId: data.rootId })}>
                    创建第一个项目
                  </button>
                </div>
              )}
            </div>
          )}
          {(dialog.type === "project" ||
            dialog.type === "file" ||
            dialog.type === "edit") && (
            <NodeForm
              key={
                dialog.type === "edit"
                  ? dialog.id
                  : dialog.parentId + dialog.type
              }
              node={
                dialog.type === "edit" ? nodeById(data, dialog.id) : undefined
              }
              kind={
                dialog.type === "edit"
                  ? nodeById(data, dialog.id).kind
                  : dialog.type
              }
              busy={busy}
              onSave={async (fields) => {
                await run(async () => {
                  if (dialog.type === "edit")
                    await command({
                      type: "edit",
                      id: dialog.id,
                      patch: fields,
                    });
                  else
                    await command({
                      type: "create",
                      kind: dialog.type,
                      parentId: dialog.parentId,
                      title: fields.title,
                      content: fields.content,
                      fileRef: fields.fileRef,
                    });
                  setDialog(null);
                  setTab("node");
                });
              }}
            />
          )}
          {dialog.type === "settings" && (
            <SettingsForm
              value={settings}
              busy={busy}
              save={async (value) => {
                await run(async () => {
                  setSettings(
                    await api<Settings>("/api/settings", {
                      method: "PUT",
                      body: JSON.stringify(value),
                    }),
                  );
                  setDialog(null);
                  setNotice("模型设置已保存");
                });
              }}
            />
          )}
          {dialog.type === "context" && (
            <div className="context-preview">
              <div className="preview-meta">
                {messages.length} 条消息 · {path.length} 个节点
              </div>
              {messages.map((message, i) => (
                <section key={`${message.nodeId}-${i}`}>
                  <header>
                    <span className={`role-tag ${message.role}`}>
                      {message.role === "system"
                        ? "系统"
                        : message.role === "user"
                          ? "用户"
                          : "助手"}
                    </span>
                    <strong>{nodeById(data, message.nodeId).title}</strong>
                  </header>
                  <pre>{message.content}</pre>
                </section>
              ))}
              {!messages.length && <p className="muted">当前上下文为空</p>}
              <div className="form-footer">
                <button
                  className="text-button"
                  onClick={() =>
                    download(
                      `${node.title.slice(0, 60).replace(/[<>:"/\\|?*]/g, "_")}.md`,
                      path
                        .map(
                          (n) =>
                            `# ${n.title}\n\n${n.kind === "chat" ? `## 问题\n\n${n.question}\n\n## 回复\n\n${n.answer}${(n.fileReads || []).map((read) => `\n\n### 已读取：${read.title}（字符 ${read.offset + 1}-${read.offset + read.content.length}）\n\n${read.content}`).join("")}` : n.fileRef ? `文件：${n.filename || n.title}\n\n正文共 ${fileChars(n)} 字符，按需读取。完整文件包含在 ZIP 备份中。` : n.content}`,
                        )
                        .join("\n\n---\n\n"),
                      "text/markdown",
                    )
                  }
                >
                  <ArrowDownToLine size={14} />
                  导出当前路径
                </button>
                <button
                  className="secondary"
                  onClick={() =>
                    download(
                      "TreeLearning-context.json",
                      JSON.stringify(
                        messages.map(({ role, content }) => ({
                          role,
                          content,
                        })),
                        null,
                        2,
                      ),
                    )
                  }
                >
                  <Download size={15} />
                  导出上下文
                </button>
              </div>
            </div>
          )}
          {dialog.type === "debug" && <RequestInspector />}
          {dialog.type === "delete" && (
            <div className="confirm-body">
              <p>
                确定删除“{nodeById(data, dialog.id).title}”及其全部子节点？ 共{" "}
                {subtreeIds(data, dialog.id).size} 个节点，此操作无法撤销。
                {(data.notes || []).some((note) =>
                  subtreeIds(data, dialog.id).has(note.projectId),
                ) &&
                  ` 同时删除 ${(data.notes || []).filter((note) => subtreeIds(data, dialog.id).has(note.projectId)).length} 份项目笔记。`}
              </p>
              <div className="form-footer">
                <button className="secondary" onClick={() => setDialog(null)}>
                  取消
                </button>
                <button
                  className="danger"
                  disabled={working}
                  onClick={() =>
                    void run(async () => {
                      await command({ type: "delete", id: dialog.id });
                      setDialog(null);
                    })
                  }
                >
                  <Trash2 size={15} />
                  删除
                </button>
              </div>
            </div>
          )}
          {dialog.type === "restore" && (
            <div className="confirm-body">
              <p>将当前学习树替换为所选备份。现有数据会先保存一份本机备份。</p>
              <div className="form-footer">
                <button className="secondary" onClick={() => setDialog(null)}>
                  取消
                </button>
                <button
                  className="primary"
                  disabled={busy || generatingIds.length > 0}
                  onClick={() =>
                    void run(async () => {
                      const body = new FormData();
                      if (dialog.file) body.append("file", dialog.file);
                      body.append(
                        "revision",
                        String(dataRef.current!.revision),
                      );
                      const result = await api<{ data: TreeData }>(
                        dialog.file ? "/api/restore/upload" : "/api/restore",
                        {
                          method: "POST",
                          body: dialog.file
                            ? body
                            : JSON.stringify({
                                data: dialog.data,
                                revision: dataRef.current!.revision,
                              }),
                        },
                      );
                      replaceData(result.data);
                      select(result.data.rootId);
                      setDrafts({});
                      setDialog(null);
                    })
                  }
                >
                  <Upload size={15} />
                  恢复
                </button>
              </div>
            </div>
          )}
          {error && (
            <p className="form-error" role="alert">
              {error}
            </p>
          )}
        </Modal>
      )}
    </div>
  );
}

function NodeForm({
  node,
  kind,
  busy,
  onSave,
}: {
  node?: TreeNode;
  kind: TreeNode["kind"];
  busy: boolean;
  onSave: (
    fields: Pick<Editable, "title"> & Partial<Omit<Editable, "title">>,
  ) => Promise<void>;
}) {
  const [title, setTitle] = useState(node?.title || "");
  const [content, setContent] = useState(node?.content || "");
  const [fileRef, setFileRef] = useState<FileRef | undefined>(node?.fileRef);
  const [question, setQuestion] = useState(node?.question || "");
  const [answer, setAnswer] = useState(node?.answer || "");
  const [importing, setImporting] = useState(false);
  const [error, setError] = useState("");
  const fileInput = useRef<HTMLInputElement>(null);
  const uploadController = useRef<AbortController | null>(null);
  useEffect(() => () => uploadController.current?.abort(), []);
  async function importFile(file?: File) {
    if (!file) return;
    setImporting(true);
    setError("");
    const controller = new AbortController();
    uploadController.current = controller;
    try {
      const body = new FormData();
      body.append("file", file);
      const result = await api<{ filename: string; fileRef: FileRef }>(
        "/api/import",
        { method: "POST", body, signal: controller.signal },
      );
      setTitle(result.filename.slice(0, 240));
      setFileRef(result.fileRef);
      setContent("");
    } catch (e) {
      if (!controller.signal.aborted)
        setError(e instanceof Error ? e.message : "文件导入失败");
    } finally {
      setImporting(false);
    }
  }
  return (
    <form
      className="edit-form"
      onSubmit={(e) => {
        e.preventDefault();
        void onSave(
          kind === "chat"
            ? { title, question, answer }
            : fileRef
              ? { title, fileRef }
              : { title, content },
        );
      }}
    >
      <label>
        名称
        <input
          autoFocus
          value={title}
          maxLength={240}
          required
          onChange={(e) => setTitle(e.target.value)}
          placeholder={kind === "project" ? "例如：线性代数" : "节点名称"}
        />
      </label>
      {kind === "file" && (
        <>
          <button
            type="button"
            className="file-import"
            disabled={importing || busy}
            onClick={() => fileInput.current?.click()}
          >
            {importing ? (
              <LoaderCircle className="spin" size={19} />
            ) : (
              <Upload size={19} />
            )}
            <span>
              选择本机文件
              <small>PDF / DOCX / Markdown / TXT / 代码</small>
            </span>
          </button>
          <input
            ref={fileInput}
            type="file"
            hidden
            accept=".pdf,.docx,.md,.txt,.csv,.json,.html,.xml,.log,.py,.js,.ts,.tsx,.jsx,.css,.c,.h,.cpp,.java,.rs,.go,.yaml,.yml,.tex"
            onChange={(e) => {
              void importFile(e.target.files?.[0]);
              e.target.value = "";
            }}
          />
        </>
      )}
      {kind === "chat" ? (
        <>
          <label htmlFor="node-question">
            问题
            <textarea
              id="node-question"
              aria-label="问题"
              rows={4}
              required
              value={question}
              onChange={(e) => setQuestion(e.target.value)}
            />
          </label>
          <label htmlFor="node-answer">
            回复
            <textarea
              id="node-answer"
              aria-label="回复"
              rows={9}
              value={answer}
              onChange={(e) => setAnswer(e.target.value)}
            />
          </label>
        </>
      ) : fileRef ? (
        <FileReference
          name={title || node?.filename || "文件"}
          chars={fileRef.chars}
        />
      ) : (
        <label htmlFor="node-content">
          {kind === "root"
            ? "全局基础知识"
            : kind === "project"
              ? "学习内容（可选）"
              : "文件正文"}
          <textarea
            id="node-content"
            aria-label={
              kind === "root"
                ? "全局基础知识"
                : kind === "project"
                  ? "学习内容（可选）"
                  : "文件正文"
            }
            rows={9}
            required={kind === "file"}
            value={content}
            onChange={(e) => setContent(e.target.value)}
            placeholder={
              kind === "project" ? "课程范围、学习目标或已有知识…" : ""
            }
          />
        </label>
      )}
      {error && (
        <p className="form-error" role="alert">
          {error}
        </p>
      )}
      <div className="form-footer">
        <button className="primary" disabled={busy || importing} type="submit">
          <Check size={16} />
          {node ? "保存修改" : "创建节点"}
        </button>
      </div>
    </form>
  );
}
function SettingsForm({
  value,
  busy,
  save,
}: {
  value: Settings;
  busy: boolean;
  save: (settings: Settings) => Promise<void>;
}) {
  const [settings, setSettings] = useState({ ...value });
  const [reveal, setReveal] = useState(false);
  const patch = (value: Partial<Settings>) =>
    setSettings((current) => ({ ...current, ...value }));
  return (
    <form
      className="edit-form"
      onSubmit={(e) => {
        e.preventDefault();
        void save(settings);
      }}
    >
      <div className="mode-control" role="group" aria-label="模型模式">
        {(["ai", "demo", "debug"] as const).map((mode) => (
          <button
            key={mode}
            type="button"
            aria-pressed={settings.mode === mode}
            className={settings.mode === mode ? "selected" : ""}
            onClick={() => patch({ mode })}
          >
            {modeLabels[mode]}
          </button>
        ))}
      </div>
      <div className="provider-presets" role="group" aria-label="DeepSeek 快速配置">
        {deepSeekModels.map((model) => (
          <button type="button" className="secondary" key={model.id}
            aria-pressed={isDeepSeekApi(settings.baseUrl) && settings.model === model.id}
            onClick={() => setSettings(deepSeekPreset(settings, model.id))}>{model.label}</button>
        ))}
      </div>
      {isDeepSeekApi(settings.baseUrl) && <p className="muted small">
        DeepSeek 使用普通回答模式。开启联网搜索后，由 Tavily 提供网页检索，需单独填写 Tavily 密钥。
      </p>}
      <label>
        接口类型
        <select
          value={settings.apiType}
          disabled={settings.webEnabled && settings.webProvider === "openai"}
          onChange={(e) =>
            patch({ apiType: e.target.value as Settings["apiType"] })
          }
        >
          <option value="chat-completions">Chat Completions</option>
          <option value="responses">Responses API</option>
        </select>
      </label>
      <label>
        API 地址
        <input
          type="url"
          placeholder="https://api.example.com/v1"
          value={settings.baseUrl}
          onChange={(e) => patch({ baseUrl: e.target.value,
            ...(isDeepSeekApi(e.target.value) ? { webProvider: "tavily" as const } : {}) })}
        />
      </label>
      <label>
        模型名称
        <input
          placeholder="模型 ID"
          value={settings.model}
          onChange={(e) => patch({ model: e.target.value })}
        />
      </label>
      <label>
        API 密钥
        <div className="key-input">
          <input
            type={reveal ? "text" : "password"}
            autoComplete="off"
            value={settings.apiKey}
            onChange={(e) => patch({ apiKey: e.target.value })}
          />
          <IconButton
            icon={Eye}
            label={reveal ? "隐藏密钥" : "显示密钥"}
            onClick={() => setReveal(!reveal)}
          />
        </div>
      </label>
      <label className="checkbox-label">
        <input
          type="checkbox"
          checked={settings.webEnabled}
          onChange={(e) =>
            patch({
              webEnabled: e.target.checked,
              ...(e.target.checked && settings.webProvider === "openai"
                ? { apiType: "responses" }
                : {}),
            })
          }
        />
        联网搜索
      </label>
      {settings.webEnabled && (
        <label>
          搜索服务
          <select
            value={settings.webProvider}
            onChange={(e) =>
              patch({
                webProvider: e.target.value as Settings["webProvider"],
                ...(e.target.value === "openai"
                  ? { apiType: "responses" }
                  : {}),
              })
            }
          >
            <option value="openai" disabled={isDeepSeekApi(settings.baseUrl)}>OpenAI 内置搜索（Responses API）</option>
            <option value="tavily">Tavily</option>
          </select>
        </label>
      )}
      {settings.webEnabled && settings.webProvider === "tavily" && (
        <label>
          Tavily API 密钥
          <input
            type="password"
            autoComplete="off"
            required={settings.mode !== "demo"}
            value={settings.webApiKey}
            onChange={(e) => patch({ webApiKey: e.target.value })}
          />
        </label>
      )}
      <label className="checkbox-label">
        <input
          type="checkbox"
          checked={settings.rememberApiKey}
          onChange={(e) => patch({ rememberApiKey: e.target.checked })}
        />
        在本机保存密钥（明文）
      </label>
      <div className="form-footer">
        <button type="submit" className="primary" disabled={busy}>
          <Check size={16} />
          保存设置
        </button>
      </div>
    </form>
  );
}

function RequestInspector() {
  const [requests, setRequests] = useState<DebugRequest[]>([]);
  const [selected, setSelected] = useState("");
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState("");
  const [copied, setCopied] = useState(false);
  useEffect(() => {
    let active = true;
    const refresh = async () => {
      try {
        const result = await api<{ requests: DebugRequest[] }>(
          "/api/debug/requests",
        );
        if (active) {
          setRequests(result.requests);
          setError("");
        }
      } catch (e) {
        if (active) setError(e instanceof Error ? e.message : "读取请求失败");
      } finally {
        if (active) setLoading(false);
      }
    };
    void refresh();
    const timer = setInterval(() => void refresh(), 1000);
    return () => {
      active = false;
      clearInterval(timer);
    };
  }, []);
  const request = requests.find((item) => item.id === selected) || requests[0];
  const statusLabels = {
    pending: "等待响应",
    success: "已完成",
    error: "失败",
    cancelled: "已停止",
  };
  return (
    <div className="request-inspector">
      {error && <p role="alert">{error}</p>}
      {!request ? (
        <p className="muted">{loading ? "正在读取请求…" : "暂无 API 请求"}</p>
      ) : (
        <>
          <label className="request-selector">
            请求记录
            <select
              aria-label="请求记录"
              value={request.id}
              onChange={(e) => {
                setSelected(e.target.value);
                setCopied(false);
              }}
            >
              {requests.map((item) => (
                <option key={item.id} value={item.id}>
                  {new Date(item.startedAt).toLocaleTimeString()} ·{" "}
                  {item.nodeTitle}
                </option>
              ))}
            </select>
          </label>
          <div className="request-meta">
            <strong>{request.method}</strong>
            <span>{request.url}</span>
            <span className={`request-status ${request.status}`}>
              {statusLabels[request.status]}
              {request.responseStatus
                ? ` · HTTP ${request.responseStatus}`
                : ""}
            </span>
          </div>
          {request.error && (
            <p role="status" className="request-error">
              {request.error}
            </p>
          )}
          <h3>请求头</h3>
          <pre aria-label="请求头">
            {JSON.stringify(request.headers, null, 2)}
          </pre>
          <div className="request-body-heading">
            <h3>请求正文</h3>
            <IconButton
              icon={copied ? Check : Copy}
              label={copied ? "已复制请求正文" : "复制请求正文"}
              onClick={() =>
                void navigator.clipboard
                  .writeText(request.body)
                  .then(() => setCopied(true))
                  .catch(() => setError("无法复制，请导出请求"))
              }
            />
            <IconButton
              icon={Download}
              label="导出 API 请求"
              onClick={() =>
                download(
                  `TreeLearning-request-${request.id}.json`,
                  JSON.stringify(
                    { ...request, body: JSON.parse(request.body) },
                    null,
                    2,
                  ),
                )
              }
            />
          </div>
          <pre aria-label="请求正文">
            {JSON.stringify(JSON.parse(request.body), null, 2)}
          </pre>
          {!!request.toolCalls?.length && (
            <>
              <h3>工具调用</h3>
              <pre aria-label="工具调用">
                {JSON.stringify(
                  request.toolCalls.map((call) => ({
                    ...call,
                    output: JSON.parse(call.output),
                  })),
                  null,
                  2,
                )}
              </pre>
            </>
          )}
        </>
      )}
    </div>
  );
}
