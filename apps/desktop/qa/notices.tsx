// Synthetic presentation and local button state only; no API calls.
import { useState } from "react";
import { createRoot } from "react-dom/client";
import { Button, FluentProvider } from "@fluentui/react-components";
import { Dismiss20Regular } from "@fluentui/react-icons";
import { WorkspaceNotice } from "../src/renderer/WorkspaceNotice";
import { useQaTheme } from "./color-theme";
import "../src/renderer/styles.css";
import "../src/renderer/design-system.css";
import "../src/renderer/dark-theme.css";
import "../src/renderer/satin-surfaces.css";
import "./notices.css";

function Fixture() {
  const theme = useQaTheme();
  const [retried, setRetried] = useState(false);
  const [visible, setVisible] = useState(true);
  return <FluentProvider theme={theme} className="app-provider">
    <main className="notice-qa">
      <header><h1>Контекстные сообщения</h1><p>Общий стиль коротких подсказок и обратной связи</p></header>
      <section aria-label="Варианты сообщений">
        <WorkspaceNotice>Поездок пока нет. Создайте первую командировку — она появится в колонке «Запуск».</WorkspaceNotice>
        <WorkspaceNotice tone="success">Изменения сохранены. Можно продолжить работу.</WorkspaceNotice>
        <WorkspaceNotice tone="warning">Ваша должность не может создавать заявки на оплату.</WorkspaceNotice>
        {visible ? <WorkspaceNotice tone="error" actions={<>
          <Button onClick={() => setRetried(true)}>Повторить</Button>
          <Button appearance="subtle" icon={<Dismiss20Regular />} aria-label="Скрыть сообщение" onClick={() => setVisible(false)} />
        </>}>{retried ? "Повторная проверка запрошена." : "Не удалось загрузить данные. Проверьте подключение и повторите попытку."}</WorkspaceNotice> : null}
        <WorkspaceNotice tone="warning"><strong>Данные временно недоступны</strong><span>Показаны последние загруженные сведения. Длинный текст переносится внутри плашки и не вытесняет кнопки за край экрана.</span></WorkspaceNotice>
      </section>
    </main>
  </FluentProvider>;
}
createRoot(document.getElementById("root")!).render(<Fixture />);
