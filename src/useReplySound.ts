import { useEffect, useRef } from "react";

export default function useReplySound() {
  const audio = useRef<AudioContext | null>(null);
  useEffect(() => {
    // Unlock audio during user interaction so delayed replies can play a tone.
    const unlock = () => {
      try {
        audio.current ??= new AudioContext();
        if (audio.current.state === "suspended")
          void audio.current.resume().catch(() => {});
      } catch {
        /* Audio may be unavailable; answering must remain usable. */
      }
    };
    document.addEventListener("pointerdown", unlock);
    document.addEventListener("keydown", unlock);
    return () => {
      document.removeEventListener("pointerdown", unlock);
      document.removeEventListener("keydown", unlock);
      const context = audio.current;
      audio.current = null;
      if (context && context.state !== "closed")
        void context.close().catch(() => {});
    };
  }, []);
  return () => {
    const context = audio.current;
    if (!context || context.state === "closed") return;
    void (async () => {
      try {
        if (context.state === "suspended") await context.resume();
        if (context.state !== "running") return;
        const oscillator = context.createOscillator();
        const gain = context.createGain();
        const start = context.currentTime;
        oscillator.type = "sine";
        oscillator.frequency.setValueAtTime(660, start);
        oscillator.frequency.setValueAtTime(880, start + 0.12);
        gain.gain.setValueAtTime(0, start);
        gain.gain.linearRampToValueAtTime(0.12, start + 0.015);
        gain.gain.linearRampToValueAtTime(0, start + 0.3);
        oscillator.connect(gain);
        gain.connect(context.destination);
        oscillator.onended = () => {
          oscillator.disconnect();
          gain.disconnect();
        };
        oscillator.start(start);
        oscillator.stop(start + 0.31);
      } catch {
        /* Sound failure must not change a successful reply. */
      }
    })();
  };
}
