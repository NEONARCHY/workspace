from .schemas import LocalizedLabel, ModuleDescriptor

MODULE_CATALOG = (
    ModuleDescriptor(
        key="messenger",
        label=LocalizedLabel(ru="Сообщения", uz_cyrl="Хабарлар", uz_latn="Xabarlar"),
        route="/messenger",
        status="placeholder",
    ),
    ModuleDescriptor(
        key="tasks",
        label=LocalizedLabel(ru="Задачи", uz_cyrl="Вазифалар", uz_latn="Vazifalar"),
        route="/tasks",
        status="placeholder",
    ),
    ModuleDescriptor(
        key="requests",
        label=LocalizedLabel(ru="Заявки", uz_cyrl="Аризалар", uz_latn="Arizalar"),
        route="/requests",
        status="placeholder",
    ),
    ModuleDescriptor(
        key="hisobot",
        label=LocalizedLabel(ru="Отчёты", uz_cyrl="Ҳисоботлар", uz_latn="Hisobotlar"),
        route="/hisobot",
        status="placeholder",
    ),
)
