import express from "express";
import multer from "multer";
import { mkdir, rm } from "node:fs/promises";
import path from "node:path";
import { Agent, fetch } from "undici";
import { Store } from "./store";
import {
  contextMessages,
  isEditable,
  lineage,
  nodeById,
  TreeError,
  type DebugRequest,
  type FileRead,
  type WebSource,
} from "../src/model";
import {
  createModelRequest,
  readModelResponse,
  ModelProtocolError,
  readToolCalls,
  appendToolResults,
} from "./model-api";
import { BranchFileTools } from "./file-tools";
import { answerInstructions, parseAnswer } from "./answer-format";
import { WebTools } from "./web-tools";
import { backup, restoreBackup } from "./backup";

export async function createApp(directory: string) {
  const app = express();
  const store = new Store(directory);
  await store.init();
  const uploadDirectory = path.join(directory, ".uploads");
  await mkdir(uploadDirectory, { recursive: true });
  const dispatcher = new Agent({ headersTimeout: 0, bodyTimeout: 0 });
  const pending = new Map<string, AbortController>();
  const debugRequests: DebugRequest[] = [];
  app.disable("x-powered-by");
  app.use((req, res, next) => {
    const localHosts = ["127.0.0.1", "localhost", "[::1]"];
    let allowed = false;
    try {
      const host = new URL(`http://${req.headers.host}`);
      allowed =
        localHosts.includes(host.hostname) &&
        (!req.headers.origin || new URL(req.headers.origin).host === host.host);
    } catch {
      /* Malformed host or origin is rejected. */
    }
    if (!allowed) {
      res.status(403).json({ error: "不允许跨站访问本地服务" });
      return;
    }
    res.setHeader("X-Content-Type-Options", "nosniff");
    res.setHeader("Referrer-Policy", "no-referrer");
    res.setHeader("X-Frame-Options", "DENY");
    next();
  });
  app.use("/api", (_req, res, next) => {
    res.setHeader("Cache-Control", "no-store");
    next();
  });
  app.use(express.json({ limit: "40mb" }));
  app.get("/api/tree", (_req, res) =>
    res.json({ data: store.data, generatingId: store.generatingId }),
  );
  app.get("/api/backup", async (_req, res) => {
    const zip = await backup(store.data, store.documents);
    res.setHeader("Content-Type", "application/zip");
    res.attachment(`TreeLearning-${new Date().toISOString().slice(0, 10)}.zip`);
    zip.on("error", () => res.destroy());
    zip.outputStream.on("error", () => res.destroy());
    res.on("close", () =>
      (zip.outputStream as import("node:stream").Readable).destroy(),
    );
    zip.outputStream.pipe(res);
    zip.end();
  });
  app.post("/api/commands", async (req, res) => {
    if (
      !req.body?.command ||
      !["create", "edit", "delete"].includes(req.body.command.type)
    )
      throw new TreeError("节点操作无效");
    res.json(await store.command(req.body.command, req.body.revision));
  });
  app.post("/api/restore", async (req, res) =>
    res.json({ data: await store.replace(req.body?.data, req.body?.revision) }),
  );
  app.post("/api/notes", async (req, res) =>
    res.json(await store.note(req.body)),
  );
  app.get("/api/workspace-state", (_req, res) =>
    res.json({
      desktop: process.env.TREELEARNING_DESKTOP === "1",
      state: store.workspaceState,
    }),
  );
  app.post("/api/workspace-state", async (req, res) => {
    await store.saveWorkspaceState(req.body);
    res.json({ ok: true });
  });
  app.get("/api/settings", (_req, res) => res.json(store.settings));
  app.put("/api/settings", async (req, res) => {
    const settings = await store.saveSettings(req.body);
    if (settings.mode !== "debug") debugRequests.length = 0;
    res.json(settings);
  });
  app.get("/api/debug/requests", (_req, res) =>
    res.json({
      requests: store.settings.mode === "debug" ? debugRequests : [],
    }),
  );
  app.get("/api/context/:id", (req, res) =>
    res.json({
      path: lineage(store.data, req.params.id),
      messages: contextMessages(
        store.data,
        req.params.id,
        req.query.generating === "true",
      ),
    }),
  );
  app.post("/api/cancel", (_req, res) => {
    for (const controller of pending.values()) controller.abort();
    res.json({ ok: true });
  });
  app.post("/api/generate", async (req, res) => {
    const { id, revision } = req.body || {};
    const controller = new AbortController();
    const disconnect = () => {
      if (!res.writableEnded) controller.abort();
    };
    res.on("close", disconnect);
    res.setTimeout(0);
    let acquired = false;
    let debugRequest: DebugRequest | undefined;
    try {
      const snapshot = await store.exclusive(() => {
        store.assertAvailable(revision);
        const node = nodeById(store.data, id);
        if (node.kind !== "chat" || !isEditable(store.data, id))
          throw new TreeError("只能为未锁定的问答叶节点生成回答");
        if (
          store.settings.mode !== "demo" &&
          (!store.settings.baseUrl || !store.settings.model)
        )
          throw new TreeError("请先在模型设置中填写 API 地址和模型名称");
        if (
          store.settings.mode !== "demo" &&
          store.settings.webEnabled &&
          store.settings.webProvider === "tavily" &&
          !store.settings.webApiKey
        )
          throw new TreeError(
            "联网搜索已开启，请在模型设置填写 Tavily API 密钥或关闭联网搜索",
          );
        if (
          store.settings.mode !== "demo" &&
          store.settings.webEnabled &&
          store.settings.webProvider === "openai" &&
          store.settings.apiType !== "responses"
        )
          throw new TreeError(
            "OpenAI 内置搜索需要 Responses API，请在模型设置中切换接口类型",
          );
        store.generatingId = id;
        pending.set(id, controller);
        acquired = true;
        return { data: store.data, settings: { ...store.settings } };
      });
      const messages = contextMessages(snapshot.data, id, true);
      if (messages.reduce((sum, m) => sum + m.content.length, 0) > 500000)
        throw new TreeError("上下文超过 50 万字符，请从更早的节点创建分支");
      let content = "";
      let title: string | undefined;
      let fileReads: FileRead[] = [];
      let webSources: WebSource[] = [];
      if (snapshot.settings.mode === "demo") {
        content = `**演示回复 · 未调用 AI**\n\n当前问题：${nodeById(snapshot.data, id).question}\n\n本次上下文包含 ${lineage(snapshot.data, id).length} 个路径节点、${messages.length} 条消息。\n\n这是用于验证树结构的占位回复。配置模型后，可在此叶节点重新生成真实回答。`;
      } else {
        const request = createModelRequest(
          snapshot.settings,
          [
            messages
              .filter((m) => m.role === "system")
              .map((m) => m.content)
              .join("\n\n"),
            answerInstructions,
          ]
            .filter(Boolean)
            .join("\n\n"),
          messages.filter(
            (m): m is typeof m & { role: "user" | "assistant" } =>
              m.role !== "system",
          ),
          "",
          [],
        );
        const headers = {
          "Content-Type": "application/json",
          ...(snapshot.settings.apiKey
            ? { Authorization: `Bearer ${snapshot.settings.apiKey}` }
            : {}),
        };
        const files = new BranchFileTools(
          snapshot.data,
          id,
          store.documents,
          controller.signal,
        );
        const web = new WebTools(snapshot.settings, controller.signal);
        const tools = [
          ...(files.files.size ? files.definitions(request.apiType) : []),
          ...web.definitions(request.apiType),
        ];
        if (tools.length) {
          request.body.tools = tools;
          if (request.apiType === "responses")
            request.body.include = ["reasoning.encrypted_content"];
        }
        let toolCount = 0;
        let nativeSearchCount = 0;
        const nativeSearch =
          snapshot.settings.webEnabled &&
          snapshot.settings.webProvider === "openai";
        for (let round = 0; round <= 8; round++) {
          controller.signal.throwIfAborted();
          if (nativeSearch) {
            if (nativeSearchCount >= 8)
              request.body.tools = tools.filter(
                (tool) => tool.type !== "web_search",
              );
            request.body.max_tool_calls = Math.max(1, 8 - nativeSearchCount);
          }
          if (round === 8) request.body.tool_choice = "none";
          const body = JSON.stringify(request.body);
          if (body.length > 1500000)
            throw new TreeError("本次请求过长，请减少文件阅读范围后重试");
          if (snapshot.settings.mode === "debug") {
            // Capture the exact serialized body passed to fetch; never retain the key.
            debugRequest = {
              id: crypto.randomUUID(),
              nodeId: id,
              nodeTitle: nodeById(snapshot.data, id).title,
              startedAt: new Date().toISOString(),
              method: "POST",
              url: request.url.toString(),
              headers: {
                ...headers,
                ...(snapshot.settings.apiKey
                  ? { Authorization: "Bearer [已隐藏]" }
                  : {}),
              },
              body,
              status: "pending",
            };
            debugRequests.unshift(debugRequest);
            debugRequests.splice(20);
          }
          const response = await fetch(request.url, {
            method: "POST",
            headers,
            body,
            dispatcher,
            signal: controller.signal,
          });
          if (debugRequest) debugRequest.responseStatus = response.status;
          if (!response.ok) {
            await response.body?.cancel();
            throw new ModelProtocolError(
              `模型服务返回 HTTP ${response.status}，请检查模型配置、额度和上下文长度。${nativeSearch ? "已启用 OpenAI 内置搜索，请确认中转站和所选模型支持 Responses API 的 web_search 工具；也可关闭联网搜索后重试。" : ""}`,
            );
          }
          const value: unknown = await response.json();
          const nativeCalls = web.observeResponse(value);
          nativeSearchCount += nativeCalls.length;
          if (debugRequest && nativeCalls.length)
            debugRequest.toolCalls = nativeCalls;
          const calls = readToolCalls(request.apiType, value);
          if (!calls.length) {
            const answer = parseAnswer(
              readModelResponse(request.apiType, value),
            );
            content = answer.answer;
            title = answer.title;
            break;
          }
          if (round === 8 || toolCount + calls.length > 32)
            throw new ModelProtocolError(
              "工具调用次数达到上限，请缩小问题范围后重试",
            );
          toolCount += calls.length;
          controller.signal.throwIfAborted();
          const outputs: string[] = [];
          for (const call of calls) {
            controller.signal.throwIfAborted();
            outputs.push(
              call.name === "web_search" || call.name === "read_web_page"
                ? await web.execute(call.name, call.arguments)
                : await files.execute(call.name, call.arguments),
            );
          }
          if (debugRequest) {
            debugRequest.toolCalls = [
              ...(debugRequest.toolCalls || []),
              ...calls.map((call, index) => ({
                name: call.name,
                arguments: call.arguments,
                output: outputs[index],
              })),
            ];
            debugRequest.status = "success";
            debugRequest.finishedAt = new Date().toISOString();
          }
          appendToolResults(
            request.apiType,
            request.body,
            value,
            calls,
            outputs,
          );
        }
        fileReads = files.reads;
        webSources = web.sources;
      }
      if (controller.signal.aborted) {
        if (!res.destroyed)
          res.status(409).json({ error: "已停止生成，原回复保留" });
        return;
      }
      const data = await store.answer(
        id,
        content,
        snapshot.settings.mode === "demo" ? "demo" : "model",
        fileReads,
        title,
        webSources,
      );
      if (debugRequest) debugRequest.status = "success";
      res.json({ data });
    } catch (error) {
      if (debugRequest) {
        debugRequest.status = controller.signal.aborted ? "cancelled" : "error";
        debugRequest.error = controller.signal.aborted
          ? "已停止生成，原回复保留"
          : error instanceof TreeError || error instanceof ModelProtocolError
            ? error.message
            : "无法连接模型服务，请检查 API 地址和网络";
      }
      if (res.destroyed) return;
      res.status(error instanceof TreeError ? 409 : 502).json({
        error: controller.signal.aborted
          ? "已停止生成，原回复保留"
          : error instanceof TreeError || error instanceof ModelProtocolError
            ? error.message
            : "无法连接模型服务，请检查 API 地址和网络",
      });
    } finally {
      if (debugRequest) {
        if (controller.signal.aborted) debugRequest.status = "cancelled";
        debugRequest.finishedAt = new Date().toISOString();
      }
      res.off("close", disconnect);
      if (acquired) {
        pending.delete(id);
        store.generatingId = null;
      }
    }
  });
  const upload = multer({
    dest: uploadDirectory,
    limits: { files: 1 },
  });
  app.post("/api/restore/upload", upload.single("file"), async (req, res) => {
    if (!req.file) throw new TreeError("请选择 ZIP 备份");
    try {
      const revision = Number(req.body.revision);
      store.assertAvailable(revision);
      const data = await restoreBackup(req.file.path, store.documents);
      res.json({ data: await store.replace(data, revision) });
    } finally {
      await rm(req.file.path, { force: true });
    }
  });
  app.get("/api/documents/:id", async (req, res) => {
    const fileRef = await store.documents.info(req.params.id);
    const offset = Number(req.query.offset || 0);
    const content = await store.documents.read(fileRef, offset, 20000);
    res.json({
      fileRef,
      offset,
      content,
      next_offset:
        offset + content.length < fileRef.chars
          ? offset + content.length
          : null,
    });
  });
  let importing = false;
  app.post("/api/import", upload.single("file"), async (req, res) => {
    const file = req.file;
    if (!file) throw new TreeError("请选择文件");
    const filename = Buffer.from(file.originalname, "latin1").toString("utf8");
    const ext = path.extname(filename).toLowerCase().slice(1);
    const controller = new AbortController();
    const disconnect = () => {
      if (!res.writableEnded) controller.abort();
    };
    res.on("close", disconnect);
    let acquired = false;
    try {
      if (importing) throw new TreeError("另一个文件正在解析，请完成后重试");
      importing = acquired = true;
      if (
        ![
          "pdf",
          "docx",
          "txt",
          "md",
          "csv",
          "json",
          "html",
          "xml",
          "log",
          "py",
          "js",
          "ts",
          "tsx",
          "jsx",
          "css",
          "c",
          "h",
          "cpp",
          "java",
          "rs",
          "go",
          "yaml",
          "yml",
          "tex",
        ].includes(ext)
      ) {
        res.status(415).json({
          error: "支持文本 PDF、DOCX、UTF-8 文本、Markdown 和代码文件",
        });
        return;
      }
      const fileRef = await store.documents.importFile(
        file.path,
        ext,
        controller.signal,
      );
      res.json({ filename, fileRef });
    } finally {
      res.off("close", disconnect);
      if (acquired) importing = false;
      await rm(file.path, { force: true });
    }
  });
  app.use("/api", (_req, res) => res.status(404).json({ error: "接口不存在" }));
  app.use(
    (
      error: Error,
      _req: express.Request,
      res: express.Response,
      _next: express.NextFunction,
    ) => {
      res.status(error instanceof TreeError ? 409 : 400).json({
        error:
          error instanceof TreeError
            ? error.message
            : error instanceof multer.MulterError
              ? "文件上传失败，请检查上传格式和磁盘空间"
              : "请求无法处理，操作未保存",
      });
    },
  );
  return {
    app,
    store,
    close: async () => {
      for (const controller of pending.values()) controller.abort();
      await store.flush();
      await dispatcher.close();
    },
  };
}
