// Comparable production-App screenshots. All API traffic stays in synthetic fixtures.
const { chromium } = require(process.env.PLAYWRIGHT_MODULE || "playwright");
const fs = require("node:fs/promises");
const path = require("node:path");
const assert = require("node:assert/strict");
const phase = process.argv.includes("--before") ? "before" : "after";
const galleryOnly = process.argv.includes("--gallery-only");
const attentionSuite = process.argv.includes("--attention");
const peopleSuite = process.argv.includes("--people");
const operationsSuite = process.argv.includes("--operations");
const documentsSuite = process.argv.includes("--documents");
const origin = process.env.UI_QA_ORIGIN || "http://127.0.0.1:5186";
assert(["127.0.0.1", "localhost"].includes(new URL(origin).hostname));
const iteration = documentsSuite ? "5" : operationsSuite ? "4" : peopleSuite ? "3" : attentionSuite ? "2" : "1";
const output = path.resolve(process.env.UI_QA_OUTPUT || `tmp/ui-consistency-iteration-${iteration}`);
const sections = documentsSuite
  ? [{ id: "letters", label: "Входящие письма", root: ".incoming-documents" }, { id: "telegram", label: "Доступ к ботам", root: ".telegram-access-view" }, { id: "survey", label: "Аналитика опросов", root: ".survey-analytics" }]
  : operationsSuite
  ? [{ id: "hr", label: "HR", root: ".hr-view" }, { id: "members", label: "Работа с членами", root: ".members-view" }, { id: "zoom", label: "Zoom-конференции", root: ".zoom-view" }]
  : peopleSuite
  ? [{ id: "employees", label: "Сотрудники", root: ".employees-view" }, { id: "leaves", label: "Отпуска", root: ".leave-view" }, { id: "absences", label: "Отсутствия", root: ".absences-view" }]
  : attentionSuite
  ? [{ id: "overview", label: "Обзор команды", root: ".team-dashboard" }, { id: "notifications", label: "Уведомления", root: ".notifications-view" }, { id: "feed", label: "Лента", root: ".feed-view" }]
  : [{ id: "tasks", label: "Задачи", root: ".tasks-view" }, { id: "payments", label: "Заявки на оплату", root: ".approvals-view" }, { id: "trips", label: "Поездки", root: ".trips-view" }];
const settle = async page => page.evaluate(async () => {
  await document.fonts.ready;
  await Promise.race([Promise.all(document.getAnimations().filter(a => Number(a.effect?.getComputedTiming().endTime) < 2000).map(a => a.finished.catch(() => undefined))), new Promise(r => setTimeout(r, 900))]);
  await new Promise(r => requestAnimationFrame(() => requestAnimationFrame(r)));
});
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
  return { user, people, tasks, requests, tripRequests, workflow, feedPosts, notifications, employees, departments, leaves, absenceRequests, presenceSummary, hr, members, zoom, incomingDocuments, telegram, survey };
}
async function measure(page, selector) {
  return page.locator(selector).evaluate(root => {
    const rect = node => { const r = node?.getBoundingClientRect(); return r ? { x: r.x, y: r.y, width: r.width, height: r.height, bottom: r.bottom, right: r.right } : null; };
    const hero = root.querySelector(".ws-section-header"), toolbar = root.querySelector(".ws2-process-toolbar, .task-filters, .notification-head-actions, .record-list-controls, .leave-filters, .absence-summary, .hr-tabs, .zoom-buckets, .members-search-row, .incoming-documents-controls, .telegram-access-controls, .survey-layout"), search = root.querySelector(".workspace-search, .employee-search");
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
    for (const [width, height, theme] of galleryOnly ? [] : [[1440, 960, "dark"], [1440, 960, "light"], [1024, 768, "dark"], [390, 844, "dark"], ...(phase === "after" && (peopleSuite || operationsSuite || documentsSuite) ? [[320, 800, "dark"]] : []), ...(phase === "after" && documentsSuite ? [[720, 480, "dark"]] : [])]) {
      const context = await browser.newContext({ viewport: { width, height }, reducedMotion: "reduce" });
      const page = await context.newPage(); page.setDefaultTimeout(15000);
      page.on("pageerror", error => errors.push(error.message));
      await page.addInitScript(theme => localStorage.setItem("yuksalish:color-theme:last", theme), theme);
      let data, releaseIds = [];
      await page.routeWebSocket("**/api/v1/events", socket => socket.onMessage(message => {
        const value = JSON.parse(String(message));
        socket.send(JSON.stringify({ type: value.type === "ping" ? "pong" : "authenticated" }));
      }));
      await page.route("**/api/v1/**", async route => {
        const request = route.request(), endpoint = new URL(request.url()).pathname.replace("/api/v1", "");
        const send = json => route.fulfill({ json });
        if (/\/auth\/(web\/)?login$/.test(endpoint)) return send({ accessToken: "qa-token", expiresIn: 3600, user: data.user });
        if (!["GET", "HEAD"].includes(request.method())) return route.fulfill({ status: 403, json: { detail: "Synthetic QA: no writes" } });
        if (endpoint === "/workspace/bootstrap") return send({ currentUser: data.user, people: data.people, tasks: data.tasks, requests: data.requests, tripRequests: data.tripRequests, workflow: data.workflow, projectWorkflow: null, tripWorkflow: null, requestWorkflows: {}, projects: [], chats: [], messages: [], departments: [], positions: [], attachments: [], feedPosts: attentionSuite ? data.feedPosts : [], calendarEvents: [], notifications: attentionSuite ? data.notifications : [], absenceRequests: peopleSuite ? data.absenceRequests : [], presenceSummary: peopleSuite ? data.presenceSummary : [], canCreatePaymentRequests: true, notificationPreferences: { desktopEnabled: false, soundEnabled: false, messagesEnabled: true, tasksEnabled: true, approvalsEnabled: true, calendarEnabled: true, tripsEnabled: true, remindersEnabled: true } });
        if (endpoint === "/efficiency") return send({ period: "2026-11", timezone: "Asia/Tashkent", methodologyVersion: "EFF-1", trackingStartedAt: "2026-09-01T00:00:00Z", currentUserId: data.user.id, employees: [] });
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
        if (endpoint === "/workday/me") return send({ status: "not_started", schedule: { startsAt: "09:00", endsAt: "18:00" }, session: null });
        if (endpoint === "/support-requests") return send({ mode: "inbox", requests: [], unreadResponseCount: 0, indicator: null });
        if (endpoint === "/updates/policy") return send({ mandatory: false, minimumVersion: null, publishedVersion: null });
        if (endpoint.includes("/approval-inbox/")) return send({ enabled: false, items: [] });
        if (endpoint === "/project-hub" || endpoint.includes("/targets")) return send({ projects: [], workstreams: [], items: [], requests: [] });
        if (endpoint.includes("/task-plans") || endpoint.includes("/task-proposals")) return send([]);
        if (endpoint.includes("/dossier/reminder")) return send({ period: "2026-11", dueDate: "2026-11-25", due: false, status: "no_changes", respondedAt: null });
        if (endpoint === "/leave-requests/context") return send({ hrUserId: data.people[0].id, deputyUserId: data.people[1].id, canConfigureSignature: false, signatureReady: true, tenureRules: [], canEditTenureRules: false });
        if (endpoint === "/leave-requests") return send(data.leaves);
        if (endpoint.includes("/directory")) return send({ canTerminateEmployees: true, employees: peopleSuite ? data.employees : data.people, people: data.people, roles: [], positions: [{ id: "qa-position", name: "Координатор региональных программ", isActive: true, sortOrder: 0 }], departments: peopleSuite ? data.departments : [], modules: [], accessRules: [] });
        if (endpoint.includes("/context/exchange")) return send({ rates: [], asOf: "2026-11-26", stale: false });
        if (endpoint.includes("/weather")) return send({ regions: [], places: [], asOf: "2026-11-26", stale: false });
        return route.fulfill({ status: 204, body: "" });
      });
      await page.goto(origin);
      data = fixtures(await page.evaluate(async () => { const d = await import("/src/renderer/test-fixtures/demo-data.ts"); return { people: d.people, initialTasks: d.initialTasks }; }));
      releaseIds = await page.evaluate(async () => (await import("/src/renderer/release-history.ts")).bundledReleaseEntries().map(entry => entry.id));
      await page.evaluate(({ id, theme }) => localStorage.setItem(`yuksalish:color-theme:${id}`, theme), { id: data.user.id, theme });
      await page.getByRole("textbox", { name: /Логин/ }).fill("qa-user");
      await page.getByLabel(/Пароль/).fill("qa-only-password");
      await page.getByRole("button", { name: "Войти", exact: true }).click(); await page.locator(".app-shell").waitFor();
      for (const section of sections) {
        // Isolate responsive content geometry from the separately tested rail drawer.
        await page.setViewportSize({ width: 1440, height: 960 }); await settle(page);
        const nav = section.id === "notifications" ? page.locator(".notification-bell") : page.locator(`.rail-action[aria-label="${section.label}"]`);
        if (!await nav.isVisible()) {
          const menu = page.getByRole("button", { name: "Открыть меню", exact: true });
          if (await menu.count()) await menu.click();
          const more = page.getByRole("button", { name: /^Ещё,/ });
          if (!await nav.isVisible() && await more.count()) await more.click();
        }
        // Keyboard activation also works for entries in the overflow portal.
        if (peopleSuite) await nav.click();
        else { await nav.focus(); await nav.press("Enter"); }
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
        await page.screenshot({ path: path.join(output, phase, file) });
        const geometry = await measure(page, section.root);
        results.push({ section: section.id, width, height, theme, ...geometry });
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
        if (phase === "after" && !attentionSuite && !peopleSuite && !operationsSuite && !documentsSuite) {
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
        console.log(`${phase} ${file}`);
      }
      await context.close();
    }
    if (!galleryOnly) await fs.writeFile(path.join(output, `${phase}.json`), JSON.stringify({ results, errors }, null, 2));
    assert.deepEqual(errors, []);
    await fs.writeFile(path.join(output, "index.html"), `<!doctype html><html lang="ru"><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1"><title>Yuksalish — сравнение интерфейса</title>
      <style>*{box-sizing:border-box}body{margin:0;padding:24px;background:#111318;color:#eceef4;font:15px/1.5 system-ui}main{max-width:1600px;margin:auto}h1{font-size:28px}p,figcaption{color:#bfc6d3}select{margin:0 0 24px;padding:12px;border-radius:8px;background:#252a33;color:inherit}section{margin:0 0 32px}h2{font-size:20px}article{display:grid;grid-template-columns:1fr 1fr;gap:16px}figure{margin:0;min-width:0}img{display:block;width:100%;height:auto;border-radius:12px}figcaption{margin-bottom:8px}@media(max-width:700px){article{grid-template-columns:1fr}body{padding:12px}}</style>
      <main><h1>Итерация ${iteration} · Общая сетка рабочих разделов</h1><p>Реальные компоненты приложения, одинаковые синтетические данные до и после. Нажмите на снимок для исходного размера.</p><select id="size" aria-label="Размер и тема"><option value="dark-1440">1440 × 960 · тёмная</option><option value="light-1440">1440 × 960 · светлая</option><option value="dark-1024">1024 × 768 · тёмная</option><option value="dark-390">390 × 844 · тёмная</option></select>
      ${sections.map(section => `<section data-section="${section.id}"><h2>${section.label}</h2><article>${["before", "after"].map((state, i) => `<figure><figcaption>${i ? "После" : "До"}</figcaption><a data-state="${state}" href="${state}/${section.id}-dark-1440.png"><img loading="lazy" src="${state}/${section.id}-dark-1440.png" alt="${section.label} — ${i ? "после" : "до"}"></a></figure>`).join("")}</article></section>`).join("")}
      ${documentsSuite ? '<section data-section="admin-menu"><h2>Режим администратора в меню аватара</h2><figure><figcaption>После · переключение прав и возврат к правам своей должности</figcaption><a data-state="after" href="after/admin-menu-dark-1440.png"><img loading="lazy" src="after/admin-menu-dark-1440.png" alt="Переключатель прав в меню профиля"></a></figure></section>' : ''}
      <p>Подход: <a href="https://github.com/heydamir/unslop" style="color:#90d5df">unslop · Damir Sokolovsky · CC BY 4.0</a>. Цвета статусов, права и рабочие процессы сохранены.</p></main><script>document.querySelector('#size').addEventListener('change',event=>{document.querySelectorAll('section').forEach(section=>section.querySelectorAll('[data-state]').forEach(link=>{const src=link.dataset.state+'/'+section.dataset.section+'-'+event.target.value+'.png';link.href=src;link.querySelector('img').src=src}))})</script></html>`);
  } finally { await browser.close(); }
})().catch(error => { console.error(error); process.exitCode = 1; });
