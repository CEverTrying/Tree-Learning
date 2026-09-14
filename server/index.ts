import path from "node:path";
import { fileURLToPath } from "node:url";
import { createApp } from "./app";

export async function startServer(options: {
  root: string;
  directory: string;
  port?: number;
  development?: boolean;
}) {
  const instance = await createApp(options.directory);
  let vite: { close: () => Promise<void> } | undefined;
  if (options.development) {
    const { createServer } = await import("vite");
    const development = await createServer({
      root: options.root,
      server: {
        middlewareMode: true,
        hmr: { port: options.port ? options.port + 10000 : 25188 },
      },
      appType: "spa",
    });
    instance.app.use(development.middlewares);
    vite = development;
  } else {
    const express = (await import("express")).default;
    instance.app.use(express.static(path.join(options.root, "dist")));
    instance.app.get("/{*path}", (_req, res) =>
      res.sendFile(path.join(options.root, "dist/index.html")),
    );
  }
  const server = await new Promise<import("node:http").Server>(
    (resolve, reject) => {
      const server = instance.app.listen(options.port ?? 0, "127.0.0.1", () =>
        resolve(server),
      );
      server.once("error", reject);
    },
  );
  server.requestTimeout = 0;
  const port = (server.address() as import("node:net").AddressInfo).port;
  return {
    url: `http://127.0.0.1:${port}`,
    close: async () => {
      await instance.close();
      await vite?.close();
      server.closeAllConnections();
      await new Promise<void>((resolve, reject) =>
        server.close((error) => (error ? reject(error) : resolve())),
      );
    },
  };
}

if (process.env.TREELEARNING_DESKTOP !== "1") {
  const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
  const running = await startServer({
    root,
    directory: process.env.TREELEARNING_DATA_DIR || path.join(root, ".local"),
    port: Number(process.env.PORT || 5188),
    development: process.env.NODE_ENV !== "production",
  });
  console.log(`TreeLearning 树学: ${running.url}`);
  for (const signal of ["SIGINT", "SIGTERM"] as const)
    process.once(signal, () => {
      void running.close().then(() => process.exit(0));
    });
}
