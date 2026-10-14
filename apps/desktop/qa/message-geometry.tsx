import { useEffect, useRef, useState } from "react";
import { createRoot } from "react-dom/client";
import { FluentProvider } from "@fluentui/react-components";
import type { WorkspaceAttachment } from "@yuksalish/contracts";
import { workspaceTheme } from "../src/renderer/workspace-theme";
import { MessageTextAnimate } from "../src/renderer/MessageTextAnimate";
import { AttachmentChips } from "../src/renderer/AttachmentPanel";
import { WorkspaceDateTimePicker } from "../src/renderer/WorkspaceDateTimePicker";
import "../src/renderer/styles.css";
import "../src/renderer/design-system.css";
import "../src/renderer/message-layout.css";
import "../src/renderer/workspace-2-messenger.css";
import "../src/renderer/workspace-inputs.css";
import "../src/renderer/dark-theme.css";
import "../src/renderer/satin-surfaces.css";

const text = "авыавываа".repeat(16);
const attachment = { id: "qa-photo", ownerType: "message", ownerId: "qa", fileName: "image.png", contentType: "image/png", byteSize: 1024 } as WorkspaceAttachment;
const loadImage = async () => {
  const canvas = document.createElement("canvas"); canvas.width = 720; canvas.height = 320;
  const context = canvas.getContext("2d")!; context.fillStyle = "#34525a"; context.fillRect(0, 0, 720, 320);
  context.fillStyle = "white"; context.font = "32px sans-serif"; context.fillText("Предпросмотр без пустых полей", 30, 170);
  return new Promise<Blob>(resolve => canvas.toBlob(blob => resolve(blob!), "image/png"));
};
function Fixture() {
  const ref = useRef<HTMLDivElement>(null);
  const [result, setResult] = useState("Проверка…");
  const [time, setTime] = useState("2026-10-14T19:01");
  useEffect(() => {
    const before = ref.current!.getBoundingClientRect().height;
    const timer = setTimeout(() => {
      const after = ref.current!.getBoundingClientRect().height;
      setResult(`Высота во время анимации: ${before}px; после: ${after}px; ${Math.abs(before - after) < .5 ? "PASS" : "FAIL"}`);
    }, 1100);
    return () => clearTimeout(timer);
  }, []);
  return <FluentProvider theme={workspaceTheme} className="app-provider" style={{ minHeight: "100vh", padding: 32 }}>
    <h1>Геометрия сообщений</h1><output>{result}</output>
    <div className="messenger-view" style={{ display: "block", width: 650, maxWidth: "100%", marginTop: 24 }}>
      <div className="message own"><div className="message-content"><div ref={ref} className="message-body"><p className="message-text"><MessageTextAnimate enabled disabled={false}>{text}</MessageTextAnimate></p><span className="message-meta">14:48 ✓</span></div></div></div>
      <div className="message own"><div className="message-content"><div className="message-body has-rich-content has-attachments"><AttachmentChips attachments={[attachment]} onDownload={() => {}} onLoad={loadImage} /><span className="message-meta">14:47 ✓</span></div></div></div>
    </div>
    <WorkspaceDateTimePicker aria-label="Тестовый срок" value={time} onChange={setTime} />
  </FluentProvider>;
}
createRoot(document.getElementById("root")!).render(<Fixture />);
