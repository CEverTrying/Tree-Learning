import test from "node:test";
import assert from "node:assert/strict";
import { mkdtemp, readFile, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";
import { createServer, type Server } from "node:http";
import { createApp } from "../server/app";
import { answerInstructions } from "../server/answer-format";
import { Store, validateSettings } from "../server/store";
import { defaultSettings, type TreeData } from "../src/model";

test("AI is the default; saved modes and legacy demo preferences survive restart", async () => {
  const directory = await mkdtemp(path.join(tmpdir(), "treelearning-modes-"));
  try {
    const store = new Store(directory);
    await store.init();
    assert.equal(store.settings.mode, "ai");
    await store.saveSettings({ ...defaultSettings, mode: "debug" });
    const restored = new Store(directory);
    await restored.init();
    assert.equal(restored.settings.mode, "debug");
    const { mode: _mode, ...legacy } = defaultSettings;
    for (const demo of [true, false]) {
      await writeFile(
        path.join(directory, "settings.json"),
        JSON.stringify({ ...legacy, demo }),
      );
      await restored.init();
      assert.equal(restored.settings.mode, demo ? "demo" : "ai");
    }
    assert.throws(() =>
      validateSettings({ ...defaultSettings, mode: "invalid" }),
    );
  } finally {
    await rm(directory, { recursive: true, force: true });
  }
});

test("shutdown waits for queued data writes", async () => {
  const directory = await mkdtemp(path.join(tmpdir(), "treelearning-close-"));
  const instance = await createApp(directory);
  let release!: () => void;
  const barrier = new Promise<void>((resolve) => {
    release = resolve;
  });
  void instance.store.exclusive(() => barrier);
  const write = instance.store.command(
    {
      type: "create",
      parentId: instance.store.data.rootId,
      kind: "project",
      title: "Saved on exit",
    },
    0,
  );
  let closed = false;
  const closing = instance.close().then(() => {
    closed = true;
  });
  try {
    await new Promise<void>((resolve) => setImmediate(resolve));
    assert.equal(closed, false);
  } finally {
    release();
  }
  await Promise.all([write, closing]);
  const restored = new Store(directory);
  await restored.init();
  assert.equal(restored.data.nodes.at(-1)?.title, "Saved on exit");
  await rm(directory, { recursive: true, force: true });
});

async function listen(server: Server) {
  await new Promise<void>((r) => server.listen(0, "127.0.0.1", r));
  return `http://127.0.0.1:${(server.address() as import("node:net").AddressInfo).port}`;
}
test("API persistence, exact provider payloads, immutable history, cancellation and key preferences", async (t) => {
  const directory = await mkdtemp(path.join(tmpdir(), "treelearning-test-"));
  const instance = await createApp(directory);
  const server = createServer(instance.app);
  const url = await listen(server);
  const payloads: any[] = [];
  let hold = false;
  let fail = false;
  let releaseRequest: (() => void) | undefined;
  const upstream = createServer(async (req, res) => {
    const chunks = [];
    for await (const chunk of req) chunks.push(chunk);
    payloads.push({
      url: req.url,
      body: JSON.parse(Buffer.concat(chunks).toString()),
      authorization: req.headers.authorization,
    });
    if (hold) {
      releaseRequest?.();
      return;
    }
    if (fail) {
      res.writeHead(500);
      res.end("Upstream failed");
      return;
    }
    res.setHeader("Content-Type", "application/json");
    res.end(
      req.url === "/v1/responses"
        ? JSON.stringify({
            status: "completed",
            output: [
              {
                type: "message",
                role: "assistant",
                content: [
                  {
                    type: "output_text",
                    text: JSON.stringify({
                      title: "响应接口概括",
                      answer: "RESPONSES ANSWER",
                    }),
                  },
                ],
              },
            ],
          })
        : JSON.stringify({
            choices: [
              {
                message: {
                  content: JSON.stringify({
                    title: "问题概括",
                    answer: "MODEL ANSWER",
                  }),
                },
              },
            ],
          }),
    );
  });
  const provider = await listen(upstream);
  t.after(async () => {
    await instance.close();
    server.closeAllConnections();
    upstream.closeAllConnections();
    await Promise.all([
      new Promise<void>((r) => server.close(() => r())),
      new Promise<void>((r) => upstream.close(() => r())),
    ]);
    await rm(directory, { recursive: true, force: true });
  });
  const request = async (endpoint: string, body?: unknown, method = "POST") => {
    const response = await fetch(
      url + endpoint,
      body === undefined
        ? undefined
        : {
            method,
            headers: { "Content-Type": "application/json" },
            body: JSON.stringify(body),
          },
    );
    return { status: response.status, value: (await response.json()) as any };
  };
  let data: TreeData = (await request("/api/tree")).value.data;
  const cmd = async (command: unknown) => {
    const result = await request("/api/commands", {
      revision: data.revision,
      command,
    });
    assert.equal(result.status, 200, JSON.stringify(result.value));
    data = result.value.data;
    return result.value.selectedId as string;
  };
  await cmd({
    type: "edit",
    id: data.rootId,
    patch: { content: "ROOT EXACT" },
  });
  const project = await cmd({
    type: "create",
    parentId: data.rootId,
    kind: "project",
    title: "P",
    content: "PROJECT EXACT",
  });
  const form = new FormData();
  form.append("file", new Blob(["FILE EXACT"]), "lecture.md");
  const imported = (await (
    await fetch(url + "/api/import", { method: "POST", body: form })
  ).json()) as any;
  assert.equal(imported.fileRef.chars, 10);
  assert.equal(imported.content, undefined);
  const file = await cmd({
    type: "create",
    parentId: project,
    kind: "file",
    title: imported.filename,
    fileRef: imported.fileRef,
  });
  await cmd({
    type: "create",
    parentId: project,
    kind: "chat",
    title: "Sibling",
    question: "PRIVATE SIBLING",
  });
  const chat = await cmd({
    type: "create",
    parentId: file,
    kind: "chat",
    title: "Q",
    question: "QUESTION EXACT",
  });
  const settings = {
    ...defaultSettings,
    mode: "debug",
    baseUrl: `${provider}/v1`,
    model: "test-model",
    apiKey: "test-secret",
  };
  assert.equal((await request("/api/settings")).value.mode, "ai");
  assert.equal(
    (await request("/api/generate", { id: chat, revision: data.revision }))
      .status,
    409,
  );
  assert.equal(payloads.length, 0);
  assert.equal((await request("/api/settings", settings, "PUT")).status, 200);
  assert.ok(
    !(await readFile(path.join(directory, "settings.json"), "utf8")).includes(
      "test-secret",
    ),
  );
  let generated = await request("/api/generate", {
    id: chat,
    revision: data.revision,
  });
  assert.equal(generated.status, 200);
  data = generated.value.data;
  assert.equal(data.nodes.find((node) => node.id === chat)?.title, "问题概括");
  assert.equal(
    data.nodes.find((node) => node.id === chat)?.answer,
    "MODEL ANSWER",
  );
  let debug = (await request("/api/debug/requests")).value.requests[0];
  assert.equal(debug.status, "success");
  assert.equal(debug.responseStatus, 200);
  assert.equal(debug.url, `${provider}/v1/chat/completions`);
  assert.deepEqual(JSON.parse(debug.body), payloads[0].body);
  assert.equal(payloads[0].authorization, "Bearer test-secret");
  assert.equal(debug.headers.Authorization, "Bearer [已隐藏]");
  assert.ok(!JSON.stringify(debug).includes("test-secret"));
  assert.deepEqual(payloads[0].body.messages, [
    { role: "system", content: `ROOT EXACT\n\n${answerInstructions}` },
    { role: "user", content: "【项目：P】\nPROJECT EXACT" },
    {
      role: "user",
      content: `【可按需读取的文件：lecture.md】\n文件 ID：${file}\n正文长度：10 字符`,
    },
    { role: "user", content: "QUESTION EXACT" },
  ]);
  await request(
    "/api/settings",
    { ...settings, apiType: "responses", rememberApiKey: true },
    "PUT",
  );
  generated = await request("/api/generate", {
    id: chat,
    revision: data.revision,
  });
  assert.equal(generated.status, 200);
  data = generated.value.data;
  assert.equal(payloads[1].url, "/v1/responses");
  assert.equal(
    payloads[1].body.instructions,
    `ROOT EXACT\n\n${answerInstructions}`,
  );
  assert.equal(
    data.nodes.find((node) => node.id === chat)?.title,
    "响应接口概括",
  );
  assert.equal(
    data.nodes.find((node) => node.id === chat)?.question,
    "QUESTION EXACT",
  );
  assert.equal(payloads[1].body.store, false);
  assert.equal(payloads[1].body.truncation, "disabled");
  assert.ok(!JSON.stringify(payloads[1]).includes("MODEL ANSWER"));
  debug = (await request("/api/debug/requests")).value.requests[0];
  assert.deepEqual(JSON.parse(debug.body), payloads[1].body);
  const restored = new Store(directory);
  await restored.init();
  assert.deepEqual(restored.data, data);
  assert.equal(restored.settings.apiKey, "test-secret");
  assert.equal(
    (
      await request("/api/commands", {
        revision: data.revision,
        command: { type: "edit", id: project, patch: { content: "CHANGE" } },
      })
    ).status,
    409,
  );
  assert.equal(
    (
      await request("/api/commands", {
        revision: 0,
        command: { type: "delete", id: chat },
      })
    ).status,
    409,
  );
  hold = true;
  const waiting = new Promise<void>((r) => {
    releaseRequest = r;
  });
  const generation = request("/api/generate", {
    id: chat,
    revision: data.revision,
  });
  await waiting;
  assert.equal(
    (await request("/api/debug/requests")).value.requests[0].status,
    "pending",
  );
  assert.equal(
    (
      await request("/api/commands", {
        revision: data.revision,
        command: {
          type: "create",
          parentId: chat,
          kind: "chat",
          title: "Race",
          question: "Race",
        },
      })
    ).status,
    409,
  );
  await request("/api/cancel", {});
  assert.equal((await generation).status, 502);
  assert.equal(
    (await request("/api/debug/requests")).value.requests[0].status,
    "cancelled",
  );
  assert.deepEqual((await request("/api/tree")).value.data, data);
  hold = false;
  fail = true;
  assert.equal(
    (await request("/api/generate", { id: chat, revision: data.revision }))
      .status,
    502,
  );
  debug = (await request("/api/debug/requests")).value.requests[0];
  assert.equal(debug.status, "error");
  assert.equal(debug.responseStatus, 500);
  assert.deepEqual(JSON.parse(debug.body), payloads.at(-1).body);
  assert.equal(
    (await request("/api/settings", { ...settings, mode: "demo" }, "PUT"))
      .status,
    200,
  );
  const sent = payloads.length;
  generated = await request("/api/generate", {
    id: chat,
    revision: data.revision,
  });
  assert.equal(generated.status, 200);
  data = generated.value.data;
  assert.equal(data.nodes.find((n) => n.id === chat)?.answerSource, "demo");
  assert.equal(payloads.length, sent);
  assert.deepEqual((await request("/api/debug/requests")).value.requests, []);
  fail = false;
  await request("/api/settings", { ...settings, mode: "ai" }, "PUT");
  generated = await request("/api/generate", {
    id: chat,
    revision: data.revision,
  });
  assert.equal(generated.status, 200);
  data = generated.value.data;
  assert.equal(data.nodes.find((n) => n.id === chat)?.answerSource, "model");
  assert.equal(payloads.length, sent + 1);
  assert.deepEqual((await request("/api/debug/requests")).value.requests, []);
  const blocked = await fetch(url + "/api/tree", {
    headers: { Origin: "https://untrusted.example" },
  });
  assert.equal(blocked.status, 403);
  const invalid = structuredClone(data);
  invalid.nodes.push(invalid.nodes[0]);
  assert.equal(
    (await request("/api/restore", { data: invalid, revision: data.revision }))
      .status,
    409,
  );
  assert.deepEqual((await request("/api/tree")).value.data, data);
});
