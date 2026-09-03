import type {
  ChatMessage,
  ChatSummary,
  WorkspacePerson,
  WorkspaceTask,
} from "@yuksalish/contracts";

export const people: readonly WorkspacePerson[] = [
  {
    id: "aziza",
    name: "Азиза Каримова",
    initials: "АК",
    role: "Финансовый менеджер",
    color: "#0f6cbd",
  },
  {
    id: "baxtiyor",
    name: "Бахтиёр Самугов",
    initials: "БС",
    role: "Руководитель отдела",
    color: "#6b5b95",
  },
  {
    id: "dilshod",
    name: "Дилшод Рахимов",
    initials: "ДР",
    role: "Специалист по закупкам",
    color: "#0e7a0d",
  },
  {
    id: "malika",
    name: "Малика Нурова",
    initials: "МН",
    role: "Директор",
    color: "#9b3a4d",
  },
];

export const initialChats: readonly ChatSummary[] = [
  {
    id: "finance",
    title: "Финансы и закупки",
    kind: "group",
    preview: "Азиза: Счёт проверен, можно запускать маршрут",
    time: "11:42",
    unread: 3,
  },
  {
    id: "baxtiyor",
    title: "Бахтиёр Самугов",
    kind: "direct",
    preview: "Возьму задачу в работу сегодня",
    time: "10:18",
    unread: 0,
  },
  {
    id: "office",
    title: "Проект: новый офис",
    kind: "project",
    preview: "Дилшод прикрепил коммерческое предложение",
    time: "Вчера",
    unread: 0,
  },
  {
    id: "payment-148",
    title: "Заявка №148: оргтехника",
    kind: "approval",
    preview: "Ожидает решения финансового менеджера",
    time: "Вчера",
    unread: 1,
  },
];

export const initialMessages: readonly ChatMessage[] = [
  {
    id: "m1",
    chatId: "finance",
    authorId: "dilshod",
    body: "Получил обновлённый счёт на ноутбуки. Сумма 84 600 000 сум, срок оплаты до пятницы.",
    time: "11:31",
  },
  {
    id: "m2",
    chatId: "finance",
    authorId: "baxtiyor",
    body: "Проверь соответствие бюджету проекта и добавь договор к заявке.",
    time: "11:34",
  },
  {
    id: "m3",
    chatId: "finance",
    authorId: "aziza",
    body: "Счёт и бюджет проверены. Можно запускать маршрут согласования оплаты.",
    time: "11:42",
    own: true,
  },
  {
    id: "m4",
    chatId: "baxtiyor",
    authorId: "baxtiyor",
    body: "Возьму задачу в работу сегодня. Итог прикреплю к карточке.",
    time: "10:18",
  },
  {
    id: "m5",
    chatId: "office",
    authorId: "dilshod",
    body: "Прикрепил коммерческое предложение по мебели и оргтехнике.",
    time: "Вчера",
  },
  {
    id: "m6",
    chatId: "payment-148",
    authorId: "aziza",
    body: "Заявка прошла проверку бюджета и перешла на согласование финансовому менеджеру.",
    time: "Вчера",
    own: true,
  },
];

export const initialTasks: readonly WorkspaceTask[] = [
  {
    id: "t-104",
    title: "Подготовить договор на поставку ноутбуков",
    project: "Новый офис",
    assigneeId: "dilshod",
    dueLabel: "Сегодня, 17:00",
    status: "in_progress",
    priority: "high",
    checklistDone: 2,
    checklistTotal: 4,
  },
  {
    id: "t-105",
    title: "Сверить лимиты бюджета на сентябрь",
    project: "Финансы",
    assigneeId: "aziza",
    dueLabel: "Завтра, 12:00",
    status: "awaiting_review",
    priority: "normal",
    checklistDone: 3,
    checklistTotal: 3,
  },
  {
    id: "t-106",
    title: "Согласовать график поставки мебели",
    project: "Новый офис",
    assigneeId: "baxtiyor",
    dueLabel: "5 сентября",
    status: "new",
    priority: "normal",
    checklistDone: 0,
    checklistTotal: 2,
  },
  {
    id: "t-097",
    title: "Обновить список материально ответственных",
    project: "Администрация",
    assigneeId: "baxtiyor",
    dueLabel: "Просрочено на 2 дня",
    status: "overdue",
    priority: "urgent",
    checklistDone: 1,
    checklistTotal: 3,
  },
];

export function personById(id: string): WorkspacePerson {
  return people.find((person) => person.id === id) ?? people[0]!;
}
