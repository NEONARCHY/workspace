// Local UI test only: synthetic trips, creation, edits and decisions stay in memory.
const { chromium, _electron: electron } = require(process.env.PLAYWRIGHT_MODULE || "playwright");
const assert = require("node:assert/strict");
const fs = require("node:fs/promises");
const path = require("node:path");
const stages = { launch: ["Запуск", "#22b9ff"], manager_approval: ["Утверждение руководителем", "#88b9ff"], hr: ["Кадровая служба", "#10e5fc"], approved: ["Утверждено", "#00ff00"], rejected: ["Отклонено", "#ff0000"] };
async function main() {
  const origin = process.env.YUKSALISH_SMOKE_URL || "http://127.0.0.1:5173";
  assert(["localhost", "127.0.0.1"].includes(new URL(origin).hostname));
  const native = Boolean(process.env.TRIP_ELECTRON_EXE);
  const output = path.resolve(`tmp/trip-board-smoke${native ? "-desktop" : ""}`);
  await fs.mkdir(output, { recursive: true });
  let browser, app, page;
  if (native) {
    const profile = await fs.mkdtemp(path.join(output, "profile-"));
    app = await electron.launch({ executablePath: path.resolve(process.env.TRIP_ELECTRON_EXE), args: [`--user-data-dir=${profile}`] });
    page = await app.firstWindow();
    assert.equal(await app.evaluate(({ app }) => app.getVersion()), JSON.parse(await fs.readFile("apps/desktop/package.json", "utf8")).version);
  } else {
    browser = await chromium.launch({ channel: "msedge", headless: true });
    page = await browser.newPage();
  }
  const resize = async (width, height = 900) => native ? app.evaluate(({ BrowserWindow }, [w, h]) => BrowserWindow.getAllWindows()[0].setSize(w, h), [width, height]) : page.setViewportSize({ width, height });
  await resize(1440);
  const errors = [], mutations = []; let trips, userId, fixture, rejectNext = false;
  page.on("pageerror", (error) => errors.push(error.message));
  await page.route("**/api/v1/chats/*/read", (route) => route.fulfill({ status: 204 }));
  await page.route("**/api/v1/workspace/bootstrap", async (route) => {
    const response = await route.fetch(); const data = await response.json(); userId = data.currentUser.id;
    fixture = { id: "qa-trip-launch", number: "TR-QA-1", purpose: "Встреча с региональной командой", destination: "Самарканд", startDate: "2026-09-18", endDate: "2026-09-20", requesterUserId: userId, employeeIds: [userId], stage: "launch", stageLabel: "Запуск", status: "draft", statusLabel: "Черновик", canEdit: true, allowedActions: ["submit"], actions: [], createdAt: "2026-09-04T09:00:00Z", updatedAt: "2026-09-04T09:00:00Z" };
    trips ??= [fixture, { ...fixture, id: "qa-trip-hr", number: "TR-QA-2", purpose: "Обсуждение проекта с партнёрами", destination: "Бухара", stage: "hr", stageLabel: stages.hr[0], status: "running", statusLabel: "На согласовании", canEdit: false, allowedActions: ["approve", "return", "reject"] }, { ...fixture, id: "qa-trip-locked", number: "TR-QA-3", purpose: "Поездка без права решения", destination: "Ташкент", stage: "manager_approval", stageLabel: stages.manager_approval[0], canEdit: false, allowedActions: [] }];
    await route.fulfill({ response, json: { ...data, tripRequests: trips } });
  });
  await page.route("**/api/v1/trip-requests**", async (route) => {
    const req = route.request(), payload = req.postDataJSON();
    const id = req.url().match(/trip-requests\/([^/?]+)/)?.[1];
    if (rejectNext) { rejectNext = false; await route.fulfill({ status: 403, json: { detail: "Test: permission changed" } }); return; }
    mutations.push({ method: req.method(), id, ...payload });
    if (!id && req.method() === "POST") {
      const created = { ...fixture, ...payload, id: "qa-trip-created", number: "TR-QA-4" };
      trips = [...trips, created]; await route.fulfill({ status: 201, json: created }); return;
    }
    const trip = trips.find((trip) => trip.id === id); assert(trip, "Only synthetic trip IDs may be mutated");
    let updated;
    if (req.method() === "PATCH") updated = { ...trip, ...payload };
    else {
      assert(req.url().endsWith("/actions") && req.method() === "POST");
      assert(trip.allowedActions.includes(payload.action));
      const action = payload.action;
      if (["return", "reject"].includes(action)) assert(payload.comment.trim());
      const stage = ["submit", "resubmit"].includes(action) ? "manager_approval" : action === "return" ? "launch" : action === "reject" ? "rejected" : trip.stage === "manager_approval" ? "hr" : "approved";
      const final = ["approved", "rejected"].includes(stage);
      updated = { ...trip, stage, stageLabel: stages[stage][0], status: final ? stage : action === "return" ? "needs_revision" : "running", statusLabel: final ? stages[stage][0] : action === "return" ? "На доработке" : "На согласовании", canEdit: stage === "launch", allowedActions: final ? [] : stage === "launch" ? ["resubmit"] : ["approve", "return", "reject"], actions: [...trip.actions, { id: `action-${mutations.length}`, actorUserId: userId, fromStage: trip.stage, toStage: stage, action, comment: payload.comment, createdAt: new Date().toISOString() }] };
    }
    trips = trips.map((trip) => trip.id === id ? updated : trip); await route.fulfill({ json: updated });
  });
  const col = (key) => page.locator(`.trip-column[data-stage-key="${key}"]`);
  const card = (id) => page.locator(`.trip-board-card[data-trip-id="${id}"]`);
  const close = () => page.getByRole("button", { name: "Закрыть карточку поездки" }).click();
  const drag = async (id, target) => {
    await page.locator('.trip-kanban[aria-busy="false"]').waitFor();
    await card(id).dragTo(col(target), { sourcePosition: { x: 18, y: 18 }, targetPosition: { x: 130, y: 100 } });
  };
  const move = async (id, target) => { await drag(id, target); await col(target).locator(`[data-trip-id="${id}"]`).waitFor(); };
  const inspect = async () => {
    const problems = await page.evaluate(() => [...document.querySelectorAll(".trip-view,.trip-commandbar,.trip-dialog,.trip-form,.trip-detail")].filter((el) => el.getClientRects().length).filter((el) => { const r = el.getBoundingClientRect(); return r.left < -2 || r.right > innerWidth + 2 || el.scrollWidth > el.clientWidth + 2; }).map((el) => el.className));
    assert.deepEqual(problems, []);
  };
  try {
    if (!native) await page.goto(origin);
    await page.getByRole("textbox", { name: /Логин/ }).fill("malika");
    await page.getByLabel(/Пароль/).fill("Yuksalish-Local-2026!");
    await page.getByRole("button", { name: "Войти", exact: true }).click();
    await page.locator('.rail-action[aria-label="Согласование поездок"]').click();
    await page.evaluate(() => {
      window.tripEvents = [];
      for (const type of ["dragstart", "dragend", "drop"]) document.addEventListener(type, (event) => window.tripEvents.push({ type, tag: event.target.tagName, id: event.target.closest("[data-trip-id]")?.dataset.tripId, stage: event.target.closest("[data-stage-key]")?.dataset.stageKey }), true);
    });
    for (const [key, [, color]] of Object.entries(stages)) {
      const rgb = `rgb(${[1, 3, 5].map((offset) => parseInt(color.slice(offset, offset + 2), 16)).join(", ")})`;
      assert.equal(await col(key).locator("header").evaluate((node) => getComputedStyle(node).backgroundColor), rgb);
    }
    await page.screenshot({ animations: "disabled", path: path.join(output, "board.png") });
    assert.equal(await col("launch").locator(".approval-column-total strong").innerText(), "Не задана");
    assert.equal(await col("approved").locator(".approval-column-total strong").innerText(), "0 UZS");
    assert.equal(await card("qa-trip-locked").getAttribute("draggable"), "false");
    await card("qa-trip-launch").dragTo(col("hr")); assert.equal(mutations.length, 0, "Cannot skip a stage");
    await move("qa-trip-launch", "manager_approval");
    await drag("qa-trip-launch", "launch");
    await page.getByRole("form", { name: "Что нужно исправить?" }).waitFor();
    assert(await page.getByRole("button", { name: "Подтвердить решение" }).isDisabled());
    await page.getByLabel("Причина решения").fill("Уточнить цель поездки");
    await page.getByRole("button", { name: "Подтвердить решение" }).click();
    await page.getByRole("button", { name: "Изменить", exact: true }).click();
    await page.getByLabel("Цель поездки", { exact: true }).fill("Уточнённая рабочая встреча");
    await page.getByRole("button", { name: "Сохранить", exact: true }).click();
    await page.getByRole("button", { name: "Отправить повторно", exact: true }).click();
    await page.getByRole("button", { name: "Согласовать", exact: true }).waitFor();
    await page.screenshot({ animations: "disabled", path: path.join(output, "detail.png") });
    await close();
    await move("qa-trip-launch", "hr");
    await page.getByRole("button", { name: "Все", exact: true }).click();
    await move("qa-trip-launch", "approved");
    await card("qa-trip-hr").dragTo(col("rejected"));
    await page.getByRole("form", { name: "Причина отклонения" }).waitFor();
    const beforeCancel = mutations.length;
    await page.getByRole("button", { name: "Отмена", exact: true }).click();
    assert.equal(mutations.length, beforeCancel);
    await close();
    rejectNext = true;
    await card("qa-trip-hr").dragTo(col("approved"));
    await page.getByRole("alert").filter({ hasText: "Не удалось изменить стадию" }).waitFor();
    assert.equal(await col("hr").locator('[data-trip-id="qa-trip-hr"]').count(), 1);
    await drag("qa-trip-hr", "rejected");
    await page.getByLabel("Причина решения").fill("Поездка отменена организатором");
    await page.getByRole("button", { name: "Подтвердить решение" }).click();
    await page.getByText("Поездка отменена организатором", { exact: true }).waitFor();
    await close();
    assert.equal(await col("rejected").locator('[data-trip-id="qa-trip-hr"]').count(), 1);
    await page.getByLabel("Поиск поездок").fill("Уточнённая");
    assert.equal(await page.locator(".trip-board-card").count(), 1);
    await page.getByRole("button", { name: "Список", exact: true }).click();
    assert.equal(await page.locator(".trip-list-item").count(), 1);
    await page.getByRole("button", { name: "Канбан", exact: true }).click();
    await page.getByLabel("Поиск поездок").fill("");
    await page.getByRole("button", { name: "Новая командировка" }).click();
    await page.getByLabel("Цель поездки", { exact: true }).fill("Черновик сохраняется при изменении окна");
    await page.getByLabel("Куда едем", { exact: true }).fill("Навои");
    for (const [width, height] of [[800,600], [640,480], [480,360]]) {
      await resize(width, height); await inspect();
      assert.equal(await page.getByLabel("Куда едем", { exact: true }).inputValue(), "Навои");
      await page.screenshot({ animations: "disabled", path: path.join(output, `${width}-form.png`) });
    }
    await page.getByRole("button", { name: "Сохранить", exact: true }).click();
    await page.getByRole("heading", { name: "Навои", exact: true }).waitFor();
    await inspect();
    await page.keyboard.press("Escape");
    await page.getByRole("dialog").waitFor({ state: "hidden" });
    for (const [width, height] of [[480,360], [640,480], [800,600], [1440,900]]) {
      await resize(width, height); await inspect();
      await col("launch").scrollIntoViewIfNeeded();
      await page.screenshot({ animations: "disabled", path: path.join(output, `${width}-board.png`) });
    }
    assert.deepEqual(errors, []);
    assert.deepEqual(mutations.filter((item) => item.action).map((item) => item.action), ["submit", "return", "resubmit", "approve", "approve", "reject"]);
    console.log(`PASS: exact trip colours, drag permissions, correction/edit/resubmit/approval cycle, rejection with reason and cancellation, server denial, filters/list, create, dialogs, Escape and 4 window sizes${native ? " in packaged Electron" : " in Edge"}; no trip writes to server.`);
  } catch (error) { console.log(await page.evaluate(() => window.tripEvents)); await page.screenshot({ animations: "disabled", path: path.join(output, "failure.png") }).catch(() => undefined); throw error; }
  finally { if (app) await app.close(); if (browser) await browser.close(); }
}
main().catch((error) => { console.error(error); process.exitCode = 1; });
