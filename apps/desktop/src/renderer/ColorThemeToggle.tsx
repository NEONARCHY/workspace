import { WorkspaceNotice } from "./WorkspaceNotice";
import { useRef, useState } from "react";
import { flushSync } from "react-dom";
import { Button, Tooltip } from "@fluentui/react-components";
import { DarkTheme20Regular, WeatherSunny20Regular } from "@fluentui/react-icons";
import { transitionColorTheme, useColorTheme, type ColorTheme } from "./color-theme";

export function ColorThemeToggle({ userId }: { readonly userId: string }) {
  const { theme, setPreference } = useColorTheme(userId);
  const target = useRef<ColorTheme | undefined>(undefined);
  const [notice, setNotice] = useState("");
  const label = theme === "dark" ? "Включить светлую тему" : "Включить тёмную тему";
  return <div className="color-theme-toggle-wrap">
    <Tooltip content={label} relationship="description"><Button className="color-theme-toggle" appearance="subtle"
      aria-label={label} icon={theme === "dark" ? <WeatherSunny20Regular /> : <DarkTheme20Regular />}
      onClick={event => {
        const bounds = event.currentTarget.getBoundingClientRect();
        const next = (target.current ?? theme) === "dark" ? "light" : "dark";
        target.current = next;
        void transitionColorTheme(() => flushSync(() => {
          target.current = undefined;
          setNotice(setPreference(next) ? "" : "Тема применена, но сохранить выбор не удалось. После перезапуска он может сброситься.");
        }), { x: bounds.left + bounds.width / 2, y: bounds.top + bounds.height / 2 });
      }} /></Tooltip>
    {notice && <WorkspaceNotice tone="warning" className="color-theme-save-notice" role="status" actions={<><Button appearance="subtle" onClick={() => setNotice("")}>Закрыть</Button></>}>{notice}</WorkspaceNotice>}
  </div>;
}
