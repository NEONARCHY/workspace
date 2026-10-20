import { useRef, useState, type ReactNode } from "react";
import { flushSync } from "react-dom";
import { DarkTheme24Regular, WeatherSunny24Regular, Desktop24Regular } from "@fluentui/react-icons";
import { transitionColorTheme, useColorTheme, type ColorThemePreference } from "./color-theme";

const choices = [
  { value: "light", label: "Светлая", description: "Лёгкость и спокойные акценты", icon: <WeatherSunny24Regular /> },
  { value: "dark", label: "Тёмная", description: "Графитовые поверхности и мягкий свет", icon: <DarkTheme24Regular /> },
  { value: "system", label: "Как в системе", description: "Следовать настройке устройства", icon: <Desktop24Regular /> },
] satisfies readonly { value: ColorThemePreference; label: string; description: string; icon: ReactNode }[];

export function ColorThemeSettings({ userId }: { readonly userId: string }) {
  const { preference, setPreference } = useColorTheme(userId);
  const [notice, setNotice] = useState("");
  const pendingChoice = useRef<ColorThemePreference | undefined>(undefined);
  return <section className="account-section color-theme-settings">
    <div className="account-section-title"><div><h3>Тема рабочего пространства</h3>
      <p>Все разделы, окна и меню меняются вместе. Выбор сохраняется на этом устройстве.</p></div></div>
    <div className="color-theme-choices" role="group" aria-label="Тема рабочего пространства">
      {choices.map(choice => <button type="button" key={choice.value} className="color-theme-choice"
        aria-pressed={preference === choice.value} onClick={() => {
          if (preference === choice.value && !pendingChoice.current) return;
          pendingChoice.current = choice.value;
          void transitionColorTheme(() => flushSync(() => {
            pendingChoice.current = undefined;
            setNotice(setPreference(choice.value) ? "" :
              "Тема применена, но сохранить выбор не удалось. После перезапуска он может сброситься.");
          }));
        }}>
        <span className="color-theme-preview" data-preview={choice.value} aria-hidden="true"><i /><i /><i /><i /></span>
        <span className="color-theme-choice-title">{choice.icon}{choice.label}</span>
        <small>{choice.description}</small>
      </button>)}
    </div>
    {notice && <p role="status">{notice}</p>}
  </section>;
}
