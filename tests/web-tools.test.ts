import test from "node:test";
import assert from "node:assert/strict";
import { createServer, type Server } from "node:http";
import { mkdtemp, readFile, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";
import { MockAgent, getGlobalDispatcher, setGlobalDispatcher } from "undici";
import { WebTools } from "../server/web-tools";
import { createApp } from "../server/app";
import { Store } from "../server/store";
import {
  contextMessages,
  defaultSettings,
  validateTree,
  type Command,
} from "../src/model";

async function listen(server: Server) {
  await new Promise<void>((resolve) => server.listen(0, "127.0.0.1", resolve));
  return `http://127.0.0.1:${(server.address() as import("node:net").AddressInfo).port}`;
}
const settings = {
  ...defaultSettings,
  webEnabled: true,
  webProvider: "tavily" as const,
  webApiKey: "SEARCH_SECRET",
};

test("web tools validate arguments, gate access, bound responses, redact errors and cancel", async () => {
  const previous = getGlobalDispatcher();
  const mock = new MockAgent();
  mock.disableNetConnect();
  setGlobalDispatcher(mock);
  try {
    const controller = new AbortController();
    const off = new WebTools(defaultSettings, controller.signal);
    assert.deepEqual(off.definitions("responses"), []);
    assert.ok(JSON.parse(await off.execute("web_search", "{}")).error);
    const tools = new WebTools(settings, controller.signal);
    assert.ok(
      JSON.parse(
        await tools.execute(
          "read_web_page",
          '{"url":"http://127.0.0.1/private"}',
        ),
      ).error,
    );
    assert.ok(
      JSON.parse(
        await tools.execute("read_web_page", '{"url":"file:///private.pdf"}'),
      ).error,
    );
    assert.ok(
      JSON.parse(
        await tools.execute("web_search", '{"query":"test","max_results":100}'),
      ).error,
    );
    mock
      .get("https://api.tavily.com")
      .intercept({ path: "/extract", method: "POST" })
      .reply(200, {
        results: [
          { url: "https://example.com/book", raw_content: "A".repeat(25000) },
        ],
      });
    const read = JSON.parse(
      await tools.execute(
        "read_web_page",
        '{"url":"https://example.com/book"}',
      ),
    );
    assert.equal(read.results[0].content.length, 20000);
    assert.equal(read.results[0].truncated, true);
    mock
      .get("https://api.tavily.com")
      .intercept({ path: "/search", method: "POST" })
      .reply(401, { error: "SEARCH_SECRET" });
    const error = await tools.execute(
      "web_search",
      '{"query":"test","max_results":2}',
    );
    assert.ok(error.includes("401"));
    assert.ok(!error.includes("SEARCH_SECRET"));
    mock
      .get("https://api.tavily.com")
      .intercept({ path: "/search", method: "POST" })
      .reply(200, { results: [] })
      .times(6);
    for (let i = 0; i < 6; i++)
      await tools.execute("web_search", '{"query":"test","max_results":2}');
    assert.ok(
      (
        await tools.execute("web_search", '{"query":"test","max_results":2}')
      ).includes("8 次上限"),
    );
    controller.abort();
    await assert.rejects(
      tools.execute("web_search", '{"query":"test","max_results":2}'),
    );
    mock.assertNoPendingInterceptors();
  } finally {
    setGlobalDispatcher(previous);
    await mock.close();
  }
});

for (const protocol of ["chat-completions", "responses"] as const) {
  test(`${protocol}: search, webpage and imported PDF tools work together and preserve sources`, async () => {
    const directory = await mkdtemp(path.join(tmpdir(), "treelearning-web-"));
    const previous = getGlobalDispatcher();
    const mock = new MockAgent();
    mock.disableNetConnect();
    mock.enableNetConnect((host) => host.startsWith("127.0.0.1"));
    setGlobalDispatcher(mock);
    const instance = await createApp(directory);
    const server = createServer(instance.app);
    const url = await listen(server);
    const store = instance.store;
    const payloads: any[] = [];
    let fileId = "";
    const model = createServer(async (req, res) => {
      const chunks: Buffer[] = [];
      for await (const chunk of req) chunks.push(chunk);
      const body = JSON.parse(Buffer.concat(chunks).toString());
      payloads.push(body);
      const calls = [
        {
          name: "web_search",
          arguments: JSON.stringify({ query: "PDF learning", max_results: 2 }),
        },
        {
          name: "read_web_page",
          arguments: JSON.stringify({ url: "https://example.com/lesson" }),
        },
        {
          name: "search_branch_files",
          arguments: JSON.stringify({
            query: "paper.pdf",
            offset: 0,
            limit: 5,
          }),
        },
        {
          name: "read_branch_file",
          arguments: JSON.stringify({
            file_id: fileId,
            offset: 0,
            max_chars: 1000,
          }),
        },
      ];
      const answer = JSON.stringify({
        title: "学习资料整理",
        answer: "参考 [课程](https://example.com/lesson) 和 paper.pdf。",
      });
      res.setHeader("Content-Type", "application/json");
      res.end(
        JSON.stringify(
          protocol === "responses"
            ? {
                status: "completed",
                output:
                  payloads.length === 1
                    ? calls.map((call, index) => ({
                        type: "function_call",
                        call_id: `c${index}`,
                        ...call,
                      }))
                    : [
                        {
                          type: "message",
                          role: "assistant",
                          content: [{ type: "output_text", text: answer }],
                        },
                      ],
              }
            : {
                choices: [
                  {
                    message:
                      payloads.length === 1
                        ? {
                            role: "assistant",
                            content: null,
                            tool_calls: calls.map((call, index) => ({
                              id: `c${index}`,
                              type: "function",
                              function: call,
                            })),
                          }
                        : { role: "assistant", content: answer },
                  },
                ],
              },
        ),
      );
    });
    try {
      const modelUrl = await listen(model);
      const command = async (value: Command) =>
        (await store.command(value, store.data.revision)).selectedId;
      const project = await command({
        type: "create",
        parentId: store.data.rootId,
        kind: "project",
        title: "学习",
      });
      const pdf = await readFile(
        new URL(
          "../node_modules/pdf-parse/test/data/01-valid.pdf",
          import.meta.url,
        ),
      );
      const form = new FormData();
      form.append(
        "file",
        new Blob([pdf], { type: "application/pdf" }),
        "paper.pdf",
      );
      const imported = await fetch(url + "/api/import", {
        method: "POST",
        body: form,
      });
      assert.equal(imported.status, 200);
      const text = await imported.json();
      assert.ok(text.fileRef.chars > 1000);
      fileId = await command({
        type: "create",
        parentId: project,
        kind: "file",
        title: "paper.pdf",
        fileRef: text.fileRef,
      });
      const chat = await command({
        type: "create",
        parentId: fileId,
        kind: "chat",
        title: "问题",
        question: "结合课程网页和 PDF 回答",
      });
      await store.saveSettings({
        ...settings,
        mode: "debug",
        apiType: protocol,
        baseUrl: modelUrl,
        model: "mock",
        rememberApiKey: false,
      });
      mock
        .get("https://api.tavily.com")
        .intercept({
          path: "/search",
          method: "POST",
          headers: { authorization: "Bearer SEARCH_SECRET" },
        })
        .reply(200, {
          results: [
            {
              title: "公开课程",
              url: "https://example.com/lesson",
              content: "SEARCH_CONTENT",
            },
            { title: "bad", url: "javascript:alert(1)", content: "bad" },
          ],
        });
      mock
        .get("https://api.tavily.com")
        .intercept({ path: "/extract", method: "POST" })
        .reply(200, {
          results: [
            { url: "https://example.com/lesson", raw_content: "WEB_CONTENT" },
          ],
        });
      const generated = await fetch(url + "/api/generate", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ id: chat, revision: store.data.revision }),
      });
      assert.equal(generated.status, 200, await generated.text());
      assert.equal(payloads.length, 2);
      assert.equal(payloads[0].tools.length, 5);
      assert.ok(!JSON.stringify(payloads).includes("SEARCH_SECRET"));
      assert.ok(JSON.stringify(payloads[1]).includes("SEARCH_CONTENT"));
      assert.ok(JSON.stringify(payloads[1]).includes("WEB_CONTENT"));
      const node = store.data.nodes.find((node) => node.id === chat)!;
      assert.equal(node.webSources?.length, 1);
      assert.equal(
        node.fileReads?.[0].content,
        await store.documents.read(text.fileRef, 0, 1000),
      );
      validateTree(store.data);
      const unsafe = structuredClone(store.data);
      unsafe.nodes.find((node) => node.id === chat)!.webSources![0].url =
        "javascript:alert(1)";
      assert.throws(() => validateTree(unsafe), /网页来源/);
      assert.ok(
        !JSON.stringify(contextMessages(store.data, chat)).includes(
          "WEB_CONTENT",
        ),
      );
      const debug = await (await fetch(url + "/api/debug/requests")).json();
      assert.equal(debug.requests[1].toolCalls.length, 4);
      assert.ok(!JSON.stringify(debug).includes("SEARCH_SECRET"));
      const restored = new Store(directory);
      await restored.init();
      assert.deepEqual(restored.data, store.data);
      assert.equal(restored.settings.webApiKey, "");
      await store.saveSettings({ ...store.settings, webApiKey: "" });
      const missingKey = await fetch(url + "/api/generate", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ id: chat, revision: store.data.revision }),
      });
      assert.equal(missingKey.status, 409);
      assert.ok((await missingKey.text()).includes("Tavily"));
      await store.saveSettings({
        ...store.settings,
        webApiKey: settings.webApiKey,
      });
      await store.saveSettings({ ...store.settings, rememberApiKey: true });
      await restored.init();
      assert.equal(restored.settings.webApiKey, "SEARCH_SECRET");
      mock.assertNoPendingInterceptors();
    } finally {
      await instance.close();
      server.closeAllConnections();
      model.closeAllConnections();
      await Promise.all([
        new Promise<void>((resolve) => server.close(() => resolve())),
        new Promise<void>((resolve) => model.close(() => resolve())),
      ]);
      setGlobalDispatcher(previous);
      await mock.close();
      await rm(directory, { recursive: true, force: true });
    }
  });
}
