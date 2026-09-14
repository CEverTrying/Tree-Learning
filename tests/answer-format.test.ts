import test from "node:test";
import assert from "node:assert/strict";
import { parseAnswer } from "../server/answer-format";
import {
  applyCommand,
  initialTree,
  nodeById,
  withAnswer,
  validateTree,
} from "../src/model";

test("answer envelope preserves Markdown and tolerates legacy provider output", () => {
  const answer = "## 定义\n\n$av+bw$\n\n```js\nconst x = 1;\n```";
  assert.deepEqual(
    parseAnswer(JSON.stringify({ title: "  线性组合\n定义  ", answer })),
    { title: "线性组合 定义", answer },
  );
  assert.deepEqual(
    parseAnswer(
      "```json\n" + JSON.stringify({ title: "标题", answer }) + "\n```",
    ),
    { title: "标题", answer },
  );
  assert.deepEqual(parseAnswer(answer), { answer });
  assert.deepEqual(parseAnswer('{"title":"标题","answer":'), {
    answer: '{"title":"标题","answer":',
  });
  assert.deepEqual(parseAnswer(JSON.stringify({ title: " ", answer })), {
    answer,
  });
  assert.equal(
    [...parseAnswer(JSON.stringify({ title: "长".repeat(100), answer })).title!]
      .length,
    24,
  );
});

test("automatic titles persist while manually renamed and legacy custom titles are preserved", () => {
  let data = initialTree();
  let result = applyCommand(data, {
    type: "create",
    parentId: data.rootId,
    kind: "project",
    title: "项目",
  });
  result = applyCommand(result.data, {
    type: "create",
    parentId: result.selectedId,
    kind: "chat",
    title: "原问题",
    question: "原问题",
  });
  const id = result.selectedId;
  data = withAnswer(result.data, id, "正文", "model", [], "自动概括");
  assert.equal(nodeById(data, id).title, "自动概括");
  assert.equal(nodeById(data, id).question, "原问题");
  data = applyCommand(data, {
    type: "edit",
    id,
    patch: { title: "自动概括", question: "新问题" },
  }).data;
  data = withAnswer(data, id, "新正文", "model", [], "新概括");
  assert.equal(nodeById(data, id).title, "新概括");
  data = applyCommand(data, {
    type: "edit",
    id,
    patch: { title: "手动名称" },
  }).data;
  data = withAnswer(data, id, "再生成", "model", [], "不可覆盖");
  assert.equal(nodeById(data, id).title, "手动名称");
  validateTree(JSON.parse(JSON.stringify(data)));
  delete nodeById(data, id).titleSource;
  assert.equal(
    nodeById(withAnswer(data, id, "正文", "model", [], "概括"), id).title,
    "手动名称",
  );
  nodeById(data, id).title = nodeById(data, id).question.slice(0, 70);
  assert.equal(
    nodeById(withAnswer(data, id, "正文", "model", [], "概括"), id).title,
    "概括",
  );
});
