import { Component, type ReactNode } from "react";

export function reportDiagnostic(category: string, error: unknown): void {
  // Do not store exception messages: they may contain employee or message data.
  const name = error instanceof Error ? error.name : "UnknownError";
  const frames = error instanceof Error ? (error.stack ?? "").split("\n").slice(1, 7)
    .map((line) => line.replace(/https?:\/\/[^\s)]+/g, (url) => url.split("?")[0] ?? "")).join("\n") : "";
  void window.yuksalish?.reportDiagnostic?.({ category, name, frames }).catch(() => undefined);
}

interface Props {
  readonly children: ReactNode;
  readonly onHome?: () => void;
  readonly overlay?: boolean;
}

export class RecoveryBoundary extends Component<Props, { failed: boolean }> {
  override state = { failed: false };

  static getDerivedStateFromError() { return { failed: true }; }

  override componentDidCatch(error: Error) {
    reportDiagnostic("react-render", error);
  }

  override render() {
    if (!this.state.failed) return this.props.children;
    return (
      <section className={`recovery-screen ${this.props.overlay ? "recovery-overlay" : ""}`} role="alert">
        <div className="recovery-card">
          <span className="recovery-mark" aria-hidden="true">Y</span>
          <h1>Не удалось показать экран</h1>
          <p>В интерфейсе произошла ошибка. Уже сохранённые данные остаются на сервере.
            При повторном открытии несохранённый ввод этого экрана будет потерян.</p>
          <div className="recovery-actions">
            <button type="button" onClick={() => this.setState({ failed: false })}>Открыть заново</button>
            {this.props.onHome ? <button type="button" onClick={this.props.onHome}>{this.props.overlay ? "Закрыть панель" : "В мессенджер"}</button> : null}
            <button type="button" onClick={() => window.location.reload()}>Перезагрузить приложение</button>
          </div>
          <small>Если ошибка повторится, сообщите, в каком разделе и после какого действия она появилась.</small>
        </div>
      </section>
    );
  }
}
