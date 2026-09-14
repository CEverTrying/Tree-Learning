import {
  mkdir,
  mkdtemp,
  open,
  readFile,
  rename,
  rm,
  stat,
  writeFile,
} from "node:fs/promises";
import path from "node:path";
import { Worker } from "node:worker_threads";
import { type FileRef, TreeError, validFileRef } from "../src/model";

export class Documents {
  readonly directory: string;
  private metadata = new Map<string, FileRef>();
  constructor(directory: string) {
    this.directory = path.join(directory, "documents");
  }
  async init() {
    await mkdir(this.directory, { recursive: true });
  }
  location(id: string) {
    if (!validFileRef({ id, chars: 0 })) throw new TreeError("文件引用无效");
    return path.join(this.directory, id);
  }
  async info(id: string): Promise<FileRef> {
    const cached = this.metadata.get(id);
    if (cached) return cached;
    try {
      const ref = JSON.parse(
        await readFile(path.join(this.location(id), "meta.json"), "utf8"),
      );
      if (
        !validFileRef(ref) ||
        ref.id !== id ||
        (await stat(path.join(this.location(id), "text.bin"))).size !==
          ref.chars * 2
      )
        throw new Error("metadata mismatch");
      await stat(path.join(this.location(id), "source"));
      this.metadata.set(id, ref);
      return ref;
    } catch {
      throw new TreeError(
        "找不到文件正文或文件已损坏，请使用包含文件的完整 ZIP 备份恢复",
      );
    }
  }
  async verify(ref: FileRef) {
    if (!validFileRef(ref) || (await this.info(ref.id)).chars !== ref.chars)
      throw new TreeError("文件引用与正文不一致");
  }
  private async finish(staging: string, chars: number): Promise<FileRef> {
    const ref = { id: crypto.randomUUID(), chars };
    await writeFile(path.join(staging, "meta.json"), JSON.stringify(ref));
    await rename(staging, this.location(ref.id));
    this.metadata.set(ref.id, ref);
    return ref;
  }
  async fromText(text: string) {
    const staging = await mkdtemp(path.join(this.directory, ".import-"));
    try {
      await writeFile(path.join(staging, "source"), text, "utf8");
      await writeFile(path.join(staging, "text.bin"), text, "utf16le");
      return await this.finish(staging, text.length);
    } finally {
      await rm(staging, { recursive: true, force: true });
    }
  }
  async importFile(source: string, ext: string, signal: AbortSignal) {
    const staging = await mkdtemp(path.join(this.directory, ".import-"));
    try {
      await rename(source, path.join(staging, "source"));
      signal.throwIfAborted();
      const chars = await new Promise<number>((resolve, reject) => {
        const worker = new Worker(
          new URL("./file-parser.mjs", import.meta.url),
          {
            workerData: {
              source: path.join(staging, "source"),
              output: path.join(staging, "text.bin"),
              ext,
            },
          },
        );
        let result: { chars?: number; error?: string } | undefined;
        const abort = () => {
          void worker.terminate();
        };
        signal.addEventListener("abort", abort, { once: true });
        worker.once("message", (value) => {
          result = value;
        });
        worker.once("error", reject);
        worker.once("exit", (code) => {
          signal.removeEventListener("abort", abort);
          if (signal.aborted) reject(new TreeError("文件导入已取消"));
          else if (
            code ||
            !result ||
            result.error ||
            !Number.isSafeInteger(result.chars)
          )
            reject(
              new TreeError(
                result?.error || "文件解析失败，请检查格式、编码和可用内存",
              ),
            );
          else resolve(result.chars!);
        });
      });
      return await this.finish(staging, chars);
    } finally {
      await rm(staging, { recursive: true, force: true });
    }
  }
  async read(ref: FileRef, offset: number, limit: number) {
    await this.verify(ref);
    if (
      !Number.isSafeInteger(offset) ||
      offset < 0 ||
      offset > ref.chars ||
      !Number.isSafeInteger(limit) ||
      limit < 1 ||
      limit > 20000
    )
      throw new TreeError("文件读取范围无效");
    const file = await open(path.join(this.location(ref.id), "text.bin"), "r");
    try {
      const buffer = Buffer.alloc(Math.min(limit, ref.chars - offset) * 2);
      let bytes = 0;
      while (bytes < buffer.length) {
        const result = await file.read(
          buffer,
          bytes,
          buffer.length - bytes,
          offset * 2 + bytes,
        );
        if (!result.bytesRead) throw new TreeError("文件正文不完整");
        bytes += result.bytesRead;
      }
      return buffer.toString("utf16le");
    } finally {
      await file.close();
    }
  }
  async search(ref: FileRef, query: string, signal?: AbortSignal) {
    let previous = "";
    for (let offset = 0; offset < ref.chars; offset += 20000) {
      signal?.throwIfAborted();
      const part = previous + (await this.read(ref, offset, 20000));
      const match = part.indexOf(query);
      if (match >= 0) return offset - previous.length + match;
      previous = query.length > 1 ? part.slice(-(query.length - 1)) : "";
    }
    return -1;
  }
}
