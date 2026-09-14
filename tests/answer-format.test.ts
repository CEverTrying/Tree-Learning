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
  assert.throws(() => parseAnswer('{"title":"标题","answer":'), /重新生成/);
  assert.deepEqual(parseAnswer(JSON.stringify({ title: " ", answer })), {
    answer,
  });
  assert.equal(
    [...parseAnswer(JSON.stringify({ title: "长".repeat(100), answer })).title!]
      .length,
    24,
  );
});

test("malformed envelopes recover TeX commands and raw newlines without changing valid JSON", () => {
  const malformed = String.raw`{"title":"指令编码","answer":"公式\n\[\n\text{byte}=\frac{a}{b}+\nabla x+\theta+\beta+\right)\n\]\n引用：\"原文\"，路径 C:\\Temp"}`;
  const expected = "公式\n\\[\n\\text{byte}=\\frac{a}{b}+\\nabla x+\\theta+\\beta+\\right)\n\\]\n引用：\"原文\"，路径 C:\\Temp";
  assert.deepEqual(parseAnswer(malformed), { title: "指令编码", answer: expected });
  assert.deepEqual(parseAnswer("```json\n" + malformed + "\n```"), {
    title: "指令编码", answer: expected,
  });
  assert.deepEqual(parseAnswer('{"answer":"第一行\n第二行\t结束","title":"换行"}'), {
    title: "换行", answer: "第一行\n第二行\t结束",
  });
  const valid = "\\text{x}\ntext\nabla\tfrac\n\\frac{1}{2}，中文，\\\\";
  assert.deepEqual(parseAnswer(JSON.stringify({ title: "有效", answer: valid })), {
    title: "有效", answer: valid,
  });
  assert.deepEqual(parseAnswer(String.raw`{"title":"编码","answer":"\u4e2d\n\[x\]"}`), {
    title: "编码", answer: "中\n\\[x\\]",
  });
});

test("unrecoverable envelopes fail instead of exposing JSON or saving partial answers", () => {
  for (const value of [
    '{"title":"标题","answer":"截断',
    '{"title":"标题","answer":"未转义的"引号""}',
    '{"title":"标题","answer":""}',
    '{"title":"标题","answer":42}',
  ]) assert.throws(() => parseAnswer(value), /重新生成/);
  for (const value of ["普通 **Markdown**", '示例：{"title":"示例"}', '{"example":123}'])
    assert.deepEqual(parseAnswer(value), { answer: value });
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
