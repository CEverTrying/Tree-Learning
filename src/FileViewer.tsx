import { useEffect, useState } from "react";
import { ChevronLeft, ChevronRight, LoaderCircle } from "lucide-react";
import type { FileRef } from "./model";
import { api, IconButton } from "./ui";
import Markdown from "./Markdown";

export default function FileViewer({ fileRef }: { fileRef: FileRef }) {
  const [offset, setOffset] = useState(0);
  const [page, setPage] = useState<{
    content: string;
    next_offset: number | null;
  }>();
  const [error, setError] = useState("");
  useEffect(() => {
    const controller = new AbortController();
    setPage(undefined);
    setError("");
    void api<{ content: string; next_offset: number | null }>(
      `/api/documents/${fileRef.id}?offset=${offset}`,
      { signal: controller.signal },
    )
      .then(setPage)
      .catch((error) => {
        if (!controller.signal.aborted) setError(error.message);
      });
    return () => controller.abort();
  }, [fileRef.id, offset]);
  return (
    <div className="file-viewer">
      <div className="section-heading">
        <span>
          {offset + 1}–{Math.min(offset + 20000, fileRef.chars)} /{" "}
          {fileRef.chars.toLocaleString()} 字符
        </span>
        <div className="node-actions">
          <IconButton
            icon={ChevronLeft}
            label="上一段文件正文"
            disabled={!offset}
            onClick={() => setOffset(Math.max(0, offset - 20000))}
          />
          <IconButton
            icon={ChevronRight}
            label="下一段文件正文"
            disabled={!page || page.next_offset === null}
            onClick={() => setOffset(page!.next_offset!)}
          />
        </div>
      </div>
      {error ? (
        <p role="alert">{error}</p>
      ) : page ? (
        <Markdown>{page.content}</Markdown>
      ) : (
        <LoaderCircle className="spin" size={18} />
      )}
    </div>
  );
}
