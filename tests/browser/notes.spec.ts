import { test, expect } from "@playwright/test";
import { initialTree, applyCommand } from "../../src/model";

test("project notebook remains selected across navigation, saves drafts, cites sources and restores positions", async ({
  page,
  request,
}) => {
  let data = initialTree();
  const p = applyCommand(data, {
    type: "create",
    parentId: data.rootId,
    kind: "project",
    title: "系统学习",
  });
  data = p.data;
  const a = applyCommand(data, {
    type: "create",
    parentId: p.selectedId,
    kind: "chat",
    title: "虚拟内存",
    question: "虚拟内存是什么？",
  });
  data = a.data;
  const edited = applyCommand(data, {
    type: "edit",
    id: a.selectedId,
    patch: { answer: "# 内存\n\n" + "内存地址的映射。\n\n".repeat(100) },
  });
  data = edited.data;
  const b = applyCommand(data, {
    type: "create",
    parentId: p.selectedId,
    kind: "chat",
    title: "进程",
    question: "进程是什么？",
  });
  data = b.data;
  const other = applyCommand(data, {
    type: "create",
    parentId: data.rootId,
    kind: "project",
    title: "其他课程",
  });
  data = other.data;
  const old = await (await request.get("/api/tree")).json();
  expect(
    (
      await request.post("/api/restore", {
        data: { data, revision: old.data.revision },
      })
    ).ok(),
  ).toBeTruthy();
  await page.goto("/");
  const jump = async (name: string, all = false) => {
    await page.getByRole("button", { name: "快速跳转", exact: true }).click();
    if (all) await page.getByLabel("全部项目").check();
    await page.getByLabel("搜索节点").fill(name);
    await page
      .getByRole("dialog")
      .getByRole("button", { name: new RegExp(name) })
      .click();
  };
  await jump("虚拟内存");
  await page.getByLabel("新问题", { exact: true }).fill("还没发送的草稿");
  await page.locator(".node-scroll").evaluate((el) => {
    el.scrollTop = 450;
    el.dispatchEvent(new Event("scroll"));
  });
  await page.getByRole("button", { name: "打开项目笔记", exact: true }).click();
  await page.getByRole("button", { name: "新建笔记", exact: true }).click();
  await page.getByLabel("笔记名称", { exact: true }).fill("操作系统复习");
  await page
    .getByLabel("笔记正文", { exact: true })
    .fill("# 要点\n\nNOTE_PRIVATE");
  await jump("进程");
  await expect(page.getByLabel("笔记正文", { exact: true })).toHaveValue(
    /NOTE_PRIVATE/,
  );
  await page.keyboard.press("Alt+ArrowLeft");
  await expect(page.locator(".node-header h1")).toHaveText("虚拟内存");
  await expect(page.getByLabel("新问题", { exact: true })).toHaveValue(
    "还没发送的草稿",
  );
  await expect
    .poll(() => page.locator(".node-scroll").evaluate((el) => el.scrollTop))
    .toBeGreaterThan(400);
  await page.keyboard.press("Alt+ArrowRight");
  await expect(page.locator(".node-header h1")).toHaveText("进程");
  await page
    .getByRole("button", { name: "摘录问题到笔记", exact: true })
    .click();
  await expect(page.getByLabel("笔记正文", { exact: true })).toHaveValue(
    /进程是什么？/,
  );
  await page.getByRole("button", { name: "预览", exact: true }).click();
  await jump("虚拟内存");
  await page.getByRole("link", { name: "来源：进程" }).click();
  await expect(page.locator(".node-header h1")).toHaveText("进程");
  await page
    .getByRole("button", { name: "引用笔记到问题", exact: true })
    .click();
  await expect(page.getByLabel("新问题", { exact: true })).toHaveValue(
    /NOTE_PRIVATE/,
  );
  await expect
    .poll(
      async () =>
        (await (await request.get("/api/tree")).json()).data.notes?.[0]
          ?.content,
    )
    .toContain("进程是什么？");
  const current = (await (await request.get("/api/tree")).json()).data;
  const context = await (
    await request.get(`/api/context/${b.selectedId}`)
  ).json();
  expect(JSON.stringify(context.messages)).not.toContain("NOTE_PRIVATE");
  expect(current.notes[0].projectId).toBe(p.selectedId);
  await page.getByRole("button", { name: "编辑", exact: true }).click();
  await page.screenshot({ path: "screenshots/project-notes-desktop.png" });
  await jump("其他课程", true);
  await expect(page.getByLabel("笔记名称", { exact: true })).toHaveValue(
    "操作系统复习",
  );
  await expect(
    page.getByRole("button", { name: "引用笔记到问题" }),
  ).toBeDisabled();
  await page.reload();
  await page.getByRole("button", { name: "打开项目笔记", exact: true }).click();
  await expect(page.getByLabel("笔记正文", { exact: true })).toHaveValue(
    /NOTE_PRIVATE/,
  );
  await page.getByRole("button", { name: "项目笔记本", exact: true }).click();
  await page.getByLabel("笔记本项目").selectOption(p.selectedId);
  await page.getByLabel("搜索笔记").fill("操作系统");
  await expect(page.getByRole("dialog")).toContainText("操作系统复习");
  await page.getByRole("button", { name: "关闭弹窗", exact: true }).click();
  await page.setViewportSize({ width: 390, height: 844 });
  await expect(page.getByLabel("笔记正文", { exact: true })).toBeVisible();
  expect(
    await page.evaluate(
      () => document.documentElement.scrollWidth <= innerWidth,
    ),
  ).toBeTruthy();
  await page.screenshot({ path: "screenshots/project-notes-mobile.png" });
  await page.getByRole("button", { name: "返回对话", exact: true }).click();
  await expect(page.locator(".node-header h1")).toHaveText("其他课程");
});

test("failed note writes keep drafts and retry without overwriting a second notebook", async ({
  page,
  request,
}) => {
  const old = await (await request.get("/api/tree")).json();
  const initial = initialTree();
  const created = applyCommand(initial, {
    type: "create",
    parentId: initial.rootId,
    kind: "project",
    title: "草稿测试",
  });
  expect(
    (
      await request.post("/api/restore", {
        data: { data: created.data, revision: old.data.revision },
      })
    ).ok(),
  ).toBeTruthy();
  await page.goto("/");
  await page
    .getByRole("tree")
    .getByRole("button", { name: "草稿测试", exact: true })
    .click();
  await page.getByRole("button", { name: "打开项目笔记", exact: true }).click();
  await page.getByRole("button", { name: "新建笔记", exact: true }).click();
  await page.route("**/api/notes", async (route) => {
    if (route.request().postDataJSON().action === "save")
      await route.fulfill({
        status: 503,
        contentType: "application/json",
        body: JSON.stringify({ error: "模拟磁盘写入失败" }),
      });
    else await route.continue();
  });
  await page.getByLabel("笔记正文", { exact: true }).fill("UNSAVED_DRAFT");
  await expect(page.getByRole("alert")).toContainText("模拟磁盘写入失败");
  await page.getByRole("button", { name: "新建项目笔记", exact: true }).click();
  await expect(page.getByLabel("笔记正文", { exact: true })).toHaveValue("");
  await page.unroute("**/api/notes");
  await page.getByRole("button", { name: "项目笔记本", exact: true }).click();
  const notes = (await (await request.get("/api/tree")).json()).data.notes;
  expect(notes).toHaveLength(2);
  await page.getByRole("dialog").locator(".jump-results button").last().click();
  await expect(page.getByLabel("笔记正文", { exact: true })).toHaveValue(
    "UNSAVED_DRAFT",
  );
  await page.getByRole("button", { name: "保存笔记", exact: true }).click();
  await expect
    .poll(
      async () =>
        (await (await request.get("/api/tree")).json()).data.notes[0].content,
    )
    .toBe("UNSAVED_DRAFT");
  expect(
    (await (await request.get("/api/tree")).json()).data.notes[1].content,
  ).toBe("");
});
