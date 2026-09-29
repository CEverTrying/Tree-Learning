import { test, expect } from "@playwright/test";
import { initialTree, applyCommand, type Command } from "../../src/model";

test("drag main in content and map, persist, replace, and navigate only to explicitly selected endpoint", async ({ page, request }) => {
  let data = initialTree();
  const command = (c: Command) => {
    const result = applyCommand(data, c); data = result.data; return result.selectedId;
  };
  const project = command({ type: "create", parentId: data.rootId, kind: "project", title: "Main preview" });
  const chat = (parentId: string, title: string) => command({ type: "create", parentId, kind: "chat", title, question: title });
  const a = chat(project, "Step A");
  const b = chat(a, "Step B");
  const c = chat(b, "Not yet main");
  const sibling = chat(project, "Other branch");
  const snapshot = await (await request.get("/api/tree")).json();
  expect((await request.post("/api/restore", { data: { data, revision: snapshot.data.revision } })).ok()).toBe(true);
  await page.goto("/");
  await page.getByRole("tree").getByRole("button", { name: "Main preview", exact: true }).click();
  const main = page.getByRole("button", { name: "设置 main 分支", exact: true });
  await main.dragTo(page.locator(`.composer-children [data-main-node-id="${a}"]`));
  await expect(page.locator(".node-header .main-badge")).toHaveText("main");
  await expect(page.locator(".node-header h1")).toHaveText("Step A");
  await page.getByRole("tab", { name: "学习树图" }).click();
  await main.dragTo(page.locator(`.map-node[data-main-node-id="${b}"]`));
  await expect(page.locator(".map-node.main-map-node")).toHaveCount(3);
  await expect(page.locator(`.map-node[data-main-node-id="${c}"] .main-badge`)).toHaveCount(0);
  await page.reload();
  await expect(page.locator(".node-header h1")).toHaveText("Step B");
  await expect(page.locator(".node-header .main-badge")).toHaveText("main");
  const scroll = page.locator(".node-scroll");
  async function wheel(deltaY: number) {
    await page.waitForTimeout(400);
    for (let i = 0; i < 2; i++) await scroll.dispatchEvent("wheel", { deltaY, deltaX: 0, deltaMode: 0 });
  }
  await wheel(-100);
  await expect(page.locator(".node-header h1")).toHaveText("Step A");
  await scroll.evaluate(el => { el.scrollTop = el.scrollHeight; });
  await wheel(100);
  await expect(page.locator(".node-header h1")).toHaveText("Step B");
  await scroll.evaluate(el => { el.scrollTop = el.scrollHeight; });
  await wheel(100);
  await expect(page.locator(".node-header h1")).toHaveText("Step B");
  await page.getByRole("tab", { name: "学习树图" }).click();
  await main.dragTo(page.locator(`.map-node[data-main-node-id="${sibling}"]`));
  await expect(page.locator(".map-node.main-map-node")).toHaveCount(2);
  await expect(page.locator(`.map-node[data-main-node-id="${a}"] .main-badge`)).toHaveCount(0);
  await page.setViewportSize({ width: 390, height: 844 });
  expect(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth)).toBe(true);
});
