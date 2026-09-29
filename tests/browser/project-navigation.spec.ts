import { test, expect } from "@playwright/test";
import { initialTree, applyCommand, type Command } from "../../src/model";

test("project picker lists all projects and sidebar shows ancestors plus direct children", async ({ page, request }) => {
  let data = initialTree();
  const command = (c: Command) => {
    const result = applyCommand(data, c); data = result.data; return result.selectedId;
  };
  const p = command({ type: "create", parentId: data.rootId, kind: "project", title: "项目甲" });
  command({ type: "create", parentId: data.rootId, kind: "project", title: "项目乙" });
  const chat = (parentId: string, title: string) => command({ type: "create", parentId, kind: "chat", title, question: title });
  const a = chat(p, "祖先一");
  const b = chat(a, "祖先二");
  const current = chat(b, "当前节点");
  const child = chat(current, "一级子节点");
  chat(child, "二级子节点");
  chat(b, "兄弟分支");
  const old = await (await request.get("/api/tree")).json();
  expect((await request.post("/api/restore", { data: { data, revision: old.data.revision } })).ok()).toBe(true);
  await page.goto("/");
  const tree = page.getByRole("tree", { name: "学习树" });
  for (const title of ["项目甲", "祖先一", "祖先二", "当前节点"]) {
    await tree.getByRole("button", { name: title, exact: true }).click();
  }
  await expect(tree.locator(".tree-select")).toHaveText(["TreeLearning 树学", "项目甲", "祖先一", "祖先二", "当前节点", "一级子节点"]);
  await expect(tree.getByRole("button", { name: "二级子节点", exact: true })).toHaveCount(0);
  await expect(tree.getByRole("button", { name: "兄弟分支", exact: true })).toHaveCount(0);
  await page.getByRole("button", { name: "我的项目", exact: true }).click();
  const picker = page.getByRole("dialog", { name: "我的项目" });
  await expect(picker.locator(".project-picker > button")).toHaveCount(2);
  await picker.getByRole("button", { name: "项目乙", exact: true }).click();
  await expect(picker).toHaveCount(0);
  await expect(page.locator(".node-header h1")).toHaveText("项目乙");
});
