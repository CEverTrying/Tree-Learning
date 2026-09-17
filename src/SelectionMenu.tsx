import { useEffect, useRef, useState, type ReactNode } from "react";
import { Copy, Quote } from "lucide-react";

export function SelectionMenu({ children, quote, onError }: {
  children: ReactNode;
  quote: (text: string) => void;
  onError: (message: string) => void;
}) {
  const [menu, setMenu] = useState<{ text: string; x: number; y: number } | null>(null);
  const menuRef = useRef<HTMLDivElement>(null);
  useEffect(() => {
    if (!menu) return;
    menuRef.current?.querySelector<HTMLButtonElement>("button")?.focus();
    const dismiss = () => setMenu(null);
    const outside = (event: PointerEvent) => {
      if (!menuRef.current?.contains(event.target as Node)) dismiss();
    };
    document.addEventListener("pointerdown", outside);
    window.addEventListener("resize", dismiss);
    document.addEventListener("scroll", dismiss, true);
    return () => {
      document.removeEventListener("pointerdown", outside);
      window.removeEventListener("resize", dismiss);
      document.removeEventListener("scroll", dismiss, true);
    };
  }, [menu]);
  return (
    <div className="conversation" onContextMenu={(event) => {
      const selection = window.getSelection();
      const text = selection?.toString().trim();
      const section = (node: Node | null) =>
        (node instanceof Element ? node : node?.parentElement)?.closest(".question-section, .answer-section");
      const start = section(selection?.anchorNode ?? null);
      const end = section(selection?.focusNode ?? null);
      const target = section(event.target as Node);
      if (!text || !start || !end || !target ||
          !event.currentTarget.contains(start) || !event.currentTarget.contains(end)) {
        setMenu(null);
        return;
      }
      event.preventDefault();
      setMenu({ text, x: Math.max(8, Math.min(event.clientX, window.innerWidth - 208)),
        y: Math.max(8, Math.min(event.clientY, window.innerHeight - 96)) });
    }}>
      {children}
      {menu && <div ref={menuRef} className="selection-menu" role="menu" aria-label="选中文字操作"
        style={{ left: menu.x, top: menu.y }}
        onContextMenu={(event) => { event.preventDefault(); event.stopPropagation(); }}
        onKeyDown={(event) => {
          if (event.key === "Escape" || event.key === "Tab") setMenu(null);
          if (["ArrowDown", "ArrowUp"].includes(event.key)) {
            event.preventDefault();
            const buttons = [...menuRef.current!.querySelectorAll("button")];
            const index = buttons.indexOf(document.activeElement as HTMLButtonElement);
            buttons[(index + 1) % buttons.length]?.focus();
          }
        }}>
        <button type="button" role="menuitem" onClick={() => { quote(menu.text); setMenu(null); }}>
          <Quote size={16} />引用到对话
        </button>
        <button type="button" role="menuitem" onClick={() => {
          void navigator.clipboard.writeText(menu.text).catch(() => onError("复制失败，请重试"));
          setMenu(null);
        }}><Copy size={16} />复制</button>
      </div>}
    </div>
  );
}
