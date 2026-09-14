export const answerInstructions = `请在完成必要的文件阅读后，将最终回复输出为一个 JSON 对象，且仅包含 title 和 answer 两个字符串字段。title 是对当前用户问题的简短概括，用作学习树节点名称：沿用问题的语言，不超过 20 个字符，不加前缀、引号或 Markdown；结合祖先上下文消解“这个”等指代，但概括问题本身，不概括答案。answer 是完整回复正文，可使用 Markdown 和数学公式。不要在 JSON 对象外添加文字或代码围栏。`;

export function parseAnswer(content: string): {
  answer: string;
  title?: string;
} {
  const text = content.trim();
  const fenced = /^```(?:json)?\s*([\s\S]*?)\s*```$/i.exec(text);
  try {
    const value: unknown = JSON.parse(fenced ? fenced[1] : text);
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
  } catch {
    // Compatible providers may ignore the requested response envelope.
  }
  return { answer: content };
}
