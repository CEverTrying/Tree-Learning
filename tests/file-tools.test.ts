import test from "node:test";
import assert from "node:assert/strict";
import { createServer, type Server } from "node:http";
import { mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";
import { createApp } from "../server/app";
import { Store } from "../server/store";
import { BranchFileTools } from "../server/file-tools";
import { readToolCalls } from "../server/model-api";
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

for (const protocol of ["chat-completions", "responses"] as const) {
  test(`${protocol}: ancestor-only lazy file tools, exact continuation and audit-only snapshots`, async () => {
    const directory = await mkdtemp(path.join(tmpdir(), "treelearning-files-"));
    const instance = await createApp(directory);
    const app = createServer(instance.app);
    const url = await listen(app);
    const store = instance.store;
    const command = async (value: Command) =>
      (await store.command(value, store.data.revision)).selectedId;
    const project = await command({
      type: "create",
      parentId: store.data.rootId,
      kind: "project",
      title: "Project",
    });
    const file = await command({
      type: "create",
      parentId: project,
      kind: "file",
      title: "教材.md",
      content: "FILE_BODY_MARKER 线性组合的定义",
    });
    const otherProject = await command({
      type: "create",
      parentId: store.data.rootId,
      kind: "project",
      title: "Other",
    });
    const sibling = await command({
      type: "create",
      parentId: project,
      kind: "file",
      title: "旁支教材.md",
      content: "SIBLING_BODY_MARKER 定义",
    });
    const foreign = await command({
      type: "create",
      parentId: otherProject,
      kind: "file",
      title: "秘密.md",
      content: "FOREIGN_SECRET",
    });
    const chat = await command({
      type: "create",
      parentId: file,
      kind: "chat",
      title: "Read",
      question: "请查阅教材中的定义",
    });
    const payloads: any[] = [];
    const provider = createServer(async (req, res) => {
      const chunks: Buffer[] = [];
      for await (const chunk of req) chunks.push(chunk);
      const body = JSON.parse(Buffer.concat(chunks).toString());
      payloads.push(body);
      const history = protocol === "responses" ? body.input : body.messages;
      const outputs = history.filter(
        (item: any) =>
          item.type === "function_call_output" || item.role === "tool",
      );
      const calls =
        outputs.length === 0
          ? [
              {
                name: "list_branch_files",
                arguments: JSON.stringify({ offset: 0, limit: 100 }),
              },
              {
                name: "search_branch_files",
                arguments: JSON.stringify({
                  query: "定义",
                  offset: 0,
                  limit: 100,
                }),
              },
            ]
          : outputs.length === 2
            ? [
                {
                  name: "read_branch_file",
                  arguments: JSON.stringify({
                    file_id: file,
                    offset: 0,
                    max_chars: 20000,
                  }),
                },
                {
                  name: "read_branch_file",
                  arguments: JSON.stringify({
                    file_id: foreign,
                    offset: 0,
                    max_chars: 20000,
                  }),
                },
                {
                  name: "read_branch_file",
                  arguments: JSON.stringify({
                    file_id: "C:\\Users\\secret.txt",
                    offset: 0,
                    max_chars: 20000,
                  }),
                },
                { name: "read_branch_file", arguments: "{" },
                {
                  name: "read_branch_file",
                  arguments: JSON.stringify({
                    file_id: sibling,
                    offset: 0,
                    max_chars: 20000,
                  }),
                },
              ]
            : [];
      res.setHeader("Content-Type", "application/json");
      res.end(
        JSON.stringify(
          protocol === "responses"
            ? {
                status: "completed",
                output: calls.length
                  ? [
                      {
                        type: "reasoning",
                        id: `rs_${outputs.length}`,
                        summary: [],
                        encrypted_content: "opaque-test",
                      },
                      ...calls.map((fn, index) => ({
                        type: "function_call",
                        id: `fc_${outputs.length}_${index}`,
                        call_id: `call_${outputs.length}_${index}`,
                        ...fn,
                      })),
                    ]
                  : [
                      {
                        type: "message",
                        role: "assistant",
                        content: [
                          {
                            type: "output_text",
                            text: JSON.stringify({
                              title: "线性组合定义",
                              answer: "根据教材.md：线性组合的定义。",
                            }),
                          },
                        ],
                      },
                    ],
              }
            : {
                choices: [
                  {
                    finish_reason: calls.length ? "tool_calls" : "stop",
                    message: calls.length
                      ? {
                          role: "assistant",
                          content: null,
                          tool_calls: calls.map((fn, index) => ({
                            id: `call_${outputs.length}_${index}`,
                            type: "function",
                            function: fn,
                          })),
                        }
                      : {
                          role: "assistant",
                          content: JSON.stringify({
                            title: "线性组合定义",
                            answer: "根据教材.md：线性组合的定义。",
                          }),
                        },
                  },
                ],
              },
        ),
      );
    });
    try {
      const providerUrl = await listen(provider);
      await store.saveSettings({
        ...defaultSettings,
        mode: "debug",
        apiType: protocol,
        baseUrl: providerUrl,
        model: "mock",
        apiKey: "secret-key",
      });
      const response = await fetch(url + "/api/generate", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ id: chat, revision: store.data.revision }),
      });
      assert.equal(response.status, 200, await response.text());
      assert.equal(
        store.data.nodes.find((node) => node.id === chat)?.title,
        "线性组合定义",
      );
      assert.equal(payloads.length, 3);
      assert.ok(!JSON.stringify(payloads[0]).includes("FILE_BODY_MARKER"));
      assert.ok(!JSON.stringify(payloads[1]).includes("FILE_BODY_MARKER"));
      assert.ok(JSON.stringify(payloads[2]).includes("FILE_BODY_MARKER"));
      assert.ok(!JSON.stringify(payloads).includes("FOREIGN_SECRET"));
      assert.ok(!JSON.stringify(payloads).includes("秘密.md"));
      assert.ok(!JSON.stringify(payloads).includes("旁支教材.md"));
      assert.ok(!JSON.stringify(payloads).includes("SIBLING_BODY_MARKER"));
      assert.equal(payloads[0].tools.length, 3);
      const finalHistory =
        protocol === "responses" ? payloads[2].input : payloads[2].messages;
      const outputs = finalHistory
        .filter(
          (item: any) =>
            item.type === "function_call_output" || item.role === "tool",
        )
        .map((item: any) => JSON.parse(item.output || item.content));
      assert.equal(outputs[0].files.length, 1);
      assert.equal(outputs[1].files[0].file_id, file);
      assert.equal(outputs[2].content, "FILE_BODY_MARKER 线性组合的定义");
      assert.equal(outputs[2].next_offset, null);
      assert.ok(
        outputs[3].error &&
          outputs[4].error &&
          outputs[5].error &&
          outputs[6].error,
      );
      if (protocol === "responses") {
        assert.ok(
          finalHistory.some(
            (item: any) => item.encrypted_content === "opaque-test",
          ),
        );
        assert.equal(payloads[2].store, false);
        assert.equal(payloads[2].previous_response_id, undefined);
        assert.deepEqual(payloads[0].include, ["reasoning.encrypted_content"]);
      }
      const debug = (await (
        await fetch(url + "/api/debug/requests")
      ).json()) as any;
      assert.equal(debug.requests.length, 3);
      debug.requests.forEach((record: any, index: number) => {
        assert.deepEqual(JSON.parse(record.body), payloads[2 - index]);
        assert.equal(record.status, "success");
      });
      assert.equal(debug.requests[1].toolCalls.length, 5);
      assert.ok(!JSON.stringify(debug).includes("secret-key"));
      const saved = store.data.nodes.find((node) => node.id === chat)!;
      assert.equal(saved.fileReads?.length, 1);
      const tools = new BranchFileTools(store.data, chat, store.documents);
      const chunk = JSON.parse(
        await tools.execute(
          "read_branch_file",
          JSON.stringify({ file_id: file, offset: 0, max_chars: 5 }),
        ),
      );
      assert.equal(chunk.content, "FILE_");
      assert.equal(chunk.next_offset, 5);
      await assert.rejects(
        command({
          type: "edit",
          id: file,
          patch: { content: "UPDATED_FILE" },
        }),
      );
      const projectTools = new BranchFileTools(store.data, project);
      assert.equal(projectTools.files.size, 0);
      assert.ok(
        JSON.parse(
          await projectTools.execute(
            "read_branch_file",
            JSON.stringify({ file_id: file, offset: 0, max_chars: 20 }),
          ),
        ).error,
      );
      assert.deepEqual(
        [...new BranchFileTools(store.data, file).files.keys()],
        [file],
      );
      assert.equal(
        JSON.parse(
          await tools.execute(
            "search_branch_files",
            JSON.stringify({
              query: "SIBLING_BODY_MARKER",
              offset: 0,
              limit: 100,
            }),
          ),
        ).total,
        0,
      );
      const followup = await command({
        type: "create",
        parentId: chat,
        kind: "chat",
        title: "Followup",
        question: "解释刚才的定义",
      });
      const context = JSON.stringify(contextMessages(store.data, followup));
      assert.ok(!context.includes("FILE_BODY_MARKER"));
      assert.ok(!context.includes("UPDATED_FILE"));
      assert.ok(
        !JSON.stringify(contextMessages(store.data, chat, true)).includes(
          "FILE_BODY_MARKER",
        ),
      );
      const restored = new Store(directory);
      await restored.init();
      assert.deepEqual(
        restored.data.nodes.find((node) => node.id === chat)?.fileReads,
        saved.fileReads,
      );
      const legacy = structuredClone(store.data);
      legacy.nodes
        .find((node) => node.id === chat)!
        .fileReads!.push({
          fileId: sibling,
          title: "旁支教材.md",
          offset: 0,
          content: "LEGACY_OUTSIDE_SNAPSHOT",
        });
      assert.ok(
        !JSON.stringify(contextMessages(legacy, followup)).includes(
          "LEGACY_OUTSIDE_SNAPSHOT",
        ),
      );
      const invalid = structuredClone(store.data);
      invalid.nodes.find((node) => node.id === chat)!.fileReads![0].offset = -1;
      assert.throws(() => validateTree(invalid));
    } finally {
      await instance.close();
      app.closeAllConnections();
      provider.closeAllConnections();
      await Promise.all([
        new Promise<void>((resolve) => app.close(() => resolve())),
        new Promise<void>((resolve) => provider.close(() => resolve())),
      ]);
      await rm(directory, { recursive: true, force: true });
    }
  });
}

test("incomplete or malformed tool calls are rejected", () => {
  assert.throws(() =>
    readToolCalls("responses", {
      status: "incomplete",
      output: [
        {
          type: "function_call",
          call_id: "a",
          name: "read_branch_file",
          arguments: "{}",
        },
      ],
    }),
  );
  assert.throws(() =>
    readToolCalls("chat-completions", {
      choices: [
        {
          message: {
            tool_calls: [
              {
                id: "a",
                type: "function",
                function: { name: "read_branch_file" },
              },
            ],
          },
        },
      ],
    }),
  );
});
