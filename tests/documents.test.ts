import test from "node:test";
import assert from "node:assert/strict";
import { createServer, type Server } from "node:http";
import { mkdtemp, readFile, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";
import { ZipFile } from "yazl";
import { createApp } from "../server/app";
import { Store } from "../server/store";
import { BranchFileTools } from "../server/file-tools";
import { restoreBackup } from "../server/backup";
import {
  applyCommand,
  contextMessages,
  initialTree,
  validateTree,
  withAnswer,
  type Command,
} from "../src/model";

async function listen(server: Server) {
  await new Promise<void>((resolve) => server.listen(0, "127.0.0.1", resolve));
  return `http://127.0.0.1:${(server.address() as import("node:net").AddressInfo).port}`;
}

test("large local files stay outside tree JSON, read in chunks, and restore with independent files", async () => {
  const directory = await mkdtemp(
    path.join(tmpdir(), "treelearning-documents-"),
  );
  const otherDirectory = await mkdtemp(
    path.join(tmpdir(), "treelearning-restore-"),
  );
  const app = await createApp(directory);
  const server = createServer(app.app);
  const url = await listen(server);
  try {
    const text =
      "x".repeat(19997) + "BOUNDARY" + "文😀".repeat(4000000) + "END_MARKER";
    const form = new FormData();
    form.append("file", new Blob([text]), "large.txt");
    assert.ok(new Blob([text]).size > 15 * 1024 * 1024);
    const uploaded = await fetch(url + "/api/import", {
      method: "POST",
      body: form,
    });
    assert.equal(
      uploaded.status,
      200,
      uploaded.status === 200 ? "" : await uploaded.text(),
    );
    const imported = await uploaded.json();
    assert.equal(imported.content, undefined);
    assert.equal(imported.fileRef.chars, text.length);
    const command = async (value: Command) =>
      (await app.store.command(value, app.store.data.revision)).selectedId;
    const project = await command({
      type: "create",
      parentId: app.store.data.rootId,
      kind: "project",
      title: "Project",
    });
    const file = await command({
      type: "create",
      parentId: project,
      kind: "file",
      title: "large.txt",
      fileRef: imported.fileRef,
    });
    const chat = await command({
      type: "create",
      parentId: file,
      kind: "chat",
      title: "Question",
      question: "Read the end",
    });
    const sibling = await command({
      type: "create",
      parentId: project,
      kind: "chat",
      title: "Sibling",
      question: "No access",
    });
    assert.equal(
      app.store.data.nodes.find((node) => node.id === file)!.content,
      "",
    );
    assert.ok(
      (await readFile(path.join(directory, "tree.json"))).length < 5000,
    );
    assert.ok(
      JSON.stringify(await (await fetch(url + "/api/tree")).json()).length <
        5000,
    );
    const tools = new BranchFileTools(
      app.store.data,
      chat,
      app.store.documents,
    );
    const search = JSON.parse(
      await tools.execute(
        "search_branch_files",
        JSON.stringify({ query: "BOUNDARY", offset: 0, limit: 10 }),
      ),
    );
    assert.equal(search.files[0].match_offset, 19997);
    const end = JSON.parse(
      await tools.execute(
        "read_branch_file",
        JSON.stringify({
          file_id: file,
          offset: text.length - 10,
          max_chars: 20000,
        }),
      ),
    );
    assert.equal(end.content, "END_MARKER");
    assert.equal(end.next_offset, null);
    validateTree(
      withAnswer(app.store.data, chat, "answer", "model", tools.reads),
    );
    assert.ok(
      !JSON.stringify(contextMessages(app.store.data, chat)).includes(
        "BOUNDARY",
      ),
    );
    assert.ok(
      JSON.parse(
        await new BranchFileTools(
          app.store.data,
          sibling,
          app.store.documents,
        ).execute(
          "read_branch_file",
          JSON.stringify({ file_id: file, offset: 0, max_chars: 10 }),
        ),
      ).error,
    );
    assert.ok(
      JSON.parse(
        await tools.execute(
          "read_branch_file",
          JSON.stringify({ file_id: file, offset: 0, max_chars: 20001 }),
        ),
      ).error,
    );
    const archive = await fetch(url + "/api/backup");
    assert.equal(archive.status, 200);
    const backupPath = path.join(directory, "backup.zip");
    await writeFile(backupPath, Buffer.from(await archive.arrayBuffer()));
    const restored = new Store(otherDirectory);
    await restored.init();
    const recovered = await restoreBackup(backupPath, restored.documents);
    await restored.replace(recovered, restored.data.revision);
    const restoredFile = restored.data.nodes.find((node) => node.id === file)!;
    assert.notEqual(restoredFile.fileRef!.id, imported.fileRef.id);
    assert.equal(
      await restored.documents.read(
        restoredFile.fileRef!,
        text.length - 10,
        20,
      ),
      "END_MARKER",
    );
    assert.equal(
      await readFile(
        path.join(
          restored.documents.location(restoredFile.fileRef!.id),
          "source",
        ),
        "utf8",
      ),
      text,
    );
    await command({ type: "delete", id: file });
    assert.equal(
      await app.store.documents.read(imported.fileRef, 19997, 8),
      "BOUNDARY",
    );
    const invalid = structuredClone(restored.data);
    invalid.nodes.find((node) => node.id === file)!.fileRef!.id =
      "../../secrets";
    assert.throws(() => validateTree(invalid));
  } finally {
    await app.close();
    server.closeAllConnections();
    await new Promise<void>((resolve) => server.close(() => resolve()));
    await rm(directory, { recursive: true, force: true });
    await rm(otherDirectory, { recursive: true, force: true });
  }
});

test("legacy files migrate without changing context and incomplete ZIPs do not replace data", async () => {
  const directory = await mkdtemp(path.join(tmpdir(), "treelearning-migrate-"));
  try {
    let data = initialTree();
    const project = applyCommand(data, {
      type: "create",
      parentId: data.rootId,
      kind: "project",
      title: "P",
    });
    const file = applyCommand(project.data, {
      type: "create",
      parentId: project.selectedId,
      kind: "file",
      title: "old.txt",
      content: "OLD CONTENT",
    });
    data = file.data;
    await writeFile(path.join(directory, "tree.json"), JSON.stringify(data));
    const store = new Store(directory);
    await store.init();
    const node = store.data.nodes.find((node) => node.id === file.selectedId)!;
    assert.equal(node.content, "");
    assert.equal(
      await store.documents.read(node.fileRef!, 0, 20000),
      "OLD CONTENT",
    );
    assert.deepEqual(
      contextMessages(store.data, node.id),
      contextMessages(data, node.id),
    );
    const before = structuredClone(store.data);
    const zip = new ZipFile();
    zip.addBuffer(Buffer.from(JSON.stringify(store.data)), "tree.json");
    const pieces: Buffer[] = [];
    const finished = new Promise<void>((resolve, reject) => {
      zip.outputStream.on("data", (chunk) => pieces.push(chunk));
      zip.outputStream.on("end", resolve);
      zip.outputStream.on("error", reject);
    });
    zip.end();
    await finished;
    const filename = path.join(directory, "incomplete.zip");
    await writeFile(filename, Buffer.concat(pieces));
    await assert.rejects(restoreBackup(filename, store.documents));
    assert.deepEqual(store.data, before);
    await store.command(
      { type: "edit", id: node.id, patch: { content: "NEW CONTENT" } },
      store.data.revision,
    );
    const next = store.data.nodes.find((item) => item.id === node.id)!;
    assert.notEqual(next.fileRef!.id, node.fileRef!.id);
    assert.equal(
      await store.documents.read(node.fileRef!, 0, 100),
      "OLD CONTENT",
    );
    assert.equal(
      await store.documents.read(next.fileRef!, 0, 100),
      "NEW CONTENT",
    );
  } finally {
    await rm(directory, { recursive: true, force: true });
  }
});
