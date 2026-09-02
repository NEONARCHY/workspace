import { useEffect, useState } from "react";

import type { ModuleDescriptor } from "@yuksalish/contracts";
import { localeNames, locales, translate, type Locale } from "@yuksalish/i18n";

import { fallbackModules, loadModuleCatalog } from "./module-catalog";

export function App() {
  const [locale, setLocale] = useState<Locale>("ru");
  const [modules, setModules] = useState<readonly ModuleDescriptor[]>(fallbackModules);
  const [online, setOnline] = useState(false);

  useEffect(() => {
    let active = true;
    void loadModuleCatalog()
      .then((catalog) => {
        if (active) {
          setModules(catalog);
          setOnline(true);
        }
      })
      .catch(() => {
        if (active) {
          setOnline(false);
        }
      });
    return () => {
      active = false;
    };
  }, []);

  return (
    <main className="shell">
      <aside className="sidebar" aria-label="Навигация по модулям">
        <div className="brand">
          <span className="brand-mark" aria-hidden="true">Y</span>
          <div>
            <strong>Yuksalish</strong>
            <span>{translate(locale, "workspace")}</span>
          </div>
        </div>
        <nav>
          {modules.map((module, index) => (
            <button className={index === 0 ? "module active" : "module"} key={module.key}>
              <span className="module-index">0{index + 1}</span>
              <span>{module.label[locale]}</span>
            </button>
          ))}
        </nav>
        <span className={online ? "status online" : "status"}>
          <span aria-hidden="true" />
          {translate(locale, online ? "apiOnline" : "apiOffline")}
        </span>
      </aside>

      <section className="content">
        <header>
          <div>
            <p className="eyebrow">Foundation · v{window.yuksalish?.version ?? "0.1.0"}</p>
            <h1>{translate(locale, "foundation")}</h1>
          </div>
          <label className="locale-control">
            <span className="sr-only">Язык</span>
            <select value={locale} onChange={(event) => setLocale(event.target.value as Locale)}>
              {locales.map((item) => (
                <option key={item} value={item}>{localeNames[item]}</option>
              ))}
            </select>
          </label>
        </header>

        <div className="foundation-card">
          <div className="card-number">01</div>
          <div>
            <p className="eyebrow">System status</p>
            <h2>{modules[0]?.label[locale]}</h2>
            <p>{translate(locale, "placeholder")}. API, desktop shell и модульные контракты подключены.</p>
          </div>
        </div>

        <div className="module-grid">
          {modules.slice(1).map((module) => (
            <article key={module.key}>
              <span>{module.key}</span>
              <h3>{module.label[locale]}</h3>
              <p>{translate(locale, "placeholder")}</p>
            </article>
          ))}
        </div>
      </section>
    </main>
  );
}
