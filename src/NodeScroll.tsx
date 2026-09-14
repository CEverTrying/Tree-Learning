import { useEffect, useLayoutEffect, useRef, type ReactNode } from "react";
import { readLocal, writeLocal } from "./local-state";

export default function NodeScroll({
  nodeId,
  parentId,
  disabled,
  onParent,
  children,
}: {
  nodeId: string;
  parentId: string | null;
  disabled: boolean;
  onParent: (id: string) => void;
  children: ReactNode;
}) {
  const element = useRef<HTMLDivElement>(null);
  useLayoutEffect(() => {
    const pane = element.current!;
    const positions = readLocal<Record<string, number>>(
      "treelearning-scroll",
      {},
    );
    pane.scrollTop = Number(positions[nodeId]) || 0;
    const remember = () => {
      const entries = readLocal<Record<string, number>>(
        "treelearning-scroll",
        {},
      );
      entries[nodeId] = pane.scrollTop;
      writeLocal("treelearning-scroll", entries);
    };
    pane.addEventListener("scroll", remember, { passive: true });
    return () => {
      pane.removeEventListener("scroll", remember);
    };
  }, [nodeId]);
  const navigate = useRef(onParent);
  navigate.current = onParent;
  const wheel = useRef({ last: 0, distance: 0, count: 0, locked: false });

  useEffect(() => {
    const pane = element.current!;
    wheel.current.distance = 0;
    wheel.current.count = 0;
    let touch: { x: number; y: number; distance: number } | null = null;
    function canLeave(target: EventTarget | null) {
      if (disabled || !parentId || pane.scrollTop > 1) return false;
      let child = target instanceof Element ? target : null;
      while (child && child !== pane) {
        if (child.matches("input, textarea, select, [contenteditable='true']"))
          return false;
        if (child.scrollTop > 0 && child.scrollHeight > child.clientHeight)
          return false;
        child = child.parentElement;
      }
      return true;
    }
    function onWheel(event: WheelEvent) {
      const state = wheel.current;
      const time = performance.now();
      if (time - state.last > 350) {
        state.distance = 0;
        state.count = 0;
        state.locked = false;
      }
      state.last = time;
      if (
        event.ctrlKey ||
        Math.abs(event.deltaX) >= Math.abs(event.deltaY) ||
        event.deltaY >= 0 ||
        !canLeave(event.target)
      ) {
        state.distance = 0;
        state.count = 0;
        return;
      }
      if (event.cancelable) event.preventDefault();
      if (state.locked) return;
      const unit =
        event.deltaMode === 1
          ? 16
          : event.deltaMode === 2
            ? pane.clientHeight
            : 1;
      state.distance += -event.deltaY * unit;
      state.count++;
      if (state.count >= 2 && state.distance >= 180) {
        // Keep the lock across node changes until the wheel gesture ends.
        state.locked = true;
        navigate.current(parentId!);
      }
    }
    function onTouchStart(event: TouchEvent) {
      touch =
        event.touches.length === 1
          ? {
              x: event.touches[0].clientX,
              y: event.touches[0].clientY,
              distance: 0,
            }
          : null;
    }
    function onTouchMove(event: TouchEvent) {
      if (!touch || event.touches.length !== 1) {
        touch = null;
        return;
      }
      const point = event.touches[0];
      const dy = point.clientY - touch.y;
      const dx = point.clientX - touch.x;
      touch.x = point.clientX;
      touch.y = point.clientY;
      if (dy <= 0 || Math.abs(dx) >= dy || !canLeave(event.target)) {
        touch.distance = 0;
        return;
      }
      if (event.cancelable) event.preventDefault();
      touch.distance += dy;
      if (touch.distance >= 90) {
        touch = null;
        navigate.current(parentId!);
      }
    }
    function onTouchEnd() {
      touch = null;
    }
    pane.addEventListener("wheel", onWheel, { passive: false });
    pane.addEventListener("touchstart", onTouchStart, { passive: true });
    pane.addEventListener("touchmove", onTouchMove, { passive: false });
    pane.addEventListener("touchend", onTouchEnd);
    pane.addEventListener("touchcancel", onTouchEnd);
    return () => {
      pane.removeEventListener("wheel", onWheel);
      pane.removeEventListener("touchstart", onTouchStart);
      pane.removeEventListener("touchmove", onTouchMove);
      pane.removeEventListener("touchend", onTouchEnd);
      pane.removeEventListener("touchcancel", onTouchEnd);
    };
  }, [nodeId, parentId, disabled]);

  return (
    <div className="node-scroll" key={nodeId} ref={element}>
      {children}
    </div>
  );
}
