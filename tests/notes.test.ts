import test from "node:test";
import assert from "node:assert/strict";
import { mkdtemp, rm, writeFile } from "node:fs/promises";
import path from "node:path";
import { tmpdir } from "node:os";
import { Store } from "../server/store";
import { backup, restoreBackup } from "../server/backup";
import { contextMessages, validateTree } from "../src/model";

test("project notes are independently editable during generation, stay outside context and survive backup", async () => {
  const directory = await mkdtemp(path.join(tmpdir(), "treelearning-notes-"));
  try {
    const store = new Store(directory);
    await store.init();
    const project = (
      await store.command(
        {
          type: "create",
          parentId: store.data.rootId,
          kind: "project",
          title: "课程",
        },
        store.data.revision,
      )
    ).selectedId;
    const chat = (
      await store.command(
        {
          type: "create",
          parentId: project,
          kind: "chat",
          title: "问题",
          question: "解释向量",
        },
        store.data.revision,
      )
    ).selectedId;
    const original = structuredClone(store.data.nodes);
    const result = await store.note({
      action: "create",
      projectId: project,
      title: "复习",
      content: "PRIVATE_NOTE",
    });
    const id = result.selectedId!;
    store.generatingId = chat;
    await Promise.all([
      store.note({
        action: "save",
        id,
        revision: 0,
        title: "复习",
        content: "PRIVATE_NOTE_UPDATED",
      }),
      store.answer(chat, "ANSWER", "model"),
    ]);
    assert.equal(store.data.notes![0].content, "PRIVATE_NOTE_UPDATED");
    assert.equal(
      store.data.nodes.find((node) => node.id === project)!.updatedAt,
      original.find((node) => node.id === project)!.updatedAt,
    );
    assert.equal(
      store.data.nodes.find((node) => node.id === chat)!.answer,
      "ANSWER",
    );
    assert.ok(
      !JSON.stringify(contextMessages(store.data, chat)).includes(
        "PRIVATE_NOTE",
      ),
    );
    await assert.rejects(
      store.note({
        action: "save",
        id,
        revision: 0,
        title: "stale",
        content: "lost",
      }),
      /已被更新/,
    );
    await assert.rejects(
      store.note({ action: "create", projectId: chat }),
      /所属项目/,
    );
    assert.equal(store.data.notes!.length, 1);
    store.generatingId = null;
    const zip = await backup(store.data, store.documents);
    const chunks: Buffer[] = [];
    const done = new Promise<void>((resolve, reject) => {
      zip.outputStream.on("data", (chunk) => chunks.push(chunk));
      zip.outputStream.on("end", resolve);
      zip.outputStream.on("error", reject);
    });
    zip.end();
    await done;
    const file = path.join(directory, "backup.zip");
    await writeFile(file, Buffer.concat(chunks));
    const restored = await restoreBackup(file, store.documents);
    assert.deepEqual(restored.notes, store.data.notes);
    const oldRevision = store.data.notes![0].revision;
    await store.replace(restored, store.data.revision);
    await assert.rejects(
      store.note({
        action: "save",
        id,
        revision: oldRevision,
        title: "old draft",
        content: "bad",
      }),
      /已被更新/,
    );
    const reloaded = new Store(directory);
    await reloaded.init();
    assert.deepEqual(reloaded.data.notes, store.data.notes);
    await store.saveWorkspaceState({
      "treelearning-note-selected": id,
      "treelearning-question-drafts": { [chat]: "DRAFT" },
    });
    await reloaded.init();
    assert.equal(reloaded.workspaceState["treelearning-note-selected"], id);
    assert.deepEqual(reloaded.workspaceState["treelearning-question-drafts"], {
      [chat]: "DRAFT",
    });
    await assert.rejects(
      store.saveWorkspaceState({ unexpected: "value" }),
      /工作区状态/,
    );
    const invalid = structuredClone(store.data);
    invalid.notes!.push({ ...invalid.notes![0] });
    assert.throws(() => validateTree(invalid), /笔记/);
    await store.command({ type: "delete", id: chat }, store.data.revision);
    assert.equal(store.data.notes!.length, 1);
    await store.command({ type: "delete", id: project }, store.data.revision);
    assert.equal(store.data.notes!.length, 0);
    await assert.rejects(
      store.note({
        action: "save",
        id,
        revision: 2,
        title: "missing",
        content: "bad",
      }),
      /已删除/,
    );
  } finally {
    await rm(directory, { recursive: true, force: true });
  }
});
