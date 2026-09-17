import { _electron as electron } from "playwright";
import { strict as assert } from "node:assert";
import { spawn } from "node:child_process";
import { mkdtemp, mkdir, readFile, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";
import { createServer } from "node:http";
const testRoot = process.env.TREELEARNING_TEST_ROOT || tmpdir();
await mkdir(testRoot, { recursive: true });
const directory = await mkdtemp(path.join(testRoot, "treelearning-desktop-"));
const executablePath = process.env.TREELEARNING_EXECUTABLE;
const applicationPath = process.env.TREELEARNING_TEST_APP;
const env = {
  ...process.env,
  TREELEARNING_PROFILE_DIR: path.join(directory, "profile"),
  TREELEARNING_DATA_DIR: path.join(directory, "data"),
};
delete env.ELECTRON_RUN_AS_NODE;
const args = [
  ...(applicationPath ? [applicationPath] : !executablePath ? ["."] : []),
  ...(process.platform === "linux" ? ["--no-sandbox", "--disable-gpu"] : []),
];
const launch = () =>
  electron.launch({ ...(executablePath ? { executablePath } : {}), args, env });
let app;
let received;
const provider = createServer(async (req, res) => {
  const chunks = [];
  for await (const chunk of req) chunks.push(chunk);
  received = JSON.parse(Buffer.concat(chunks).toString());
  const results = received.messages.filter((item) => item.role === "tool");
  const tool =
    results.length === 0
      ? {
          name: "list_branch_files",
          arguments: JSON.stringify({ offset: 0, limit: 100 }),
        }
      : results.length === 1
        ? {
            name: "read_branch_file",
            arguments: JSON.stringify({
              file_id: JSON.parse(results[0].content).files[0].file_id,
              offset: 0,
              max_chars: 20000,
            }),
          }
        : null;
  res.setHeader("Content-Type", "application/json");
  res.end(
    JSON.stringify({
      choices: [
        {
          message: tool
            ? {
                role: "assistant",
                content: null,
                tool_calls: [
                  {
                    id: `call_${results.length}`,
                    type: "function",
                    function: tool,
                  },
                ],
              }
            : { content: "WINDOWS_DEBUG_ANSWER" },
        },
      ],
    }),
  );
});
await new Promise((resolve) => provider.listen(0, "127.0.0.1", resolve));
try {
  app = await launch();
  let page = await app.firstWindow();
  const errors = [];
  page.on("pageerror", (error) => errors.push(error.message));
  await page
    .getByRole("heading", { name: "TreeLearning 树学", level: 1 })
    .waitFor();
  const preferences = await app.evaluate(({ BrowserWindow }) =>
    BrowserWindow.getAllWindows()[0].webContents.getLastWebPreferences(),
  );
  assert.equal(preferences.nodeIntegration, false);
  assert.equal(preferences.contextIsolation, true);
  assert.equal(preferences.sandbox, true);
  const menu = await app.evaluate(({ Menu }) =>
    Menu.getApplicationMenu().items.map((item) => item.label),
  );
  assert.ok(
    menu.includes("文件") && menu.includes("编辑") && menu.includes("帮助"),
  );
  const pdf = await readFile(
    new URL(
      "../node_modules/pdf-parse/test/data/01-valid.pdf",
      import.meta.url,
    ),
  );
  const importedPdf = await page.request.post(
    new URL("/api/import", page.url()).href,
    {
      multipart: {
        file: {
          name: "textbook.pdf",
          mimeType: "application/pdf",
          buffer: pdf,
        },
      },
    },
  );
  assert.equal(importedPdf.status(), 200, await importedPdf.text());
  assert.ok((await importedPdf.json()).fileRef.chars > 1000);
  await page.getByRole("button", { name: "AI 模式", exact: true }).waitFor();
  await page.getByRole("button", { name: "模型设置", exact: true }).click();
  await page.getByRole("button", { name: "演示模式", exact: true }).click();
  await page.getByRole("button", { name: "保存设置", exact: true }).click();
  await page.getByRole("button", { name: "创建第一个项目" }).click();
  await page.getByLabel("名称", { exact: true }).fill("Windows 伴学验证");
  await page
    .getByLabel("学习内容（可选）", { exact: true })
    .fill("学习线性代数，使用中文回答。");
  await page.getByRole("button", { name: "创建节点" }).click();
  await page
    .getByRole("heading", { name: "Windows 伴学验证", level: 1 })
    .waitFor();
  await page.getByRole("button", { name: "添加文件节点", exact: true }).click();
  await page
    .getByRole("dialog")
    .locator('input[type="file"]')
    .setInputFiles({
      name: "中文学习资料.md",
      mimeType: "text/markdown",
      buffer: Buffer.from(
        "# 向量\n向量可以表示方向与长度。WINDOWS_FILE_CONTEXT",
      ),
    });
  await page
    .getByRole("dialog")
    .getByLabel("引用文件", { exact: true })
    .getByText("中文学习资料.md", { exact: true })
    .waitFor();
  await page.getByRole("button", { name: "创建节点" }).click();
  await page
    .getByRole("heading", { name: "中文学习资料.md", level: 1 })
    .waitFor();
  await page
    .getByLabel("新问题", { exact: true })
    .fill("向量的线性组合是什么？");
  await page.getByLabel("新问题", { exact: true }).press("Enter");
  await page.getByText("演示回复 · 未调用 AI").waitFor();
  await page.getByRole("button", { name: "修改发送内容", exact: true }).click();
  await page.getByLabel("问题", { exact: true }).fill("请解释向量的线性组合。");
  await page
    .getByLabel("回复", { exact: true })
    .fill("两个向量的线性组合是 $av+bw$。");
  await page.getByRole("button", { name: "保存修改" }).click();
  await page.locator(".katex").waitFor();
  await page.getByRole("button", { name: "显示上下文", exact: true }).click();
  assert.ok(
    !(await page.getByRole("dialog").innerText()).includes(
      "WINDOWS_FILE_CONTEXT",
    ),
  );
  await page.getByRole("button", { name: "关闭弹窗" }).click();
  const screenshot =
    process.env.TREELEARNING_SCREENSHOT ||
    `screenshots/${process.platform === "win32" ? "windows-app" : "desktop-app"}.png`;
  await page.screenshot({ path: screenshot });
  assert.equal(await page.getByRole("tree").getByRole("treeitem").count(), 2);
  await page.getByRole("tab", { name: "学习树图" }).click();
  await page.locator(".react-flow__node").first().waitFor();
  assert.equal(await page.locator(".react-flow__node").count(), 3);
  assert.ok(
    !(await page.locator(".tree-map").innerText()).includes(
      "TreeLearning 树学",
    ),
  );
  await page.screenshot({ path: screenshot.replace(/\.png$/, "-map.png") });
  await page.getByRole("tab", { name: "节点内容" }).click();
  if (executablePath) {
    const code = await new Promise((resolve, reject) => {
      const child = spawn(
        executablePath,
        applicationPath ? [applicationPath] : [],
        {
          env,
          stdio: "ignore",
          timeout: 10000,
        },
      );
      child.once("error", reject);
      child.once("exit", resolve);
    });
    assert.equal(code, 0);
    assert.equal(
      await app.evaluate(
        ({ BrowserWindow }) => BrowserWindow.getAllWindows().length,
      ),
      1,
    );
  }
  await page.getByRole("button", { name: "打开项目笔记", exact: true }).click();
  await page.getByRole("button", { name: "新建笔记", exact: true }).click();
  await page.getByLabel("笔记名称", { exact: true }).fill("Windows 项目复习");
  await page
    .getByLabel("笔记正文", { exact: true })
    .fill("WINDOWS_NOTE_RESTART");
  await page
    .getByLabel("新问题", { exact: true })
    .fill("WINDOWS_QUESTION_DRAFT");
  await app.close();
  app = null;
  const saved = JSON.parse(
    await readFile(path.join(directory, "data/tree.json"), "utf8"),
  );
  assert.equal(saved.nodes.length, 4);
  assert.equal(saved.notes[0].content, "WINDOWS_NOTE_RESTART");
  assert.equal(saved.nodes.at(-1).answer, "两个向量的线性组合是 $av+bw$。");
  app = await launch();
  page = await app.firstWindow();
  await page
    .getByRole("heading", { name: "向量的线性组合是什么？", exact: true })
    .waitFor();
  assert.equal(
    await page.getByLabel("新问题", { exact: true }).inputValue(),
    "WINDOWS_QUESTION_DRAFT",
  );
  await page.getByRole("button", { name: "打开项目笔记", exact: true }).click();
  assert.equal(
    await page.getByLabel("笔记正文", { exact: true }).inputValue(),
    "WINDOWS_NOTE_RESTART",
  );
  await page.getByRole("button", { name: "收起项目笔记", exact: true }).click();
  await page
    .getByRole("tree")
    .getByRole("button", { name: "中文学习资料.md", exact: true })
    .click();
  await page
    .getByRole("tree")
    .getByRole("button", { name: "Windows 伴学验证", exact: true })
    .click();
  await page
    .getByRole("tree")
    .getByRole("button", { name: "中文学习资料.md", exact: true })
    .click();
  await page
    .getByRole("tree")
    .getByRole("button", { name: "向量的线性组合是什么？", exact: true })
    .click();
  await page.locator(".katex").waitFor();
  assert.equal(
    await page
      .getByRole("button", { name: "编辑节点", exact: true })
      .isEnabled(),
    true,
  );
  await page.getByLabel("新问题", { exact: true }).fill("继续讨论线性无关。");
  await page.getByRole("button", { name: "发送问题" }).click();
  await page.getByText("演示回复 · 未调用 AI").waitFor();
  await page
    .getByRole("tree")
    .getByRole("button", { name: "向量的线性组合是什么？", exact: true })
    .click();
  assert.equal(
    await page
      .getByRole("button", { name: "编辑节点", exact: true })
      .isEnabled(),
    false,
  );
  assert.deepEqual(errors, []);
  await page.getByRole("button", { name: "模型设置", exact: true }).click();
  await page.getByRole("button", { name: "调试模式", exact: true }).click();
  await page
    .getByLabel("API 地址", { exact: true })
    .fill(`http://127.0.0.1:${provider.address().port}/v1`);
  await page.getByLabel("模型名称", { exact: true }).fill("windows-test-model");
  await page
    .getByLabel("API 密钥", { exact: true })
    .fill("windows-test-secret");
  await page.getByRole("button", { name: "保存设置", exact: true }).click();
  await page.getByRole("dialog").waitFor({ state: "hidden" });
  await page.getByLabel("新问题", { exact: true }).fill("调试模式验证问题");
  await page.getByRole("button", { name: "发送问题", exact: true }).click();
  await page.getByText("WINDOWS_DEBUG_ANSWER", { exact: true }).waitFor();
  await page
    .getByLabel("本次文件阅读", { exact: true })
    .locator("summary")
    .click();
  assert.ok(
    (
      await page.getByLabel("本次文件阅读", { exact: true }).innerText()
    ).includes("WINDOWS_FILE_CONTEXT"),
  );
  await page
    .getByRole("button", { name: "查看 API 请求", exact: true })
    .click();
  const body = page.getByLabel("请求正文", { exact: true });
  await body.waitFor();
  assert.deepEqual(JSON.parse(await body.innerText()), received);
  assert.ok((await page.getByRole("dialog").innerText()).includes("HTTP 200"));
  assert.ok(
    !(await page.getByRole("dialog").innerText()).includes(
      "windows-test-secret",
    ),
  );
  await page.screenshot({ path: screenshot.replace(/\.png$/, "-debug.png") });
  await page.getByRole("button", { name: "关闭弹窗" }).click();
  await page.screenshot({ path: screenshot });
  await page
    .getByRole("tree")
    .getByRole("button", { name: "向量的线性组合是什么？", exact: true })
    .click();
  await page.getByRole("button", { name: "删除节点", exact: true }).click();
  assert.ok(
    (await page.getByRole("dialog").innerText()).includes("共 3 个节点"),
  );
  await page.getByRole("button", { name: "取消", exact: true }).click();
  assert.equal(
    await page
      .getByRole("button", { name: "编辑节点", exact: true })
      .isEnabled(),
    false,
  );
  await page.getByRole("button", { name: "删除节点", exact: true }).click();
  await page
    .getByRole("dialog")
    .getByRole("button", { name: "删除", exact: true })
    .click();
  await page.getByRole("dialog").waitFor({ state: "hidden" });
  assert.equal(
    await page
      .getByRole("button", { name: "编辑节点", exact: true })
      .isEnabled(),
    true,
  );
  assert.ok(
    !(await page.getByRole("tree").innerText()).includes(
      "向量的线性组合是什么？",
    ),
  );
  await app.close();
  app = null;
  const afterDelete = JSON.parse(
    await readFile(path.join(directory, "data/tree.json"), "utf8"),
  );
  assert.equal(afterDelete.nodes.length, 3);
  console.log(
    `${process.platform}: startup, native menu, sandbox, PDF and Chinese file import, conversation, context, math, leaf editing, single instance, restart persistence of project notes, question drafts and selected node, history lock, default AI, demo and debug modes with exact redacted API inspection passed.`,
  );
} finally {
  await app?.close();
  provider.closeAllConnections();
  await new Promise((resolve) => provider.close(() => resolve()));
  await rm(directory, { recursive: true, force: true });
}
