import { test, expect } from "@playwright/test";
import { initialTree, applyCommand, defaultSettings } from "../../src/model";

test("Enter sends, modified Enter inserts a newline, IME does not send, and only completed replies sound", async ({
  page,
  request,
}) => {
  await page.addInitScript(() => {
    const start = OscillatorNode.prototype.start;
    (window as any).replySounds = 0;
    OscillatorNode.prototype.start = function (...args) {
      (window as any).replySounds++;
      return start.apply(this, args);
    };
  });
  const tree = initialTree();
  const project = applyCommand(tree, {
    type: "create",
    parentId: tree.rootId,
    kind: "project",
    title: "输入测试",
  });
  const old = await (await request.get("/api/tree")).json();
  await request.post("/api/restore", {
    data: { data: project.data, revision: old.data.revision },
  });
  await request.put("/api/settings", {
    data: { ...defaultSettings, mode: "demo" },
  });
  await page.goto("/");
  await page
    .getByRole("tree")
    .getByRole("button", { name: "输入测试", exact: true })
    .click();
  const input = page.getByLabel("新问题", { exact: true });
  await input.fill("第一行");
  await input.press("Shift+Enter");
  await input.pressSequentially("second");
  await input.press("Control+Enter");
  await input.pressSequentially("third");
  await expect(input).toHaveValue("第一行\nsecond\nthird");
  await input.evaluate((element) =>
    element.dispatchEvent(
      new KeyboardEvent("keydown", {
        key: "Enter",
        code: "Enter",
        isComposing: true,
        bubbles: true,
        cancelable: true,
      }),
    ),
  );
  await expect(page.locator(".node-header h1")).toHaveText("输入测试");
  await expect(input).toHaveValue("第一行\nsecond\nthird");
  await input.press("Enter");
  await expect(
    page.getByText("演示回复 · 未调用 AI", { exact: true }),
  ).toBeVisible();
  await expect
    .poll(() => page.evaluate(() => (window as any).replySounds))
    .toBe(1);
  const current = (await (await request.get("/api/tree")).json()).data;
  expect(current.nodes.find((node: any) => node.kind === "chat").question).toBe(
    "第一行\nsecond\nthird",
  );
  await page.getByRole("button", { name: "重新生成回复", exact: true }).click();
  await expect
    .poll(() => page.evaluate(() => (window as any).replySounds))
    .toBe(2);
  await input.press("Enter");
  expect(
    (await (await request.get("/api/tree")).json()).data.nodes,
  ).toHaveLength(3);

  let finish: (() => Promise<void>) | undefined;
  await page.route("**/api/generate", async (route) => {
    await new Promise<void>((resolve) => {
      finish = async () => {
        await route.fulfill({
          status: 409,
          contentType: "application/json",
          body: JSON.stringify({ error: "已停止生成，原回复保留" }),
        });
        resolve();
      };
    });
  });
  await input.fill("等待中的问题");
  await input.press("Enter");
  await expect(
    page.getByRole("button", { name: "停止生成", exact: true }),
  ).toBeVisible();
  await input.fill("不要重复发送");
  await input.press("Enter");
  expect(
    (await (await request.get("/api/tree")).json()).data.nodes,
  ).toHaveLength(4);
  await page.getByRole("button", { name: "停止生成", exact: true }).click();
  await expect.poll(() => !!finish).toBe(true);
  await finish!();
  await expect(page.getByRole("alert")).toContainText("已停止生成");
  expect(await page.evaluate(() => (window as any).replySounds)).toBe(2);
  await page.unroute("**/api/generate");
  await page.route("**/api/generate", (route) =>
    route.fulfill({
      status: 502,
      contentType: "application/json",
      body: JSON.stringify({ error: "模型服务失败" }),
    }),
  );
  await page.getByRole("button", { name: "重新生成回复", exact: true }).click();
  await expect(page.getByRole("alert")).toContainText("模型服务失败");
  expect(await page.evaluate(() => (window as any).replySounds)).toBe(2);
});
