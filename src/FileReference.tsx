import { FileText } from "lucide-react";

export default function FileReference({
  name,
  chars,
}: {
  name: string;
  chars: number;
}) {
  return (
    <div className="file-reference" aria-label="引用文件">
      <FileText size={20} aria-hidden="true" />
      <div>
        <strong>{name}</strong>
        <span>已引用 · {chars.toLocaleString()} 字符</span>
      </div>
    </div>
  );
}
