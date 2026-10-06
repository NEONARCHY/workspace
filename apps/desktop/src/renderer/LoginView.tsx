import { useState, type FormEvent } from "react";

import { Button, Field, Input } from "@fluentui/react-components";
import { Eye24Regular, EyeOff24Regular } from "@fluentui/react-icons";
import { AuthWaves } from "./AuthWaves";
import { CompanyLogo } from "./CompanyLogo";
import { SlidingSegmented } from "./SlidingSegmented";

interface LoginViewProps {
  readonly busy: boolean;
  readonly restoring?: boolean;
  readonly error?: string;
  readonly onLogin: (username: string, password: string, totpCode?: string) => Promise<void>;
  readonly onAcceptInvitation: (inviteToken: string, password: string) => Promise<void>;
  readonly onCompletePasswordReset: (resetToken: string, password: string) => Promise<void>;
  readonly onRetryConnection?: () => void;
}

export function LoginView({
  busy,
  restoring = false,
  error,
  onLogin,
  onAcceptInvitation,
  onCompletePasswordReset,
  onRetryConnection,
}: LoginViewProps) {
  const [mode, setMode] = useState<"login" | "invitation" | "recovery">("login");
  const [username, setUsername] = useState("");
  const [password, setPassword] = useState("");
  const [totpCode, setTotpCode] = useState("");
  const [inviteToken, setInviteToken] = useState("");
  const [confirmation, setConfirmation] = useState("");
  const [passwordVisible, setPasswordVisible] = useState(false);

  const passwordVisibilityControl = (
    <Button
      appearance="subtle"
      size="small"
      type="button"
      icon={passwordVisible ? <EyeOff24Regular /> : <Eye24Regular />}
      aria-label={passwordVisible ? "Скрыть пароль" : "Показать пароль"}
      aria-pressed={passwordVisible}
      onClick={() => setPasswordVisible((visible) => !visible)}
    />
  );

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
      <AuthWaves />
      <section className="auth-intro">
        <CompanyLogo tone="color" className="auth-brand" />
        <p className="auth-kicker">Workspace</p>
      </section>

      <section className="auth-card" aria-label="Вход в Yuksalish Workspace">
        <SlidingSegmented className="auth-mode-switch" role="group" aria-label="Способ входа">
          <button
            type="button"
            aria-pressed={mode === "login"}
            className={mode === "login" ? "active" : ""}
            onClick={() => setMode("login")}
          >
            Вход
          </button>
          <button
            type="button"
            aria-pressed={mode === "invitation"}
            className={mode === "invitation" ? "active" : ""}
            onClick={() => setMode("invitation")}
          >
            Активация приглашения
          </button>
          <button
            type="button"
            aria-pressed={mode === "recovery"}
            className={mode === "recovery" ? "active" : ""}
            onClick={() => setMode("recovery")}
          >
            Сброс доступа
          </button>
        </SlidingSegmented>

        <form id="auth-form" aria-labelledby="auth-form-heading" onSubmit={submit}>
          <div>
            <h1 id="auth-form-heading">
              {mode === "login"
                ? "Добро пожаловать"
                : mode === "invitation"
                  ? "Создание учётной записи"
                  : "Новый пароль"}
            </h1>
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
              type={passwordVisible ? "text" : "password"}
              value={password}
              autoComplete={mode === "login" ? "current-password" : "new-password"}
              onChange={(_, data) => setPassword(data.value)}
              contentAfter={passwordVisibilityControl}
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
                type={passwordVisible ? "text" : "password"}
                value={confirmation}
                autoComplete="new-password"
                onChange={(_, data) => setConfirmation(data.value)}
                contentAfter={passwordVisibilityControl}
              />
            </Field>
          )}

          {restoring ? (
            <div className="auth-session-restoring" role="status" aria-live="polite">
              Восстанавливаем защищённый вход…
            </div>
          ) : null}
          {error ? <div className="auth-error" role="alert">{error}</div> : null}
          {onRetryConnection && !restoring ? <Button type="button" appearance="subtle" onClick={onRetryConnection} disabled={busy}>
            Проверить соединение
          </Button> : null}
          <Button
            type="submit"
            appearance="primary"
            className={`auth-submit${busy ? " is-pending" : ""}`}
            aria-busy={busy}
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
