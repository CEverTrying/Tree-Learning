import test from "node:test";
import assert from "node:assert/strict";
import { applyCommand, initialTree, mainPathIds, validateTree, type Command } from "../src/model";

function fixture() {
  let data = initialTree();
  const command = (c: Command) => {
    const result = applyCommand(data, c);
    data = result.data;
    return result.selectedId;
  };
  const project = command({ type: "create", parentId: data.rootId, kind: "project", title: "P" });
  const chat = (parentId: string, title: string) => command({ type: "create", parentId, kind: "chat", title, question: title });
  const a = chat(project, "A");
  const b = chat(a, "B");
  const sibling = chat(project, "Sibling");
  return { get data() { return data; }, command, chat, project, a, b, sibling };
}

test("main has a fixed endpoint, replaces the previous path, and survives serialization", () => {
  const f = fixture();
  f.command({ type: "set-main", id: f.b });
  assert.deepEqual([...mainPathIds(f.data)], [f.project, f.a, f.b]);
  const child = f.chat(f.b, "New child");
  assert.equal(mainPathIds(f.data).has(child), false);
  f.command({ type: "set-main", id: child });
  assert.equal(mainPathIds(f.data).has(child), true);
  f.command({ type: "set-main", id: f.sibling });
  assert.deepEqual([...mainPathIds(f.data)], [f.project, f.sibling]);
  const restored = JSON.parse(JSON.stringify(f.data));
  validateTree(restored);
  assert.deepEqual([...mainPathIds(restored)], [f.project, f.sibling]);
});

test("main can target locked nodes and shrinks when its endpoint subtree is deleted", () => {
  const f = fixture();
  f.command({ type: "set-main", id: f.a });
  assert.deepEqual([...mainPathIds(f.data)], [f.project, f.a]);
  f.command({ type: "set-main", id: f.b });
  f.command({ type: "delete", id: f.a });
  assert.deepEqual([...mainPathIds(f.data)], [f.project]);
  f.command({ type: "delete", id: f.project });
  assert.equal(mainPathIds(f.data).size, 0);
});

test("each project has one independent main path and invalid endpoints are rejected", () => {
  const f = fixture();
  f.command({ type: "set-main", id: f.b });
  const other = f.command({ type: "create", parentId: f.data.rootId, kind: "project", title: "Other" });
  const otherTip = f.chat(other, "Other child");
  f.command({ type: "set-main", id: otherTip });
  assert.deepEqual([...mainPathIds(f.data)], [f.project, f.a, f.b, other, otherTip]);
  assert.throws(() => f.command({ type: "set-main", id: f.data.rootId }));
  for (const tip of ["missing", otherTip, 42]) {
    const invalid = structuredClone(f.data);
    (invalid.nodes.find(n => n.id === f.project)! as any).mainTipId = tip;
    assert.throws(() => validateTree(invalid));
  }
});
