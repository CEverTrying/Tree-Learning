import { workerData, parentPort } from "node:worker_threads";
import { createRequire } from "node:module";
import { createReadStream } from "node:fs";
import { open, readFile } from "node:fs/promises";
const require = createRequire(import.meta.url);
const { source, output, ext } = workerData;
let chars = 0;
let hasText = false;
const handle = await open(output, "w");
async function write(text) {
  chars += text.length;
  hasText ||= /\S/.test(text);
  await handle.writeFile(Buffer.from(text, "utf16le"));
}
try {
  if (ext === "pdf") {
    const pdf = require("pdf-parse/lib/pdf.js/v1.10.100/build/pdf.js");
    pdf.disableWorker = true;
    const doc = await pdf.getDocument(await readFile(source));
    try {
      for (let i = 1; i <= doc.numPages; i++) {
        const page = await doc.getPage(i);
        const content = await page.getTextContent({
          normalizeWhitespace: false,
          disableCombineTextItems: false,
        });
        let y;
        let text = "";
        for (const item of content.items) {
          if (y !== undefined && y !== item.transform[5]) text += "\n";
          text += item.str;
          y = item.transform[5];
        }
        await write((i > 1 ? "\n\n" : "") + text);
        page.cleanup();
      }
    } finally {
      doc.destroy();
    }
  } else if (ext === "docx") {
    const mammoth = require("mammoth");
    await write((await mammoth.extractRawText({ path: source })).value);
  } else {
    const decoder = new TextDecoder("utf-8", { fatal: true });
    for await (const chunk of createReadStream(source))
      await write(decoder.decode(chunk, { stream: true }));
    await write(decoder.decode());
  }
  if (!hasText) throw new Error("没有可提取的文字，扫描版 PDF 请先进行 OCR");
  parentPort.postMessage({ chars });
} catch (error) {
  parentPort.postMessage({ error: error.message || "文件解析失败" });
} finally {
  await handle.close();
}
