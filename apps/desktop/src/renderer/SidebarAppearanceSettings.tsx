import { useState } from "react";
import { useSidebarTheme, type SidebarTheme } from "./sidebar-theme";

const choices: readonly { readonly value: SidebarTheme; readonly label: string }[] = [
  { value: "blue-teal", label: "Сине-бирюзовый" },
  { value: "navy", label: "Тёмно-синий" },
  { value: "light", label: "Светлый" },
];

export function SidebarAppearanceSettings({ userId }: { readonly userId: string }) {
  const { theme, setTheme } = useSidebarTheme(userId);
  const [notice, setNotice] = useState("");
  return <section className="account-section" data-account-section="appearance">
    <div className="account-section-title"><div>
      <h3>Цвет бокового меню</h3>
      <p>Применяется сразу. Ваш выбор сохраняется в этом браузере или приложении.</p>
    </div></div>
    <div className="sidebar-theme-choices" role="group" aria-label="Цвет бокового меню">
      {choices.map(choice => <button type="button" key={choice.value}
        className="sidebar-theme-choice" aria-pressed={theme === choice.value}
        onClick={() => setNotice(setTheme(choice.value) ? "" : "Цвет применён, но не удалось сохранить выбор. После перезапуска он может сброситься.")}>
        <span className="sidebar-theme-swatch sidebar-palette" data-sidebar-theme={choice.value} aria-hidden="true">
          <i /><i /><i />
        </span>
        <span>{choice.label}{choice.value === "blue-teal" && <small> По умолчанию</small>}</span>
      </button>)}
    </div>
    {notice && <p role="status">{notice}</p>}
  </section>;
}
