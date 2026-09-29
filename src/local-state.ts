import type { WorkspaceKey } from "./workspace-state";
let desktop = false;
let staged: Record<string, unknown> = {};
let pending: Promise<void> | undefined;
let timer: ReturnType<typeof setTimeout> | undefined;
let beforeClose: (() => Promise<unknown>) | undefined;
export function registerBeforeClose(callback: () => Promise<unknown>) {
  beforeClose = callback;
  return () => {
    beforeClose = undefined;
  };
}
export async function flushWorkspace() {
  clearTimeout(timer);
  if (pending) await pending;
  if (!Object.keys(staged).length) return;
  const values = staged;
  staged = {};
  pending = (async () => {
    try {
      const result = await fetch("/api/workspace-state", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(values),
      });
      if (!result.ok) {
        let detail = result.statusText || "保存接口返回错误";
        try {
          const body = await result.json();
          if (typeof body.error === "string") detail = body.error;
        } catch { /* Keep the HTTP status if the response is not JSON. */ }
        throw new Error(`工作区草稿保存失败（HTTP ${result.status}）：${detail}`);
      }
    } catch (error) {
      staged = { ...values, ...staged };
      throw error;
    }
  })();
  try {
    await pending;
  } finally {
    pending = undefined;
  }
  if (Object.keys(staged).length) await flushWorkspace();
}
export async function initializeWorkspace() {
  try {
    const result = await fetch("/api/workspace-state");
    if (!result.ok) return;
    const value = await result.json();
    desktop = value.desktop === true;
    if (desktop)
      for (const [key, item] of Object.entries(value.state || {}))
        localStorage.setItem(key, JSON.stringify(item));
  } catch {
    /* Browser storage remains available if the local service is unavailable. */
  }
  (
    window as Window & { treeLearningFlush?: () => Promise<void> }
  ).treeLearningFlush = async () => {
    await beforeClose?.();
    await flushWorkspace();
  };
}
export function readLocal<T>(key: string, fallback: T): T {
  try {
    return JSON.parse(localStorage.getItem(key) || "null") ?? fallback;
  } catch {
    return fallback;
  }
}
export function writeLocal(key: WorkspaceKey, value: unknown) {
  if (desktop) {
    staged[key] = value;
    clearTimeout(timer);
    timer = setTimeout(() => {
      void flushWorkspace().catch(() => {});
    }, 100);
  }
  try {
    localStorage.setItem(key, JSON.stringify(value));
    return true;
  } catch {
    return false;
  }
}
