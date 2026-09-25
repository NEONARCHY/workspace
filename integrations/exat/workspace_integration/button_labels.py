"""Readable Telegram button labels, without changing callback payloads."""

from __future__ import annotations

_ICONS = ("📤", "✍️", "📚", "📬", "🏠", "🔎", "📎", "📄", "📁", "🏢", "🏛️",
          "🌐", "👤", "✉️", "✅", "↩️", "⬅️", "➡️", "🗑️", "⚙️", "🔄",
          "⏳", "🚀", "📝", "📅", "🛑", "📋", "🔹", "🗂️", "👁️")


def button_label(label: str, action: str = "") -> str:
    """Give every shared-mode button a stable visual cue, including dynamic rows."""
    if label.startswith(_ICONS):
        return label
    text = label.casefold()
    if "назад" in text or "предыдущ" in text:
        icon = "⬅️"
    elif "далее" in text or "следующ" in text or "продолжить" in text:
        icon = "➡️"
    elif "удалить" in text:
        icon = "🗑️"
    elif "не удалять" in text or "отмена" in text or "отменить" in text:
        icon = "🛑"
    elif "согласова" in text or "подтвердить" in text or "одобрить" in text:
        icon = "✅"
    elif "доработ" in text or "исправить" in text or "вернуть" in text:
        icon = "↩️"
    elif "поиск" in text:
        icon = "🔎"
    elif "файл" in text or "документ" in text or "вложени" in text:
        icon = "📎"
    elif "отправить" in text:
        icon = "📤"
    elif "проверить" in text or "подождите" in text:
        icon = "⏳"
    elif "обновить" in text or "повторить" in text:
        icon = "🔄"
    elif "организаци" in text or "адрес" in text or action.startswith(("u:", "b:")):
        icon = "🏢"
    elif text in {"министерства", "комитеты"}:
        icon = "🏛️"
    elif text in {"агентства", "другие"}:
        icon = "🏢"
    elif text == "международные":
        icon = "🌐"
    elif "согласующ" in text or action.startswith(("r:", "q:")):
        icon = "👤"
    elif action.startswith("o:"):
        icon = "✉️"
    elif action.startswith("g:"):
        icon = "👁️"
    elif action.startswith("f:"):
        icon = "📁"
    elif action.startswith("c:"):
        icon = "🗂️"
    else:
        icon = "🔹"
    visible = label.removeprefix("← ") if icon == "⬅️" else label
    visible = visible.removesuffix(" →") if icon == "➡️" else visible
    return f"{icon} {visible}"
