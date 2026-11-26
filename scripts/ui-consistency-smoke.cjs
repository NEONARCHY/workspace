// Comparable production-App screenshots. All API traffic stays in synthetic fixtures.
const { chromium } = require(process.env.PLAYWRIGHT_MODULE || "playwright");
const fs = require("node:fs/promises");
const path = require("node:path");
const assert = require("node:assert/strict");
const phase = process.argv.includes("--before") ? "before" : "after";
const galleryOnly = process.argv.includes("--gallery-only");
const origin = process.env.UI_QA_ORIGIN || "http://127.0.0.1:5186";
assert(["127.0.0.1", "localhost"].includes(new URL(origin).hostname));
const output = path.resolve(process.env.UI_QA_OUTPUT || "tmp/ui-consistency-iteration-1");
const sections = [{ id: "tasks", label: "Задачи", root: ".tasks-view" }, { id: "payments", label: "Заявки на оплату", root: ".approvals-view" }, { id: "trips", label: "Поездки", root: ".trips-view" }];
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
  return { user, people, tasks, requests, tripRequests, workflow };
}
async function measure(page, selector) {
  return page.locator(selector).evaluate(root => {
    const rect = node => { const r = node?.getBoundingClientRect(); return r ? { x: r.x, y: r.y, width: r.width, height: r.height, bottom: r.bottom, right: r.right } : null; };
    const hero = root.querySelector(".ws-section-header"), toolbar = root.querySelector(".ws2-process-toolbar, .task-filters"), search = root.querySelector(".workspace-search");
    return { hero: rect(hero), toolbar: rect(toolbar), search: rect(search), root: rect(root),
      pageOverflow: document.documentElement.scrollWidth - innerWidth,
      filters: rect(root.querySelector(".workspace-queue-filters")),
      controls: toolbar ? [...toolbar.children].filter(n => n.getBoundingClientRect().width).map(n => ({ class: n.className, ...rect(n) })) : [],
      rows: root.querySelectorAll("tbody tr, .approval-board-card, .kanban-card").length };
  });
}
(async () => {
  await fs.mkdir(path.join(output, phase), { recursive: true });
  const browser = await chromium.launch({ channel: "msedge", headless: true });
  const results = [], errors = [];
  try {
    for (const [width, height, theme] of galleryOnly ? [] : [[1440, 960, "dark"], [1440, 960, "light"], [1024, 768, "dark"], [390, 844, "dark"]]) {
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
        if (endpoint === "/workspace/bootstrap") return send({ currentUser: data.user, people: data.people, tasks: data.tasks, requests: data.requests, tripRequests: data.tripRequests, workflow: data.workflow, projectWorkflow: null, tripWorkflow: null, requestWorkflows: {}, projects: [], chats: [], messages: [], departments: [], positions: [], attachments: [], feedPosts: [], calendarEvents: [], notifications: [], canCreatePaymentRequests: true, notificationPreferences: { desktopEnabled: false } });
        if (endpoint === "/personal-preferences/release-history") return send({ readEntryIds: releaseIds });
        if (endpoint === "/workday/me") return send({ status: "not_started", schedule: { startsAt: "09:00", endsAt: "18:00" }, session: null });
        if (endpoint === "/support-requests") return send({ mode: "inbox", requests: [], unreadResponseCount: 0, indicator: null });
        if (endpoint === "/updates/policy") return send({ mandatory: false, minimumVersion: null, publishedVersion: null });
        if (endpoint.includes("/approval-inbox/")) return send({ enabled: false, items: [] });
        if (endpoint === "/project-hub" || endpoint.includes("/targets")) return send({ projects: [], workstreams: [], items: [], requests: [] });
        if (endpoint.includes("/task-plans") || endpoint.includes("/task-proposals")) return send([]);
        if (endpoint.includes("/dossier/reminder")) return send({ period: "2026-11", dueDate: "2026-11-25", due: false, status: "no_changes", respondedAt: null });
        if (endpoint.includes("/directory")) return send({ employees: data?.people ?? [], people: data?.people ?? [], roles: [], positions: [], departments: [], modules: [], accessRules: [] });
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
        const nav = page.locator(`.rail-action[aria-label="${section.label}"]`);
        if (!await nav.isVisible()) {
          const menu = page.getByRole("button", { name: "Открыть меню", exact: true });
          if (await menu.count()) await menu.click();
          const more = page.getByRole("button", { name: /^Ещё,/ });
          if (!await nav.isVisible() && await more.count()) await more.click();
        }
        // Keyboard activation also works for entries in the overflow portal.
        await nav.focus(); await nav.press("Enter");
        try { await page.locator(section.root).waitFor(); } catch (error) {
          await page.screenshot({ path: path.join(output, `${phase}-failure-${width}.png`) });
          console.log((await page.locator(".workspace").innerText().catch(() => page.locator("body").innerText())).slice(0, 2500));
          throw error;
        }
        await page.setViewportSize({ width, height });
        await settle(page);
        await page.mouse.move(width - 1, 0);
        const file = `${section.id}-${theme}-${width}.png`;
        await page.screenshot({ path: path.join(output, phase, file) });
        const geometry = await measure(page, section.root);
        results.push({ section: section.id, width, height, theme, ...geometry });
        if (phase === "after") {
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
        console.log(`${phase} ${file}`);
      }
      await context.close();
    }
    if (!galleryOnly) await fs.writeFile(path.join(output, `${phase}.json`), JSON.stringify({ results, errors }, null, 2));
    assert.deepEqual(errors, []);
    await fs.writeFile(path.join(output, "index.html"), `<!doctype html><html lang="ru"><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1"><title>Yuksalish — сравнение интерфейса</title>
      <style>*{box-sizing:border-box}body{margin:0;padding:24px;background:#111318;color:#eceef4;font:15px/1.5 system-ui}main{max-width:1600px;margin:auto}h1{font-size:28px}p,figcaption{color:#bfc6d3}select{margin:0 0 24px;padding:12px;border-radius:8px;background:#252a33;color:inherit}section{margin:0 0 32px}h2{font-size:20px}article{display:grid;grid-template-columns:1fr 1fr;gap:16px}figure{margin:0;min-width:0}img{display:block;width:100%;height:auto;border-radius:12px}figcaption{margin-bottom:8px}@media(max-width:700px){article{grid-template-columns:1fr}body{padding:12px}}</style>
      <main><h1>Итерация 1 · Общая сетка рабочих разделов</h1><p>Реальные компоненты приложения, одинаковые синтетические данные до и после. Нажмите на снимок для исходного размера.</p><select id="size" aria-label="Размер и тема"><option value="dark-1440">1440 × 960 · тёмная</option><option value="light-1440">1440 × 960 · светлая</option><option value="dark-1024">1024 × 768 · тёмная</option><option value="dark-390">390 × 844 · тёмная</option></select>
      ${sections.map(section => `<section data-section="${section.id}"><h2>${section.label}</h2><article>${["before", "after"].map((state, i) => `<figure><figcaption>${i ? "После" : "До"}</figcaption><a data-state="${state}" href="${state}/${section.id}-dark-1440.png"><img loading="lazy" src="${state}/${section.id}-dark-1440.png" alt="${section.label} — ${i ? "после" : "до"}"></a></figure>`).join("")}</article></section>`).join("")}
      <p>Подход: <a href="https://github.com/heydamir/unslop" style="color:#90d5df">unslop · Damir Sokolovsky · CC BY 4.0</a>. Цвета статусов, права и рабочие процессы сохранены.</p></main><script>document.querySelector('#size').addEventListener('change',event=>{document.querySelectorAll('section').forEach(section=>section.querySelectorAll('[data-state]').forEach(link=>{const src=link.dataset.state+'/'+section.dataset.section+'-'+event.target.value+'.png';link.href=src;link.querySelector('img').src=src}))})</script></html>`);
  } finally { await browser.close(); }
})().catch(error => { console.error(error); process.exitCode = 1; });
