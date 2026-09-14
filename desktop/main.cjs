const { app, BrowserWindow, dialog, Menu, shell } = require("electron");
const { appendFileSync, mkdirSync } = require("node:fs");
const path = require("node:path");

process.env.TREELEARNING_DESKTOP = "1";
const appId = "app.treelearning.desktop";
if (process.env.TREELEARNING_PROFILE_DIR) {
  mkdirSync(process.env.TREELEARNING_PROFILE_DIR, { recursive: true });
  app.setPath("userData", process.env.TREELEARNING_PROFILE_DIR);
}
app.setAppUserModelId(appId);
const directory = process.env.TREELEARNING_DATA_DIR || app.getPath("userData");
let service;
let window;
let closing = false;

function logError(error) {
  try {
    mkdirSync(directory, { recursive: true });
    appendFileSync(
      path.join(directory, "desktop.log"),
      `${new Date().toISOString()} ${error instanceof Error ? error.stack : String(error)}\n`,
    );
  } catch {
    /* Keep the original startup error when the data folder is unavailable. */
  }
}
async function openDataFolder() {
  const error = await shell.openPath(directory);
  if (error) dialog.showErrorBox("无法打开数据文件夹", error);
}
function createMenu() {
  Menu.setApplicationMenu(
    Menu.buildFromTemplate([
      ...(process.platform === "darwin" ? [{ role: "appMenu" }] : []),
      {
        label: "文件",
        submenu: [
          { label: "打开数据文件夹", click: openDataFolder },
          { type: "separator" },
          { label: "退出", role: "quit" },
        ],
      },
      {
        label: "编辑",
        submenu: [
          { label: "撤销", role: "undo" },
          { label: "重做", role: "redo" },
          { type: "separator" },
          { label: "剪切", role: "cut" },
          { label: "复制", role: "copy" },
          { label: "粘贴", role: "paste" },
          { label: "全选", role: "selectAll" },
        ],
      },
      {
        label: "视图",
        submenu: [
          { label: "放大", role: "zoomIn" },
          { label: "缩小", role: "zoomOut" },
          { label: "实际大小", role: "resetZoom" },
          { label: "全屏", role: "togglefullscreen" },
        ],
      },
      {
        label: "帮助",
        submenu: [
          {
            label: "关于树学",
            click: () =>
              dialog.showMessageBox(window, {
                type: "info",
                title: "关于 TreeLearning 树学",
                message: "TreeLearning 树学",
                detail: `版本 ${app.getVersion()}`,
                buttons: ["确定"],
              }),
          },
        ],
      },
    ]),
  );
}
async function createWindow() {
  window = new BrowserWindow({
    width: 1440,
    height: 940,
    minWidth: 760,
    minHeight: 580,
    title: "TreeLearning 树学",
    icon: path.join(__dirname, "../dist/icon.png"),
    backgroundColor: "#fafbf9",
    show: false,
    webPreferences: {
      nodeIntegration: false,
      contextIsolation: true,
      sandbox: true,
    },
  });
  window.once("ready-to-show", () => window?.show());
  window.webContents.setWindowOpenHandler(({ url }) => {
    if (/^https?:\/\//.test(url)) void shell.openExternal(url).catch(logError);
    return { action: "deny" };
  });
  window.webContents.on("will-navigate", (event, url) => {
    if (new URL(url).origin !== service.url) {
      event.preventDefault();
      if (/^https?:\/\//.test(url))
        void shell.openExternal(url).catch(logError);
    }
  });
  window.webContents.on("render-process-gone", (_event, details) => {
    logError(`Renderer exited: ${details.reason}`);
    if (!closing)
      dialog.showErrorBox(
        "TreeLearning 窗口已停止",
        "请重新打开树学，已保存的学习数据会保留。",
      );
  });
  window.webContents.session.setPermissionRequestHandler(
    (_contents, _permission, callback) => callback(false),
  );
  window.on("closed", () => {
    window = null;
  });
  window.on("close", (event) => {
    if (!closing) {
      event.preventDefault();
      app.quit();
    }
  });
  await window.loadURL(service.url);
}
function startupError(error) {
  logError(error);
  dialog.showErrorBox(
    "TreeLearning 无法启动",
    `${error.message}\n\n数据目录：${directory}`,
  );
  app.quit();
}
const single = app.requestSingleInstanceLock();
if (!single) app.quit();
else {
  app.on("second-instance", () => {
    if (window) {
      if (window.isMinimized()) window.restore();
      window.show();
      window.focus();
    } else if (service && !closing) void createWindow().catch(startupError);
  });
  app
    .whenReady()
    .then(async () => {
      const { startServer } = await import("../dist-server/index.mjs");
      service = await startServer({
        root: path.join(__dirname, ".."),
        directory,
        port: 0,
      });
      createMenu();
      await createWindow();
      app.on("activate", () => {
        if (!window && !closing) void createWindow().catch(startupError);
      });
    })
    .catch(startupError);
  app.on("window-all-closed", () => {
    if (process.platform !== "darwin") app.quit();
  });
  app.on("before-quit", (event) => {
    if (!service || closing) return;
    event.preventDefault();
    closing = true;
    Promise.resolve(
      window && !window.isDestroyed()
        ? window.webContents.executeJavaScript("window.treeLearningFlush?.()")
        : undefined,
    )
      .then(() => service.close())
      .then(() => app.quit())
      .catch((error) => {
        closing = false;
        logError(error);
        dialog.showErrorBox(
          "尚未退出",
          "草稿保存未完成，请稍后重试退出。\n" + error.message,
        );
      });
  });
}
