import { test, expect } from "@playwright/test";
import { initialTree, applyCommand, defaultSettings } from "../../src/model";

test("another branch remains editable and can send while a reply is pending", async ({ page, request }) => {
  const tree = initialTree();
  const project = applyCommand(tree, { type: "create", kind: "project", parentId: tree.rootId, title: "并行测试" });
  const a = applyCommand(project.data, { type: "create", kind: "chat", parentId: project.selectedId, title: "分支 A", question: "A" });
  const b = applyCommand(a.data, { type: "create", kind: "chat", parentId: project.selectedId, title: "分支 B", question: "B" });
  const old = await (await request.get("/api/tree")).json();
  await request.post("/api/restore", { data: { data: b.data, revision: old.data.revision } });
  await request.put("/api/settings", { data: { ...defaultSettings, mode: "demo" } });
  const finish = new Map<string, () => Promise<void>>();
  await page.route("**/api/generate", async (route) => {
    const body = route.request().postDataJSON();
    await new Promise<void>((resolve) => {
      finish.set(body.id, async () => {
        const latest = await (await request.get("/api/tree")).json();
        const response = await route.fetch({ postData: { ...body, revision: latest.data.revision } });
        await route.fulfill({ response });
        resolve();
      });
    });
  });
  await page.goto("/");
  const treeButton = (name: string) => page.getByRole("tree").getByRole("button", { name, exact: true });
  await treeButton("并行测试").click();
  await treeButton("分支 A").click();
  await page.getByRole("button", { name: "生成回复", exact: true }).click();
  await expect.poll(() => finish.has(a.selectedId)).toBe(true);
  await treeButton("并行测试").click();
  await treeButton("分支 B").click();
  await expect(page.getByRole("button", { name: "编辑节点", exact: true })).toBeEnabled();
  await expect(page.getByRole("button", { name: "删除节点", exact: true })).toBeEnabled();
  await page.getByLabel("新问题", { exact: true }).fill("B 的后续问题");
  await page.getByLabel("新问题", { exact: true }).press("Enter");
  await expect.poll(() => finish.size).toBe(2);
  await finish.get(a.selectedId)!();
  await expect(page.locator(".node-header h1")).toHaveText("B 的后续问题");
  await expect(page.getByRole("button", { name: "停止生成", exact: true })).toBeVisible();
  const other = [...finish.keys()].find((id) => id !== a.selectedId)!;
  await finish.get(other)!();
  await expect(page.getByText("演示回复 · 未调用 AI", { exact: true })).toBeVisible();
  await expect(page.getByRole("button", { name: "停止生成", exact: true })).toHaveCount(0);
});
