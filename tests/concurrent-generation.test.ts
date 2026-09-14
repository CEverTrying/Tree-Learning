import test from "node:test";
import assert from "node:assert/strict";
import { createServer, type Server, type ServerResponse } from "node:http";
import { mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";
import { createApp } from "../server/app";
import { type Command, defaultSettings } from "../src/model";

async function listen(server: Server) {
  await new Promise<void>((resolve) => server.listen(0, "127.0.0.1", resolve));
  return `http://127.0.0.1:${(server.address() as import("node:net").AddressInfo).port}`;
}

test("independent branches generate and mutate concurrently; cancellation and locks stay local", async (t) => {
  const directory = await mkdtemp(path.join(tmpdir(), "treelearning-concurrent-"));
  const instance = await createApp(directory);
  const server = createServer(instance.app);
  const url = await listen(server);
  const waiting = new Map<string, ServerResponse>();
  const upstream = createServer(async (req, res) => {
    const chunks: Buffer[] = [];
    for await (const chunk of req) chunks.push(chunk);
    const body = JSON.parse(Buffer.concat(chunks).toString());
    waiting.set(body.messages.at(-1).content, res);
  });
  const provider = await listen(upstream);
  t.after(async () => {
    await instance.close();
    server.closeAllConnections();
    upstream.closeAllConnections();
    await Promise.all([new Promise<void>((r) => server.close(() => r())), new Promise<void>((r) => upstream.close(() => r()))]);
    await rm(directory, { recursive: true, force: true });
  });
  const store = instance.store;
  await store.saveSettings({ ...defaultSettings, baseUrl: provider, model: "mock" });
  const command = (command: Command) => store.command(command, store.data.revision);
  const project = (await command({ type: "create", kind: "project", parentId: store.data.rootId, title: "P" })).selectedId;
  const createChat = async (name: string) => (await command({ type: "create", kind: "chat", parentId: project, title: name, question: name })).selectedId;
  const a = await createChat("A");
  const b = await createChat("B");
  const c = await createChat("C");
  const post = (endpoint: string, body: unknown) => fetch(url + endpoint, {
    method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify(body),
  });
  const generate = (id: string) => post("/api/generate", { id, revision: store.data.revision });
  const started = async (question: string) => {
    for (let i = 0; i < 200 && !waiting.has(question); i++)
      await new Promise((resolve) => setTimeout(resolve, 10));
    assert.ok(waiting.has(question), `${question} must reach upstream`);
  };
  const pendingA = generate(a);
  await started("A");
  const pendingB = generate(b);
  await started("B");
  assert.deepEqual(new Set((await (await fetch(url + "/api/tree")).json()).generatingIds), new Set([a, b]));
  assert.equal((await generate(a)).status, 409);
  await command({ type: "edit", id: c, patch: { question: "C edited" } });
  const extra = await createChat("D");
  await command({ type: "delete", id: extra });
  for (const cmd of [
    { type: "edit", id: a, patch: { question: "changed" } },
    { type: "delete", id: b },
    { type: "delete", id: project },
    { type: "edit", id: store.data.rootId, patch: { content: "changed" } },
    { type: "create", kind: "chat", parentId: a, title: "child", question: "child" },
  ] as Command[]) await assert.rejects(command(cmd), /正在生成/);
  await assert.rejects(store.replace(store.data, store.data.revision), /正在生成/);
  await post("/api/cancel", { id: a });
  assert.equal((await pendingA).status, 502);
  assert.deepEqual([...store.generatingIds], [b]);
  await command({ type: "edit", id: a, patch: { question: "A edited" } });
  waiting.get("B")!.setHeader("Content-Type", "application/json");
  waiting.get("B")!.end(JSON.stringify({ choices: [{ message: { content: JSON.stringify({ title: "B done", answer: "B answer" }) } }] }));
  assert.equal((await pendingB).status, 200);
  assert.equal(store.data.nodes.find((node) => node.id === b)?.answer, "B answer");
  assert.equal(store.data.nodes.find((node) => node.id === c)?.question, "C edited");
  assert.equal(store.data.nodes.find((node) => node.id === a)?.question, "A edited");
  assert.equal(store.generatingIds.size, 0);
  const retryA = generate(a);
  await started("A edited");
  const pendingC = generate(c);
  await started("C edited");
  for (const question of ["C edited", "A edited"]) {
    waiting.get(question)!.setHeader("Content-Type", "application/json");
    waiting.get(question)!.end(JSON.stringify({ choices: [{ message: { content: question + " answer" } }] }));
  }
  assert.deepEqual((await Promise.all([retryA, pendingC])).map((response) => response.status), [200, 200]);
  assert.equal(store.data.nodes.find((node) => node.id === a)?.answer, "A edited answer");
  assert.equal(store.data.nodes.find((node) => node.id === c)?.answer, "C edited answer");
  assert.equal(store.data.nodes.find((node) => node.id === b)?.answer, "B answer");
  assert.equal(store.generatingIds.size, 0);
});
