import { mkdir, readFile, rename, writeFile } from "node:fs/promises";
import path from "node:path";
import { Documents } from "./documents";
import {
  applyCommand,
  defaultSettings,
  initialTree,
  TreeError,
  validateTree,
  withAnswer,
  type Command,
  type FileRead,
  type WebSource,
  type Settings,
  type TreeData,
} from "../src/model";

async function readJson(file: string): Promise<unknown | undefined> {
  try {
    return JSON.parse(await readFile(file, "utf8"));
  } catch (error) {
    if ((error as NodeJS.ErrnoException).code === "ENOENT") return undefined;
    throw error;
  }
}
async function atomicWrite(file: string, value: unknown) {
  const temporary = `${file}.${crypto.randomUUID()}.tmp`;
  await writeFile(temporary, JSON.stringify(value, null, 2), { mode: 0o600 });
  await rename(temporary, file);
}
export function validateSettings(value: unknown): Settings {
  const s = value as Settings & { demo?: boolean };
  const mode =
    s?.mode ??
    (typeof s?.demo === "boolean" ? (s.demo ? "demo" : "ai") : undefined);
  if (
    !s ||
    !["chat-completions", "responses"].includes(s.apiType) ||
    [s.baseUrl, s.model, s.apiKey].some((v) => typeof v !== "string") ||
    !["ai", "demo", "debug"].includes(mode ?? "") ||
    typeof s.rememberApiKey !== "boolean" ||
    (s.webEnabled !== undefined && typeof s.webEnabled !== "boolean") ||
    (s.webProvider !== undefined &&
      !["openai", "tavily"].includes(s.webProvider)) ||
    (s.webApiKey !== undefined &&
      (typeof s.webApiKey !== "string" || s.webApiKey.length > 2000))
  )
    throw new TreeError("模型配置无效");
  if (s.baseUrl.trim()) {
    let url: URL;
    try {
      url = new URL(s.baseUrl);
    } catch {
      throw new TreeError("请填写有效的 API 地址");
    }
    if (
      !["http:", "https:"].includes(url.protocol) ||
      url.username ||
      url.password ||
      url.search ||
      url.hash
    )
      throw new TreeError("请填写不含查询参数的 HTTP(S) API 地址");
  }
  return {
    apiType: s.apiType,
    baseUrl: s.baseUrl.trim(),
    model: s.model.trim(),
    apiKey: s.apiKey.trim(),
    mode: mode as Settings["mode"],
    rememberApiKey: s.rememberApiKey,
    webEnabled: s.webEnabled ?? false,
    webProvider: s.webProvider ?? (s.webApiKey?.trim() ? "tavily" : "openai"),
    webApiKey: s.webApiKey?.trim() ?? "",
  };
}
export class Store {
  readonly documents: Documents;
  data!: TreeData;
  settings: Settings = { ...defaultSettings };
  generatingId: string | null = null;
  workspaceState: Record<string, unknown> = {};
  private queue: Promise<unknown> = Promise.resolve();
  constructor(public directory: string) {
    this.documents = new Documents(directory);
  }
  async init() {
    await mkdir(this.directory, { recursive: true });
    await this.documents.init();
    this.workspaceState =
      ((await readJson(path.join(this.directory, "workspace-state.json"))) as
        | Record<string, unknown>
        | undefined) || {};
    const data = await readJson(path.join(this.directory, "tree.json"));
    if (data !== undefined) {
      validateTree(data);
      if (data.nodes.some((node) => node.kind === "file" && !node.fileRef))
        await atomicWrite(
          path.join(
            this.directory,
            `tree-before-file-migration-${Date.now()}.json`,
          ),
          data,
        );
      await this.persist(data);
    } else {
      this.data = initialTree();
      await atomicWrite(path.join(this.directory, "tree.json"), this.data);
    }
    const settings = await readJson(path.join(this.directory, "settings.json"));
    if (settings) this.settings = validateSettings(settings);
  }
  exclusive<T>(operation: () => Promise<T> | T): Promise<T> {
    const result = this.queue.then(operation);
    this.queue = result.catch(() => {});
    return result;
  }
  assertAvailable(revision: number) {
    if (this.generatingId) throw new TreeError("正在生成回答，请先停止生成");
    if (revision !== this.data.revision)
      throw new TreeError("数据已更新，请刷新后重试");
  }
  async flush(): Promise<void> {
    await this.queue;
  }
  private async persist(data: TreeData) {
    const next = structuredClone(data);
    for (const node of next.nodes) {
      if (node.kind !== "file") continue;
      if (!node.fileRef) {
        node.fileRef = await this.documents.fromText(node.content);
        node.content = "";
      }
      await this.documents.verify(node.fileRef);
    }
    validateTree(next);
    await atomicWrite(path.join(this.directory, "tree.json"), next);
    this.data = next;
  }
  command(command: Command, revision: number) {
    return this.exclusive(async () => {
      this.assertAvailable(revision);
      const result = applyCommand(this.data, command);
      await this.persist(result.data);
      return { ...result, data: this.data };
    });
  }
  replace(value: unknown, revision: number) {
    return this.exclusive(async () => {
      this.assertAvailable(revision);
      validateTree(value);
      const next = structuredClone(value);
      next.revision = this.data.revision + 1;
      for (const note of next.notes || [])
        note.revision =
          Math.max(
            note.revision,
            this.data.notes?.find((item) => item.id === note.id)?.revision ??
              -1,
          ) + 1;
      await atomicWrite(
        path.join(this.directory, `tree-before-restore-${Date.now()}.json`),
        this.data,
      );
      await this.persist(next);
      return this.data;
    });
  }
  answer(
    id: string,
    content: string,
    source: "demo" | "model",
    fileReads: FileRead[] = [],
    title?: string,
    webSources: WebSource[] = [],
  ) {
    return this.exclusive(async () => {
      const next = withAnswer(
        this.data,
        id,
        content,
        source,
        fileReads,
        title,
        webSources,
      );
      await this.persist(next);
      return this.data;
    });
  }
  note(value: {
    action: "create" | "save" | "delete";
    id?: string;
    projectId?: string;
    title?: string;
    content?: string;
    revision?: number;
  }) {
    return this.exclusive(async () => {
      if (!value || !["create", "save", "delete"].includes(value.action))
        throw new TreeError("笔记操作无效");
      const next = structuredClone(this.data);
      next.notes ??= [];
      let selectedId = value.id;
      if (value.action === "create") {
        selectedId = crypto.randomUUID();
        next.notes.push({
          id: selectedId,
          projectId: value.projectId!,
          title: value.title ?? "未命名笔记",
          content: value.content ?? "",
          revision: 0,
          updatedAt: new Date().toISOString(),
        });
      } else {
        const note = next.notes.find((note) => note.id === value.id);
        if (!note)
          throw new TreeError("笔记已删除或不在当前备份中，草稿仍保留在本机");
        if (note.revision !== value.revision)
          throw new TreeError(
            "笔记已被更新，草稿已保留。请重新加载笔记后合并内容",
          );
        if (value.action === "delete")
          next.notes = next.notes.filter((item) => item.id !== note.id);
        else {
          note.title = value.title!;
          note.content = value.content!;
          note.revision++;
          note.updatedAt = new Date().toISOString();
        }
      }
      next.revision++;
      validateTree(next);
      await this.persist(next);
      return { data: this.data, selectedId };
    });
  }
  saveWorkspaceState(value: unknown) {
    return this.exclusive(async () => {
      const allowed = [
        "treelearning-navigation",
        "treelearning-scroll",
        "treelearning-question-drafts",
        "treelearning-note-selected",
        "treelearning-note-drafts",
        "treelearning-note-width",
      ];
      if (
        !value ||
        typeof value !== "object" ||
        Array.isArray(value) ||
        Object.keys(value).some((key) => !allowed.includes(key))
      )
        throw new TreeError("工作区状态无效");
      const next = { ...this.workspaceState, ...value };
      await atomicWrite(
        path.join(this.directory, "workspace-state.json"),
        next,
      );
      this.workspaceState = next;
    });
  }
  saveSettings(value: unknown) {
    return this.exclusive(async () => {
      const settings = validateSettings(value);
      const saved = {
        ...settings,
        apiKey: settings.rememberApiKey ? settings.apiKey : "",
        webApiKey: settings.rememberApiKey ? settings.webApiKey : "",
      };
      await atomicWrite(path.join(this.directory, "settings.json"), saved);
      this.settings = settings;
      return settings;
    });
  }
}
