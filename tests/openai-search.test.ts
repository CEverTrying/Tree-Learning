import test from "node:test";
import assert from "node:assert/strict";
import { createServer, type Server } from "node:http";
import { mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";
import { createApp } from "../server/app";
import { validateSettings, Store } from "../server/store";
import { defaultSettings, type Command } from "../src/model";

async function listen(server: Server) {
  await new Promise<void>((resolve) => server.listen(0, "127.0.0.1", resolve));
  return `http://127.0.0.1:${(server.address() as import("node:net").AddressInfo).port}`;
}

test("search settings migrate existing Tavily configuration and validate providers", () => {
  const { webProvider: _, ...legacy } = defaultSettings;
  assert.equal(
    validateSettings({ ...legacy, webApiKey: "old-key" }).webProvider,
    "tavily",
  );
  assert.equal(validateSettings(legacy).webProvider, "openai");
  assert.throws(
    () => validateSettings({ ...defaultSettings, webProvider: "unknown" }),
    /配置无效/,
  );
});

test("OpenAI relay search shares credentials, composes with branch reads and saves native citations and debug calls", async () => {
  const directory = await mkdtemp(
    path.join(tmpdir(), "treelearning-openai-search-"),
  );
  const instance = await createApp(directory);
  const server = createServer(instance.app);
  const url = await listen(server);
  const store = instance.store;
  const payloads: any[] = [];
  const requests: { url?: string; authorization?: string }[] = [];
  let fileId = "";
  let rejectSearch = false;
  const nativeCall = {
    type: "web_search_call",
    id: "ws_1",
    status: "completed",
    action: { type: "search", query: "linear algebra" },
  };
  const model = createServer(async (req, res) => {
    const chunks: Buffer[] = [];
    for await (const chunk of req) chunks.push(chunk);
    const body = JSON.parse(Buffer.concat(chunks).toString());
    payloads.push(body);
    requests.push({ url: req.url, authorization: req.headers.authorization });
    res.setHeader("Content-Type", "application/json");
    if ("max_tool_calls" in body) {
      res.statusCode = 400;
      res.end(JSON.stringify({ error: "Unsupported parameter: max_tool_calls" }));
      return;
    }
    if (rejectSearch) {
      res.statusCode = 400;
      res.end(JSON.stringify({ error: "unsupported web_search RELAY_SECRET" }));
      return;
    }
    res.end(
      JSON.stringify({
        status: "completed",
        output:
          payloads.length === 1
            ? [
                nativeCall,
                {
                  type: "function_call",
                  call_id: "file_1",
                  name: "read_branch_file",
                  arguments: JSON.stringify({
                    file_id: fileId,
                    offset: 0,
                    max_chars: 1000,
                  }),
                },
              ]
            : [
                {
                  type: "message",
                  role: "assistant",
                  content: [
                    {
                      type: "output_text",
                      text: JSON.stringify({
                        title: "线性代数资料",
                        answer: "查阅了课程和分支文件。",
                      }),
                      annotations: [
                        {
                          type: "url_citation",
                          title: "课程",
                          url: "https://example.com/course",
                          start_index: 0,
                          end_index: 4,
                        },
                        {
                          type: "url_citation",
                          title: "重复",
                          url: "https://example.com/course",
                        },
                        {
                          type: "url_citation",
                          title: "无效",
                          url: "javascript:alert(1)",
                        },
                      ],
                    },
                  ],
                },
              ],
      }),
    );
  });
  try {
    const relay = await listen(model);
    const command = async (value: Command) =>
      (await store.command(value, store.data.revision)).selectedId;
    const project = await command({
      type: "create",
      parentId: store.data.rootId,
      kind: "project",
      title: "课程",
    });
    fileId = await command({
      type: "create",
      parentId: project,
      kind: "file",
      title: "教材",
      content: "BRANCH_FILE_BODY",
    });
    const chat = await command({
      type: "create",
      parentId: fileId,
      kind: "chat",
      title: "问题",
      question: "搜索课程并结合教材回答",
    });
    await store.saveSettings({
      ...defaultSettings,
      webEnabled: true,
      webProvider: "openai",
      apiType: "responses",
      baseUrl: relay + "/relay/v1/chat/completions",
      apiKey: "RELAY_SECRET",
      model: "relay-model",
      mode: "debug",
    });
    const generate = () =>
      fetch(url + "/api/generate", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ id: chat, revision: store.data.revision }),
      });
    const response = await generate();
    assert.equal(response.status, 200, await response.text());
    assert.equal(payloads.length, 2);
    assert.ok(
      requests.every(
        (request) =>
          request.url === "/relay/v1/responses" &&
          request.authorization === "Bearer RELAY_SECRET",
      ),
    );
    assert.deepEqual(
      payloads[0].tools.find((tool: any) => tool.type === "web_search"),
      { type: "web_search" },
    );
    assert.equal(payloads[0].tools.length, 4);
    assert.ok(payloads.every((body) => !("max_tool_calls" in body)));
    assert.ok(!JSON.stringify(payloads[0]).includes("BRANCH_FILE_BODY"));
    assert.ok(JSON.stringify(payloads[1]).includes("BRANCH_FILE_BODY"));
    assert.ok(payloads[1].input.some((item: any) => item.id === nativeCall.id));
    const node = store.data.nodes.find((node) => node.id === chat)!;
    assert.equal(node.title, "线性代数资料");
    assert.deepEqual(node.webSources, [
      { title: "课程", url: "https://example.com/course" },
    ]);
    assert.equal(node.fileReads?.[0].content, "BRANCH_FILE_BODY");
    const debug = await (await fetch(url + "/api/debug/requests")).json();
    assert.equal(debug.requests[1].body, JSON.stringify(payloads[0]));
    assert.deepEqual(
      debug.requests[1].toolCalls.map((call: any) => call.name),
      ["web_search", "read_branch_file"],
    );
    assert.ok(!JSON.stringify(debug).includes("RELAY_SECRET"));
    const reloaded = new Store(directory);
    await reloaded.init();
    assert.equal(reloaded.settings.webProvider, "openai");
    assert.equal(reloaded.settings.apiKey, "");
    assert.deepEqual(
      reloaded.data.nodes.find((node) => node.id === chat)!.webSources,
      node.webSources,
    );
    rejectSearch = true;
    const rejected = await generate();
    const error = await rejected.text();
    assert.equal(rejected.status, 502);
    assert.match(error, /中转站.*Responses API.*web_search/);
    assert.ok(!error.includes("RELAY_SECRET"));
    assert.equal(
      store.data.nodes.find((node) => node.id === chat)!.answer,
      node.answer,
    );
    rejectSearch = false;
    await store.saveSettings({ ...store.settings, webEnabled: false });
    assert.equal((await generate()).status, 200);
    assert.ok(
      !payloads.at(-1).tools.some((tool: any) => tool.type === "web_search"),
    );
    await store.saveSettings({
      ...store.settings,
      webEnabled: true,
      apiType: "chat-completions",
    });
    assert.equal((await generate()).status, 409);
  } finally {
    await instance.close();
    server.closeAllConnections();
    model.closeAllConnections();
    await Promise.all([
      new Promise<void>((resolve) => server.close(() => resolve())),
      new Promise<void>((resolve) => model.close(() => resolve())),
    ]);
    await rm(directory, { recursive: true, force: true });
  }
});
