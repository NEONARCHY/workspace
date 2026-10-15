// Synthetic, read-only renderer fixture. No API requests or employee records.
import { createRoot } from "react-dom/client";
import { useEffect, useState } from "react";
import { FluentProvider } from "@fluentui/react-components";
import { ReactionPicker, reactionEmojis } from "../src/renderer/ReactionPicker";
import { ReactionEmoji } from "../src/renderer/ReactionEmoji";
import { useQaTheme } from "./color-theme";
import "../src/renderer/styles.css";
import "../src/renderer/design-system.css";
import "../src/renderer/dark-theme.css";
import "../src/renderer/workspace-popups.css";
import "../src/renderer/satin-surfaces.css";

function Fixture() {
  const theme = useQaTheme();
  const [result, setResult] = useState("Нажмите «Измерить», затем откройте выбор реакций. Замер начнётся через 1 секунду.");
  const [run, setRun] = useState(0);
  useEffect(() => {
    if (!run) return;
    let frame = 0, last = 0, start = 0, activeMax = 0;
    const intervals: number[] = [];
    const tick = (now: number) => {
      if (!start) { start = now; last = now; }
      else { intervals.push(now - last); last = now; }
      activeMax = Math.max(activeMax, document.querySelectorAll('img[data-animated="true"]').length);
      if (now - start < 5000) frame = requestAnimationFrame(tick);
      else {
        const sorted = intervals.toSorted((a, b) => a - b);
        setResult(JSON.stringify({ frames: intervals.length, fps: +(1000 * intervals.length / (now - start)).toFixed(1),
          p95FrameMs: +sorted[Math.floor(sorted.length * .95)]!.toFixed(1),
          framesOver50ms: intervals.filter(value => value > 50).length, activeMax }));
      }
    };
    const timer = window.setTimeout(() => { frame = requestAnimationFrame(tick); }, 1000);
    return () => { clearTimeout(timer); cancelAnimationFrame(frame); };
  }, [run]);
  return <FluentProvider theme={theme} className="app-provider" style={{ minHeight: "100dvh", padding: 24, background: "var(--ws-canvas)", color: "var(--ws-text)" }}>
    <h1>Анимированные реакции</h1>
    <p>Настоящий общий компонент; одновременно видимые реакции и открытый выбор.</p>
    <button onClick={() => { setResult("Измерение…"); setRun(value => value + 1); }}>Измерить 5 секунд</button>
    <output aria-label="Результат замера" style={{ display: "block", marginBlock: 12, overflowWrap: "anywhere" }}>{result}</output>
    <ReactionPicker userId="qa-animation" onSelect={emoji => setResult(`Выбрана реакция ${emoji}`)} />
    <div style={{ display: "grid", gridTemplateColumns: "repeat(8, minmax(0, 1fr))", width: "min(344px, 100%)", gap: 8, marginTop: 16, maxHeight: 300, overflow: "auto" }}>
      {reactionEmojis.map(emoji => <span key={emoji} aria-label={emoji} style={{ display: "grid", placeItems: "center", height: 36 }}><ReactionEmoji emoji={emoji} size={28} /></span>)}
    </div>
  </FluentProvider>;
}
createRoot(document.getElementById("root")!).render(<Fixture />);
