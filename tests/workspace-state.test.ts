import test from "node:test";
import assert from "node:assert/strict";
import { mkdtemp, rm } from "node:fs/promises";
import path from "node:path";
import { tmpdir } from "node:os";
import { Store } from "../server/store";
import { workspaceKeys } from "../src/workspace-state";

test("sidebar and window state do not reject a batch containing question drafts, and survive restart", async () => {
  const directory = await mkdtemp(path.join(tmpdir(), "treelearning-workspace-"));
  try {
    const store = new Store(directory);
    await store.init();
    const state = {
      "treelearning-sidebar-hidden": true,
      "treelearning-pages": { activeId: "page-1", pages: [{ id: "page-1", ids: [store.data.rootId], index: 0, view: "node" }] },
      "treelearning-question-drafts": { [store.data.rootId]: "尚未发送的问题" },
      "treelearning-navigation": { ids: [store.data.rootId], index: 0 },
      "treelearning-scroll": {},
      "treelearning-note-selected": "",
      "treelearning-note-drafts": {},
      "treelearning-note-width": 300,
    };
    assert.deepEqual(Object.keys(state).sort(), [...workspaceKeys].sort());
    await store.saveWorkspaceState(state);
    const restarted = new Store(directory);
    await restarted.init();
    assert.deepEqual(restarted.workspaceState, state);
    await assert.rejects(restarted.saveWorkspaceState({ unexpected: true }), /工作区状态无效/);
    assert.deepEqual(restarted.workspaceState, state);
  } finally {
    await rm(directory, { recursive: true, force: true });
  }
});
