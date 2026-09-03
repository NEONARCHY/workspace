import { useState, type FormEvent } from "react";

import { Button, Field, Input } from "@fluentui/react-components";

interface LoginViewProps {
  readonly busy: boolean;
  readonly error?: string;
  readonly onLogin: (username: string, password: string, totpCode?: string) => Promise<void>;
  readonly onAcceptInvitation: (inviteToken: string, password: string) => Promise<void>;
  readonly onCompletePasswordReset: (resetToken: string, password: string) => Promise<void>;
}

export function LoginView({
  busy,
  error,
  onLogin,
  onAcceptInvitation,
  onCompletePasswordReset,
}: LoginViewProps) {
  const showDemoCredentials =
    import.meta.env.DEV || import.meta.env.VITE_SHOW_DEMO_CREDENTIALS === "true";
  const [mode, setMode] = useState<"login" | "invitation" | "recovery">("login");
  const [username, setUsername] = useState(showDemoCredentials ? "aziza" : "");
  const [password, setPassword] = useState("");
  const [totpCode, setTotpCode] = useState("");
  const [inviteToken, setInviteToken] = useState("");
  const [confirmation, setConfirmation] = useState("");

  const submit = (event: FormEvent) => {
    event.preventDefault();
    if (mode === "login") {
      void onLogin(username, password, totpCode || undefined);
      return;
    }
    if (password !== confirmation) return;
    if (mode === "invitation") {
      void onAcceptInvitation(inviteToken, password);
    } else {
      void onCompletePasswordReset(inviteToken, password);
    }
  };

  return (
    <main className="auth-screen">
      <section className="auth-intro">
        <div className="auth-mark">Y</div>
        <p className="auth-kicker">Yuksalish Workspace</p>
        <h1>Работа компании в одном защищённом пространстве</h1>
        <p>
          Сообщения, задачи и согласования доступны только после входа. Каждое устройство
          получает отдельную отзываемую сессию.
        </p>
        {showDemoCredentials ? (
          <div className="auth-security-note">
            <strong>Локальная alpha</strong>
            <span>Тестовые пользователи: aziza, baxtiyor, dilshod, malika</span>
            <span>Пароль: Yuksalish-Local-2026!</span>
          </div>
        ) : null}
      </section>

      <section className="auth-card" aria-label="Вход в Yuksalish Workspace">
        <div className="auth-mode-switch">
          <button
            type="button"
            className={mode === "login" ? "active" : ""}
            onClick={() => setMode("login")}
          >
            Вход
          </button>
          <button
            type="button"
            className={mode === "invitation" ? "active" : ""}
            onClick={() => setMode("invitation")}
          >
            Активация приглашения
          </button>
          <button
            type="button"
            className={mode === "recovery" ? "active" : ""}
            onClick={() => setMode("recovery")}
          >
            Сброс доступа
          </button>
        </div>

        <form onSubmit={submit}>
          <div>
            <h2>
              {mode === "login"
                ? "Добро пожаловать"
                : mode === "invitation"
                  ? "Создание учётной записи"
                  : "Новый пароль"}
            </h2>
            <p>
              {mode === "login"
                ? "Введите корпоративные данные доступа."
                : mode === "invitation"
                  ? "Вставьте одноразовый код приглашения и задайте пароль."
                  : "Получите одноразовый код у администратора и задайте новый пароль."}
            </p>
          </div>

          {mode === "login" ? (
            <Field label="Логин" required>
              <Input
                value={username}
                autoComplete="username"
                onChange={(_, data) => setUsername(data.value)}
              />
            </Field>
          ) : (
            <Field
              label={mode === "invitation" ? "Код приглашения" : "Код сброса доступа"}
              required
            >
              <Input
                value={inviteToken}
                autoComplete="off"
                onChange={(_, data) => setInviteToken(data.value.trim())}
              />
            </Field>
          )}

          <Field label="Пароль" required>
            <Input
              type="password"
              value={password}
              autoComplete={mode === "login" ? "current-password" : "new-password"}
              onChange={(_, data) => setPassword(data.value)}
            />
          </Field>

          {mode === "login" ? (
            <Field label="Код приложения-аутентификатора" hint="Нужен только при включённом TOTP">
              <Input
                inputMode="numeric"
                maxLength={6}
                value={totpCode}
                autoComplete="one-time-code"
                onChange={(_, data) => setTotpCode(data.value.replace(/\D/g, ""))}
              />
            </Field>
          ) : (
            <Field
              label="Повторите пароль"
              required
              validationMessage={
                confirmation && confirmation !== password ? "Пароли не совпадают" : undefined
              }
            >
              <Input
                type="password"
                value={confirmation}
                autoComplete="new-password"
                onChange={(_, data) => setConfirmation(data.value)}
              />
            </Field>
          )}

          {error ? <div className="auth-error" role="alert">{error}</div> : null}
          <Button
            type="submit"
            appearance="primary"
            disabled={
              busy ||
              !password ||
              (mode === "login" ? !username : !inviteToken || password !== confirmation)
            }
          >
            {busy
              ? "Проверяем…"
              : mode === "login"
                ? "Войти"
                : mode === "invitation"
                  ? "Активировать и войти"
                  : "Сменить пароль и войти"}
          </Button>
        </form>
      </section>
    </main>
  );
}
