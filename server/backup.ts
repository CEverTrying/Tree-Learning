import { createWriteStream } from "node:fs";
import {
  mkdir,
  mkdtemp,
  readFile,
  rename,
  rm,
  writeFile,
} from "node:fs/promises";
import { pipeline } from "node:stream/promises";
import path from "node:path";
import { ZipFile } from "yazl";
import { open as openZip, type ZipFile as ReadZip, type Entry } from "yauzl";
import { Documents } from "./documents";
import {
  validateTree,
  TreeError,
  type TreeData,
  type FileRef,
} from "../src/model";

export async function backup(data: TreeData, documents: Documents) {
  const refs = new Map(
    data.nodes.flatMap((node) =>
      node.fileRef ? [[node.fileRef.id, node.fileRef] as const] : [],
    ),
  );
  for (const ref of refs.values()) await documents.verify(ref);
  const zip = new ZipFile();
  zip.addBuffer(Buffer.from(JSON.stringify(data)), "tree.json");
  for (const id of refs.keys())
    for (const name of ["meta.json", "text.bin", "source"])
      zip.addFile(
        path.join(documents.location(id), name),
        `documents/${id}/${name}`,
      );
  return zip;
}

export async function restoreBackup(file: string, documents: Documents) {
  const staging = await mkdtemp(path.join(documents.directory, ".restore-"));
  const installed: string[] = [];
  try {
    const zip = await new Promise<ReadZip>((resolve, reject) =>
      openZip(
        file,
        { lazyEntries: true, validateEntrySizes: true },
        (error, value) => (error ? reject(error) : resolve(value!)),
      ),
    );
    await new Promise<void>((resolve, reject) => {
      const seen = new Set<string>();
      const fail = (error: unknown) => {
        zip.close();
        reject(error);
      };
      zip.on("error", fail);
      zip.on("end", resolve);
      zip.on("entry", (entry: Entry) => {
        void (async () => {
          const name = entry.fileName;
          if (
            seen.size > 30000 ||
            seen.has(name) ||
            !(
              name === "tree.json" ||
              /^documents\/[a-f0-9-]{36}\/(?:meta\.json|text\.bin|source)$/.test(
                name,
              )
            )
          )
            throw new TreeError("备份包含重复或不支持的文件路径");
          if (
            (name === "tree.json" &&
              entry.uncompressedSize > 40 * 1024 * 1024) ||
            (name.endsWith("/meta.json") && entry.uncompressedSize > 4096)
          )
            throw new TreeError("备份的树或文件元数据过长");
          seen.add(name);
          const target = path.join(staging, name);
          await mkdir(path.dirname(target), { recursive: true });
          const stream = await new Promise<import("node:stream").Readable>(
            (resolve, reject) =>
              zip.openReadStream(entry, (error, stream) =>
                error ? reject(error) : resolve(stream!),
              ),
          );
          await pipeline(stream, createWriteStream(target, { flags: "wx" }));
          zip.readEntry();
        })().catch(fail);
      });
      zip.readEntry();
    });
    const data: unknown = JSON.parse(
      await readFile(path.join(staging, "tree.json"), "utf8"),
    );
    validateTree(data);
    const imported = new Documents(staging);
    const refs = new Map(
      data.nodes.flatMap((node) =>
        node.fileRef ? [[node.fileRef.id, node.fileRef] as const] : [],
      ),
    );
    for (const ref of refs.values()) await imported.verify(ref);
    const replacements = new Map<string, FileRef>();
    // Fresh IDs keep restored files from overwriting existing immutable files.
    for (const ref of refs.values()) {
      const next = { ...ref, id: crypto.randomUUID() };
      await writeFile(
        path.join(imported.location(ref.id), "meta.json"),
        JSON.stringify(next),
      );
      await rename(imported.location(ref.id), documents.location(next.id));
      installed.push(next.id);
      replacements.set(ref.id, next);
    }
    for (const node of data.nodes)
      if (node.fileRef) node.fileRef = replacements.get(node.fileRef.id)!;
    return data;
  } catch (error) {
    for (const id of installed)
      await rm(documents.location(id), { recursive: true, force: true });
    throw error instanceof TreeError
      ? error
      : new TreeError("备份无法读取或文件不完整，原学习树未改变");
  } finally {
    await rm(staging, { recursive: true, force: true });
  }
}
