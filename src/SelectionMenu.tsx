import { useEffect, useLayoutEffect, useRef, useState, type ReactNode } from "react";
import { createPortal } from "react-dom";
import { Copy, Quote } from "lucide-react";

export function SelectionMenu({ children, quote, onError }: {
  children: ReactNode;
  quote: (text: string) => void;
  onError: (message: string) => void;
}) {
  const [menu, setMenu] = useState<{ text: string; left: number; top: number; bottom: number } | null>(null);
  const menuRef = useRef<HTMLDivElement>(null);
  useLayoutEffect(() => {
    if (!menu || !menuRef.current) return;
    const element = menuRef.current;
    const { width, height } = element.getBoundingClientRect();
    const below = menu.bottom + 6;
    const top = below + height <= window.innerHeight - 8 ? below : menu.top - height - 6;
    element.style.left = `${Math.max(8, Math.min(menu.left, window.innerWidth - width - 8))}px`;
    element.style.top = `${Math.max(8, Math.min(top, window.innerHeight - height - 8))}px`;
  }, [menu]);
  useEffect(() => {
    if (!menu) return;
    menuRef.current?.querySelector<HTMLButtonElement>("button")?.focus({ preventScroll: true });
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
      const rects = [...selection!.getRangeAt(0).getClientRects()]
        .filter((rect) => rect.width > 0 && rect.height > 0 && rect.bottom > 0 && rect.top < window.innerHeight);
      if (!rects.length) return;
      // For multiline selections, anchor to the selected line nearest the click.
      const distance = (rect: DOMRect) => Math.max(rect.top - event.clientY, event.clientY - rect.bottom, 0);
      const anchor = rects.reduce((nearest, rect) => distance(rect) < distance(nearest) ? rect : nearest);
      setMenu({ text, left: anchor.left, top: anchor.top, bottom: anchor.bottom });
    }}>
      {children}
      {menu && createPortal(<div ref={menuRef} className="selection-menu" role="menu" aria-label="选中文字操作"
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
      </div>, document.body)}
    </div>
  );
}
