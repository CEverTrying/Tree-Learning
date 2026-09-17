import { test, expect } from "@playwright/test";
import { initialTree, applyCommand, withAnswer } from "../../src/model";

test("selection stays quiet; right click quotes a snapshot or copies text", async ({ page, request, context }) => {
  const tree = initialTree();
  const project = applyCommand(tree, { type: "create", kind: "project", parentId: tree.rootId, title: "引用测试" });
  const chat = applyCommand(project.data, { type: "create", kind: "chat", parentId: project.selectedId, title: "测试问题", question: "这是问题原文" });
  const data = withAnswer(chat.data, chat.selectedId, "这是回答第一段。\n\n这是回答第二段。", "model");
  const old = await (await request.get("/api/tree")).json();
  await request.post("/api/restore", { data: { data, revision: old.data.revision } });
  await context.grantPermissions(["clipboard-read", "clipboard-write"]);
  await page.goto("/");
  await page.getByRole("tree").getByRole("button", { name: "引用测试", exact: true }).click();
  await page.getByRole("tree").getByRole("button", { name: "测试问题", exact: true }).click();
  const answer = page.getByText("这是回答第一段。", { exact: true });
  const select = async () => {
    await answer.evaluate((element) => {
      const range = document.createRange();
      range.selectNodeContents(element);
      getSelection()!.removeAllRanges();
      getSelection()!.addRange(range);
    });
  };
  await select();
  await expect(page.getByRole("menu")).toHaveCount(0);
  await expect(page.getByText("摘录选中文字")).toHaveCount(0);
  const draft = page.getByLabel("新问题", { exact: true });
  await draft.fill("已有草稿");
  await select();
  await answer.click({ button: "right" });
  const selectedRect = await page.evaluate(() => {
    const rect = getSelection()!.getRangeAt(0).getClientRects()[0];
    return { left: rect.left, bottom: rect.bottom };
  });
  const menuRect = await page.getByRole("menu").boundingBox();
  expect(Math.abs(menuRect!.x - selectedRect.left)).toBeLessThan(2);
  expect(Math.abs(menuRect!.y - selectedRect.bottom - 6)).toBeLessThan(2);
  await page.getByRole("menuitem", { name: "引用到对话" }).click();
  await expect(draft).toHaveValue("已有草稿\n\n引用「测试问题」：\n> 这是回答第一段。\n\n");
  await expect(draft).toBeFocused();
  await expect(page.getByRole("menu")).toHaveCount(0);
  expect((await (await request.get("/api/tree")).json()).data.nodes).toHaveLength(3);
  await select();
  await answer.click({ button: "right" });
  await page.getByRole("menuitem", { name: "复制", exact: true }).click();
  await expect.poll(() => page.evaluate(() => navigator.clipboard.readText())).toBe("这是回答第一段。");
  await select();
  await answer.click({ button: "right" });
  await page.keyboard.press("Escape");
  await expect(page.getByRole("menu")).toHaveCount(0);
});
