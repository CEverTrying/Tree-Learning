import { test, expect } from "@playwright/test";
import { createServer } from "node:http";
import { readFile } from "node:fs/promises";
import {
  applyCommand,
  initialTree,
  defaultSettings,
  type Command,
} from "../../src/model";

test("tree workflow, file context, branch isolation, leaf edit, persistence and responsive layouts", async ({
  page,
  request,
}) => {
  const errors: string[] = [];
  page.on("pageerror", (e) => errors.push(e.message));
  await page.goto("/");
  const snapshot = await (await request.get("/api/tree")).json();
  const rootId = snapshot.data.rootId;
  await request.post("/api/restore", {
    data: {
      revision: snapshot.data.revision,
      data: {
        version: 1,
        revision: 0,
        rootId,
        nodes: [
          {
            ...snapshot.data.nodes.find((n: any) => n.id === rootId),
            sealed: false,
          },
        ],
      },
    },
  });
  await page.reload();
  await page.getByRole("button", { name: "模型设置", exact: true }).click();
  await page
    .getByRole("dialog")
    .getByRole("button", { name: "演示模式", exact: true })
    .click();
  await page.getByRole("button", { name: "保存设置", exact: true }).click();
  await expect(page.getByRole("heading", { level: 1 })).toHaveText(
    "TreeLearning 树学",
  );
  await page.getByRole("button", { name: "编辑节点", exact: true }).click();
  await page
    .getByLabel("全局基础知识", { exact: true })
    .fill("你是树学，使用中文和数学公式回答。ROOT_MARKER");
  await page.getByRole("button", { name: "保存修改" }).click();
  await page.getByRole("button", { name: "创建第一个项目" }).click();
  await page.getByLabel("名称", { exact: true }).fill("线性代数");
  await page
    .getByLabel("学习内容（可选）", { exact: true })
    .fill("从几何直觉理解向量、矩阵和线性变换。PROJECT_MARKER");
  await page.getByRole("button", { name: "创建节点" }).click();
  await expect(page.getByRole("heading", { level: 1 })).toHaveText("线性代数");
  await page.getByRole("button", { name: "添加文件节点", exact: true }).click();
  await page
    .getByRole("dialog")
    .locator('input[type="file"]')
    .setInputFiles({
      name: "01-向量与空间.md",
      mimeType: "text/markdown",
      buffer: Buffer.from(
        "# 向量与空间\n\n向量可以表示方向与长度。FILE_MARKER\n\n线性组合：$av+bw$。",
      ),
    });
  await expect(page.getByLabel("名称", { exact: true })).toHaveValue(
    "01-向量与空间.md",
  );
  await page.getByRole("button", { name: "创建节点" }).click();
  await expect(
    page.getByRole("heading", { name: "01-向量与空间.md", exact: true }),
  ).toBeVisible();
  await page
    .getByLabel("新问题", { exact: true })
    .fill("如何从几何角度理解线性组合？");
  await page.getByRole("button", { name: "发送问题" }).click();
  await expect(page.getByText("演示回复 · 未调用 AI")).toBeVisible();
  await page.getByRole("button", { name: "修改发送内容", exact: true }).click();
  await page
    .getByLabel("问题", { exact: true })
    .fill("线性组合如何生成一个平面？");
  await page
    .getByLabel("回复", { exact: true })
    .fill(
      "两个不共线的向量 $v,w$ 的线性组合 $av+bw$ 可以覆盖它们张成的平面。\n\n- 系数决定沿每个方向移动的距离。\n- 两个方向必须线性无关。\n\n\\[ A = \\begin{pmatrix} 1 & 0 \\\\ 0 & 1 \\end{pmatrix} \\]",
    );
  await page.getByRole("button", { name: "保存修改" }).click();
  await expect(page.locator(".katex").first()).toBeVisible();
  await page.getByRole("button", { name: "显示上下文", exact: true }).click();
  await expect(page.getByRole("dialog")).toContainText("ROOT_MARKER");
  await expect(page.getByRole("dialog")).toContainText("可按需读取的文件");
  await expect(page.getByRole("dialog")).not.toContainText("FILE_MARKER");
  await page.getByRole("button", { name: "关闭弹窗" }).click();
  await page
    .getByLabel("新问题", { exact: true })
    .fill("如果两个向量共线，会发生什么？");
  await page.getByRole("button", { name: "发送问题" }).click();
  await expect(page.getByText("演示回复 · 未调用 AI")).toBeVisible();
  await page
    .getByRole("tree")
    .getByRole("button", { name: "如何从几何角度理解线性组合？", exact: true })
    .click();
  await expect(
    page.getByRole("button", { name: "编辑节点", exact: true }),
  ).toBeDisabled();
  await page.screenshot({ path: "screenshots/desktop.png", fullPage: true });
  await page.getByRole("tab", { name: "学习树图" }).click();
  await expect(page.locator(".react-flow__node")).toHaveCount(4);
  await page.screenshot({ path: "screenshots/tree-map.png", fullPage: true });
  await page.getByRole("tab", { name: "节点内容" }).click();
  await page.getByRole("tree").getByRole("button", { name: "01-向量与空间.md", exact: true }).click();
  await page
    .getByRole("tree")
    .getByRole("button", { name: "线性代数", exact: true })
    .click();
  await page.getByLabel("新问题", { exact: true }).fill("什么是矩阵？");
  await page.getByRole("button", { name: "发送问题" }).click();
  await expect(page.getByText("演示回复 · 未调用 AI")).toBeVisible();
  await page.getByRole("button", { name: "显示上下文", exact: true }).click();
  await expect(page.getByRole("dialog")).toContainText("PROJECT_MARKER");
  await expect(page.getByRole("dialog")).not.toContainText("FILE_MARKER");
  await expect(page.getByRole("dialog")).not.toContainText("线性组合如何");
  await page.getByRole("button", { name: "关闭弹窗" }).click();
  await page.reload();
  await page
    .getByRole("tree")
    .getByRole("button", { name: "线性代数", exact: true })
    .click();
  await expect(page.getByRole("tree")).toContainText("什么是矩阵？");
  await page
    .getByRole("tree")
    .getByRole("button", { name: "什么是矩阵？", exact: true })
    .click();
  await page.setViewportSize({ width: 390, height: 844 });
  await expect(page.getByLabel("新问题", { exact: true })).toBeVisible();
  expect(
    await page.evaluate(
      () => document.documentElement.scrollWidth <= innerWidth,
    ),
  ).toBe(true);
  await page.screenshot({ path: "screenshots/mobile.png", fullPage: true });
  await expect(page.locator(".context-panel")).toHaveCount(0);
  await page.getByRole("button", { name: "显示上下文", exact: true }).click();
  await expect(page.getByRole("dialog", { name: "完整上下文" })).toBeVisible();
  await page.getByRole("button", { name: "关闭弹窗", exact: true }).click();
  await page.getByRole("button", { name: "打开侧栏", exact: true }).click();
  await expect(page.getByRole("tree")).toBeVisible();
  await page.setViewportSize({ width: 1440, height: 960 });
  await page
    .getByRole("tree")
    .getByRole("button", { name: "线性代数", exact: true })
    .click();
  await page
    .getByRole("tree")
    .getByRole("button", { name: "01-向量与空间.md", exact: true })
    .click();
  await page.getByRole("button", { name: "删除节点", exact: true }).click();
  await expect(page.getByRole("dialog")).toContainText("共 3 个节点");
  await page.getByRole("button", { name: "取消", exact: true }).click();
  await expect(
    page.getByRole("heading", { name: "01-向量与空间.md", exact: true }),
  ).toBeVisible();
  await page.getByRole("button", { name: "删除节点", exact: true }).click();
  await page
    .getByRole("dialog")
    .getByRole("button", { name: "删除", exact: true })
    .click();
  await expect(page.getByRole("heading", { level: 1 })).toHaveText("线性代数");
  await page.reload();
  await page
    .getByRole("tree")
    .getByRole("button", { name: "线性代数", exact: true })
    .click();
  await expect(page.getByRole("tree")).not.toContainText("01-向量与空间.md");
  await expect(page.getByRole("tree")).not.toContainText("如果两个向量共线");
  await expect(page.getByRole("tree")).toContainText("什么是矩阵？");
  expect(errors).toEqual([]);
});

test("sidebar follows one parent and direct children; map stays within the project", async ({
  page,
  request,
}) => {
  let data = initialTree();
  const create = (command: Command) => {
    const result = applyCommand(data, command);
    data = result.data;
    return result.selectedId;
  };
  const project = create({
    type: "create",
    parentId: data.rootId,
    kind: "project",
    title: "项目甲",
  });
  const file = create({
    type: "create",
    parentId: project,
    kind: "file",
    title: "教材甲",
    content: "教材正文",
  });
  const chat = create({
    type: "create",
    parentId: file,
    kind: "chat",
    title: "问题甲",
    question: "问题",
  });
  create({
    type: "create",
    parentId: chat,
    kind: "chat",
    title: "追问甲",
    question: "追问",
  });
  create({
    type: "create",
    parentId: project,
    kind: "chat",
    title: "旁支甲",
    question: "旁支",
  });
  const other = create({
    type: "create",
    parentId: data.rootId,
    kind: "project",
    title: "项目乙",
  });
  create({
    type: "create",
    parentId: other,
    kind: "chat",
    title: "问题乙",
    question: "乙",
  });
  const snapshot = await (await request.get("/api/tree")).json();
  expect(
    (
      await request.post("/api/restore", {
        data: { revision: snapshot.data.revision, data },
      })
    ).ok(),
  ).toBe(true);
  await page.goto("/");
  const tree = page.getByRole("tree");
  const open = async (name: string) => {
    await tree.getByRole("button", { name, exact: true }).click();
  };
  await expect(tree.getByRole("treeitem")).toHaveCount(3);
  await expect(tree).not.toContainText("教材甲");
  await expect(page.getByRole("tab", { name: "学习树图" })).toHaveCount(0);
  await open("项目甲");
  await expect(tree.getByRole("treeitem")).toHaveCount(4);
  await expect(tree).not.toContainText("问题甲");
  await expect(tree).not.toContainText("项目乙");
  await page.getByLabel("搜索子节点").fill("问题甲");
  await expect(tree).toContainText("没有匹配的子节点");
  await expect(tree.getByRole("treeitem")).toHaveCount(2);
  await page.getByRole("button", { name: "清空搜索" }).click();
  await tree.getByRole("button", { name: "打开教材甲", exact: true }).click();
  await expect(tree.getByRole("treeitem")).toHaveCount(3);
  await expect(tree).not.toContainText("TreeLearning 树学");
  await expect(tree).not.toContainText("旁支甲");
  await expect(tree).not.toContainText("追问甲");
  await page.getByRole("tab", { name: "学习树图" }).click();
  const graph = page.locator(".react-flow__node");
  await expect(graph).toHaveCount(5);
  await expect(page.locator(".react-flow__edge")).toHaveCount(4);
  await expect(page.locator(".tree-map")).not.toContainText("项目乙");
  await expect(page.locator(".tree-map")).not.toContainText(
    "TreeLearning 树学",
  );
  await graph.filter({ hasText: "问题甲" }).click();
  await expect(tree.getByRole("treeitem")).toHaveCount(3);
  await expect(tree).toContainText("追问甲");
  await expect(tree).not.toContainText("项目甲");
  await open("追问甲");
  await expect(tree.getByRole("treeitem")).toHaveCount(2);
  await open("问题甲");
  await expect(tree.getByRole("treeitem")).toHaveCount(3);
  await page.screenshot({
    path: "screenshots/project-navigation.png",
    fullPage: true,
  });
  await page.setViewportSize({ width: 390, height: 844 });
  await page.getByRole("button", { name: "打开侧栏", exact: true }).click();
  await expect(tree.getByRole("treeitem")).toHaveCount(3);
  await open("教材甲");
  await expect(tree).not.toBeInViewport();
  await page.getByRole("button", { name: "打开侧栏", exact: true }).click();
  await expect(tree).toContainText("项目甲");
  await expect(tree).not.toContainText("追问甲");
  await page.screenshot({
    path: "screenshots/project-navigation-mobile.png",
    fullPage: true,
  });
  await page
    .getByRole("button", { name: "关闭侧栏", exact: true })
    .click({ position: { x: 380, y: 100 } });
  await page.setViewportSize({ width: 1440, height: 960 });
  await page.locator(".brand").click();
  await expect(page.locator(".tree-map")).toHaveCount(0);
  await open("项目乙");
  await page.getByRole("tab", { name: "学习树图" }).click();
  await expect(graph).toHaveCount(2);
  await expect(page.locator(".tree-map")).not.toContainText("项目甲");
});

test("top overscroll navigates one parent per gesture and sidebar has no photo", async ({
  page,
  request,
}) => {
  let data = initialTree();
  const create = (command: Command) => {
    const result = applyCommand(data, command);
    data = result.data;
    return result.selectedId;
  };
  const project = create({
    type: "create",
    parentId: data.rootId,
    kind: "project",
    title: "滚动项目",
  });
  const parent = create({
    type: "create",
    parentId: project,
    kind: "chat",
    title: "父问题",
    question: "父问题内容",
  });
  create({
    type: "create",
    parentId: parent,
    kind: "chat",
    title: "子问题",
    question: "长消息\n\n".repeat(120),
  });
  const snapshot = await (await request.get("/api/tree")).json();
  expect(
    (
      await request.post("/api/restore", {
        data: { revision: snapshot.data.revision, data },
      })
    ).ok(),
  ).toBe(true);
  await page.goto("/");
  for (const name of ["滚动项目", "父问题", "子问题"])
    await page
      .getByRole("tree")
      .getByRole("button", { name, exact: true })
      .click();
  await expect(page.locator(".sidebar img")).toHaveCount(0);
  const pane = page.locator(".node-scroll");
  const heading = page.getByRole("heading", { level: 1 });
  const wheel = async (deltaY: number, deltaX = 0) => {
    await pane.dispatchEvent("wheel", { deltaY, deltaX, deltaMode: 0 });
  };
  await pane.evaluate((element) => {
    element.scrollTop = 300;
  });
  await wheel(-200);
  await wheel(-200);
  await expect(heading).toHaveText("子问题");
  await pane.evaluate((element) => {
    element.scrollTop = 0;
  });
  await wheel(-200, 300);
  await wheel(-200, 300);
  await expect(heading).toHaveText("子问题");
  await wheel(-50);
  await expect(heading).toHaveText("子问题");
  await wheel(-80);
  await wheel(-80);
  await expect(heading).toHaveText("父问题");
  await wheel(-300);
  await wheel(-300);
  await expect(heading).toHaveText("父问题");
  // A pause ends the trackpad gesture, allowing the next upward gesture.
  await page.waitForTimeout(400);
  await pane.hover();
  await page.mouse.wheel(0, -100);
  await page.mouse.wheel(0, -100);
  await expect(heading).toHaveText("滚动项目");
  await page.screenshot({
    path: "screenshots/scroll-parent-desktop.png",
    fullPage: true,
  });
  await page.setViewportSize({ width: 390, height: 844 });
  const touch = async (type: string, y: number) => {
    await pane.evaluate(
      (element, { type, y }) => {
        const point = new Touch({
          identifier: 1,
          target: element,
          clientX: 150,
          clientY: y,
        });
        element.dispatchEvent(
          new TouchEvent(type, {
            bubbles: true,
            cancelable: true,
            touches: type === "touchend" ? [] : [point],
          }),
        );
      },
      { type, y },
    );
  };
  await touch("touchstart", 250);
  await touch("touchmove", 290);
  await expect(heading).toHaveText("滚动项目");
  await touch("touchmove", 350);
  await expect(heading).toHaveText("TreeLearning 树学");
  await touch("touchmove", 500);
  await touch("touchend", 500);
  await wheel(-300);
  await wheel(-300);
  await expect(heading).toHaveText("TreeLearning 树学");
  await page.getByRole("button", { name: "打开侧栏", exact: true }).click();
  await expect(page.locator(".sidebar img")).toHaveCount(0);
  await page.screenshot({
    path: "screenshots/scroll-parent-mobile.png",
    fullPage: true,
  });
});

test("file references and full ZIP backup restore", async ({
  page,
  request,
}) => {
  const bodyRequests: string[] = [];
  page.on("request", (request) => {
    if (new URL(request.url()).pathname.startsWith("/api/documents/"))
      bodyRequests.push(request.url());
  });
  const snapshot = await (await request.get("/api/tree")).json();
  const data = initialTree();
  const created = applyCommand(data, {
    type: "create",
    parentId: data.rootId,
    kind: "project",
    title: "文件库测试",
  });
  await request.post("/api/restore", {
    data: { revision: snapshot.data.revision, data: created.data },
  });
  await page.goto("/");
  await page
    .getByRole("tree")
    .getByRole("button", { name: "文件库测试", exact: true })
    .click();
  await page.getByRole("button", { name: "添加文件节点", exact: true }).click();
  await page
    .getByRole("dialog")
    .locator('input[type="file"]')
    .setInputFiles({
      name: "分段资料.txt",
      mimeType: "text/plain",
      buffer: Buffer.from(
        "FIRST\n" + "x".repeat(19994) + "SECOND\n" + "y".repeat(19993) + "LAST",
      ),
    });
  await expect(page.getByLabel("名称", { exact: true })).toHaveValue(
    "分段资料.txt",
  );
  await expect(page.getByRole("dialog").getByLabel("引用文件")).toContainText(
    "分段资料.txt",
  );
  await expect(page.getByRole("dialog")).not.toContainText("FIRST");
  await page.getByRole("button", { name: "创建节点", exact: true }).click();
  await expect(page.getByLabel("引用文件", { exact: true })).toContainText(
    "分段资料.txt",
  );
  await expect(page.locator("main")).not.toContainText("FIRST");
  const downloadPromise = page.waitForEvent("download");
  await page.getByRole("button", { name: "导出完整备份", exact: true }).click();
  const download = await downloadPromise;
  expect(download.suggestedFilename()).toMatch(/\.zip$/);
  const archive = await readFile((await download.path())!);
  await page.getByRole("button", { name: "删除节点", exact: true }).click();
  await page
    .getByRole("dialog")
    .getByRole("button", { name: "删除", exact: true })
    .click();
  await expect(page.getByRole("heading", { level: 1 })).toHaveText(
    "文件库测试",
  );
  await page.locator('input[accept=".json,.zip"]').setInputFiles({
    name: "backup.zip",
    mimeType: "application/zip",
    buffer: archive,
  });
  await page
    .getByRole("dialog")
    .getByRole("button", { name: "取消", exact: true })
    .click();
  await expect(page.getByRole("tree")).not.toContainText("分段资料.txt");
  await page.locator('input[accept=".json,.zip"]').setInputFiles({
    name: "backup.zip",
    mimeType: "application/zip",
    buffer: archive,
  });
  await page
    .getByRole("dialog")
    .getByRole("button", { name: "恢复", exact: true })
    .click();
  await expect(page.getByRole("dialog")).toHaveCount(0);
  await page
    .getByRole("tree")
    .getByRole("button", { name: "文件库测试", exact: true })
    .click();
  await page
    .getByRole("tree")
    .getByRole("button", { name: "分段资料.txt", exact: true })
    .click();
  await expect(page.getByLabel("引用文件", { exact: true })).toContainText(
    "分段资料.txt",
  );
  await page.getByRole("button", { name: "编辑节点", exact: true }).click();
  await page.getByLabel("名称", { exact: true }).fill("资料新名称");
  await page.getByRole("button", { name: "保存修改", exact: true }).click();
  await expect(page.getByRole("dialog")).toHaveCount(0);
  await expect(page.getByLabel("引用文件", { exact: true })).toContainText(
    "资料新名称",
  );
  await expect(page.locator("main")).not.toContainText("FIRST");
  expect(bodyRequests).toEqual([]);
  await page.screenshot({
    path: "screenshots/file-library.png",
    fullPage: true,
  });
});

test("web search configuration and saved source links", async ({
  page,
  request,
}) => {
  await request.put("/api/settings", { data: defaultSettings });
  await page.goto("/");
  await page.getByRole("button", { name: "模型设置", exact: true }).click();
  await expect(page.getByLabel("联网搜索", { exact: true })).not.toBeChecked();
  await page.getByLabel("联网搜索", { exact: true }).check();
  await expect(
    page.getByRole("combobox", { name: "搜索服务", exact: true }),
  ).toHaveValue("openai");
  await expect(
    page.getByRole("combobox", { name: "接口类型", exact: true }),
  ).toHaveValue("responses");
  await expect(page.getByLabel("Tavily API 密钥", { exact: true })).toHaveCount(
    0,
  );
  await page
    .getByRole("combobox", { name: "搜索服务", exact: true })
    .selectOption("tavily");
  await page
    .getByLabel("Tavily API 密钥", { exact: true })
    .fill("browser-search-secret");
  await expect(
    page.getByLabel("Tavily API 密钥", { exact: true }),
  ).toHaveAttribute("type", "password");
  await page.getByRole("button", { name: "保存设置", exact: true }).click();
  const saved = await (await request.get("/api/settings")).json();
  expect(saved.webEnabled).toBe(true);
  expect(saved.webApiKey).toBe("browser-search-secret");
  const snapshot = await (await request.get("/api/tree")).json();
  const empty = initialTree();
  const project = applyCommand(empty, {
    type: "create",
    parentId: empty.rootId,
    kind: "project",
    title: "联网学习",
  });
  const created = applyCommand(project.data, {
    type: "create",
    parentId: project.selectedId,
    kind: "chat",
    title: "课程检索",
    question: "查找课程资料",
  });
  const revision = snapshot.data.revision;
  snapshot.data = created.data;
  const chat = snapshot.data.nodes.find(
    (node: any) => node.id === created.selectedId,
  );
  chat.webSources = [{ title: "课程资料", url: "https://example.com/lesson" }];
  await request.post("/api/restore", {
    data: { revision, data: snapshot.data },
  });
  await page.reload();
  const parents = [];
  let current = chat;
  while (current.parentId !== null) {
    parents.unshift(current);
    current = snapshot.data.nodes.find(
      (node: any) => node.id === current.parentId,
    );
  }
  for (const node of parents)
    await page
      .getByRole("tree")
      .getByRole("button", { name: node.title, exact: true })
      .click();
  const link = page
    .getByLabel("本次联网来源")
    .getByRole("link", { name: "课程资料" });
  await expect(link).toHaveAttribute("href", "https://example.com/lesson");
  await expect(link).toHaveAttribute("rel", "noreferrer");
  await page.screenshot({
    path: "screenshots/web-sources.png",
    fullPage: true,
  });
  await page.setViewportSize({ width: 390, height: 844 });
  await page.getByRole("button", { name: "打开侧栏", exact: true }).click();
  await page.getByRole("button", { name: "模型设置", exact: true }).click();
  await expect(page.getByLabel("联网搜索", { exact: true })).toBeChecked();
  await page.getByLabel("联网搜索", { exact: true }).uncheck();
  await page.getByRole("button", { name: "保存设置", exact: true }).click();
  expect((await (await request.get("/api/settings")).json()).webEnabled).toBe(
    false,
  );
});

test("AI configuration, debug request inspection and mode switching", async ({
  page,
  request,
}) => {
  let received: unknown;
  const provider = createServer(async (req, res) => {
    const chunks: Buffer[] = [];
    for await (const chunk of req) chunks.push(chunk);
    const payload = JSON.parse(Buffer.concat(chunks).toString());
    received = payload;
    const results = payload.messages.filter(
      (item: any) => item.role === "tool",
    );
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
              : {
                  content: JSON.stringify({
                    title: "调试问题概括",
                    answer: "DEBUG_MODEL_ANSWER",
                  }),
                },
          },
        ],
      }),
    );
  });
  await new Promise<void>((resolve) =>
    provider.listen(0, "127.0.0.1", resolve),
  );
  const address = `http://127.0.0.1:${(provider.address() as import("node:net").AddressInfo).port}/v1`;
  try {
    await request.put("/api/settings", { data: defaultSettings });
    await page.goto("/");
    await expect(
      page.getByRole("button", { name: "AI 模式", exact: true }),
    ).toBeVisible();
    await page
      .getByRole("button", { name: "新建项目", exact: true })
      .first()
      .click();
    await page.getByLabel("名称", { exact: true }).fill("调试验证");
    await page
      .getByLabel("学习内容（可选）", { exact: true })
      .fill("DEBUG_PROJECT_CONTEXT");
    await page.getByRole("button", { name: "创建节点", exact: true }).click();
    await page.getByRole("button", { name: "添加文件节点", exact: true }).click();
    await page.getByLabel("名称", { exact: true }).fill("项目教材.md");
    await page
      .getByLabel("文件正文", { exact: true })
      .fill("PROJECT_FILE_READ_MARKER 这是项目教材的正文。");
    await page.getByRole("button", { name: "创建节点", exact: true }).click();
    await expect(
      page.getByRole("heading", { name: "项目教材.md", exact: true }),
    ).toBeVisible();
    const before = (await (await request.get("/api/tree")).json()).data.nodes
      .length;
    await page.getByLabel("新问题", { exact: true }).fill("DEBUG_QUESTION");
    await page.getByRole("button", { name: "发送问题", exact: true }).click();
    await expect(page.getByRole("dialog")).toBeVisible();
    expect(
      (await (await request.get("/api/tree")).json()).data.nodes.length,
    ).toBe(before);
    await page.getByRole("button", { name: "调试模式", exact: true }).click();
    await page.getByLabel("API 地址", { exact: true }).fill(address);
    await page.getByLabel("模型名称", { exact: true }).fill("local-test-model");
    await page
      .getByLabel("API 密钥", { exact: true })
      .fill("browser-test-secret");
    await page.getByRole("button", { name: "保存设置", exact: true }).click();
    await page.getByRole("button", { name: "发送问题", exact: true }).click();
    await expect(
      page.getByText("DEBUG_MODEL_ANSWER", { exact: true }),
    ).toBeVisible();
    await expect(page.getByRole("heading", { level: 1 })).toHaveText(
      "调试问题概括",
    );
    await expect(page.getByRole("tree")).toContainText("调试问题概括");
    await page
      .getByLabel("本次文件阅读", { exact: true })
      .locator("summary")
      .click();
    await expect(
      page.getByLabel("本次文件阅读", { exact: true }),
    ).toContainText("PROJECT_FILE_READ_MARKER");
    await page
      .getByRole("button", { name: "查看 API 请求", exact: true })
      .click();
    const body = page.getByLabel("请求正文", { exact: true });
    await expect(body).toContainText("DEBUG_QUESTION");
    await expect(body).toContainText("PROJECT_FILE_READ_MARKER");
    expect(JSON.parse(await body.innerText())).toEqual(received);
    await expect(page.getByRole("dialog")).toContainText("HTTP 200");
    await expect(page.getByLabel("请求头", { exact: true })).toContainText(
      "[已隐藏]",
    );
    await expect(page.getByRole("dialog")).not.toContainText(
      "browser-test-secret",
    );
    const downloadEvent = page.waitForEvent("download");
    await page
      .getByRole("button", { name: "导出 API 请求", exact: true })
      .click();
    expect((await downloadEvent).suggestedFilename()).toMatch(
      /^TreeLearning-request-.*\.json$/,
    );
    await page.screenshot({ path: "screenshots/debug-desktop.png" });
    await page.setViewportSize({ width: 390, height: 844 });
    expect(
      await page.evaluate(
        () => document.documentElement.scrollWidth <= innerWidth,
      ),
    ).toBe(true);
    await page.screenshot({ path: "screenshots/debug-mobile.png" });
    await page.getByRole("button", { name: "关闭弹窗" }).click();
    await page.reload();
    await expect(
      page.getByRole("button", { name: "调试模式", exact: true }),
    ).toBeVisible();
    await page.getByRole("button", { name: "调试模式", exact: true }).click();
    await page
      .getByRole("dialog")
      .getByRole("button", { name: "AI 模式", exact: true })
      .click();
    await page.getByRole("button", { name: "保存设置", exact: true }).click();
    await expect(
      page.getByRole("button", { name: "查看 API 请求", exact: true }),
    ).toHaveCount(0);
  } finally {
    provider.closeAllConnections();
    await new Promise<void>((resolve) => provider.close(() => resolve()));
  }
});
