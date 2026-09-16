// Cross-cutting interaction QA. All API traffic is intercepted; the LAN server is untouched.
const { chromium } = require(process.env.PLAYWRIGHT_MODULE || "playwright");
const assert = require("node:assert/strict");
const fs = require("node:fs/promises");
const path = require("node:path");

const people = [
  { id: "aziza", username: "aziza", name: "Азиза Каримова", initials: "АК", role: "manager", jobTitle: "Главный бухгалтер", color: "#0091a8" },
  { id: "baxtiyor", username: "baxtiyor", name: "Бахтиёр Самугов", initials: "БС", role: "employee", jobTitle: "Руководитель подразделения", color: "#476c91" },
];
const tasks = [{ id: "t1", title: "Согласовать график поставки", description: "Проверить даты и подтвердить график.", project: "Новый офис", authorId: "aziza", assigneeId: "baxtiyor", dueLabel: "18 сентября", dueAt: "2026-09-18T12:00:00Z", status: "in_progress", priority: "high", checklistDone: 1, checklistTotal: 3, chatId: "task-t1", participants: [], checklist: [], comments: [], dependencies: [] }];

async function main() {
  const origin = process.env.YUKSALISH_VISUAL_URL || "http://127.0.0.1:4173";
  const output = path.resolve("tmp/workspace-2-interactions");
  await fs.mkdir(output, { recursive: true });
  const browser = await chromium.launch({ channel: "msedge", headless: true });
  const page = await browser.newPage({ viewport: { width: 1440, height: 900 } });
  const errors = [];
  const violations = [];
  page.on("pageerror", error => errors.push(error.message));
  page.on("console", message => { if (message.type() === "error" && !message.text().includes("WebSocket connection")) errors.push(message.text()); });
  await page.route("**/favicon.ico", route => route.fulfill({ status: 204, body: "" }));
  await page.route("**/api/v1/**", async route => {
    const url = route.request().url();
    if (url.endsWith("/auth/web/login")) return route.fulfill({ json: { accessToken: "visual-token", tokenType: "bearer", expiresIn: 900, user: people[0] } });
    if (url.endsWith("/workspace/bootstrap")) return route.fulfill({ json: { currentUser: people[0], canCreatePaymentRequests: true, people, positions: [], chats: [], messages: [], tasks, requests: [], projects: [], tripRequests: [], feedPosts: [], calendarEvents: [], notifications: [], attachments: [], workflow: null, requestWorkflows: [], notificationPreferences: { desktopEnabled: false, messagesEnabled: true, tasksEnabled: true, approvalsEnabled: true, tripsEnabled: true, calendarEnabled: true, remindersEnabled: true } } });
    if (url.includes("/directory")) return route.fulfill({ json: {
      roles: [], departments: [], positions: [], modules: [], accessRules: [],
      employees: people.map(person => ({ ...person, status: "active", departmentId: null, positionId: null })),
    } });
    return route.fulfill({ status: 204, body: "" });
  });
  const audit = async (label, selector) => {
    const result = await page.evaluate(async scope => (await axe.run(scope ? document.querySelector(scope) : document, { runOnly: { type: "tag", values: ["wcag2a", "wcag2aa", "wcag21aa", "wcag22aa"] } })).violations.flatMap(item => {
      // Fluent's Tabster focus sentinels are intentionally focusable and aria-hidden;
      // they are infrastructure around the menu, not user-visible controls.
      const nodes = item.nodes.filter(node => !(item.id === "aria-hidden-focus" && node.html.includes("data-tabster-dummy")));
      return nodes.length ? [{ id: item.id, nodes: nodes.map(node => ({ target: node.target, failureSummary: node.failureSummary, any: node.any })) }] : [];
    }), selector);
    if (result.length) violations.push({ label, result });
  };
  try {
    await page.goto(origin);
    await page.evaluate(await fs.readFile(require.resolve("axe-core/axe.min.js"), "utf8"));
    await page.locator("[data-auth-waves]").waitFor();
    await page.waitForFunction(() => {
      const canvas = document.querySelector("[data-auth-waves]");
      return canvas instanceof HTMLCanvasElement && canvas.width > 0 && canvas.height > 0;
    });
    const authComposition = await page.locator(".auth-screen").evaluate(element => {
      const card = element.querySelector(".auth-card").getBoundingClientRect();
      const intro = element.querySelector(".auth-intro").getBoundingClientRect();
      const canvas = element.querySelector("[data-auth-waves]");
      return {
        cardCenterOffset: Math.round(card.left + card.width / 2 - window.innerWidth / 2),
        introCenterOffset: Math.round(intro.left + intro.width / 2 - window.innerWidth / 2),
        canvas: canvas instanceof HTMLCanvasElement
          ? { width: canvas.width, height: canvas.height, motion: canvas.dataset.motion }
          : null,
      };
    });
    assert(Math.abs(authComposition.cardCenterOffset) <= 2, "the sign-in card must be centred");
    assert(Math.abs(authComposition.introCenterOffset) <= 2, "the sign-in identity must be centred");
    assert(authComposition.canvas && authComposition.canvas.width > 0 && authComposition.canvas.height > 0);
    assert.equal(authComposition.canvas.motion, "active");
    await page.screenshot({ path: path.join(output, "login-overview.png") });
    const login = page.getByRole("textbox", { name: /Логин/ });
    await login.fill("");
    await login.focus();
    await login.type("visual");
    await page.waitForTimeout(220);
    const firstCaret = await page.locator(".ws-caret-line").boundingBox();
    assert(firstCaret && firstCaret.x > 0, "custom caret must be visible inside the login field");
    const focusedField = await login.evaluate(element => ({
      caret: getComputedStyle(element).caretColor,
      outline: getComputedStyle(element).outlineStyle,
      shellShadow: getComputedStyle(element.closest(".fui-Input")).boxShadow,
      delay: getComputedStyle(element.closest(".fui-Input")).transitionDelay,
      caretAnimation: getComputedStyle(document.querySelector(".ws-caret-line")).animationName,
    }));
    assert.equal(focusedField.caret, "rgba(0, 0, 0, 0)");
    assert.equal(focusedField.outline, "none");
    assert.notEqual(focusedField.shellShadow, "none");
    assert.match(focusedField.delay, /0\.0[45]5?s/);
    assert.equal(focusedField.caretAnimation, "ws-caret-office-blink");
    await login.type("-field");
    await page.waitForTimeout(120);
    const movedCaret = await page.locator(".ws-caret-line").boundingBox();
    assert(movedCaret && movedCaret.x > firstCaret.x + 8, "caret must follow the insertion point");
    await page.screenshot({ path: path.join(output, "login-focus.png") });
    await audit("login-focus", ".auth-screen");
    await page.getByRole("heading", { name: "Добро пожаловать" }).click();
    await page.waitForTimeout(180);
    assert.equal(await page.locator(".ws-caret-line").evaluate(element => getComputedStyle(element).opacity), "0");

    await page.setViewportSize({ width: 1024, height: 768 });
    const authAtTablet = await page.locator(".auth-screen").evaluate(element => ({
      documentOverflow: document.documentElement.scrollWidth > window.innerWidth,
      cardWidth: Math.round(element.querySelector(".auth-card").getBoundingClientRect().width),
      logoWidth: Math.round(element.querySelector(".auth-brand").getBoundingClientRect().width),
    }));
    assert.equal(authAtTablet.documentOverflow, false, "the sign-in screen must not overflow at 1024px");
    assert(authAtTablet.cardWidth <= 430 && authAtTablet.logoWidth <= 276);
    await page.screenshot({ path: path.join(output, "login-1024.png") });
    await audit("login-1024", ".auth-screen");
    await page.setViewportSize({ width: 1440, height: 900 });

    await login.fill("visual");
    await page.getByLabel(/Пароль/).fill("visual-only");
    await page.getByRole("button", { name: "Войти", exact: true }).click();
    await page.locator(".app-shell").waitFor();
    const tasksButton = page.locator('.rail-action[aria-label="Задачи"]');
    await tasksButton.click();
    const entering = await page.locator(".app-content > .workspace-view").evaluate(element => getComputedStyle(element).animationName);
    assert.equal(entering, "ws2-view-arrive");
    await page.waitForTimeout(340);
    const navState = await tasksButton.evaluate(element => ({
      active: element.classList.contains("active"),
      surfaceOpacity: getComputedStyle(element, "::before").opacity,
      radius: getComputedStyle(element, "::before").borderRadius,
    }));
    assert.deepEqual(navState, { active: true, surfaceOpacity: "1", radius: "14px" });
    await page.screenshot({ path: path.join(output, "navigation-active.png") });

    await page.getByRole("button", { name: /Профиль:/ }).click();
    await page.locator(".identity-popover").waitFor();
    await page.waitForTimeout(240);
    const popupStyle = await page.locator(".identity-popover").evaluate(element => ({
      radius: Number.parseFloat(getComputedStyle(element).borderRadius),
      blur: getComputedStyle(element).backdropFilter,
      background: getComputedStyle(element).backgroundImage,
    }));
    assert(popupStyle.radius >= 18);
    assert.notEqual(popupStyle.blur, "none");
    assert.notEqual(popupStyle.background, "none");
    await page.screenshot({ path: path.join(output, "profile-popover.png") });
    await audit("profile-popover", ".identity-popover");
    await page.keyboard.press("Escape");

    await page.locator('.rail-action[aria-label="Сотрудники"]').click();
    const roleFilter = page.getByRole("combobox", { name: "Фильтр по роли сотрудника" });
    await roleFilter.click();
    const formDropdown = page.locator(".fui-Listbox");
    await formDropdown.waitFor();
    await page.waitForTimeout(220);
    const dropdownStyle = await formDropdown.evaluate(element => ({
      radius: Number.parseFloat(getComputedStyle(element).borderRadius),
      blur: getComputedStyle(element).backdropFilter,
      background: getComputedStyle(element).backgroundImage,
      width: element.getBoundingClientRect().width,
      animation: getComputedStyle(element).animationName,
    }));
    assert(dropdownStyle.radius >= 18);
    assert(dropdownStyle.width >= 220);
    assert.notEqual(dropdownStyle.blur, "none");
    assert.notEqual(dropdownStyle.background, "none");
    assert.equal(dropdownStyle.animation, "none");
    await page.screenshot({ path: path.join(output, "form-dropdown.png") });
    await audit("form-dropdown", ".fui-Listbox");
    await formDropdown.getByRole("option", { name: "Сотрудник", exact: true }).click();
    await page.getByRole("button", { name: "Открыть сотрудника: Бахтиёр Самугов" }).waitFor();
    assert.equal(await page.getByRole("button", { name: "Открыть сотрудника: Азиза Каримова" }).count(), 0);
    await roleFilter.click();
    await page.locator(".fui-Listbox").getByRole("option", { name: "Все роли", exact: true }).click();

    await page.getByLabel("Выбрать сотрудника: Азиза Каримова").check();
    await page.getByRole("button", { name: "Действия", exact: true }).click();
    const contextMenu = page.locator(".fui-MenuPopover");
    await contextMenu.waitFor();
    await page.waitForTimeout(220);
    const menuStyle = await contextMenu.evaluate(element => ({
      radius: Number.parseFloat(getComputedStyle(element).borderRadius),
      blur: getComputedStyle(element).backdropFilter,
      background: getComputedStyle(element).backgroundImage,
      className: element.className,
      animation: getComputedStyle(element).animationName,
    }));
    assert(menuStyle.radius >= 18);
    assert.notEqual(menuStyle.blur, "none");
    assert.notEqual(menuStyle.background, "none");
    assert.equal(menuStyle.animation, "none");
    await page.screenshot({ path: path.join(output, "context-menu.png") });
    await audit("context-menu", ".fui-MenuPopover");
    await page.keyboard.press("Escape");

    await tasksButton.click();
    await page.getByRole("button", { name: "Новая задача", exact: true }).click();
    await page.getByRole("dialog", { name: "Новая задача" }).waitFor();
    await page.getByRole("button", { name: "Ответственный новой задачи" }).click();
    await page.locator(".person-picker-surface").waitFor();
    await page.waitForTimeout(240);
    await page.screenshot({ path: path.join(output, "person-picker.png") });
    await audit("person-picker", ".person-picker-surface");

    await page.emulateMedia({ reducedMotion: "reduce" });
    const pickerSearch = page.getByRole("textbox", { name: "Поиск: Ответственный новой задачи" });
    await pickerSearch.focus();
    await pickerSearch.type("Бах");
    await page.waitForTimeout(120);
    const reduced = await pickerSearch.evaluate(element => ({ caret: getComputedStyle(element).caretColor, line: getComputedStyle(document.querySelector(".ws-caret-line")).display }));
    assert.notEqual(reduced.caret, "rgba(0, 0, 0, 0)");
    assert.equal(reduced.line, "none");

    assert.deepEqual(violations, []);
    assert.deepEqual(errors, []);
    await fs.writeFile(path.join(output, "results.json"), JSON.stringify({ authComposition, authAtTablet, focusedField, navState, popupStyle, dropdownStyle, menuStyle, reduced, errors, violations }, null, 2));
    console.log(`PASS: WS2 interaction shell verified in ${output}`);
  } finally { await browser.close(); }
}
main().catch(error => { console.error(error); process.exitCode = 1; });
