"""Shared reviewer editor. All Tk calls stay on the main thread; HTTPS runs off-thread."""

from __future__ import annotations

import json
import queue
import threading
import tkinter as tk
from collections.abc import Callable
from tkinter import filedialog, ttk
from typing import Any

from .client import WorkspaceClient, WorkspaceError, connection_settings, save_connection


class SharedReviewerEditor:
    def __init__(self, gui: Any):
        self.gui = gui
        self.initial_bindings = {
            key: gui._telegram_target_from_label(gui.outgoing_reviewer_id_vars[key].get())
            for key in ("askar", "bobur", "umid", "davronbek")
        }
        self.root = gui.root
        self.window: tk.Toplevel | None = None
        self.config: dict[str, Any] | None = None
        self.expected_revision = 0
        self.dirty = False
        self.busy = False
        self.results: queue.Queue[tuple[str, Any]] = queue.Queue()
        self.rows: dict[str, tuple[tk.StringVar, tk.StringVar, tk.BooleanVar]] = {}
        self.status = tk.StringVar(value="Workspace: подключение не настроено")
        parent = gui.outgoing_reviewer_bobur_combo.master
        ttk.Button(parent, text="Workspace · согласующие и Telegram", command=self.open).grid(
            row=8, column=0, columnspan=8, sticky="ew", pady=8
        )
        ttk.Label(parent, textvariable=self.status, wraplength=700).grid(
            row=9, column=0, columnspan=8, sticky="w"
        )
        self.root.after(200, self.drain)
        self.root.after(500, self.poll)

    def run(self, kind: str, operation: Callable[[], Any]) -> None:
        if self.busy:
            return
        self.busy = True

        def worker() -> None:
            try:
                self.results.put((kind, operation()))
            except (WorkspaceError, OSError, ValueError, KeyError) as exc:
                message = (
                    str(exc)
                    if isinstance(exc, WorkspaceError)
                    else "Ошибка подключения или формата настроек."
                )
                self.results.put(("error", message))

        threading.Thread(target=worker, name="workspace-settings", daemon=True).start()

    def drain(self) -> None:
        try:
            kind, value = self.results.get_nowait()
        except queue.Empty:
            pass
        else:
            self.busy = False
            if kind == "error":
                self.status.set(value + " Ввод сохранён.")
            else:
                self.accept(value, force=kind == "save")
        self.root.after(200, self.drain)

    def poll(self) -> None:
        try:
            configured = bool(connection_settings().get("api_url"))
            if configured:
                for key in ("askar", "bobur", "umid", "davronbek"):
                    getattr(self.gui, f"outgoing_reviewer_{key}_combo").configure(state="disabled")
                self.run("load", lambda: WorkspaceClient().configuration())
        except (OSError, ValueError):
            self.status.set("Ошибка чтения настроек подключения Workspace.")
        self.root.after(15_000, self.poll)

    def accept(self, config: dict[str, Any], *, force: bool = False) -> None:
        self.config = config
        for row in config["reviewers"]:
            self.gui.outgoing_reviewer_id_vars[row["key"]].set(row["telegramId"] or "")
        if not self.dirty or force:
            self.fill()
        revision = config["revision"]
        conflict = self.dirty and revision != self.expected_revision
        self.status.set(
            "Настройки изменены на другом устройстве. Ввод сохранён; "
            "обновите форму перед сохранением."
            if conflict
            else f"Workspace: версия {revision}. Бот применяет настройки самостоятельно."
        )

    def fill(self) -> None:
        if not self.config:
            return
        for row in self.config["reviewers"]:
            if row["key"] in self.rows:
                username, telegram, enabled = self.rows[row["key"]]
                username.set(row["username"])
                telegram.set(row["telegramId"] or "")
                enabled.set(row["enabled"])
        self.expected_revision = self.config["revision"]
        self.dirty = False

    def open(self) -> None:
        if self.window is not None and self.window.winfo_exists():
            self.window.lift()
            return
        self.window = tk.Toplevel(self.root)
        self.window.title("Workspace — согласующие исходящих писем")
        self.window.geometry("850x690")
        self.window.minsize(740, 600)
        frame = ttk.Frame(self.window, padding=20)
        frame.pack(fill="both", expand=True)
        frame.columnconfigure(0, weight=1)
        ttk.Label(
            frame, text="Общие настройки Workspace и Telegram", font=("Segoe UI", 15, "bold")
        ).grid(row=0, sticky="w", pady=(0, 8))
        ttk.Label(
            frame,
            text="Роль маршрута остаётся постоянной. Меняются аккаунт и числовой Telegram ID.",
            wraplength=760,
        ).grid(row=1, sticky="w")
        table = ttk.Frame(frame)
        table.grid(row=2, sticky="nsew", pady=16)
        table.columnconfigure(1, weight=1)
        table.columnconfigure(2, weight=1)
        for col, title in enumerate(("Роль маршрута", "Логин Workspace", "Telegram ID", "Включён")):
            ttk.Label(table, text=title).grid(row=0, column=col, padx=6, pady=6, sticky="w")
        self.rows = {}
        for index, (key, label) in enumerate(
            (
                ("askar", "Аскар"),
                ("bobur", "Бобур"),
                ("umid", "Умид"),
                ("davronbek", "Давронбек"),
            ),
            1,
        ):
            username, telegram = tk.StringVar(), tk.StringVar()
            enabled = tk.BooleanVar()
            self.rows[key] = username, telegram, enabled
            ttk.Label(table, text=label).grid(row=index, column=0, padx=6, pady=10, sticky="w")
            ttk.Entry(table, textvariable=username).grid(row=index, column=1, padx=6, sticky="ew")
            ttk.Entry(table, textvariable=telegram).grid(row=index, column=2, padx=6, sticky="ew")
            ttk.Checkbutton(table, variable=enabled).grid(row=index, column=3)
            for variable in (username, telegram, enabled):
                variable.trace_add("write", self.mark_dirty)
        ttk.Label(
            frame,
            text="Пустой Telegram ID: согласование только в Workspace.\n"
            "Для сохранения требуется вход администратора; "
            "ключ агента не даёт права менять назначения.",
            wraplength=760,
        ).grid(row=3, sticky="w")
        auth = ttk.LabelFrame(frame, text="Администратор Workspace", padding=12)
        auth.grid(row=4, sticky="ew", pady=16)
        self.login, self.password, self.totp = tk.StringVar(), tk.StringVar(), tk.StringVar()
        for col, (label, variable) in enumerate(
            (
                ("Логин", self.login),
                ("Пароль", self.password),
                ("Код 2FA (если включён)", self.totp),
            )
        ):
            auth.columnconfigure(col, weight=1)
            ttk.Label(auth, text=label).grid(row=0, column=col, sticky="w", padx=4)
            ttk.Entry(auth, textvariable=variable, show="*" if col == 1 else "").grid(
                row=1, column=col, sticky="ew", padx=4, pady=6
            )
        actions = ttk.Frame(frame)
        actions.grid(row=5, sticky="ew")
        ttk.Button(actions, text="Сохранить в Workspace", command=self.save).pack(side="left")
        ttk.Button(actions, text="Сбросить ввод к актуальной версии", command=self.fill).pack(
            side="left", padx=8
        )
        ttk.Button(actions, text="Подключение…", command=self.connection_dialog).pack(side="right")
        ttk.Label(frame, textvariable=self.status, wraplength=760).grid(row=6, sticky="w", pady=16)
        self.fill()
        if not connection_settings().get("api_url"):
            self.connection_dialog()

    def mark_dirty(self, *_args: Any) -> None:
        self.dirty = True

    def save(self) -> None:
        if self.busy:
            return
        if not self.config or self.config["revision"] != self.expected_revision:
            self.status.set(
                "Обновите форму: текущая версия отсутствует или изменена на другом устройстве."
            )
            return
        payload = {
            "expectedRevision": self.expected_revision,
            "reviewers": [
                {
                    "key": key,
                    "username": values[0].get().strip().removeprefix("@"),
                    "telegramId": values[1].get().strip() or None,
                    "enabled": values[2].get(),
                }
                for key, values in self.rows.items()
            ],
        }
        username, password, totp = self.login.get(), self.password.get(), self.totp.get()
        self.password.set("")
        self.totp.set("")

        def operation() -> dict[str, Any]:
            client = WorkspaceClient()
            access = client.login(username, password, totp)
            try:
                return client.save(payload, access)
            finally:
                try:
                    client.logout(access)
                except WorkspaceError:
                    # Never retain the session locally, even if the server becomes unreachable.
                    self.results.put(
                        (
                            "error",
                            "Ошибка закрытия административного сеанса. "
                            "Завершите сеанс Exat в настройках безопасности Workspace.",
                        )
                    )

        self.run("save", operation)

    def connection_dialog(self) -> None:
        dialog = tk.Toplevel(self.window)
        dialog.title("Подключение к Workspace")
        panel = ttk.Frame(dialog, padding=20)
        panel.pack(fill="both", expand=True)
        settings = connection_settings()
        url = tk.StringVar(value=settings.get("api_url", ""))
        ca = tk.StringVar(value=settings.get("ca_file", ""))
        token = tk.StringVar()
        for index, (label, variable) in enumerate(
            (
                ("HTTPS-адрес API Workspace", url),
                ("Корневой сертификат PEM (если нужен)", ca),
                ("Ключ агента (пусто — оставить сохранённый)", token),
            )
        ):
            ttk.Label(panel, text=label).grid(row=index * 2, column=0, sticky="w")
            ttk.Entry(panel, textvariable=variable, width=65, show="*" if index == 2 else "").grid(
                row=index * 2 + 1, column=0, pady=8
            )
        ttk.Button(
            panel,
            text="Выбрать сертификат",
            command=lambda: ca.set(
                filedialog.askopenfilename(parent=dialog, filetypes=[("PEM", "*.pem *.crt")])
            ),
        ).grid(row=4, column=1, padx=8)
        message = tk.StringVar()
        ttk.Label(panel, textvariable=message, wraplength=480).grid(row=7, column=0)

        def connect() -> None:
            try:
                save_connection(url.get(), ca.get(), token.get(), self.initial_bindings)
            except (OSError, ValueError, RuntimeError) as exc:
                message.set(
                    str(exc)
                    if isinstance(exc, WorkspaceError)
                    else "Ошибка сохранения подключения. Проверьте сертификат и хранилище ключей."
                )
                return
            token.set("")
            dialog.destroy()
            self.run("load", lambda: WorkspaceClient().configuration())

        ttk.Button(panel, text="Сохранить подключение", command=connect).grid(
            row=6, column=0, pady=8
        )


def attach_gui(gui: Any) -> None:
    gui.workspace_reviewer_editor = SharedReviewerEditor(gui)


def open_shared_settings(gui: Any) -> bool:
    """In connected mode the legacy save action must not create divergent local settings."""
    try:
        configured = bool(connection_settings().get("api_url"))
    except (OSError, json.JSONDecodeError):
        configured = True  # Fail closed; a corrupt connection is not permission to go local.
    if configured:
        gui.workspace_reviewer_editor.open()
    return configured
