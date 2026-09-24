# Uzbek labels intentionally use the orthographically correct Unicode apostrophe.
# ruff: noqa: RUF001

from .schemas import LocalizedLabel, ModuleDescriptor

MODULE_CATALOG = (
    ModuleDescriptor(
        key="crm",
        label=LocalizedLabel(ru="CRM", uz_cyrl="CRM", uz_latn="CRM"),
        route="/crm",
        status="placeholder",
    ),
    ModuleDescriptor(
        key="tasks",
        label=LocalizedLabel(ru="Задачи", uz_cyrl="Вазифалар", uz_latn="Vazifalar"),
        route="/tasks",
        status="available",
    ),
    ModuleDescriptor(
        key="team_overview",
        label=LocalizedLabel(
            ru="Обзор команды",
            uz_cyrl="Жамоа шарҳи",
            uz_latn="Jamoa sharhi",
        ),
        route="/team-overview",
        status="available",
    ),
    ModuleDescriptor(
        key="payment_requests",
        label=LocalizedLabel(
            ru="Заявки на оплату",
            uz_cyrl="Тўлов аризалари",
            uz_latn="To‘lov arizalari",
        ),
        route="/payment-requests",
        status="available",
    ),
    ModuleDescriptor(
        key="ai_referent",
        label=LocalizedLabel(
            ru="AI Referent",
            uz_cyrl="AI Referent",
            uz_latn="AI Referent",
        ),
        route="/ai-referent",
        status="available",
    ),
    ModuleDescriptor(
        key="telegram_access",
        label=LocalizedLabel(
            ru="Доступ к Telegram-ботам",
            uz_cyrl="Telegram ботларига рухсат",
            uz_latn="Telegram botlariga ruxsat",
        ),
        route="/telegram-access",
        status="available",
    ),
    ModuleDescriptor(
        key="feed",
        label=LocalizedLabel(ru="Лента", uz_cyrl="Лента", uz_latn="Lenta"),
        route="/feed",
        status="available",
    ),
    ModuleDescriptor(
        key="projects",
        label=LocalizedLabel(
            ru="Список проектов",
            uz_cyrl="Лойиҳалар рўйхати",
            uz_latn="Loyihalar ro‘yxati",
        ),
        route="/projects",
        status="available",
    ),
    ModuleDescriptor(
        key="trip_approvals",
        label=LocalizedLabel(
            ru="Согласование поездок",
            uz_cyrl="Сафарни келишиш",
            uz_latn="Safarni kelishish",
        ),
        route="/trip-approvals",
        status="available",
    ),
    ModuleDescriptor(
        key="messenger",
        label=LocalizedLabel(ru="Мессенджер", uz_cyrl="Мессенжер", uz_latn="Messenjer"),
        route="/messenger",
        status="available",
    ),
    ModuleDescriptor(
        key="calendar",
        label=LocalizedLabel(ru="Календарь", uz_cyrl="Тақвим", uz_latn="Taqvim"),
        route="/calendar",
        status="available",
    ),
    ModuleDescriptor(
        key="zoom_meetings",
        label=LocalizedLabel(
            ru="Zoom-конференции",
            uz_cyrl="Zoom конференциялар",
            uz_latn="Zoom konferensiyalar",
        ),
        route="/zoom-meetings",
        status="available",
    ),
    ModuleDescriptor(
        key="absences",
        label=LocalizedLabel(
            ru="Отсутствия",
            uz_cyrl="Йўқликлар",
            uz_latn="Yo‘qliklar",
        ),
        route="/absences",
        status="available",
    ),
    ModuleDescriptor(
        key="members",
        label=LocalizedLabel(
            ru="Работа с членами",
            uz_cyrl="Аъзолар билан ишлаш",
            uz_latn="A’zolar bilan ishlash",
        ),
        route="/members",
        status="available",
    ),
    ModuleDescriptor(
        key="hr",
        label=LocalizedLabel(ru="HR", uz_cyrl="Кадрлар", uz_latn="Kadrlar"),
        route="/hr",
        status="available",
    ),
    ModuleDescriptor(
        key="employees",
        label=LocalizedLabel(ru="Сотрудники", uz_cyrl="Ходимлар", uz_latn="Xodimlar"),
        route="/employees",
        status="available",
    ),
)
