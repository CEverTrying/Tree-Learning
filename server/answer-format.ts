import { ModelProtocolError } from "./model-api";

export const answerInstructions = `请在完成必要的文件阅读后，将最终回复输出为一个 JSON 对象，且仅包含 title 和 answer 两个字符串字段。title 是对当前用户问题的简短概括，用作学习树节点名称：沿用问题的语言，不超过 20 个字符，不加前缀、引号或 Markdown；结合祖先上下文消解“这个”等指代，但概括问题本身，不概括答案。answer 是完整回复正文，可使用 Markdown 和数学公式。必须遵守 JSON 字符串转义规则：正文换行写成 \\n，双引号写成 \\"，数学公式中的每个反斜杠写成两个反斜杠，例如 \\\\frac、\\\\text、\\\\[。不要在 JSON 对象外添加文字或代码围栏。`;

// These TeX commands begin with valid JSON escapes and would otherwise silently
// become tabs, newlines or control characters when repairing a malformed envelope.
const ambiguousTexCommands = new Set([
  "begin", "big", "Big", "bigg", "Bigg", "bigl", "bigr", "binom", "boldsymbol",
  "boxed", "bar", "beta", "bullet", "backslash", "frac", "forall",
  "right", "rangle", "rho", "rightarrow", "Rightarrow", "rfloor", "rceil",
  "text", "textbf", "textit", "textrm", "theta", "times", "tau", "tan",
  "tanh", "tilde", "to", "top", "triangle", "underbrace", "underline",
  "nabla", "neq", "ne", "nu", "not", "notin", "neg", "newline",
]);

function repairStringEscapes(text: string): string {
  let result = "";
  let inString = false;
  for (let i = 0; i < text.length; i++) {
    const char = text[i];
    if (char === '"') inString = !inString;
    if (inString && char === "\\") {
      const next = text[i + 1];
      const command = /^[a-zA-Z]+/.exec(text.slice(i + 1))?.[0];
      const unicode = next === "u" && /^[0-9a-fA-F]{4}/.test(text.slice(i + 2));
      if (
        (command && ambiguousTexCommands.has(command)) ||
        (!unicode && !['"', "\\", "/", "b", "f", "n", "r", "t"].includes(next))
      ) {
        result += "\\\\";
      } else {
        result += char + next;
        i++;
      }
    } else if (inString && char.charCodeAt(0) < 32) {
      result += JSON.stringify(char).slice(1, -1);
    } else {
      result += char;
    }
  }
  return result;
}

export function parseAnswer(content: string): {
  answer: string;
  title?: string;
} {
  const text = content.trim();
  const fenced = /^```(?:json)?\s*([\s\S]*?)\s*```$/i.exec(text);
  const source = fenced ? fenced[1] : text;
  const isEnvelope = /^\{\s*"(?:title|answer)"\s*:/.test(source);
  let value: unknown;
  try {
    value = JSON.parse(source);
  } catch {
    if (isEnvelope) {
      try {
        value = JSON.parse(repairStringEscapes(source));
      } catch {
        throw new ModelProtocolError("模型回复格式不完整或无法解析，请重新生成；原回复保留。");
      }
    }
  }
  if (
    value &&
    typeof value === "object" &&
    "title" in value &&
    "answer" in value &&
    typeof value.title === "string" &&
    typeof value.answer === "string" &&
    value.answer.trim()
  ) {
    const title = [...value.title.trim().replace(/\s+/g, " ")]
      .slice(0, 24)
      .join("");
    return { answer: value.answer, ...(title ? { title } : {}) };
  }
  if (isEnvelope)
    throw new ModelProtocolError("模型回复缺少有效的标题或正文，请重新生成；原回复保留。");
  return { answer: content };
}
