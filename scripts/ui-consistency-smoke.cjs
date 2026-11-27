// Comparable production-App screenshots. All API traffic stays in synthetic fixtures.
const { chromium } = require(process.env.PLAYWRIGHT_MODULE || "playwright");
const fs = require("node:fs/promises");
const path = require("node:path");
const assert = require("node:assert/strict");
const phase = process.argv.includes("--before") ? "before" : "after";
const galleryOnly = process.argv.includes("--gallery-only");
const chatPaginationSuite = process.argv.includes('--chat-pagination');
const sidebarSuite = process.argv.includes('--sidebar');
const referentSurfacesSuite = process.argv.includes('--referent-surfaces');
const calendarSurfacesSuite = process.argv.includes('--calendar-surfaces');
const surfaceFollowupSuite = process.argv.includes('--surface-followup');
const toolbarSuite = process.argv.includes('--toolbar-layout');
const shellReviewSuite = process.argv.includes("--shell-review");
const attentionSuite = process.argv.includes("--attention") || shellReviewSuite || surfaceFollowupSuite;
const peopleSuite = process.argv.includes("--people");
const operationsSuite = process.argv.includes("--operations");
const documentsSuite = process.argv.includes("--documents");
const communicationsSuite = process.argv.includes("--communications") || shellReviewSuite || toolbarSuite || chatPaginationSuite || sidebarSuite || referentSurfacesSuite;
const registrySuite = process.argv.includes("--registry") || toolbarSuite || surfaceFollowupSuite;
const workdaySuite = process.argv.includes("--workday");
const promptSuite = process.argv.includes("--hisobot-prompt");
const topbarSuite = process.argv.includes("--topbar") || workdaySuite;
const reportingSuite = process.argv.includes("--reporting");
const planningSuite = process.argv.includes("--planning") || topbarSuite || promptSuite || calendarSurfacesSuite || surfaceFollowupSuite;
const onlyWidth = Number(process.env.UI_QA_WIDTH || 0);
assert([0, 320, 390, 720, 1024, 1440].includes(onlyWidth));
const origin = process.env.UI_QA_ORIGIN || "http://127.0.0.1:5186";
assert(["127.0.0.1", "localhost"].includes(new URL(origin).hostname));
const iteration = communicationsSuite ? "12" : registrySuite ? "11" : promptSuite ? "10" : workdaySuite ? "9" : reportingSuite ? "8" : topbarSuite ? "7" : planningSuite ? "6" : documentsSuite ? "5" : operationsSuite ? "4" : peopleSuite ? "3" : attentionSuite ? "2" : "1";
const output = path.resolve(process.env.UI_QA_OUTPUT || `tmp/ui-consistency-iteration-${iteration}`);
const sections = communicationsSuite ? [{ id: "referent", label: "AI Referent", root: ".ai-referent-view" }, { id: "messenger", label: "Мессенджер", root: ".messenger-view" }, { id: "legacy-projects", label: "Список проектов", root: ".projects-view" }] : registrySuite ? [{ id: "grants", label: "Гранты", root: ".grants-view" }, { id: "reference", label: "Справочник", root: ".reference-view" }, { id: "mail", label: "Почта", root: ".mail-view" }] : promptSuite ? [{ id: "home", label: "Главная", root: ".personal-home" }, { id: "tasks", label: "Задачи", root: ".tasks-view" }, { id: "messenger", label: "Мессенджер", root: ".messenger-view" }].filter(section => section.id === (process.env.UI_QA_SECTION || "messenger")) : workdaySuite ? [{ id: "home", label: "Главная", root: ".personal-home" }] : reportingSuite
  ? [{ id: "hisobot", label: "AI Hisobot", root: ".ai-hisobot-view" }, { id: "monthly", label: "Ойлик ҳисоботлар", root: ".monthly-reports-page" }, { id: "efficiency", label: "Эффективность", navLabel: "Задачи", root: ".tasks-view" }]
  : planningSuite
  ? [{ id: "home", label: "Главная", root: ".personal-home" }, { id: "calendar", label: "Календарь", root: ".calendar-view" }, { id: "projects", label: "Проекты", root: ".project-hub-view" }]
  : documentsSuite
  ? [{ id: "letters", label: "Входящие письма", root: ".incoming-documents" }, { id: "telegram", label: "Доступ к ботам", root: ".telegram-access-view" }, { id: "survey", label: "Аналитика опросов", root: ".survey-analytics" }]
  : operationsSuite
  ? [{ id: "hr", label: "HR", root: ".hr-view" }, { id: "members", label: "Работа с членами", root: ".members-view" }, { id: "zoom", label: "Zoom-конференции", root: ".zoom-view" }]
  : peopleSuite
  ? [{ id: "employees", label: "Сотрудники", root: ".employees-view" }, { id: "leaves", label: "Отпуска", root: ".leave-view" }, { id: "absences", label: "Отсутствия", root: ".absences-view" }]
  : attentionSuite
  ? [{ id: "overview", label: "Обзор команды", root: ".team-dashboard" }, { id: "notifications", label: "Уведомления", root: ".notifications-view" }, { id: "feed", label: "Лента", root: ".feed-view" }]
  : [{ id: "tasks", label: "Задачи", root: ".tasks-view" }, { id: "payments", label: "Заявки на оплату", root: ".approvals-view" }, { id: "trips", label: "Поездки", root: ".trips-view" }];
if (shellReviewSuite) sections.splice(0, sections.length, { id: 'overview', label: 'Обзор команды', root: '.team-dashboard' }, { id: 'payments', label: 'Заявки на оплату', root: '.approvals-view' }, { id: 'referent', label: 'AI Referent', root: '.ai-referent-view' });
if (toolbarSuite) sections.splice(0, sections.length, { id: 'referent', label: 'AI Referent', root: '.ai-referent-view' }, { id: 'legacy-projects', label: 'Список проектов', root: '.projects-view' }, { id: 'payments', label: 'Заявки на оплату', root: '.approvals-view' }, { id: 'trips', label: 'Поездки', root: '.trips-view' }, { id: 'tasks', label: 'Задачи', root: '.tasks-view' }, { id: 'grants', label: 'Гранты', root: '.grants-view' });
if (chatPaginationSuite) sections.splice(0, sections.length, { id: 'messenger', label: 'Мессенджер', root: '.messenger-view' });
if (sidebarSuite) sections.splice(0, sections.length, { id: 'messenger', label: 'Мессенджер', root: '.messenger-view' });
if (referentSurfacesSuite) sections.splice(0, sections.length, { id: 'referent', label: 'AI Referent · исходящие письма', root: '.ai-referent-view', navLabel: 'AI Referent' });
if (calendarSurfacesSuite) sections.splice(0, sections.length, { id: 'tasks', label: 'Задачи', root: '.tasks-view' }, { id: 'calendar', label: 'Календарь', root: '.calendar-view' });
if (surfaceFollowupSuite) sections.splice(0, sections.length, { id: 'overview', label: 'Обзор команды', root: '.team-dashboard' }, { id: 'calendar', label: 'Календарь', root: '.calendar-view' }, { id: 'grants', label: 'Гранты', root: '.grants-view' });
const settle = async page => page.evaluate(async () => {
  await document.fonts.ready;
  await Promise.race([Promise.all(document.getAnimations().filter(a => Number(a.effect?.getComputedTiming().endTime) < 2000).map(a => a.finished.catch(() => undefined))), new Promise(r => setTimeout(r, 900))]);
  await new Promise(r => requestAnimationFrame(() => requestAnimationFrame(r)));
});
async function capture(subject, target) {
  const temporary = target + ".tmp";
  try { await fs.writeFile(temporary, await subject.screenshot()); await fs.rename(temporary, target); }
  finally { await fs.rm(temporary, { force: true }); }
}
function registryFixtures(people, user) {
  const grantSettings = { leaderUserId: people[1].id, chairUserId: people[2].id, revision: 1 };
  const grants = Array.from({ length: 24 }, (_, i) => ({ id: `qa-grant-${i}`, title: ["Развитие молодёжных инициатив", "Образовательная программа регионов", "Подготовка местных координаторов", "Исследование общественных инициатив"][i % 4], description: "Подготовить заявку, план мероприятий и бюджет программы.", initiatorUserId: user.id, authorUserId: people[2].id, assigneeId: people[i % people.length].id, coAssigneeIds: [], workflowVersion: 2, launchApprovedAt: "2026-11-20T10:00:00Z", launchApprovedByUserId: people[2].id, ...grantSettings, dueAt: "2026-12-12T12:00:00Z", status: ["in_progress", "leader_review", "needs_revision", "completed"][i % 4], revision: 2, checklist: [], resultText: "", chatId: `qa-grant-chat-${i}`, createdAt: "2026-11-20T09:00:00Z", updatedAt: "2026-11-24T09:00:00Z", allowedActions: i % 4 === 1 ? ["approve", "return"] : ["comment"], events: [], attachments: [] }));
  const reference = {
    profile: { legalName: "Тестовая организация «Юксалиш»", shortName: "Юксалиш", tin: "", registeredAddress: "", postalAddress: "", bankName: "", bankCode: "", bankAccount: "", phone: "", email: "office@example.test", website: "", revision: 1, updatedAt: "2026-11-24T09:00:00Z" },
    partners: Array.from({ length: 12 }, (_, i) => ({ id: `qa-partner-${i}`, name: ["Центр региональных инициатив", "Образовательный фонд", "Агентство развития", "Ассоциация местных сообществ"][i % 4], kind: ["partner", "donor", "government", "contractor"][i % 4], tin: "", contactPerson: people[i % people.length].name, phone: "", email: `contact${i}@example.test`, address: "", notes: "Совместные региональные программы и рабочие встречи", archived: i === 11, revision: 1, updatedAt: "2026-11-24T09:00:00Z" })),
    experts: [], templates: [], changes: [],
  };
  const messages = Array.from({ length: 20 }, (_, i) => ({ id: `qa-mail-${i}`, threadId: `qa-thread-${i}`, subject: ["Программа региональной встречи", "Документы по образовательной программе", "Согласование бюджета проекта", "Итоги рабочей встречи"][i % 4], sender: `Координатор программы <team${i}@example.test>`, recipients: "qa-user@example.test", receivedAt: "2026-11-26T09:30:00Z", snippet: "Направляем материалы для согласования. Просим проверить программу и подготовить замечания.", unread: i % 3 === 0, body: "Здравствуйте. Направляем материалы для согласования региональной программы. Все данные этого письма — тестовые.", replyTo: "", messageId: `<qa-${i}@example.test>`, references: "", attachments: [] }));
  return { grants, grantSettings, reference, messages, connection: { accountId: "qa-mail-account", email: "qa-user@example.test", configured: true, sendingEnabled: true, connectedAt: "2026-11-20T09:00:00Z", reconnectRequired: false } };
}
function fixtures(demo) {
  const people = demo.people.map(person => ({ ...person, avatarVersion: null }));
  const user = { ...people.find(p => p.username === "malika"), role: "admin", jobTitle: "Руководитель подразделения" };
  const tasks = Array.from({ length: 24 }, (_, i) => ({ ...demo.initialTasks[i % demo.initialTasks.length], id: `task-${i}`,
    title: ["Подготовить материалы региональной встречи", "Согласовать договор на оборудование", "Обновить план работы подразделения", "Проверить итоговый отчёт проекта"][i % 4],
    status: ["new", "in_progress", "awaiting_review", "completed"][i % 4], priority: ["normal", "low", "high", "urgent"][i % 4],
    dueAt: i % 6 === 0 ? "2026-11-25T12:00:00Z" : "2026-12-04T12:00:00Z", dueLabel: i % 6 === 0 ? "25 ноября" : "4 декабря",
    authorId: user.id, assigneeId: people[i % people.length].id, participants: [], checklist: [], comments: [], dependencies: [],
  }));
  const stages = ["start", "accountant", "chairman", "paid"];
  const labels = ["Новая заявка", "Проверка бухгалтерии", "Утверждение", "Оплачено"];
  const workflow = { id: "qa-workflow", name: "Заявки на оплату", version: 1, status: "published", publishedVersion: 1, formSchema: {},
    nodes: stages.map((id, i) => ({ id, label: labels[i], kind: i === 0 ? "start" : i === 3 ? "end" : "approval", detail: "", positionX: i * 220, positionY: 0, config: {} })),
    edges: stages.slice(1).map((id, i) => ({ id: `edge-${i}`, source: stages[i], target: id, label: "", condition: {} })),
  };
  const requests = Array.from({ length: 12 }, (_, i) => ({ id: `payment-${i}`, number: String(801 + i),
    title: ["Оборудование для региональной встречи", "Подготовка материалов форума", "Аренда переговорной комнаты"][i % 3], amount: (i + 2) * 350000, currency: "UZS", purpose: "Оплата рабочих расходов", status: i % 4 === 3 ? "approved" : "running", statusLabel: i % 4 === 3 ? "Оплачено" : "На согласовании", stageLabel: labels[i % 4], activeNodeKeys: [stages[i % 4]], activeStages: [{ key: stages[i % 4], label: labels[i % 4], kind: i % 4 === 0 ? "start" : "approval", canAct: false }], requesterId: user.id, responsibleUserId: people[i % people.length].id,
    details: { transferType: "Другие услуги", projectName: "Региональная программа", projectCode: "REG-26", sourceAccount: "Основной счёт", destinationAccount: "Счёт поставщика", requestPriority: "normal", deadline: null, comment: "", tripPurpose: "", tripStartDate: null, tripEndDate: null, employeeIds: [], paymentPurpose: "Оплата услуг", paymentReason: "Рабочие расходы", responsibleUserId: user.id },
    createdAt: "2026-11-24T10:00:00Z", updatedAt: "2026-11-25T10:00:00Z", revision: 1, versions: [], actions: [] }));
  const tripStages = ["launch", "deputy_approval", "manager_approval", "hr"];
  const tripRequests = Array.from({ length: 12 }, (_, i) => ({ id: `trip-${i}`, number: `TR-${231 + i}`, requesterUserId: people[i % people.length].id, purpose: ["Рабочая встреча с региональной командой", "Проверка хода реализации проекта", "Подготовка совместной программы"][i % 3], destination: ["Самарканд", "Бухара", "Ташкент"][i % 3], startDate: "2026-12-04", endDate: "2026-12-06", employeeIds: [people[i % people.length].id], stage: tripStages[i % 4], stageLabel: ["Запуск", "Согласование заместителя", "Утверждение председателем", "Кадровая служба"][i % 4], status: "running", statusLabel: "На согласовании", canEdit: false, allowedActions: [], actions: [], createdAt: "2026-11-24T09:00:00Z", updatedAt: "2026-11-25T09:00:00Z" }));
  const feedPosts = Array.from({ length: 6 }, (_, i) => ({ id: `post-${i}`, authorUserId: people[i % people.length].id,
    title: ["План региональных встреч на декабрь", "Материалы к рабочему совещанию", "Итоги совместной работы команды"][i % 3],
    body: "Коллеги, подготовлены материалы для следующего этапа работы.\n\nПожалуйста, проверьте задачи своего подразделения и добавьте результаты до согласованного срока. Все документы и обсуждения доступны в карточках проектов.",
    isPinned: i === 0, likedByCurrentUser: false, likeCount: 0, reactions: [], canEdit: true, canDelete: true, canPin: true,
    comments: [{ id: `comment-${i}`, authorUserId: user.id, body: "Материалы проверены, дополнения переданы команде.", reactions: [], canDelete: true, createdAt: "2026-11-26T07:30:00Z" }],
    createdAt: "2026-11-26T07:00:00Z", updatedAt: "2026-11-26T07:00:00Z" }));
  const notifications = Array.from({ length: 300 }, (_, i) => ({ id: `notice-${i}`, kind: ["approval", "task", "calendar", "message"][i % 4],
    section: ["payment_requests", "tasks", "calendar", "messenger"][i % 4], priority: i % 4 === 0 ? "high" : "normal",
    title: ["Нужно решение по заявке", "Задача передана на проверку", "Приглашение на рабочую встречу", "Новое сообщение в рабочем чате"][i % 4],
    body: ["Оборудование для региональной встречи · Утверждение руководителем", "План работы подразделения · Результат готов к проверке", "Подготовка совместной программы · Встреча команды", "Обсуждение материалов декабрьского совещания"][i % 4],
    entityId: null, requiresAction: i % 4 === 0, isReminder: false, occurredAt: "2026-11-26T07:00:00Z", readAt: i % 9 === 8 ? "2026-11-26T07:10:00Z" : null, resolvedAt: null }));
  const departments = [{ id: "qa-dept", name: "Региональные программы", kind: "department", isActive: true, sortOrder: 0 }];
  const employees = Array.from({ length: 48 }, (_, i) => ({ ...people[i % people.length], id: `employee-${i}`, username: `employee.${i + 1}`, name: `${people[i % people.length].name} ${i + 1}`, role: "employee", status: i % 8 === 7 ? "invited" : "active", departmentId: "qa-dept", positionId: "qa-position", jobTitle: "Координатор региональных программ" }));
  const leaves = Array.from({ length: 12 }, (_, i) => ({ id: `leave-${i}`, requesterUserId: i % 2 ? user.id : people[i % people.length].id, applicationText: "Менга йиллик меҳнат таътили беришингизни сўрайман.", requestedStartsOn: "2026-12-04", requestedEndsOn: "2026-12-17", startsOn: null, endsOn: null, workYearStartsOn: null, workYearEndsOn: null, calendarDays: null, paidDays: null, tenureAdditionalDays: null, organizationEmploymentDate: null, returnOn: null, accountingOfficer: null, orderEmployeeName: null, orderJobTitle: null, orderSignerName: null, orderClause1: null, orderClause2: null, orderClause3: null, status: i % 3 === 2 ? "approved" : "pending_hr", statusLabel: i % 3 === 2 ? "Утверждено" : "Проверка кадров", orderNumber: null, orderYear: null, signedByUserId: null, approvedAt: null, canRevise: i % 2 === 1, canReviewHr: false, canReviewDeputy: false, canWithdraw: false, hasOrder: false, actions: [], createdAt: "2026-11-26T07:00:00Z", updatedAt: "2026-11-26T07:00:00Z" }));
  const absenceRequests = Array.from({ length: 8 }, (_, i) => ({ id: `absence-${i}`, requesterUserId: i % 2 ? user.id : people.find(p => p.id !== user.id).id, directManagerUserId: i % 2 ? people.find(p => p.id !== user.id).id : user.id, kind: ["personal_time", "late_arrival", "sick_leave", "business_event"][i % 4], reason: ["Посещение государственного учреждения", "Задержка транспорта по пути на работу", "Амбулаторное лечение по назначению врача", "Участие в региональном рабочем совещании"][i % 4], startsAt: "2026-11-26T07:00:00Z", endsAt: "2026-11-26T10:00:00Z", status: "pending", statusLabel: "Ждёт решения", documentStatus: "not_required", canEdit: false, allowedActions: [], actions: [], createdAt: "2026-11-26T06:00:00Z", updatedAt: "2026-11-26T06:00:00Z" }));
  const presenceSummary = people.map(person => ({ userId: person.id, status: "working" }));
  const hr = { calculatedAt: "2026-11-26", settings: { hrUserId: user.id, chairUserId: people[0].id, accountantUserId: people[1].id }, registers: [],
    profiles: Array.from({ length: 40 }, (_, i) => ({ id: `hr-${i}`, userId: i < people.length ? people[i].id : null, fullName: `${people[i % people.length].name} ${i + 1}`, jobTitle: "Координатор региональных программ", employmentDate: "2023-04-12", serviceAnchorDate: "2026-11-26", serviceYears: 3 + i % 8, serviceMonths: i % 12, serviceDays: i % 28, allowancePercent: i % 3 ? 10 : 0, employmentStatus: i % 10 === 9 ? "terminated" : "active", terminatedOn: i % 10 === 9 ? "2026-11-01" : null, hiddenAfterYear: false, updatedAt: "2026-11-26T07:00:00Z" })) };
  const regions = ["Ташкент", "Самарканд", "Бухара", "Андижан"].map((nameRu, i) => ({ id: i + 1, nameRu, nameUz: nameRu }));
  const members = { configured: true, generatedAt: "2026-11-26T07:00:00Z", regions, spheres: [{ id: 1, nameRu: "Образование", nameUz: "Ta’lim" }, { id: 2, nameRu: "Предпринимательство", nameUz: "Tadbirkorlik" }],
    members: Array.from({ length: 64 }, (_, i) => ({ id: i + 1, username: `member.${i + 1}`, firstName: people[i % people.length].name, lastName: String(i + 1), status: "active", createdAt: "2026-11-20T09:00:00Z", regionId: i % 4 + 1, regionNameRu: regions[i % 4].nameRu, sphereId: i % 2 + 1, sphereNameRu: i % 2 ? "Предпринимательство" : "Образование", gender: i % 2 ? "male" : "female" })) };
  const zoom = { configured: true, timezone: "Asia/Tashkent", reminderMinutes: 30, bookingHorizonDays: 90, slotMinutes: 15,
    meetings: Array.from({ length: 10 }, (_, i) => ({ id: `zoom-${i}`, topic: ["Региональное рабочее совещание", "Обсуждение плана совместной программы", "Подведение итогов проекта"][i % 3], description: "Материалы и текущие задачи региональной команды.", startsAt: i < 6 ? `2026-12-0${i + 1}T09:00:00Z` : "2026-11-20T09:00:00Z", endsAt: i < 6 ? `2026-12-0${i + 1}T10:00:00Z` : "2026-11-20T10:00:00Z", durationMinutes: 60, status: "scheduled", source: "workspace", organizerUserId: user.id, organizerName: user.name, participantIds: [user.id], canEdit: true, canCancel: true })) };
  user.adminModeEnabled = true;
  const incomingDocuments = Array.from({ length: 36 }, (_, i) => ({ id: `letter-${i}`, revision: 1, number: `26/${151 + i}`, subject: ["Подготовка регионального рабочего совещания", "Материалы совместной программы", "Ответ на обращение подразделения"][i % 3], sender: "Управление региональных программ", receivedAt: "2026-11-25T05:00:00Z", addedAt: "2026-11-26T05:00:00Z", source: "exat", filesExpected: false, execution: null, canAssign: true, canOpenTask: false }));
  const telegram = { bots: [{ key: "ai_referent", label: "AI Referent", connected: true }, { key: "hisobot", label: "AI Hisobot", connected: true }, { key: "workspace_notifications", label: "Уведомления Workspace", connected: true }], people: people.map((p, i) => ({ userId: p.id, username: p.username, fullName: p.name, jobTitle: "Координатор региональных программ", telegramId: i % 2 ? null : String(120000001 + i), verified: i % 2 === 0, verificationSource: i % 2 ? null : "admin", botKeys: i % 2 ? [] : ["ai_referent", "hisobot"], revision: 1, hisobotScope: "central", hisobotRegion: null, hisobotReportRequired: true, hisobotManager: false })) };
  const survey = { analysis: { id: "survey-qa", title: "Опрос региональной команды", fileName: "team-answers.csv", revision: 1, archived: false, createdAt: "2026-11-25T07:00:00Z", updatedAt: "2026-11-26T07:00:00Z", configuration: { sheet: 0, headerRow: 0, types: {}, separator: ";", missingValues: [], query: "", filters: [], savedViews: [] } }, workbook: { warnings: [], sheets: [{ name: "Ответы", rows: [["Подразделение", "Оценка"], ...Array.from({ length: 64 }, (_, i) => [i % 2 ? "Региональная команда" : "Центральный аппарат", String(i % 5 + 1)])] }] } };
  const hub = { projects: Array.from({ length: 6 }, (_, i) => ({ id: `hub-${i}`, code: `REG-${26 + i}`, title: ["Региональная программа развития", "Поддержка молодёжных инициатив", "Цифровизация рабочих процессов"][i % 3], description: "Работа с региональными командами, проведение встреч и подготовка материалов.", managerUserId: user.id, responsibleUserIds: [people[0].id], approverUserIds: [user.id], startDate: "2026-11-01", endDate: "2026-12-15", budget: 20000000, currency: "UZS", accessStatus: "open", lifecycleStatus: i === 5 ? "completed" : "active", approvedAmount: 4500000, canEdit: true, chatId: null, createdByUserId: user.id, createdAt: "2026-11-01T07:00:00Z", updatedAt: "2026-11-26T07:00:00Z" })), workstreams: [], items: [], requests: [] };
  hub.workstreams = hub.projects.flatMap(p => Array.from({ length: 3 }, (_, i) => ({ id: `${p.id}-stream-${i}`, projectId: p.id, title: ["Региональные встречи", "Материалы программы", "Координация команды"][i], description: "Планирование и выполнение работ направления.", budget: 5000000, currency: "UZS", responsibleUserIds: [user.id], canEdit: true, createdByUserId: user.id, createdAt: p.createdAt, updatedAt: p.updatedAt })));
  hub.items = hub.workstreams.flatMap(w => Array.from({ length: 5 }, (_, i) => ({ id: `${w.id}-item-${i}`, projectId: w.projectId, workstreamId: w.id, kind: i % 2 ? "event" : "task", title: ["Подготовить программу встречи", "Провести встречу команды", "Согласовать материалы"][i % 3], description: "Подготовка материалов и проверка результата.", startsAt: "2026-12-02T07:00:00Z", dueAt: i === 0 ? "2026-11-25T12:00:00Z" : "2026-12-04T12:00:00Z", budget: 1000000, status: ["active", "planned", "completed", "rejected", "active"][i], assigneeUserIds: [user.id], calendarEventId: null, createdByUserId: user.id, createdAt: "2026-11-01T07:00:00Z", updatedAt: "2026-11-26T07:00:00Z", requestCount: 0, approvedRequestCount: 0, actions: [] })));
  const home = demo.home;
  const calendarEvents = Array.from({ length: 15 }, (_, i) => ({ ...home.calendarEvents[0], id: `calendar-${i}`, title: ["Рабочая встреча региональной команды", "Обсуждение материалов программы", "Согласование плана проекта"][i % 3], startsAt: `2026-11-${String(20 + i % 9).padStart(2, "0")}T${String(7 + i % 4).padStart(2, "0")}:00:00Z`, endsAt: `2026-11-${String(20 + i % 9).padStart(2, "0")}T${String(8 + i % 4).padStart(2, "0")}:00:00Z` }));
  return { user, people, tasks, requests, tripRequests, workflow, feedPosts, notifications, employees, departments, leaves, absenceRequests, presenceSummary, hr, members, zoom, incomingDocuments, telegram, survey, hub, home, calendarEvents, personalEfficiency: demo.personalEfficiency, recognition: demo.recognition, rates: demo.contextRates, weather: demo.contextWeather, reporting: require("./ui-reporting-fixtures.cjs")(user, people) };
}
async function measure(page, selector) {
  return page.locator(selector).evaluate(root => {
    const rect = node => { const r = node?.getBoundingClientRect(); return r ? { x: r.x, y: r.y, width: r.width, height: r.height, bottom: r.bottom, right: r.right } : null; };
    const hero = root.querySelector(".ws-section-header, .calendar-filters"), toolbar = root.querySelector(".ws2-process-toolbar, .task-filters, .notification-head-actions, .record-list-controls, .leave-filters, .absence-summary, .hr-tabs, .zoom-buckets, .members-search-row, .incoming-documents-controls, .telegram-access-controls, .survey-layout, .home-overview, .calendar-view-bar, .project-hub-layout"), search = root.querySelector(".workspace-search, .employee-search");
    return { hero: rect(hero), toolbar: rect(toolbar), search: rect(search), root: rect(root),
      pageOverflow: document.documentElement.scrollWidth - innerWidth,
      filters: rect(root.querySelector(".workspace-queue-filters")),
      metrics: rect(root.querySelector(".team-dash-metrics, .notification-metrics")),
      feed: rect(root.querySelector(".feed-layout")),
      controls: toolbar ? [...toolbar.children].filter(n => n.getBoundingClientRect().width).map(n => ({ class: n.className, ...rect(n) })) : [],
      rows: root.querySelectorAll("tbody tr, .approval-board-card, .kanban-card").length };
  });
}
(async () => {
  await fs.mkdir(path.join(output, phase), { recursive: true });
  const browser = await chromium.launch({ channel: "msedge", headless: true });
  const results = [], errors = [];
  try {
    for (const [width, height, theme] of galleryOnly ? [] : [[1440, 960, "dark"], [1440, 960, "light"], [1024, 768, "dark"], [390, 844, "dark"], ...((phase === "after" || topbarSuite || reportingSuite || registrySuite || communicationsSuite || calendarSurfacesSuite) && (peopleSuite || operationsSuite || documentsSuite || planningSuite || reportingSuite || registrySuite || communicationsSuite) ? [[320, 800, "dark"]] : []), ...((phase === "after" || topbarSuite || reportingSuite || registrySuite || communicationsSuite || calendarSurfacesSuite) && (documentsSuite || planningSuite || reportingSuite || registrySuite || communicationsSuite) ? [[720, 480, "dark"]] : [])].filter(([width]) => !onlyWidth || width === onlyWidth)) {
      const context = await browser.newContext({ viewport: { width, height }, reducedMotion: "reduce" });
      const page = await context.newPage(); page.setDefaultTimeout(15000);
      if (sidebarSuite) await page.addInitScript(require('./ui-sidebar-checks.cjs').installProbe);
      if (planningSuite || reportingSuite || registrySuite || communicationsSuite) await page.clock.setFixedTime(new Date(promptSuite ? "2026-11-26T12:39:00Z" : "2026-11-26T09:30:00Z"));
      page.on("pageerror", error => errors.push(error.message));
      if (communicationsSuite && phase === "after") page.on("console", message => {
        if (message.type() === "error" && /Encountered two children with the same key/.test(message.text())) errors.push(message.text());
      });
      await page.addInitScript(theme => localStorage.setItem("yuksalish:color-theme:last", theme), theme);
      let data, releaseIds = [], workdayWorking = false, workdayWrites = 0;
      await page.routeWebSocket("**/api/v1/events", socket => socket.onMessage(message => {
        const value = JSON.parse(String(message));
        socket.send(JSON.stringify({ type: value.type === "ping" ? "pong" : "authenticated" }));
      }));
      await page.route("**/api/v1/**", async route => {
        const request = route.request(), endpoint = new URL(request.url()).pathname.replace("/api/v1", "");
        const send = json => route.fulfill({ json: communicationsSuite && endpoint === "/workspace/bootstrap" ? { ...json, moduleAccess: data.communication.moduleAccess, projects: data.communication.projects, chats: data.home.chats, messages: data.home.messages } : registrySuite && endpoint === "/workspace/bootstrap" ? { ...json, moduleAccess: data.registry.moduleAccess } : json });
        if (/\/auth\/(web\/)?login$/.test(endpoint)) return send({ accessToken: "qa-token", expiresIn: 3600, user: data.user });
        if (shellReviewSuite && request.method() === 'POST' && /^\/workday\/(start|finish)$/.test(endpoint)) {
          workdayWrites++; workdayWorking = endpoint.endsWith('/start');
          return send({ status: workdayWorking ? 'working' : 'finished', schedule: { startsAt: '09:00', endsAt: '18:00' }, session: null });
        }
        if (registrySuite && endpoint === "/mail/messages/search") { const { query } = request.postDataJSON(); return send({ messages: data.registry.messages.filter(item => !query || `${item.subject} ${item.sender}`.toLocaleLowerCase().includes(query.toLocaleLowerCase())), nextPageToken: null }); }
        if (!["GET", "HEAD"].includes(request.method())) { if (endpoint.startsWith("/workday/")) workdayWrites++; return route.fulfill({ status: 403, json: { detail: "Synthetic QA: no writes" } }); }
        if (communicationsSuite && endpoint.startsWith('/ai-referent/')) {
          const fixture = data.communication, params = new URL(request.url()).searchParams, q = (params.get('query') || params.get('q') || '').toLocaleLowerCase(), offset = Number(params.get('offset') || 0);
          if (endpoint.endsWith('/visibility')) return send(fixture.visibility);
          if (endpoint.endsWith('/authority')) return send(fixture.authority);
          if (endpoint.endsWith('/reviewers')) return send(fixture.reviewers);
          if (toolbarSuite && endpoint.endsWith('/archive')) return send({ letters: [], totalCount: 0 });
          if (toolbarSuite && endpoint.endsWith('/journals')) return send({ files: [] });
          if (toolbarSuite && endpoint.endsWith('/telegram-link')) return send({ telegramId: '120000001' });
          if (endpoint.endsWith('/incoming')) { const letters = fixture.incoming.filter(item => [item.platformIncomingNumber, item.subject, item.senderOrganization, item.responsibleDisplayName].join(' ').toLocaleLowerCase().includes(q)); return send({ letters: letters.slice(offset, offset + 100), totalCount: fixture.incoming.length, filteredCount: letters.length, registeredCount: 96, attentionCount: 24, withAttachmentsCount: 120, lastSyncAt: '2026-11-26T07:00:00Z', journal: { available: false } }); }
          if (endpoint.endsWith('/letters')) { const letters = fixture.letters.filter(item => item.subject.toLocaleLowerCase().includes(q)); return send({ letters, participation: params.get('participation') || 'all', totalCount: letters.length, pendingReviewCount: 5, readyCount: 4, sentCount: 4, signedCount: 0 }); }
          if (endpoint.includes('/letters/')) return send(fixture.letters.find(item => item.id === endpoint.split('/').at(-1)));
          if (endpoint.endsWith('/recipients')) return send({ entries: [], totalCount: 0 });
        }
        if (endpoint === "/workspace/bootstrap") return send({ currentUser: { ...data.user, ...(planningSuite ? { departmentId: "qa-dept" } : {}) }, people: planningSuite ? data.people.map(p => ({ ...p, departmentId: "qa-dept" })) : data.people, tasks: planningSuite ? data.home.tasks : data.tasks, requests: data.requests, tripRequests: data.tripRequests, workflow: data.workflow, projectWorkflow: null, tripWorkflow: null, requestWorkflows: {}, projects: [], chats: planningSuite ? data.home.chats : [], messages: planningSuite ? data.home.messages : [], departments: planningSuite ? [{ ...data.departments[0], assignedUsersCount: data.people.length }] : [], positions: [], attachments: [], feedPosts: attentionSuite || planningSuite ? data.feedPosts : [], calendarEvents: planningSuite ? data.calendarEvents : [], notifications: attentionSuite ? data.notifications : planningSuite ? data.home.notifications : [], absenceRequests: peopleSuite ? data.absenceRequests : [], presenceSummary: peopleSuite ? data.presenceSummary : [], canCreatePaymentRequests: true, notificationPreferences: { desktopEnabled: false, soundEnabled: false, messagesEnabled: true, tasksEnabled: true, approvalsEnabled: true, calendarEnabled: true, tripsEnabled: true, remindersEnabled: true } });
        if (planningSuite && endpoint === "/profile/me/efficiency") return send(data.personalEfficiency);
        if (registrySuite && endpoint === "/grants") return send(data.registry.grants);
        if (registrySuite && endpoint === "/grants/settings") return send(data.registry.grantSettings);
        if (registrySuite && endpoint.startsWith("/grants/")) return send(data.registry.grants.find(item => item.id === endpoint.split("/").at(-1)));
        if (registrySuite && endpoint === "/reference") return send(data.registry.reference);
        if (registrySuite && endpoint === "/mail/connection") return send(data.registry.connection);
        if (registrySuite && endpoint === "/mail/drafts") return send([]);
        if (registrySuite && endpoint.startsWith("/mail/threads/")) return send({ messages: [data.registry.messages.find(item => item.threadId === endpoint.split("/").at(-1))], truncated: false });
        if (planningSuite && endpoint.startsWith("/recognition/profiles/")) return send(data.recognition);
        if (planningSuite && endpoint === "/home/reactions") return send({ totalCount: 7, reactions: [{ emoji: "👍", count: 7 }] });
        if (planningSuite && endpoint === "/ai-referent/incoming") return send({ letters: [], totalCount: 0, filteredCount: 0, registeredCount: 0, attentionCount: 0, withAttachmentsCount: 0, journal: { available: false } });
        if (planningSuite && endpoint === "/incoming-letters") return send({ visibility: "assigned", deadline_timezone_verified: false, meta: { page: 1, limit: 20, total: 0 }, data: [] });
        if (reportingSuite && endpoint === "/monthly-reports") return send(data.reporting.monthly);
        if (reportingSuite && endpoint === "/hisobot/me") return send(data.reporting.hisobot.profile);
        if (promptSuite && endpoint === "/hisobot/me/activity-draft") return send({ reportDate: "2026-11-26", generatedAt: "2026-11-26T12:40:00Z", seenAt: null, content: "Отчёт за 26.11.2026\n\n1. Подготовлен результат по задаче.", activityCount: 1, omittedCount: 0 });
        if (promptSuite && /^\/chats\/[^/]+\/messages$/.test(endpoint)) return send(data.home.messages.filter(message => message.chatId === endpoint.split("/")[2]));
        if (reportingSuite && endpoint === "/hisobot/me/history") return send(data.reporting.hisobot.reports.slice(0, 3));
        if (reportingSuite && endpoint === "/hisobot/reports") return send(data.reporting.hisobot.reports);
        if (reportingSuite && /\/hisobot\/(me\/unit-history|unit-reports)$/.test(endpoint)) return send([]);
        if (endpoint === "/efficiency") return send(reportingSuite ? data.reporting.efficiency : { period: "2026-11", timezone: "Asia/Tashkent", methodologyVersion: "EFF-1", trackingStartedAt: "2026-09-01T00:00:00Z", currentUserId: data.user.id, employees: [] });
        if (endpoint === "/hr") return send(data.hr);
        if (endpoint === "/telegram-access") return send(data.telegram);
        if (endpoint === "/survey-analyses") return send([data.survey.analysis]);
        if (endpoint === "/survey-analyses/survey-qa") return send(data.survey);
        if (endpoint === "/incoming-documents") {
          const params = new URL(request.url()).searchParams, q = (params.get("q") || "").toLocaleLowerCase(), offset = Number(params.get("offset") || 0);
          const items = data.incomingDocuments.filter(d => `${d.number} ${d.subject} ${d.sender}`.toLocaleLowerCase().includes(q));
          return send({ documents: items.slice(offset, offset + 30), total: items.length, offset, limit: 30 });
        }
        if (endpoint.startsWith("/incoming-documents/")) return send({ document: data.incomingDocuments.find(d => d.id === endpoint.split("/").at(-1)), files: [] });
        if (endpoint === "/members") return send(data.members);
        if (endpoint === "/personnel-dossiers/context") return send({ canManageAccess: false, canViewPhotoRoster: false });
        if (endpoint === "/zoom-meetings") return send(data.zoom);
        if (endpoint === "/zoom-meetings/availability") return send({ configured: true, timezone: "Asia/Tashkent", slotMinutes: 15, hostCalendarSynced: true, intervals: [] });
        if (endpoint === "/workday/team") return send({ asOf: "2026-11-26T07:00:00Z", members: [], workingCount: 0 });
        if (endpoint === "/grants") return send([]);
        if (endpoint === "/ai-referent/signature-inbox") return send({ items: [], totalCount: 0, offset: 0 });
        if (endpoint === "/personal-preferences/release-history") return send({ readEntryIds: releaseIds });
        if (endpoint === "/workday/me") return send({ status: workdayWorking ? "working" : "not_started", schedule: { startsAt: "09:00", endsAt: "18:00" }, session: null });
        if (endpoint === "/support-requests") return send({ mode: "inbox", requests: [], unreadResponseCount: 0, indicator: null });
        if (endpoint === "/updates/policy") return send({ mandatory: false, minimumVersion: null, publishedVersion: null });
        if (endpoint.includes("/approval-inbox/")) return send({ enabled: false, items: [] });
        if (endpoint === "/project-hub" || endpoint.includes("/targets")) return send(planningSuite ? data.hub : { projects: [], workstreams: [], items: [], requests: [] });
        if (endpoint.includes("/task-plans") || endpoint.includes("/task-proposals")) return send([]);
        if (endpoint.includes("/dossier/reminder")) return send({ period: "2026-11", dueDate: "2026-11-25", due: false, status: "no_changes", respondedAt: null });
        if (endpoint === "/leave-requests/context") return send({ hrUserId: data.people[0].id, deputyUserId: data.people[1].id, canConfigureSignature: false, signatureReady: true, tenureRules: [], canEditTenureRules: false });
        if (endpoint === "/leave-requests") return send(data.leaves);
        if (endpoint.includes("/directory")) return send({ canTerminateEmployees: true, employees: peopleSuite ? data.employees : data.people, people: data.people, roles: [], positions: [{ id: "qa-position", name: "Координатор региональных программ", isActive: true, sortOrder: 0 }], departments: peopleSuite ? data.departments : [], modules: [], accessRules: [] });
        if ((topbarSuite || reportingSuite) && endpoint === "/assistant/chats") return send([{ id: "qa-assistant-chat", title: "Рабочие вопросы", isDefault: true, isPinned: false, createdAt: "2026-11-26T08:00:00Z", updatedAt: "2026-11-26T08:00:00Z" }]);
        if ((topbarSuite || reportingSuite) && endpoint === "/assistant/messages") return send([]);
        if (topbarSuite && endpoint.includes("/context/exchange")) return send(data.rates);
        if (topbarSuite && endpoint.includes("/weather")) return send(data.weather);
        if (endpoint.includes("/context/exchange")) return send({ rates: [], asOf: "2026-11-26", stale: false });
        if (endpoint.includes("/weather")) return send({ regions: [], places: [], asOf: "2026-11-26", stale: false });
        return route.fulfill({ status: 204, body: "" });
      });
      await page.goto(origin);
      data = fixtures(await page.evaluate(async () => { const d = await import("/src/renderer/test-fixtures/demo-data.ts"), h = await import("/src/renderer/test-fixtures/personal-home-fixture.ts"), c = await import("/qa/context-fixtures.ts"); return { people: d.people, initialTasks: d.initialTasks, home: h.homeFixture("malika", Date.parse("2026-11-26T09:30:00Z")), personalEfficiency: h.homeEfficiency("malika"), recognition: h.homeRecognition("malika"), contextRates: c.contextRates, contextWeather: c.contextWeather }; }));
      if (promptSuite) data.home.notifications = [...data.home.notifications, { id: "qa-hisobot-reminder", kind: "hisobot", title: "AI Hisobot", body: "Черновик отчёта готов", priority: "attention", section: "ai_hisobot", requiresAction: true, isReminder: true, occurredAt: "2026-11-26T12:40:00Z" }];
      if (calendarSurfacesSuite) {
        data.home.tasks = Array.from({ length: 96 }, (_, i) => ({ ...data.tasks[i % data.tasks.length], id: `qa-calendar-task-${i}`, title: `Рабочая задача ${String(i + 1).padStart(2, '0')}`, status: 'in_progress', assigneeId: data.user.id, dueAt: `2026-11-${i < 35 ? '26' : '27'}T09:00:00Z` }));
        data.calendarEvents = Array.from({ length: 35 }, (_, i) => ({ ...data.calendarEvents[0], id: `qa-agenda-${i}`, title: `Региональная встреча ${String(i + 1).padStart(2, '0')}`, startsAt: '2026-11-26T09:00:00Z', endsAt: '2026-11-26T10:00:00Z', status: 'scheduled' }));
      }
      releaseIds = await page.evaluate(async () => (await import("/src/renderer/release-history.ts")).bundledReleaseEntries().map(entry => entry.id));
      if (communicationsSuite) { data.communication = require('./ui-communication-fixtures.cjs')(data.people, data.user); data.communication.moduleAccess = await page.evaluate(async () => (await import('/src/renderer/module-catalog.ts')).fallbackModules.map(module => ({ moduleKey: module.key, permissions: { view: true, create: true, edit: true, approve: true, admin: true } }))); }
      if (registrySuite) { data.registry = registryFixtures(data.people, data.user); data.registry.moduleAccess = await page.evaluate(async () => (await import('/src/renderer/module-catalog.ts')).fallbackModules.map(module => ({ moduleKey: module.key, permissions: { view: true, create: true, edit: true, approve: true, admin: true } }))); }
      if (communicationsSuite) data.home.chats = [...data.home.chats.map(chat => ({ ...chat, unread: 0 })), { ...data.home.chats[0], id: 'qa-legacy-project-chat', title: 'Проект: региональные инициативы', preview: 'План работ и материалы проекта', unread: 0, kind: 'group', contextType: 'project', contextId: 'legacy-project-0' }];
      if (chatPaginationSuite) data.home.chats.push(...['group', 'task', 'project', 'trip'].flatMap(kind => Array.from({ length: 100 }, (_, i) => ({
        ...data.home.chats[0], id: `qa-paged-${kind}-${i}`, title: `Переписка ${kind} ${String(i).padStart(3, '0')}`, preview: 'Материалы и рабочее обсуждение', unread: 0,
        kind: kind === 'task' ? 'task' : 'group', contextType: kind === 'group' ? undefined : kind, contextId: undefined,
      }))));
      await page.evaluate(({ id, theme }) => localStorage.setItem(`yuksalish:color-theme:${id}`, theme), { id: data.user.id, theme });
      await page.getByRole("textbox", { name: /Логин/ }).fill("qa-user");
      await page.getByLabel(/Пароль/).fill("qa-only-password");
      await page.getByRole("button", { name: "Войти", exact: true }).click(); await page.locator(".app-shell").waitFor();
      for (const section of sections) {
        // Isolate responsive content geometry from the separately tested rail drawer.
        await page.setViewportSize({ width: 1440, height: 960 }); await settle(page);
        if (communicationsSuite && section.id === 'legacy-projects') {
          if (toolbarSuite) {
            const messenger = page.getByRole('button', { name: 'Мессенджер', exact: true }).or(page.getByRole('menuitem', { name: 'Мессенджер', exact: true }));
            if (!await messenger.isVisible()) await page.getByRole('button', { name: /^Ещё,/ }).click();
            await messenger.click(); await page.locator('.chat-buckets').waitFor();
          }
          await page.locator('.chat-buckets').getByRole('button', { name: /^Ещё/ }).click();
          await page.getByRole('menuitem', { name: /^Чаты проектов/ }).click();
          await page.locator('.chat-list').getByRole('button', { name: /Проект: региональные инициативы/ }).click();
          await page.getByRole('button', { name: 'Открыть проект', exact: true }).click();
          await page.getByRole('dialog').waitFor(); await page.keyboard.press('Escape'); await page.getByRole('dialog').waitFor({ state: 'hidden' });
        } else {
        const nav = section.id === "notifications" ? page.locator(".notification-bell") : registrySuite || communicationsSuite ? page.getByRole("button", { name: section.navLabel || section.label, exact: true }).or(page.getByRole("menuitem", { name: section.navLabel || section.label, exact: true })) : reportingSuite ? page.getByRole("button", { name: section.navLabel || section.label, exact: true }) : page.locator(`.rail-action[aria-label="${section.navLabel || section.label}"]`);
        if (!await nav.isVisible()) {
          const menu = page.getByRole("button", { name: "Открыть меню", exact: true });
          if (await menu.count()) await menu.click();
          const more = page.getByRole("button", { name: /^Ещё,/ });
          if (!await nav.isVisible() && await more.count()) await more.click();
        }
        if ((reportingSuite && ["hisobot", "monthly"].includes(section.id) || communicationsSuite && section.id === "referent") && !await nav.isVisible()) await page.getByRole("button", { name: "ИИ-модули", exact: true }).click();
        // Keyboard activation also works for entries in the overflow portal.
        if (peopleSuite) await nav.click();
        else { await nav.focus(); await nav.press("Enter"); }
        }
        if (reportingSuite && section.id === "efficiency") { await page.getByRole("button", { name: "Эффективность", exact: true }).click(); await page.locator(".eff-summary .eff-gauge-ring strong").first().waitFor(); }
        if (reportingSuite && section.id === "hisobot") await page.locator("#hisobot-report-text").waitFor();
        if (reportingSuite && section.id === "monthly") await page.locator(".monthly-reports-period").waitFor();
        if (communicationsSuite && section.id === 'referent') {
          await page.getByRole('tab', { name: referentSurfacesSuite ? 'Исходящие' : 'Входящие', exact: true }).click();
          await page.locator(referentSurfacesSuite ? '.ai-referent-row' : '.ai-incoming-table tbody tr').first().waitFor();
        }
        if (communicationsSuite && section.id === 'legacy-projects') await page.locator('.project-card').first().waitFor();
        if (communicationsSuite && section.id === 'messenger') await page.locator('.chat-row').first().waitFor();
        if (registrySuite && section.id === "grants") await page.locator('.grant-records tbody tr').first().waitFor();
        if (registrySuite && section.id === "reference") { await page.getByRole('button', { name: 'Организации', exact: true }).click(); await page.locator('.reference-record').first().waitFor(); }
        if (registrySuite && section.id === "mail") await page.locator('.mail-row').first().waitFor();
        if (calendarSurfacesSuite && section.id === 'tasks') {
          await page.locator('.tasks-view .view-switch').getByRole('button', { name: 'Список', exact: true }).click();
          await settle(page);
          if (phase === 'after') {
            const borders = await page.locator('.tasks-view .workspace-select, .tasks-view .record-page-nav, .task-domain-tabs').evaluateAll(nodes => nodes.map(node => { const s = getComputedStyle(node); return [s.borderTopWidth, s.borderBottomWidth, s.borderLeftWidth, s.borderRightWidth]; }));
            assert(borders.length >= 4 && borders.every(sides => sides.every(width => width === '0px')), 'filters, pagination and upper tabs are borderless');
          }
          await capture(page, path.join(output, phase, `task-controls-${theme}-${width}.png`));
          await page.locator('.tasks-view .view-switch').getByRole('button', { name: 'Календарь', exact: true }).click();
          await page.locator('.task-calendar-embedded').waitFor();
        }
        try { await page.locator(section.root).waitFor(); } catch (error) {
          await page.screenshot({ path: path.join(output, `${phase}-failure-${width}.png`) });
          console.log((await page.locator(".workspace").innerText().catch(() => page.locator("body").innerText())).slice(0, 2500));
          throw error;
        }
        await page.setViewportSize({ width, height });
        await settle(page);
        await page.locator("#workspace-content").focus();
        await page.mouse.move(width - 1, 0);
        const file = `${section.id}-${theme}-${width}.png`;
        await capture(page, path.join(output, phase, file));
        if (topbarSuite && section.id === "home" || phase === "after" && reportingSuite && section.id === "hisobot") await capture(page.locator(".global-bar"), path.join(output, phase, `topbar-${theme}-${width}.png`));
        const geometry = await measure(page, section.root);
        results.push({ section: section.id, width, height, theme, ...geometry });
        if (surfaceFollowupSuite) { await require('./ui-surface-followup-checks.cjs')(page, section, { output, phase, width, theme, geometry }); console.log('PASS ' + file); continue; }
        if (calendarSurfacesSuite) { if (phase === 'after') await require('./ui-calendar-surface-checks.cjs')(page, section, { width, geometry }); console.log('PASS ' + file); continue; }
        if (referentSurfacesSuite) { results.at(-1).letters = await require('./ui-referent-surface-checks.cjs')(page, { output, phase, width, theme, geometry }); console.log('PASS ' + file); continue; }
        if (sidebarSuite) { results.at(-1).sidebar = await require('./ui-sidebar-checks.cjs').check(page, { output, phase, width, height, theme }); console.log('PASS sidebar-' + theme + '-' + width); continue; }
        if (chatPaginationSuite) { await require('./ui-chat-pagination-checks.cjs')(page, { output, width, theme }); console.log('PASS ' + file); continue; }
        if (toolbarSuite) { if (phase === 'after') await require('./ui-toolbar-checks.cjs')(page, section, { width, geometry }); console.log('PASS ' + file); continue; }
        if (shellReviewSuite) {
          if (phase === 'after') await require('./ui-shell-checks.cjs')(page, section, { width, theme, geometry, output });
          await capture(page.locator('.global-bar'), path.join(output, phase, `topbar-${theme}-${width}.png`));
          console.log('PASS ' + file); continue;
        }
        if (communicationsSuite) { if (phase === 'after') await require('./ui-communication-checks.cjs')(page, section, { width, geometry }); console.log('PASS ' + file); continue; }
        if (registrySuite && phase === "after") {
          assert(geometry.pageOverflow <= 1, `${file}: page overflow`);
          const pane = page.locator(`${section.root} ${section.id === 'grants' ? '.grant-records' : section.id === 'reference' ? '.reference-content' : '.mail-workspace'}`);
          const bounds = await pane.boundingBox();
          assert(Math.abs(bounds.x - geometry.hero.x) <= 1 && bounds.x + bounds.width <= geometry.hero.right + 1, `${file}: shared panel edges`);
          const field = section.id === 'mail' ? page.getByRole('textbox', { name: 'Поиск писем', exact: true }) : page.getByRole('searchbox', { name: section.id === 'grants' ? 'Поиск заявок' : 'Поиск по справочнику', exact: true });
          const rows = page.locator(`${section.root} ${section.id === 'grants' ? '.record-row' : section.id === 'reference' ? '.reference-record' : '.mail-row'}`);
          const count = await rows.count(); assert(count > 0, `${file}: populated registry`);
          await field.fill('несуществующий-qa-результат');
          if (section.id === 'mail') await page.getByRole('button', { name: 'Найти', exact: true }).click();
          await rows.first().waitFor({ state: 'hidden' });
          assert((await measure(page, section.root)).pageOverflow <= 1, `${file}: expanded search overflow`);
          await field.fill('');
          if (section.id === 'mail') await page.getByRole('button', { name: 'Найти', exact: true }).click();
          await rows.first().waitFor(); assert.equal(await rows.count(), count, `${file}: clearing restores rows`);
          if (section.id === 'reference') {
            await page.getByLabel('Архив', { exact: true }).check();
            assert.equal(await rows.count(), count + 1, `${file}: archive remains accessible`);
            await page.getByLabel('Архив', { exact: true }).uncheck();
            await page.getByRole('button', { name: 'Юксалиш', exact: true }).click();
            await page.getByRole('button', { name: 'Изменить', exact: true }).click();
            const dialog = page.getByRole('dialog', { name: 'Реквизиты «Юксалиш»', exact: true });
            await dialog.getByRole('textbox', { name: 'ИНН', exact: true }).fill('123456789');
            await dialog.getByRole('button', { name: 'Сохранить', exact: true }).click();
            await dialog.getByRole('alert').waitFor();
            assert.equal(await dialog.getByRole('textbox', { name: 'ИНН', exact: true }).inputValue(), '123456789', 'rejected save preserves input');
            await dialog.getByRole('button', { name: 'Отмена', exact: true }).click();
            await dialog.waitFor({ state: 'hidden' });
            await page.getByRole('button', { name: 'Организации', exact: true }).click();
          }
          if (section.id === 'mail') {
            await page.getByRole('button', { name: 'Управление Gmail', exact: true }).click();
            await page.getByRole('menuitem', { name: 'Переподключить Gmail', exact: true }).waitFor();
            assert(await page.getByRole('menuitem', { name: 'Отключить Gmail', exact: true }).isVisible());
            await page.keyboard.press('Escape');
            if (width <= 720) {
              await page.getByLabel('Папка почты', { exact: true }).selectOption('drafts');
              await page.getByText('Писем в этом списке нет.', { exact: true }).waitFor();
              await page.getByLabel('Папка почты', { exact: true }).selectOption('inbox');
              await rows.first().waitFor();
            }
          }
          await page.emulateMedia({ forcedColors: 'active' });
          assert((await measure(page, section.root)).pageOverflow <= 1, `${file}: forced colors overflow`);
          await page.emulateMedia({ forcedColors: 'none' });
          console.log(`PASS ${file}: edges, search/reset, navigation, forced colors`);
          continue;
        }
        if (promptSuite) {
          let beforeBounds = await page.locator(section.root).boundingBox();
          let composer;
          if (section.id === "messenger") {
            composer = page.locator('.messenger-view textarea, .messenger-view [contenteditable="true"]').first();
            if (!await composer.isVisible()) await page.locator('.chat-row, .chat-list-item, .chat-item').first().click();
            await composer.fill("Сообщение до появления уведомления");
            await composer.focus();
            beforeBounds = await page.locator(section.root).boundingBox();
          }
          await page.clock.setFixedTime(new Date("2026-11-26T12:41:00Z"));
          await page.evaluate(() => window.dispatchEvent(new Event("focus")));
          const notice = page.locator('.hisobot-draft-notice'); await notice.waitFor();
          assert.equal(await page.getByRole('dialog').count(), 0, 'no modal interruption');
          if (composer) {
            assert(await composer.evaluate(node => node === document.activeElement), 'messenger keeps focus');
            await composer.fill("Сообщение после появления уведомления");
          }
          assert.deepEqual(await page.locator(section.root).boundingBox(), beforeBounds, 'section geometry unchanged');
          await capture(page, path.join(output, phase, file));
          await page.getByRole('button', { name: 'Закрыть уведомление AI Hisobot' }).click();
          await page.evaluate(() => document.dispatchEvent(new Event('visibilitychange')));
          assert.equal(await notice.count(), 0, 'dismissal stays closed');
          console.log(`PASS ${file}: nonmodal reminder and usable section`);
          continue;
        }
        if (workdaySuite) {
          let startFill;
          for (const working of [false, true]) {
            workdayWorking = working;
            await page.evaluate(() => document.dispatchEvent(new Event("visibilitychange")));
            const trigger = page.getByRole("button", { name: working ? "Рабочий день: Сейчас в работе" : "Рабочий день: Работа не начата", exact: true });
            if (phase === "after") {
              await page.locator(".global-bar").evaluate(bar => { bar.scrollLeft = 0; }); await settle(page);
              const bounds = await trigger.boundingBox(); assert(bounds.x >= 0 && bounds.x + bounds.width <= width, "workday action is visible without scrolling");
              assert.equal(await trigger.getAttribute("data-action"), working ? "finish" : "start");
              assert.notEqual(await trigger.locator(".workday-control-glyph").evaluate(node => getComputedStyle(node).backgroundColor), "rgba(0, 0, 0, 0)");
            }
            await trigger.waitFor(); await trigger.scrollIntoViewIfNeeded(); await trigger.click();
            const panel = page.getByRole("dialog", { name: "Рабочий день", exact: true }); await panel.waitFor(); await settle(page);
            const action = panel.getByRole("button", { name: working ? "Завершить работу" : "Начать работу", exact: true });
            const name = working ? "workday-finish" : "workday-start";
            await page.mouse.move(0, 0); await capture(panel, path.join(output, phase, `${name}-${theme}-${width}.png`));
            if (phase === "after") {
              const fill = await action.evaluate(node => getComputedStyle(node).backgroundColor);
              if (!working) startFill = fill; else assert.notEqual(fill, startFill, "start and finish have distinct materials");
              await page.emulateMedia({ reducedMotion: "no-preference" });
              await action.hover();
              await action.evaluate(async node => {
                await new Promise(resolve => requestAnimationFrame(() => requestAnimationFrame(resolve)));
                for (const animation of node.getAnimations({ subtree: true })) { animation.pause(); animation.currentTime = Math.min(210, Number(animation.effect.getTiming().duration) / 2); }
              });
              assert(Number(await action.locator(".workday-action-glint").evaluate(node => getComputedStyle(node).opacity)) > 0, "hover glint is visible");
              await capture(panel, path.join(output, phase, `${name}-hover-${theme}-${width}.png`));
              await action.evaluate(node => node.getAnimations({ subtree: true }).forEach(animation => animation.finish()));
              await page.mouse.down();
              await action.evaluate(async node => {
                await new Promise(resolve => requestAnimationFrame(() => requestAnimationFrame(resolve)));
                for (const animation of node.getAnimations({ subtree: true })) { animation.pause(); animation.currentTime = Number(animation.effect.getTiming().duration); }
              });
              assert.equal(await action.locator(".workday-action-impact").evaluate(node => getComputedStyle(node).opacity), "1", "pressed highlight is visible");
              await capture(panel, path.join(output, phase, `${name}-pressed-${theme}-${width}.png`));
              await page.mouse.move(0, 0); await page.mouse.up();
              const bounds = await action.boundingBox(); assert(bounds.height >= 44 && bounds.width >= 44);
              assert.equal(await action.evaluate(node => getComputedStyle(node).borderTopWidth), "0px");
              await page.emulateMedia({ reducedMotion: "reduce" });
              await action.hover(); await settle(page);
              assert.equal(await action.evaluate(node => node.getAnimations({ subtree: true }).length), 0, "reduced motion: no workday animation");
              await page.emulateMedia({ forcedColors: "active" }); await action.focus(); await page.keyboard.press("Shift+Tab"); await page.keyboard.press("Tab"); await settle(page);
              assert.equal(await action.evaluate(node => getComputedStyle(node).outlineStyle), "solid", "high contrast keyboard focus");
              assert.equal(await action.locator(".workday-action-glint").evaluate(node => getComputedStyle(node).display), "none");
              await page.emulateMedia({ forcedColors: "none" });
            }
            await page.keyboard.press("Escape"); await panel.waitFor({ state: "hidden" });
          }
          assert.equal(workdayWrites, 0, "visual QA never changes attendance");
        }
        if (phase === "after" && !workdaySuite && (topbarSuite || reportingSuite)) {
          const toolbar = await page.locator(".global-bar").evaluate(bar => {
            const controls = [...bar.querySelectorAll(".browser-menu-trigger, .section-jump-trigger, .notification-bell, .color-theme-toggle, .assistant-launcher, .workspace-identity-menu, .connection-indicator, .context-trigger, .workday-control-mobile-trigger")].filter(node => node.getBoundingClientRect().height > 0);
            return controls.map(node => { const rect = node.getBoundingClientRect(), style = getComputedStyle(node); return { name: node.className, x: rect.x, y: rect.y, width: rect.width, height: rect.height, fill: style.backgroundColor, image: style.backgroundImage, shadow: style.boxShadow, radius: style.borderRadius, border: style.borderTopWidth }; });
          });
          for (const control of toolbar) {
            assert(Math.abs(control.height - 44) <= 1, `${file}: toolbar height ${control.name}`);
            if (control.name.includes('section-jump-trigger')) {
              assert(control.width >= 180, `${file}: readable search field`);
              assert.equal(control.radius, '14px'); assert.equal(control.border, '0px'); assert.equal(control.shadow, 'none');
              assert.notEqual(control.fill, 'rgba(0, 0, 0, 0)'); continue;
            }
            assert.equal(control.radius, "50%", `${file}: toolbar corner ${control.name}`);
            assert.equal(control.border, "0px", `${file}: toolbar without frames ${control.name}`);
            assert.equal(control.fill, "rgba(0, 0, 0, 0)", `${file}: transparent toolbar fill ${control.name}`);
            assert.equal(control.image, "none", `${file}: no gradient frame ${control.name}`);
            assert.equal(control.shadow, "none", `${file}: no inset frame ${control.name}`);
            if (width <= 1023) assert(Math.abs(control.width - 44) <= 1, `${file}: compact toolbar target ${control.name}`);
          }
          assert.equal(await page.locator(".section-jump-trigger").isVisible(), width > 700, `${file}: phone search stays hidden`);
          if (width <= 1023) {
            const positions = [...toolbar].sort((a, b) => a.x - b.x);
            const gaps = positions.slice(1).map((item, index) => item.x - positions[index].x - positions[index].width);
            assert(Math.min(...gaps) >= 7, `${file}: toolbar minimum spacing`);
            assert(Math.max(...gaps) - Math.min(...gaps) <= 1, `${file}: equal toolbar spacing`);
          }
          if (section.id === "home" || reportingSuite && section.id === "hisobot") {
            const avatarSize = await page.locator(".workspace-identity-menu .fui-Avatar").boundingBox();
            const orbSize = await page.locator(".assistant-launcher > .gradient-orb, .assistant-launcher > .gradient-orb-fallback").boundingBox();
            assert.equal(avatarSize.width, 40); assert.equal(avatarSize.height, 40);
            assert.equal(orbSize.width, avatarSize.width); assert.equal(orbSize.height, avatarSize.height);
            await page.locator(".notification-bell").hover(); await settle(page);
            const hover = await page.locator(".notification-bell").evaluate(node => { const style = getComputedStyle(node, "::before"); return { width: style.width, height: style.height, radius: style.borderRadius, fill: style.backgroundColor }; });
            assert.deepEqual({ width: hover.width, height: hover.height, radius: hover.radius }, { width: "40px", height: "40px", radius: "50%" });
            assert.notEqual(hover.fill, "rgba(0, 0, 0, 0)");
            for (const selector of [".assistant-launcher", ".workspace-identity-menu"]) {
              await page.locator(selector).hover(); await settle(page);
              const style = await page.locator(selector).evaluate(node => ({ fill: getComputedStyle(node).backgroundColor, before: getComputedStyle(node, "::before").content }));
              assert.deepEqual(style, { fill: "rgba(0, 0, 0, 0)", before: "none" }, `${file}: portrait/orb has no hover backing`);
            }
            const themeButton = page.locator(".color-theme-toggle"), targetTheme = theme === "dark" ? "тёмную" : "светлую";
            await themeButton.scrollIntoViewIfNeeded(); await themeButton.click();
            await page.getByRole("button", { name: `Включить ${targetTheme} тему`, exact: true }).waitFor(); await themeButton.click();
            for (const [trigger, title] of [[".context-currency-trigger", "Курсы валют"], [".context-weather-trigger", "Погода Узбекистана"]]) {
              await page.locator(trigger).scrollIntoViewIfNeeded(); await page.locator(trigger).click();
              await page.getByRole("dialog", { name: title, exact: true }).waitFor(); await page.keyboard.press("Escape");
              await page.getByRole("dialog", { name: title, exact: true }).waitFor({ state: "hidden" });
              await settle(page);
              assert.equal(await page.locator(trigger).evaluate(node => node === document.activeElement), true, `${file}: restore ${trigger} focus; active=${await page.evaluate(() => document.activeElement?.outerHTML.slice(0, 500))}`);
            }
            await page.locator(".workspace-identity-menu").scrollIntoViewIfNeeded(); await page.locator(".workspace-identity-menu").click();
            await page.getByRole("button", { name: "Настройки", exact: true }).waitFor(); await page.keyboard.press("Escape");
            await page.getByRole("button", { name: "Настройки", exact: true }).waitFor({ state: "hidden" });
            await page.locator(".connection-indicator").scrollIntoViewIfNeeded(); await page.locator(".connection-indicator").click();
            await page.getByText("Связь с рабочим сервером", { exact: true }).waitFor(); await page.keyboard.press("Escape");
            await page.getByText("Связь с рабочим сервером", { exact: true }).waitFor({ state: "hidden" });
            if (width <= 1023) {
              await page.locator(".workday-control-mobile-trigger").scrollIntoViewIfNeeded(); await page.locator(".workday-control-mobile-trigger").click();
              await page.getByRole("dialog", { name: "Рабочий день", exact: true }).waitFor();
              assert(await page.getByRole("button", { name: "Начать работу", exact: true }).isEnabled(), `${file}: workday action retained`);
              await page.keyboard.press("Escape"); await page.getByRole("dialog", { name: "Рабочий день", exact: true }).waitFor({ state: "hidden" });
              await page.locator(".browser-menu-trigger").scrollIntoViewIfNeeded(); await page.locator(".browser-menu-trigger").click();
              await page.locator("#browser-navigation").waitFor(); await page.keyboard.press("Escape"); await page.locator("#browser-navigation").waitFor({ state: "hidden" });
            }
            await page.locator(".global-bar").evaluate(bar => { bar.scrollLeft = 0; });
          }
        }
        if (phase === "after") {
          const framed = await page.locator(section.root).evaluate(root => [...root.querySelectorAll(".ws-section-header, .record-table-frame, .team-dash-metric, .team-dash-panel, .notification-metrics > button, .notification-progress-card, .feed-card, .feed-context-card, .leave-list-area, .leave-detail, .leave-list-item, .absence-summary > button, .absence-column, .absence-card, .hr-summary > div, .members-summary > div, .members-regional-ranking, .zoom-split, .zoom-row, .zoom-side, .incoming-document-row, .incoming-status, .telegram-access-overview > span, .telegram-access-row, .telegram-access-bot, .survey-panel, .survey-file-drop, .survey-analysis-item")].filter(node => {
            const style = getComputedStyle(node);
            return [style.borderTopWidth, style.borderRightWidth, style.borderBottomWidth, style.borderLeftWidth].some(value => parseFloat(value) > 0)
              || style.boxShadow.includes("inset") || style.backgroundImage.includes("conic-gradient");
          }).map(node => node.className));
          assert.deepEqual(framed, [], `${file}: decorative surface frames`);
        }
        if (phase === "after") {
          const next = page.getByRole("button", { name: /^Следующая страница:/ }).first();
          if (await next.count() && await next.isEnabled()) {
            await next.click();
            await page.getByRole("button", { name: /^Предыдущая страница:/ }).first().click();
          }
        }
        if (phase === "after" && reportingSuite) {
          const surfaces = await page.locator(section.root).evaluate(root => [...root.querySelectorAll(".hisobot-panel, .hisobot-activity-draft, .hisobot-tabs, .monthly-reports-panel, .monthly-reports-attachments, .eff-summary, .eff-method-card, .eff-coverage-card, .eff-people, .eff-commandbar, .eff-deadline-explanation")].filter(node => {
            const style = getComputedStyle(node); return parseFloat(style.borderTopWidth) > 0 || style.boxShadow.includes("inset") || style.backgroundImage.includes("conic-gradient");
          }).map(node => node.className));
          assert.deepEqual(surfaces, [], `${file}: reporting surfaces without frames`);
          assert.equal(geometry.pageOverflow, 0, `${file}: no reporting page overflow`);
          if (section.id === "hisobot") {
            const field = page.locator("#hisobot-report-text"); await field.fill("Мой черновик для проверки интерфейса");
            assert(await page.getByRole("button", { name: "Отправить отчёт", exact: true }).isEnabled());
            await page.getByRole("button", { name: "Моя история", exact: true }).click();
            assert.equal(await page.locator(".hisobot-report-card").count(), 3);
            await page.getByRole("button", { name: "Отчёты сотрудников", exact: true }).click();
            await page.locator(".hisobot-report-card").first().waitFor();
            assert.equal(await page.locator(".hisobot-report-card").count(), 24);
            const search = page.getByRole("searchbox", { name: "Поиск отчётов" });
            await search.fill("НетТакогоОтчета"); await page.getByText("По вашему запросу отчётов нет. Измените поиск или подразделение.", { exact: true }).waitFor();
            await search.fill("Самарканд"); assert.equal(await page.locator(".hisobot-report-card").count(), 8);
            await search.fill(""); await page.getByRole("combobox", { name: "Контур отчётности" }).click(); await page.getByRole("option", { name: "Центральный аппарат", exact: true }).click();
            assert.equal(await page.locator(".hisobot-report-card").count(), 16);
            await page.getByRole("button", { name: "Сегодня", exact: true }).click(); assert.equal(await field.inputValue(), "Мой черновик для проверки интерфейса");
            await field.fill(""); await page.getByRole("button", { name: "Правила AI Hisobot", exact: true }).click();
            await page.getByRole("dialog", { name: "Как учитываются отчёты" }).waitFor(); await page.keyboard.press("Escape");
            await page.getByRole("dialog", { name: "Как учитываются отчёты" }).waitFor({ state: "hidden" });
          } else if (section.id === "monthly") {
            const comment = page.getByRole("textbox", { name: "Комментарий к отчёту (необязательно)" });
            await comment.fill("Черновик за ноябрь");
            await page.getByLabel("Файлы отчёта", { exact: true }).setInputFiles({ name: "november.docx", mimeType: "application/vnd.openxmlformats-officedocument.wordprocessingml.document", buffer: Buffer.from("synthetic visual QA only") });
            await page.getByRole("combobox", { name: "Отчётный месяц" }).click(); await page.getByRole("option", { name: /октябрь/ }).click();
            assert.equal(await comment.inputValue(), ""); assert(await page.getByRole("button", { name: "Отправить отчёт", exact: true }).isDisabled());
            await page.getByRole("combobox", { name: "Отчётный месяц" }).click(); await page.getByRole("option", { name: /ноябрь/ }).click();
            assert.equal(await comment.inputValue(), "Черновик за ноябрь"); assert(await page.getByText("november.docx · 1 КБ", { exact: true }).isVisible());
            await page.getByRole("button", { name: "Разрешить начисление заработной платы", exact: true }).click();
            await page.getByRole("button", { name: /^Подтвердить разрешение за/ }).waitFor();
            await page.getByRole("button", { name: "Отмена", exact: true }).click();
            assert.equal(await page.getByRole("button", { name: /^Подтвердить разрешение за/ }).count(), 0);
          } else {
            if (width > 760) {
              const summary = await page.locator(".eff-summary").boundingBox(), method = await page.locator(".eff-method-card").boundingBox();
              if (Math.abs(summary.x - method.x) > 4) assert(Math.abs(summary.y - method.y) <= 1, `${file}: aligned efficiency columns`);
            }
            const search = page.getByLabel("Поиск сотрудников в эффективности", { exact: true });
            const count = await page.locator(".eff-table tbody tr").count();
            await search.fill("НетТакогоСотрудника"); assert.equal(await page.locator(".eff-table tbody tr").count(), 0);
            await search.fill(""); assert.equal(await page.locator(".eff-table tbody tr").count(), count);
            await page.locator(".eff-table tbody tr").nth(0).focus(); await page.keyboard.press("Enter");
            assert(await page.locator(".eff-table tbody tr.selected").nth(0).isVisible());
            assert.equal(await page.locator(".eff-history-chart filter").count(), 0);
          }
        }
        if (phase === "after" && planningSuite && !workdaySuite) {
          const framed = await page.locator(section.root).evaluate(root => [...root.querySelectorAll(".home-panel, .home-overview > button, .home-row, .calendar-day, .calendar-view-bar, .calendar-agenda-card, .project-hub-project, .project-hub-metrics > div, .project-hub-workstream-card")].filter(node => {
            const style = getComputedStyle(node);
            return [style.borderTopWidth, style.borderRightWidth, style.borderBottomWidth, style.borderLeftWidth].some(value => parseFloat(value) > 0) || style.boxShadow.includes("inset");
          }).map(node => node.className));
          assert.deepEqual(framed, [], `${file}: planning surfaces without frames`);
          assert(geometry.pageOverflow <= 1, `${file}: page overflow`);
          assert(Math.abs(geometry.toolbar.x - geometry.hero.x) <= 1 && geometry.toolbar.right <= geometry.hero.right + 1, `${file}: shared edges`);
          if (section.id === "home") {
            const summary = page.locator(".home-overview > button");
            assert.equal(await summary.count(), 4, `${file}: actionable day summary`);
            assert.match(await summary.first().innerText(), /^3\s+Важные действия/, `${file}: unique attention count`);
            for (const button of await summary.all()) assert((await button.boundingBox()).height >= 44, `${file}: summary touch target`);
            await summary.nth(1).click(); await page.locator(".tasks-view").waitFor();
            await page.setViewportSize({ width: 1440, height: 960 });
            await page.locator('.rail-action[aria-label="Главная"]').click(); await page.locator(".personal-home").waitFor();
            await page.setViewportSize({ width, height }); await settle(page);
          }
          if (section.id === "calendar") {
            const count = page.locator(".calendar-view-summary [role=status]");
            assert.match(await count.innerText(), /Событий: 19/);
            await page.getByRole("button", { name: "Следующий месяц", exact: true }).click();
            assert.match(await count.innerText(), /Событий: 6/);
            await page.getByRole("button", { name: "Предыдущий месяц", exact: true }).click();
            await page.getByRole("button", { name: "Плитки", exact: true }).click();
            assert.equal(await page.locator(".calendar-agenda-card").count(), 19, `${file}: complete month list`);
            await page.getByRole("button", { name: "Месяц", exact: true }).click();
            await page.getByRole("button", { name: "Фильтры", exact: true }).click();
            const field = page.getByRole("textbox", { name: "Поиск событий", exact: true });
            await field.fill("несуществующее-qa-событие"); assert.match(await count.innerText(), /Событий: 0/);
            await field.fill(""); await field.blur(); assert.match(await count.innerText(), /Событий: 19/);
            await page.getByRole("button", { name: "Фильтры", exact: true }).click();
            await page.emulateMedia({ forcedColors: "active" }); await settle(page);
            const outline = await page.locator('.calendar-day[aria-selected="true"]').evaluate(node => getComputedStyle(node).outlineStyle);
            assert.notEqual(outline, "none", `${file}: high contrast selection`);
            await page.emulateMedia({ forcedColors: "none" });
          }
          if (section.id === "projects") {
            const index = page.locator(".project-hub-index-body"), trigger = page.locator(".project-hub-index-toggle");
            if (width <= 700) { assert(!await index.isVisible(), `${file}: compact index collapsed`); await trigger.click(); }
            const filter = page.getByRole("combobox", { name: "Фильтр проектов", exact: true });
            await filter.click(); await page.getByRole("option", { name: "Завершённые", exact: true }).click();
            assert.equal(await page.locator(".project-hub-project").count(), 1);
            assert.equal(await page.locator(".project-hub-title h2").innerText(), "Цифровизация рабочих процессов");
            assert.match(await page.locator('.project-hub-project[aria-current="true"]').innerText(), /REG-31/);
            await filter.click(); await page.getByRole("option", { name: "Все", exact: true }).click(); assert.equal(await page.locator(".project-hub-project").count(), 6);
            await filter.click(); await page.getByRole("option", { name: "Активные", exact: true }).click(); assert.equal(await page.locator(".project-hub-project").count(), 5);
            if (width <= 700) { await trigger.click(); await page.locator(".project-hub-tools-toggle").click(); }
            await page.getByRole("button", { name: "Настроить проект", exact: true }).click();
            await page.getByRole("textbox", { name: "Название проекта", exact: true }).fill("Черновик без сохранения");
            await page.getByRole("button", { name: "Отмена", exact: true }).click();
            await page.getByRole("dialog").waitFor({ state: "hidden" });
            await page.emulateMedia({ forcedColors: "active" });
            if (width <= 700) await trigger.click();
            const outline = await page.locator('.project-hub-project[aria-current="true"]').evaluate(node => getComputedStyle(node).outlineStyle);
            assert.notEqual(outline, "none", `${file}: high contrast project selection`);
            await page.emulateMedia({ forcedColors: "none" });
          }
          assert((await measure(page, section.root)).pageOverflow <= 1, `${file}: interaction overflow`);
        }
        if (phase === "after" && operationsSuite) {
          assert(geometry.pageOverflow <= 1, `${file}: page overflow`);
          assert(Math.abs(geometry.toolbar.x - geometry.hero.x) <= 1 && geometry.toolbar.right <= geometry.hero.right + 1, `${file}: toolbar edges`);
          const clipped = await page.locator(`${section.root} .ws-section-header`).evaluate(header => {
            const r = header.getBoundingClientRect();
            return [...header.children].filter(node => !node.classList.contains("ws-section-header-art")).some(node => {
              const c = node.getBoundingClientRect();
              return c.width > 0 && c.height > 0 && (c.top < r.top - 1 || c.bottom > r.bottom + 1 || c.right > r.right + 1);
            });
          });
          assert(!clipped, `${file}: clipped header`);
          if (section.id === "hr") {
            const rows = page.locator(".hr-table tbody tr:not(.ws-skeleton-row)");
            assert.equal(await rows.count(), 25, `${file}: bounded HR page`);
            await page.getByRole("button", { name: "Следующая страница: кадровые карточки", exact: true }).click();
            assert.equal(await rows.count(), 15, `${file}: remaining HR records`);
            const search = page.getByRole("textbox", { name: "Поиск кадровой карточки", exact: true });
            await search.fill("несуществующий-qa-результат"); await page.waitForFunction(() => !document.querySelector(".hr-table tbody tr"));
            await search.fill(""); await search.blur(); await page.waitForFunction(() => document.querySelectorAll(".hr-table tbody tr").length === 25);
            await page.getByRole("button", { name: "Кадровая карточка", exact: true }).click();
            await page.getByPlaceholder("Фамилия Имя Отчество", { exact: true }).fill("Черновик кадровой карточки");
            await page.getByRole("button", { name: "Отмена", exact: true }).click();
          }
          if (section.id === "members") {
            const rows = page.locator(".member-row");
            assert.equal(await rows.count(), 25, `${file}: bounded member page`);
            const search = page.getByRole("textbox", { name: "Поиск членов", exact: true });
            await search.fill("несуществующий-qa-результат"); await page.waitForFunction(() => !document.querySelector(".member-row"));
            await search.fill(""); await search.blur(); await page.waitForFunction(() => document.querySelectorAll(".member-row").length === 25);
            if (width <= 700) await page.getByRole("button", { name: "Фильтры реестра", exact: true }).click();
            const region = page.getByRole("combobox", { name: "Фильтр по региону", exact: true });
            await region.click(); await page.getByRole("option", { name: "Ташкент", exact: true }).click();
            assert.equal(await rows.count(), 16, `${file}: member region filter`);
            await region.click(); await page.getByRole("option", { name: "Все регионы", exact: true }).click();
            if (width <= 700) {
              await page.getByRole("button", { name: "Фильтры реестра", exact: true }).click();
              await page.getByRole("button", { name: "Сортировка: члены организации", exact: true }).click();
              assert.equal(await page.getByRole("menuitem").count(), 6, `${file}: member sorting retained`);
              await page.getByRole("menuitem", { name: "Член", exact: true }).click();
            }
            await page.locator(".member-row .record-open").first().click(); await page.locator(".member-inspector").waitFor();
            await page.getByRole("button", { name: "Закрыть карточку", exact: true }).click();
          }
          if (section.id === "zoom") {
            const rows = page.locator(".zoom-row"); assert.equal(await rows.count(), 6, `${file}: upcoming meetings`);
            await page.getByRole("button", { name: "Прошедшие", exact: true }).click(); assert.equal(await rows.count(), 4, `${file}: past meetings`);
            await page.getByRole("button", { name: "Ближайшие", exact: true }).click();
            // The organizer name is a separate profile link inside the row.
            await page.locator(".zoom-row-body > strong").first().click(); await page.locator(".zoom-detail").waitFor();
            await page.getByRole("button", { name: "Новая конференция", exact: true }).click();
            const title = page.getByRole("textbox", { name: "Название", exact: true }); await title.fill("Черновик конференции");
            assert.equal(await rows.count(), 6, `${file}: schedule retained during entry`);
            await page.getByRole("button", { name: "Закрыть форму", exact: true }).click();
          }
          assert((await measure(page, section.root)).pageOverflow <= 1, `${file}: interaction overflow`);
        }
        if (phase === "after" && peopleSuite) {
          assert(geometry.pageOverflow <= 1, `${file}: page overflow`);
          assert(Math.abs(geometry.toolbar.x - geometry.hero.x) <= 1 && geometry.toolbar.right <= geometry.hero.right + 1, `${file}: toolbar edges`);
          const clipped = await page.locator(`${section.root} .ws-section-header`).evaluate(header => {
            const r = header.getBoundingClientRect();
            return [...header.children].filter(node => !node.classList.contains("ws-section-header-art")).some(node => {
              const c = node.getBoundingClientRect();
              return c.width > 0 && c.height > 0 && (c.top < r.top - 1 || c.bottom > r.bottom + 1 || c.right > r.right + 1);
            });
          });
          assert(!clipped, `${file}: clipped header`);
          await page.locator("#rail-more-drawer").waitFor({ state: "hidden" });
          if (section.id === "employees") {
            if (width <= 700) {
              const tools = page.getByRole("group", { name: "Управление сотрудниками", exact: true });
              assert(!await tools.isVisible(), `${file}: compact management starts collapsed`);
              const trigger = page.getByRole("button", { name: "Управление каталогом", exact: true });
              assert((await trigger.boundingBox()).height >= 44, `${file}: management touch target`);
              await trigger.click(); assert(await tools.isVisible(), `${file}: management remains accessible`);
              await trigger.click();
            }
            const field = page.getByRole("textbox", { name: "Поиск сотрудников", exact: true });
            const rows = page.locator(".employee-row");
            assert.equal(await rows.count(), 25, `${file}: bounded employee page`);
            const height = await field.evaluate(input => input.closest(".workspace-search-field").getBoundingClientRect().height);
            assert(Math.abs(height - geometry.search.height) <= 1, `${file}: painted search height`);
            await field.fill("несуществующий-qa-результат"); await page.waitForFunction(() => !document.querySelector(".employee-row"));
            await field.fill(""); await field.blur(); await page.waitForFunction(() => document.querySelectorAll(".employee-row").length === 25);
            const status = page.getByRole("combobox", { name: "Фильтр состояния сотрудников" });
            await status.click(); await page.getByRole("option", { name: "Приглашённые", exact: true }).click();
            assert.equal(await rows.count(), 6, `${file}: employee status filter`);
            await status.click(); await page.getByRole("option", { name: "Все сотрудники", exact: true }).click();
            if (width <= 700) {
              await page.getByRole("button", { name: "Сортировка: сотрудники", exact: true }).click();
              assert.equal(await page.getByRole("menuitem").count(), 6, `${file}: every sort column retained`);
              await page.getByRole("menuitem", { name: "Должность", exact: true }).click();
              await page.getByRole("checkbox", { name: "Выбрать видимую страницу сотрудников", exact: true }).check();
            } else {
              await page.getByRole("checkbox", { name: "Выбрать сотрудников на странице", exact: true }).check();
            }
            assert.equal(await page.locator('.employee-row[aria-selected="true"]').count(), 25, `${file}: select visible page`);
          }
          if (section.id === "leaves") {
            const rows = page.locator(".leave-list-item");
            assert.equal(await rows.count(), 12, `${file}: populated leave list`);
            const filters = page.locator(".leave-filters");
            await filters.getByRole("button", { name: "Мои", exact: true }).click();
            assert.equal(await rows.count(), 6, `${file}: own leave filter`);
            await filters.getByRole("button", { name: "Утверждены", exact: true }).click();
            assert.equal(await rows.count(), 4, `${file}: approved leave filter`);
            await filters.getByRole("button", { name: "Все", exact: true }).click();
            await rows.first().click(); await page.locator(".leave-card h2").waitFor();
            await page.getByRole("button", { name: "Новое заявление", exact: true }).click();
            const field = page.getByRole("textbox", { name: "Текст заявления", exact: true });
            await field.fill("Черновик заявления для проверки интерфейса");
            assert.equal(await field.inputValue(), "Черновик заявления для проверки интерфейса");
            await page.getByRole("button", { name: "Отмена", exact: true }).click();
          }
          if (section.id === "absences") {
            assert.equal(await page.locator(".absence-summary > button").count(), 7, `${file}: all presence statuses retained`);
            const fills = await page.locator(".absence-summary > button").evaluateAll(nodes => nodes.map(node => {
              const style = getComputedStyle(node); return style.backgroundImage + style.backgroundColor;
            }));
            assert.equal(new Set(fills).size, 7, `${file}: semantic presence colors retained`);
            assert.equal(await page.locator(".absence-card").count(), 8, `${file}: populated absence queues`);
            // Exercise real scrollbar widths rather than mocked offset/client sizes.
            for (const scrollbar of [14, 8]) {
              const style = await page.addStyleTag({ content: `.absences-view{height:400px!important;overflow-y:scroll!important;scrollbar-width:auto!important}.absences-view::-webkit-scrollbar{width:${scrollbar}px}` });
              const edges = await page.locator(section.root).evaluate(root => [".ws-section-header", ".absence-summary", ".absence-canvas"].map(selector => {
                const rect = root.querySelector(selector).getBoundingClientRect(); return { x: rect.x, right: rect.right };
              }));
              assert(edges.every(rect => Math.abs(rect.x - edges[0].x) <= 1 && Math.abs(rect.right - edges[0].right) <= 1), `${file}: shared edges with ${scrollbar}px scrollbar`);
              await style.evaluate(node => node.remove());
            }
            await page.locator('.absence-summary [data-presence-status="working"]').click();
            const dialog = page.getByRole("dialog"); await dialog.waitFor();
            await page.keyboard.press("Escape"); await dialog.waitFor({ state: "hidden" });
            await page.locator(".absence-card").first().click(); await page.locator(".absence-drawer").waitFor();
            await page.keyboard.press("Escape"); await page.locator(".absence-drawer").waitFor({ state: "hidden" });
            await page.getByRole("button", { name: "Сообщить об отсутствии", exact: true }).click();
            await page.getByRole("textbox", { name: "Причина", exact: true }).fill("Проверка сохранения текста");
            await page.getByRole("button", { name: "Отмена", exact: true }).click();
          }
        }
        if (phase === "after" && documentsSuite) {
          assert(geometry.pageOverflow <= 1, `${file}: page overflow`);
          assert(Math.abs(geometry.toolbar.x - geometry.hero.x) <= 1 && Math.abs(geometry.toolbar.right - geometry.hero.right) <= 1, `${file}: shared edges`);
          const clipped = await page.locator(`${section.root} .ws-section-header`).evaluate(header => {
            const r = header.getBoundingClientRect();
            return [...header.children].filter(node => !node.classList.contains("ws-section-header-art")).some(node => {
              const c = node.getBoundingClientRect(); return c.width && c.height && (c.top < r.top - 1 || c.bottom > r.bottom + 1 || c.left < r.left - 1 || c.right > r.right + 1);
            });
          });
          assert(!clipped, `${file}: clipped header`);
          if (section.id === "letters") {
            const rows = page.locator(".incoming-document-row"), search = page.getByPlaceholder("Номер, тема или отправитель");
            assert.equal(await rows.count(), 30, `${file}: server page`);
            const pager = page.getByRole("navigation", { name: "Страницы входящих писем" });
            await pager.getByRole("button", { name: "Далее" }).click(); await page.waitForFunction(() => document.querySelectorAll(".incoming-document-row").length === 6);
            await pager.getByRole("button", { name: "Назад" }).click(); await page.waitForFunction(() => document.querySelectorAll(".incoming-document-row").length === 30);
            await search.fill("несуществующий-qa"); await page.waitForFunction(() => !document.querySelector(".incoming-document-row"));
            await search.fill(""); await page.waitForFunction(() => document.querySelectorAll(".incoming-document-row").length === 30);
            await rows.first().click(); await page.locator(".incoming-document-card").waitFor();
            await page.getByRole("button", { name: "Назначить исполнение", exact: true }).click();
            await page.getByRole("form", { name: "Назначение исполнения" }).waitFor();
          }
          if (section.id === "telegram") {
            const search = page.getByRole("searchbox", { name: "Поиск сотрудников для Telegram" });
            await search.fill("несуществующий-qa"); assert.equal(await page.locator(".telegram-access-row").count(), 0);
            await search.fill(""); assert.equal(await page.locator(".telegram-access-row").count(), data.telegram.people.length);
            await page.locator(".telegram-access-guide summary").click(); assert(await page.locator(".telegram-access-guide p").isVisible());
            await page.locator(".telegram-access-guide summary").click();
            const id = page.getByRole("textbox", { name: "Telegram ID", exact: true }).first();
            await id.fill("000"); await page.locator(".telegram-access-row").first().getByRole("button", { name: "Сохранить", exact: true }).click();
            assert.match(await page.locator(".telegram-access-row").first().getByRole("alert").innerText(), /не начинаться с нуля/);
          }
          if (section.id === "survey") {
            const search = page.getByRole("textbox", { name: "Поиск анализов", exact: true });
            await search.fill("несуществующий-qa"); assert.equal(await page.locator(".survey-analysis-item").count(), 0);
            await search.fill(""); await page.locator(".survey-analysis-item").first().click();
            const title = page.getByRole("textbox", { name: "Название анализа", exact: true });
            await title.waitFor(); await title.fill("Черновик анализа команды");
            assert.equal(await title.inputValue(), "Черновик анализа команды");
            assert.match(await page.locator(".survey-workbench").innerText(), /64/);
            await title.fill(data.survey.analysis.title);
            await page.getByRole("button", { name: "Открыть меню профиля: Малика Нурова" }).click();
            const toggle = page.getByRole("switch", { name: "Режим администратора" }); await toggle.waitFor();
            assert.equal(await page.locator(".global-bar .admin-mode-toggle").count(), 0, `${file}: no topbar switch`);
            assert.equal(await toggle.getAttribute("aria-checked"), "true");
            await page.screenshot({ path: path.join(output, phase, `admin-menu-${theme}-${width}.png`) });
            await toggle.click(); await page.locator(".admin-mode-error").waitFor();
            assert.equal(await toggle.getAttribute("aria-checked"), "true", `${file}: failed change preserves mode`);
            await page.keyboard.press("Escape");
            await toggle.waitFor({ state: "hidden" });
            await page.getByRole("button", { name: "Открыть меню профиля: Малика Нурова" }).click();
            await page.locator(".admin-mode-error").waitFor();
            assert.equal(await toggle.getAttribute("aria-checked"), "true", `${file}: state survives menu close`);
            await page.keyboard.press("Escape");
          }
          assert((await measure(page, section.root)).pageOverflow <= 1, `${file}: interaction overflow`);
          await page.emulateMedia({ forcedColors: "active" });
          assert((await measure(page, section.root)).pageOverflow <= 1, `${file}: forced-colors overflow`);
          if (section.id !== "telegram") {
            const selected = page.locator(section.id === "letters" ? '.incoming-document-row[aria-pressed="true"]' : '.survey-analysis-item[aria-pressed="true"]');
            assert.equal(await selected.evaluate(node => getComputedStyle(node).outlineStyle), "solid", `${file}: high-contrast selection`);
          }
          await page.emulateMedia({ forcedColors: "none" });
        }
        if (phase === "after" && !attentionSuite && !peopleSuite && !operationsSuite && !documentsSuite && !planningSuite && !reportingSuite) {
          assert(geometry.pageOverflow <= 1, `${file}: page overflow`);
          assert(Math.abs(geometry.search.height - geometry.filters.height) <= 1, `${file}: search/filter height`);
          for (const [name, rect] of Object.entries({ toolbar: geometry.toolbar, filters: geometry.filters })) {
            assert(rect && Math.abs(rect.x - geometry.hero.x) <= 1, `${file}: ${name} leading edge`);
            assert(rect.right <= geometry.hero.right + 1, `${file}: ${name} trailing edge`);
          }
          const field = page.locator(`${section.root} .workspace-search input`).first();
          const cards = page.locator(`${section.root} .record-row, ${section.root} .approval-board-card`);
          const count = await cards.count();
          assert(count > 0, `${file}: populated fixture`);
          await field.fill("несуществующий-qa-результат");
          await page.waitForFunction(selector => document.querySelectorAll(`${selector} .record-row, ${selector} .approval-board-card`).length === 0, section.root);
          assert((await measure(page, section.root)).pageOverflow <= 1, `${file}: focused search overflow`);
          await field.fill(""); await field.blur();
          await page.waitForFunction(({ selector, count }) => document.querySelectorAll(`${selector} .record-row, ${selector} .approval-board-card`).length === count, { selector: section.root, count });
        }
        if (phase === "after" && attentionSuite) {
          assert(geometry.pageOverflow <= 1, `${file}: page overflow`);
          const clippedHeader = await page.locator(`${section.root} .ws-section-header`).evaluate(header => {
            const bounds = header.getBoundingClientRect();
            return [...header.children].filter(node => !node.classList.contains("ws-section-header-art")).some(node => {
              const rect = node.getBoundingClientRect();
              return rect.width > 0 && rect.height > 0 && (rect.top < bounds.top - 1 || rect.bottom > bounds.bottom + 1);
            });
          });
          assert(!clippedHeader, `${file}: clipped header content`);
          for (const rect of [geometry.toolbar, geometry.metrics].filter(Boolean)) {
            assert(Math.abs(rect.x - geometry.hero.x) <= 1 && Math.abs(rect.right - geometry.hero.right) <= 1, `${file}: shared edges`);
          }
          if (section.id === "notifications") {
            const rows = page.locator(".notification-row");
            assert.equal(await rows.count(), 15, `${file}: first batch`);
            const field = page.getByRole("textbox", { name: "Поиск уведомлений" });
            await field.fill("несуществующий-qa-результат"); await page.waitForFunction(() => !document.querySelector(".notification-row"));
            await field.fill(""); await field.blur(); await page.waitForFunction(() => document.querySelectorAll(".notification-row").length === 15);
            await rows.last().scrollIntoViewIfNeeded();
            await page.waitForFunction(() => document.querySelectorAll(".notification-row").length === 30);
            await page.setViewportSize({ width: 1440, height: 960 }); await settle(page);
            await page.locator('.rail-action[aria-label="Лента"]').click(); await page.locator(".feed-view").waitFor();
            assert.equal(await rows.count(), 0, `${file}: released on leave`);
            await page.locator(".notification-bell").click(); await rows.first().waitFor();
            assert.equal(await rows.count(), 15, `${file}: reset on return`);
          }
          if (section.id === "feed") {
            assert(Math.abs((geometry.feed.x - geometry.hero.x) - (geometry.hero.right - geometry.feed.right)) <= 1, `${file}: centered feed`);
            const draft = page.locator(".feed-comment-composer input").first();
            await draft.fill("Черновик комментария"); assert.equal(await draft.inputValue(), "Черновик комментария"); await draft.fill("");
            await page.getByRole("button", { name: "Новое объявление", exact: true }).click();
            await page.locator(".feed-composer-dialog").waitFor(); await page.getByRole("button", { name: "Отмена", exact: true }).click();
          }
          if (section.id === "overview") {
            const overlaps = await page.locator(".team-dash-task-copy").evaluateAll(copies => copies.some(copy => {
              const rects = [...copy.children].map(node => node.getBoundingClientRect()).filter(rect => rect.height > 0);
              return rects.some((rect, i) => i > 0 && rect.top < rects[i - 1].bottom - 1);
            }));
            assert(!overlaps, `${file}: overlapping task explanations`);
            await page.locator(".team-dash-metric").first().click(); await page.locator(".team-dash-dialog").waitFor();
            await page.locator(".team-dash-dialog").getByRole("button", { name: "Закрыть", exact: true }).click();
          }
        }
        if (!workdaySuite && (topbarSuite && section.id === "home" || reportingSuite && section.id === "hisobot") && (phase === "after" || theme === "dark" && [1440, 720].includes(width))) {
          const liveMotion = phase === "after" && theme === "dark" && width === 1440;
          if (liveMotion) { await page.emulateMedia({ reducedMotion: "no-preference" }); await settle(page); }
          const launcher = page.locator(".assistant-launcher"); await launcher.scrollIntoViewIfNeeded();
          const beforeOrb = await launcher.boundingBox();
          const beforeControls = await page.locator(".global-bar").evaluate(bar => [...bar.querySelectorAll(".assistant-launcher, .color-theme-toggle, .workspace-identity-menu, .context-trigger")].map(node => ({ name: node.className, x: node.getBoundingClientRect().x, y: node.getBoundingClientRect().y })));
          await page.locator(".assistant-launcher").click(); await page.locator(".assistant-empty h2").waitFor(); await settle(page);
          if (phase === "after") {
            assert(await launcher.isVisible(), `${file}: launcher remains visible`);
            const afterOrb = await launcher.boundingBox();
            assert(Math.abs(afterOrb.x - beforeOrb.x) <= 1 && Math.abs(afterOrb.y - beforeOrb.y) <= 1, `${file}: stationary orb`);
            assert.equal(await launcher.locator(":scope > .gradient-orb, :scope > .gradient-orb-fallback").count(), 1, `${file}: orb remains in button`);
            const afterControls = await page.locator(".global-bar").evaluate(bar => [...bar.querySelectorAll(".assistant-launcher, .color-theme-toggle, .workspace-identity-menu, .context-trigger")].map(node => ({ name: node.className, x: node.getBoundingClientRect().x, y: node.getBoundingClientRect().y })));
            assert.deepEqual(afterControls, beforeControls, `${file}: no neighbour shift`);
            const barBounds = await page.locator(".global-bar").boundingBox(), panelBounds = await page.locator(".assistant-panel").boundingBox();
            assert(panelBounds.y >= barBounds.y + barBounds.height - 1, `${file}: assistant keeps toolbar accessible`);
            const panelStyle = await page.locator(".assistant-panel").evaluate(node => ({ border: getComputedStyle(node).borderTopWidth, image: getComputedStyle(node).backgroundImage }));
            assert.deepEqual(panelStyle, { border: "0px", image: "none" }, `${file}: assistant window without frame`);
            await page.getByRole("button", { name: "Развернуть окно", exact: true }).click(); await settle(page);
            const expanded = await page.locator(".assistant-panel").boundingBox();
            assert(expanded.y >= barBounds.y + barBounds.height - 1 && expanded.y + expanded.height <= height + 1, `${file}: expanded assistant below toolbar`);
            await page.getByRole("button", { name: "Свернуть окно", exact: true }).click(); await settle(page);
          }
          await capture(page, path.join(output, phase, `assistant-open-${theme}-${width}.png`));
          await page.getByRole("button", { name: "Закрыть ассистента", exact: true }).click();
          await page.locator(".assistant-panel").waitFor({ state: "hidden" });
          if (phase === "after") assert(await launcher.evaluate(node => node === document.activeElement), `${file}: assistant restores launcher focus`);
          if (liveMotion) await page.emulateMedia({ reducedMotion: "reduce" });
          if (phase === "after") {
            await page.emulateMedia({ forcedColors: "active" });
            assert.notEqual(await launcher.evaluate(node => getComputedStyle(node).outlineStyle), "none", `${file}: high contrast launcher`);
            await page.emulateMedia({ forcedColors: "none" });
          }
        }
        console.log(`${phase} ${file}`);
      }
      await context.close();
    }
    if (!galleryOnly) {
      const resultPath = path.join(output, `${phase}.json`);
      const saved = onlyWidth ? await fs.readFile(resultPath, "utf8").catch(error => { if (error.code === "ENOENT") return '{"results":[]}'; throw error; }) : '{"results":[]}';
      const previous = JSON.parse(saved).results.filter(result => result.width !== onlyWidth);
      await fs.writeFile(resultPath, JSON.stringify({ results: [...previous, ...results], errors }, null, 2));
    }
    assert.deepEqual(errors, []);
    if (chatPaginationSuite) return;
    if (promptSuite) return;
    await fs.writeFile(path.join(output, "index.html"), `<!doctype html><html lang="ru"><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1"><title>Yuksalish — сравнение интерфейса</title>
      <style>*{box-sizing:border-box}body{margin:0;padding:24px;background:#111318;color:#eceef4;font:15px/1.5 system-ui}main{max-width:1600px;margin:auto}h1{font-size:28px}p,figcaption{color:#bfc6d3}select{margin:0 0 24px;padding:12px;border-radius:8px;background:#252a33;color:inherit}section{margin:0 0 32px}h2{font-size:20px}article{display:grid;grid-template-columns:1fr 1fr;gap:16px}figure{margin:0;min-width:0}img{display:block;width:100%;height:auto;border-radius:12px}figcaption{margin-bottom:8px}@media(max-width:700px){article{grid-template-columns:1fr}body{padding:12px}}</style>
      <main><h1>${calendarSurfacesSuite ? 'Календарь и элементы управления' : `Итерация ${iteration} · Общая сетка рабочих разделов`}</h1><p>Реальные компоненты приложения, одинаковые синтетические данные до и после. Нажмите на снимок для исходного размера.</p><select id="size" aria-label="Размер и тема"><option value="dark-1440">1440 × 960 · тёмная</option><option value="light-1440">1440 × 960 · светлая</option><option value="dark-1024">1024 × 768 · тёмная</option><option value="dark-390">390 × 844 · тёмная</option>${topbarSuite || reportingSuite || registrySuite || communicationsSuite || calendarSurfacesSuite ? '<option value="dark-320">320 × 800 · тёмная</option><option value="dark-720">720 × 480 · тёмная</option>' : ''}</select>
      ${workdaySuite ? '<select id="interaction" aria-label="Состояние кнопки"><option value="">Обычное состояние</option><option value="hover">Наведение</option><option value="pressed">Нажатие</option></select>' : ''}
      ${(sidebarSuite ? [{ id: 'sidebar-expanded', label: 'Навигация' }, { id: 'sidebar-ai', label: 'ИИ-модули' }, { id: 'sidebar-collapsed', label: 'Свёрнутое меню' }] : workdaySuite ? [{ id: "workday-start", label: "Начать работу" }, { id: "workday-finish", label: "Завершить работу" }, { id: "topbar", label: "Заметная иконка рабочего дня" }] : topbarSuite ? [{ id: "topbar", label: "Общая верхняя панель" }, ...sections] : surfaceFollowupSuite ? [...sections, { id: 'filters-expanded', label: 'Календарь — раскрытые фильтры' }] : sections).map(section => `<section data-section="${section.id}"><h2>${section.label}</h2><article>${["before", "after"].map((state, i) => `<figure><figcaption>${i ? "После" : "До"}</figcaption><a data-state="${state}" href="${state}/${section.id}-dark-1440.png"><img loading="lazy" ${workdaySuite && section.id !== "topbar" ? 'style="max-width:360px"' : ''} src="${state}/${section.id}-dark-1440.png" alt="${section.label} — ${i ? "после" : "до"}"></a></figure>`).join("")}</article></section>`).join("")}
      ${topbarSuite && !workdaySuite ? [1440, 720].map(width => `<section><h2>Открытый ассистент · ${width} px</h2><article>${["before", "after"].map((state, i) => `<figure><figcaption>${i ? "После: орба остаётся в кнопке" : "До: орба переносится в окно"}</figcaption><a href="${state}/assistant-open-dark-${width}.png"><img loading="lazy" src="${state}/assistant-open-dark-${width}.png" alt="Ассистент — ${i ? "после" : "до"}"></a></figure>`).join("")}</article></section>`).join("") : ''}
      ${documentsSuite ? '<section data-section="admin-menu"><h2>Режим администратора в меню аватара</h2><figure><figcaption>После · переключение прав и возврат к правам своей должности</figcaption><a data-state="after" href="after/admin-menu-dark-1440.png"><img loading="lazy" src="after/admin-menu-dark-1440.png" alt="Переключатель прав в меню профиля"></a></figure></section>' : ''}
      ${calendarSurfacesSuite ? `<section><h2>Фильтры и страницы · desktop</h2><article>${['before', 'after'].map(state => `<figure><figcaption>${state === 'after' ? 'После' : 'До'}</figcaption><a href="${state}/task-controls-dark-1440.png"><img src="${state}/task-controls-dark-1440.png" alt="Фильтры и страницы — ${state}"></a></figure>`).join('')}</article></section>` : ''}
      <p>Подход: <a href="https://github.com/heydamir/unslop" style="color:#90d5df">unslop · Damir Sokolovsky · CC BY 4.0</a>. Цвета статусов, права и рабочие процессы сохранены.</p></main><script>const update=()=>document.querySelectorAll('section[data-section]').forEach(section=>section.querySelectorAll('[data-state]').forEach(link=>{const interaction=link.dataset.state==='after'&&section.dataset.section!=='topbar'?(document.querySelector('#interaction')?.value||''):'';const src=link.dataset.state+'/'+section.dataset.section+(interaction?'-'+interaction:'')+'-'+document.querySelector('#size').value+'.png';link.href=src;link.querySelector('img').src=src}));document.querySelector('#size').addEventListener('change',update);document.querySelector('#interaction')?.addEventListener('change',update)</script></html>`);
  } finally { await browser.close(); }
})().catch(error => { console.error(error); process.exitCode = 1; });
