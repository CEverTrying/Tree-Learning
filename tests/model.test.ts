import test from "node:test";
import assert from "node:assert/strict";
import {
  applyCommand,
  contextMessages,
  initialTree,
  isEditable,
  nodeById,
  validateTree,
  withAnswer,
  type Command,
  type TreeData,
} from "../src/model";

function fixture() {
  let data = initialTree();
  const command = (command: Command) => {
    const result = applyCommand(data, command);
    data = result.data;
    return result.selectedId;
  };
  const root = data.rootId;
  command({ type: "edit", id: root, patch: { content: "ROOT" } });
  const project = command({
    type: "create",
    parentId: root,
    kind: "project",
    title: "P",
    content: "PROJECT",
  });
  const file = command({
    type: "create",
    parentId: project,
    kind: "file",
    title: "F",
    content: "FILE",
  });
  const first = command({
    type: "create",
    parentId: file,
    kind: "chat",
    title: "Q1",
    question: "QUESTION1",
  });
  data = withAnswer(data, first, "ANSWER1", "model");
  const sibling = command({
    type: "create",
    parentId: project,
    kind: "chat",
    title: "SIBLING",
    question: "SIBLING SECRET",
  });
  const current = command({
    type: "create",
    parentId: first,
    kind: "chat",
    title: "Q2",
    question: "QUESTION2",
  });
  data = withAnswer(data, current, "OLD ANSWER", "model");
  return {
    get data() {
      return data;
    },
    command,
    root,
    project,
    file,
    first,
    sibling,
    current,
  };
}
test("context is exactly the root-to-node path and excludes siblings", () => {
  const f = fixture();
  const context = contextMessages(f.data, f.current);
  assert.deepEqual(
    context.map((m) => m.content),
    [
      "ROOT",
      "【项目：P】\nPROJECT",
      `【可按需读取的文件：F】\n文件 ID：${f.file}\n正文长度：4 字符`,
      "QUESTION1",
      "ANSWER1",
      "QUESTION2",
      "OLD ANSWER",
    ],
  );
  assert.deepEqual(
    context.map((m) => m.role),
    ["system", "user", "user", "user", "assistant", "user", "assistant"],
  );
  assert.deepEqual(
    contextMessages(f.data, f.current, true),
    context.slice(0, -1),
  );
  assert.ok(
    !JSON.stringify(contextMessages(f.data, f.sibling)).includes("FILE"),
  );
});
test("project content is optional; file and chat can both parent file and chat", () => {
  const f = fixture();
  const project = f.command({
    type: "create",
    parentId: f.root,
    kind: "project",
    title: "Optional",
  });
  const file = f.command({
    type: "create",
    parentId: f.current,
    kind: "file",
    title: "Nested",
    content: "NESTED FILE",
  });
  const child = f.command({
    type: "create",
    parentId: file,
    kind: "file",
    title: "Child",
    content: "CHILD FILE",
  });
  assert.equal(contextMessages(f.data, project).length, 1);
  assert.equal(
    contextMessages(f.data, child).at(-1)?.content,
    `【可按需读取的文件：Child】\n文件 ID：${child}\n正文长度：10 字符`,
  );
});
test("only current leaves are editable, including after child deletion", () => {
  const f = fixture();
  for (const id of [f.root, f.project, f.file, f.first]) {
    assert.equal(isEditable(f.data, id), false);
    assert.throws(
      () => f.command({ type: "edit", id, patch: { title: "changed" } }),
      /锁定/,
    );
  }
  f.command({
    type: "edit",
    id: f.current,
    patch: { question: "UPDATED", answer: "MANUAL" },
  });
  assert.equal(nodeById(f.data, f.current).answerSource, "manual");
  f.command({ type: "delete", id: f.current });
  assert.equal(isEditable(f.data, f.first), true);
  f.command({ type: "edit", id: f.first, patch: { question: "NEW QUESTION" } });
  assert.equal(nodeById(f.data, f.first).question, "NEW QUESTION");
  assert.equal(
    contextMessages(f.data, f.first, true).at(-1)?.content,
    "NEW QUESTION",
  );
});
test("deleting a subtree preserves siblings and root, and selects its parent", () => {
  const f = fixture();
  const sibling = f.command({
    type: "create",
    parentId: f.project,
    kind: "chat",
    title: "Sibling",
    question: "KEEP",
  });
  const before = structuredClone(f.data);
  assert.throws(() => f.command({ type: "delete", id: f.root }), /根节点/);
  assert.deepEqual(f.data, before);
  assert.equal(f.command({ type: "delete", id: f.file }), f.project);
  for (const id of [f.file, f.first, f.current])
    assert.equal(
      f.data.nodes.some((node) => node.id === id),
      false,
    );
  assert.equal(nodeById(f.data, sibling).question, "KEEP");
  validateTree(f.data);
  assert.equal(f.command({ type: "delete", id: f.project }), f.root);
  assert.deepEqual(
    f.data.nodes.map((node) => node.id),
    [f.root],
  );
});
test("structural constraints prevent projects inside projects and chats under root", () => {
  const f = fixture();
  assert.throws(() =>
    f.command({
      type: "create",
      parentId: f.root,
      kind: "chat",
      title: "X",
      question: "X",
    }),
  );
  assert.throws(() =>
    f.command({
      type: "create",
      parentId: f.project,
      kind: "project",
      title: "X",
    }),
  );
  assert.throws(() =>
    f.command({ type: "edit", id: f.current, patch: { content: "hidden" } }),
  );
  assert.throws(() =>
    f.command({ type: "edit", id: f.current, patch: { question: " " } }),
  );
});
test("backup validation rejects duplicates, disconnected cycles and unlocked ancestors", () => {
  const f = fixture();
  validateTree(JSON.parse(JSON.stringify(f.data)));
  const invalid = (mutate: (data: TreeData) => void) => {
    const data = structuredClone(f.data);
    mutate(data);
    assert.throws(() => validateTree(data));
  };
  invalid((data) => data.nodes.push(data.nodes[0]));
  invalid((data) => {
    nodeById(data, f.file).parentId = f.current;
  });
  invalid((data) => {
    nodeById(data, f.root).sealed = false;
  });
  invalid((data) => {
    nodeById(data, f.current).parentId = "missing";
  });
  invalid((data) => {
    nodeById(data, f.current).kind = "root";
  });
  invalid((data) => {
    data.revision = -1;
  });
  assert.throws(() => validateTree({ version: 1, nodes: [null] }));
});
