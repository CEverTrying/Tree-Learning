import { unified } from "unified";
import remarkParse from "remark-parse";
import remarkMath from "remark-math";
import { visit } from "unist-util-visit";

const parser = unified().use(remarkParse).use(remarkMath);
const protectedTypes = new Set([
  "code",
  "inlineCode",
  "math",
  "inlineMath",
  "html",
  "link",
  "image",
]);

// Normalize LaTeX delimiters before Markdown unescapes them, preserving code and links.
export function normalizeMathDelimiters(source: string): string {
  if (!source.includes("\\(") && !source.includes("\\[")) return source;
  const protectedRanges: { start: number; end: number }[] = [];
  visit(parser.parse(source), (node) => {
    const start = node.position?.start.offset;
    const end = node.position?.end.offset;
    if (
      protectedTypes.has(node.type) &&
      start !== undefined &&
      end !== undefined
    )
      protectedRanges.push({ start, end });
  });
  return source.replace(
    /(?<!\\)\\\(([\s\S]*?)(?<!\\)\\\)|(?<!\\)\\\[([\s\S]*?)(?<!\\)\\\]/g,
    (
      match: string,
      inline: string | undefined,
      display: string | undefined,
      offset: number,
    ) => {
      const end = offset + match.length;
      if (
        protectedRanges.some((range) => offset < range.end && end > range.start)
      )
        return match;
      if (inline !== undefined) return `$${inline.trim()}$`;
      const lineStart = source.lastIndexOf("\n", offset - 1) + 1;
      const before = source.slice(lineStart, offset);
      const indentation = before.match(/^[ \t]*/)?.[0] || "";
      const nextNewline = source.indexOf("\n", end);
      const after = source.slice(
        end,
        nextNewline < 0 ? source.length : nextNewline,
      );
      const formula = display!
        .trim()
        .split("\n")
        .map((line) => indentation + line.trimStart())
        .join("\n");
      return `${before.trim() ? "\n\n" : ""}$$\n${formula}\n${indentation}$$${after.trim() ? "\n\n" : ""}`;
    },
  );
}
