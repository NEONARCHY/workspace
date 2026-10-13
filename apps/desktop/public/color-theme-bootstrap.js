// Runs before the renderer/CSS bundle to avoid a light flash on a dark launch.
// Only a validated visual preference is read; no account/session data.
(() => {
  let preference = "light";
  try {
    const stored = localStorage.getItem("yuksalish:color-theme:last");
    if (["light", "dark", "system"].includes(stored)) preference = stored;
  } catch { /* Restricted storage: light is the safe existing default. */ }
  const dark = preference === "dark" || preference === "system" && window.matchMedia?.("(prefers-color-scheme: dark)").matches;
  const root = document.documentElement;
  root.dataset.colorTheme = dark ? "dark" : "light";
  root.style.colorScheme = dark ? "dark" : "light";
  if (dark) root.style.backgroundColor = "#101115";
})();
