function elementOf(node: Node | null): Element | null {
  return node instanceof Element ? node : node?.parentElement ?? null;
}

function formulaOf(node: Node | null): Element | null {
  return elementOf(node)?.closest(".katex-display, .katex")?.closest(".katex-display")
    ?? elementOf(node)?.closest(".katex") ?? null;
}

// KaTeX renders both MathML and HTML. Copy its original TeX once, not the
// duplicated visual glyphs. A partially selected formula is copied whole.
export function markdownSelection(selection: Selection | null): { text: string; hasMath: boolean } {
  if (!selection || selection.isCollapsed || !selection.rangeCount)
    return { text: "", hasMath: false };
  const range = selection.getRangeAt(0).cloneRange();
  const startFormula = formulaOf(range.startContainer);
  const endFormula = formulaOf(range.endContainer);
  if (startFormula) range.setStartBefore(startFormula);
  if (endFormula) range.setEndAfter(endFormula);
  const fragment = range.cloneContents();
  let hasMath = false;
  for (const formula of fragment.querySelectorAll(".katex-display, .katex")) {
    if (!fragment.contains(formula)) continue;
    const tex = formula.querySelector('annotation[encoding="application/x-tex"]')?.textContent;
    if (tex === undefined || tex === null) continue;
    hasMath = true;
    const markdown = formula.classList.contains("katex-display")
      ? `\n\n$$\n${tex.trim()}\n$$\n\n`
      : `$${tex.trim()}$`;
    formula.replaceWith(document.createTextNode(markdown));
  }
  if (!hasMath) return { text: selection.toString(), hasMath: false };
  const blocks = new Set(["P", "DIV", "SECTION", "H1", "H2", "H3", "H4", "H5", "H6", "BLOCKQUOTE", "PRE", "UL", "OL", "TABLE", "TR"]);
  const serialize = (node: Node): string => {
    if (node.nodeType === Node.TEXT_NODE) return node.textContent ?? "";
    if (node instanceof Element && node.tagName === "BR") return "\n";
    const content = [...node.childNodes].map(serialize).join("");
    if (node instanceof Element && blocks.has(node.tagName)) return `\n\n${content}\n\n`;
    if (node instanceof Element && node.tagName === "LI") return `\n- ${content}\n`;
    return content;
  };
  return { text: serialize(fragment).replace(/\n{3,}/g, "\n\n").trim(), hasMath };
}

export function copyMathSelection(event: ClipboardEvent) {
  if (event.defaultPrevented || !event.clipboardData) return;
  if (elementOf(event.target as Node)?.closest("input, textarea, [contenteditable='true']")) return;
  const selection = window.getSelection();
  if (!elementOf(selection?.anchorNode ?? null)?.closest(".markdown") ||
      !elementOf(selection?.focusNode ?? null)?.closest(".markdown")) return;
  const { text, hasMath } = markdownSelection(selection);
  if (!hasMath) return;
  event.clipboardData.setData("text/plain", text);
  event.preventDefault();
}
