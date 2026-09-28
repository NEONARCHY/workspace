// Visual QA for recognition artwork. All API traffic is intercepted; the LAN server is untouched.
const { chromium } = require(process.env.PLAYWRIGHT_MODULE || "playwright");
const assert = require("node:assert/strict");
const fs = require("node:fs/promises");
const path = require("node:path");

const person = {
  id: "aziza",
  username: "aziza",
  name: "Азиза Каримова",
  initials: "АК",
  role: "manager",
  jobTitle: "Руководитель проектного офиса",
  color: "#0091a8",
};

const tierFixtures = [
  ["bronze", "check", "Точный старт"],
  ["silver", "camera", "Организатор встреч"],
  ["gold", "mail", "Деловая переписка"],
  ["platinum", "megaphone", "Голос Ленты"],
  ["sapphire", "receipt", "Инициатор оплат"],
  ["amethyst", "target", "Оплата доведена до результата"],
  ["prism", "signal", "Голос команды"],
  ["cosmic", "layers", "Архитектор проектов"],
];

const otherTypes = [
  ["bronze", "compass", "Маршрут согласован"],
  ["silver", "spark", "Поддержка коллег"],
  ["gold", "pulse", "Стабильная эффективность"],
  ["platinum", "orbit", "Серия эффективности"],
  ["sapphire", "gem", "Верность команде"],
];

const achievements = [...tierFixtures, ...otherTypes].map(([tier, iconKey, title], index) => ({
  code: `visual-${tier}-${iconKey}`,
  title: `${title} · ${index + 1}`,
  description: "Подтверждённое достижение Workspace",
  category: "visual",
  tier,
  iconKey,
  progress: index < tierFixtures.length ? index + 1 : 0,
  target: index + 1,
  unlocked: index < tierFixtures.length,
}));

const rewardCatalog = [
  ["appreciation", "Благодарность", "За помощь и поддержку"],
  ["leadership", "Лидерство", "За ответственность"],
  ["rescue", "Спасение срока", "За вклад в критический момент"],
  ["mentorship", "Наставничество", "За развитие коллег"],
  ["innovation", "Новаторство", "За полезную идею"],
  ["reliability", "Надёжность", "За устойчивый результат"],
  ["teamwork", "Командная работа", "За общий результат"],
  ["initiative", "Инициатива", "За полезное дело"],
  ["mastery", "Мастерство", "За высокое качество"],
].map(([iconKey, title, description]) => ({ iconKey, title, description }));

const rewards = ["После запуска проекта", "После сложной задачи"].map((contextNote, index) => ({
  id: `reward-${index}`,
  iconKey: "teamwork",
  title: "Командная работа",
  description: "За общий результат",
  contextNote,
  recipientUserId: person.id,
  issuerUserId: `issuer-${index}`,
  issuerName: index === 0 ? "Малика Нурова" : "Дилшод Рахимов",
  createdAt: `2026-09-${27 - index}T12:00:00Z`,
}));

const profile = {
  person,
  departmentName: "Проектный офис",
  employmentDate: "2024-02-01",
  serviceYears: 2,
  serviceMonths: 7,
  serviceDays: 23,
  activeTaskCount: 4,
  activeTaskCountVisible: true,
  achievements,
  rewards,
  rewardCatalog,
  canIssueReward: true,
  canManageSettings: false,
};

async function main() {
  const origin = process.env.YUKSALISH_VISUAL_URL || "http://127.0.0.1:4173";
  const output = path.resolve(process.env.YUKSALISH_VISUAL_OUTPUT || "tmp/recognition-3d");
  await fs.mkdir(output, { recursive: true });
  const browser = await chromium.launch({ channel: "msedge", headless: true });
  const page = await browser.newPage({ viewport: { width: 1440, height: 960 } });
  const errors = [];
  page.on("pageerror", (error) => errors.push(error.message));
  page.on("console", (message) => {
    if (message.type() === "error" && !message.text().includes("WebSocket connection")) {
      errors.push(message.text());
    }
  });
  await page.route("**/favicon.ico", (route) => route.fulfill({ status: 204, body: "" }));
  await page.route("**/version.json", (route) => route.fulfill({ json: {
    buildId: "recognition-3d-visual",
    version: "1.0.18",
    builtAt: "2026-09-27T00:00:00.000Z",
    title: "Visual QA",
    notes: [],
  } }));
  await page.route("**/api/v1/**", async (route) => {
    const url = route.request().url();
    if (url.endsWith("/auth/web/login")) {
      return route.fulfill({ json: { accessToken: "visual-token", tokenType: "bearer", expiresIn: 900, user: person } });
    }
    if (url.endsWith("/workspace/bootstrap")) {
      return route.fulfill({ json: {
        currentUser: person,
        canCreatePaymentRequests: true,
        people: [person],
        positions: [],
        chats: [],
        messages: [],
        tasks: [],
        requests: [],
        projects: [],
        tripRequests: [],
        feedPosts: [],
        calendarEvents: [],
        notifications: [],
        attachments: [],
        workflow: null,
        requestWorkflows: [],
        notificationPreferences: {
          desktopEnabled: false,
          messagesEnabled: true,
          tasksEnabled: true,
          approvalsEnabled: true,
          tripsEnabled: true,
          calendarEnabled: true,
          remindersEnabled: true,
        },
      } });
    }
    if (url.includes("/recognition/profiles/aziza")) return route.fulfill({ json: profile });
    if (url.endsWith("/efficiency")) return route.fulfill({ json: {
      period: "2026-09", timezone: "Asia/Tashkent", methodologyVersion: "EFF-1.0", trackingStartedAt: "2026-09-01", currentUserId: person.id,
      employees: [{ userId: person.id, name: person.name, jobTitle: person.jobTitle, period: "2026-09", timezone: "Asia/Tashkent", percentage: 80, onTimeCount: 4, eligibleCount: 5, overdueCount: 1, awaitingReviewCount: 0, noDueDateCount: 0, returnedForRevisionCount: 0, excludedCount: 0, sampleSize: 5, methodologyVersion: "EFF-1.0", trackingStartedAt: "2026-09-01", historyCompleteness: "complete", smallSample: false, history: [] }],
    } });
    return route.fulfill({ status: 204, body: "" });
  });

  try {
    await page.goto(origin);
    await page.getByLabel(/Логин/).fill("visual");
    await page.getByLabel(/Пароль/).fill("visual-only");
    await page.getByRole("button", { name: "Войти", exact: true }).click();
    await page.locator(".app-shell").waitFor();
    if (await page.getByRole("button", { name: "Напомнить позже" }).isVisible()) {
      await page.getByRole("button", { name: "Напомнить позже" }).click();
    }
    await page.getByRole("button", { name: /Открыть меню профиля:/ }).click();
    await page.getByRole("button", { name: "Профиль сотрудника", exact: true }).click();
    const dialog = page.getByRole("dialog", { name: "Публичный профиль сотрудника" });
    await dialog.waitFor();
    await dialog.getByRole("meter", { name: "Эффективность выполнения задач в срок" }).waitFor();
    assert.equal(await dialog.getByRole("meter", { name: "Эффективность выполнения задач в срок" }).getAttribute("aria-valuenow"), "80");
    await page.waitForTimeout(280);
    await dialog.screenshot({ path: path.join(output, "profile-overview.png") });
    await dialog.locator(".employee-profile-latest-achievement").first().hover();
    await page.getByRole("tooltip").waitFor();
    await dialog.getByRole("button", { name: "Достижения", exact: true }).click();
    await page.waitForFunction(() => {
      const images = [...document.querySelectorAll(".recognition-badge-artwork")];
      return images.length > 0 && images.every((image) => image.complete && image.naturalWidth > 0);
    });

    const renderedTiers = await page.locator(".achievement-card").evaluateAll((cards) => cards.map((card) => (
      [...card.classList].find((name) => name.startsWith("recognition-rarity-"))
    )));
    for (const [tier] of tierFixtures) {
      assert(renderedTiers.includes(`recognition-rarity-${tier}`), `missing ${tier} card`);
    }
    const cardEdgeSpace = await dialog.locator(".achievement-grid").first().evaluate((grid) => {
      const viewport = grid.closest(".fui-DialogContent").getBoundingClientRect();
      const cards = [...grid.querySelectorAll(".achievement-card")].map((card) => card.getBoundingClientRect());
      return {
        left: Math.min(...cards.map((card) => card.left)) - viewport.left,
        right: viewport.right - Math.max(...cards.map((card) => card.right)),
        gridLeft: grid.getBoundingClientRect().left - viewport.left,
        gridRight: viewport.right - grid.getBoundingClientRect().right,
        paddingLeft: getComputedStyle(grid).paddingLeft,
      };
    });
    assert(cardEdgeSpace.left >= 24 && cardEdgeSpace.right >= 24,
      `achievement glow needs space at both edges: ${JSON.stringify(cardEdgeSpace)}`);
    assert.equal(await page.locator("svg.recognition-badge-artwork").count(), 0);
    assert.equal(
      await page.locator(".achievement-card img.recognition-badge-artwork").count(),
      await page.locator(".achievement-card").count(),
    );
    await page.waitForTimeout(300);
    const cardStates = await page.locator(".achievement-card").evaluateAll((cards) => cards.map((card) => ({
      unlocked: card.classList.contains("is-unlocked"),
      opacity: Number.parseFloat(getComputedStyle(card).opacity),
      decorationBefore: getComputedStyle(card.querySelector(".recognition-card-surface"), "::before").content,
      decorationAfter: getComputedStyle(card.querySelector(".recognition-card-surface"), "::after").content,
    })));
    const unlockedOpacity = cardStates.find((card) => card.unlocked)?.opacity ?? 0;
    const lockedOpacity = cardStates.find((card) => !card.unlocked)?.opacity ?? 1;
    assert(
      lockedOpacity < unlockedOpacity,
      `locked achievements must be visually quieter: ${JSON.stringify(cardStates)}`,
    );
    assert(
      cardStates.every((card) => ["none", '""'].includes(card.decorationBefore)
        && ["none", '""'].includes(card.decorationAfter)),
      "card dots and diagonal stripes must be absent",
    );
    await dialog.screenshot({ path: path.join(output, "all-tiers.png") });
    await dialog.getByText("Следующие цели", { exact: true }).scrollIntoViewIfNeeded();
    await dialog.screenshot({ path: path.join(output, "locked-achievements.png") });
    const lockedCard = page.locator(".achievement-card:not(.is-unlocked)").first();
    const lockedShadow = await lockedCard.locator(".recognition-card-surface").evaluate((surface) => getComputedStyle(surface).boxShadow);
    await lockedCard.hover();
    await page.waitForTimeout(250);
    assert.equal(await lockedCard.evaluate((card) => card.style.getPropertyValue("--recognition-active")), "0");
    assert.equal(await lockedCard.locator(".recognition-card-surface").evaluate((surface) => getComputedStyle(surface).boxShadow), lockedShadow);

    const cosmicCard = page.locator(".recognition-rarity-cosmic");
    await cosmicCard.hover();
    await page.waitForTimeout(180);
    await dialog.screenshot({ path: path.join(output, "cosmic-hover.png") });

    await dialog.getByRole("button", { name: "Награды", exact: true }).click();
    assert.equal(await dialog.locator(".employee-reward-card").count(), 1);
    await dialog.getByRole("button", { name: /Командная работа: 2 награды/ }).hover();
    await page.getByText("После запуска проекта", { exact: true }).waitFor();
    await page.waitForTimeout(220);
    await dialog.screenshot({ path: path.join(output, "rewards-first.png") });
    const profileScrollBeforeHistory = await dialog.locator(".fui-DialogContent").evaluate((content) => content.scrollTop);
    await dialog.getByRole("button", { name: /Командная работа: 2 награды/ }).click();
    const history = page.getByRole("dialog", { name: "История награды" });
    await history.waitFor();
    assert.equal(await dialog.count(), 1, "profile must remain mounted under reward history");
    await page.waitForTimeout(280);
    await page.screenshot({ path: path.join(output, "reward-history-layer.png") });
    assert.equal(await history.locator(".reward-history-content li").count(), 2);
    await page.waitForTimeout(450);
    await history.screenshot({ path: path.join(output, "reward-history.png") });
    const longHistory = await history.evaluate((surface) => {
      const list = surface.querySelector(".reward-history-content ol");
      for (let index = 0; index < 18; index += 1) {
        list.append(list.firstElementChild.cloneNode(true));
      }
      const content = surface.querySelector(".fui-DialogContent");
      content.scrollTop = content.scrollHeight;
      return {
        scrollHeight: content.scrollHeight,
        clientHeight: content.clientHeight,
        titleTop: surface.querySelector(".fui-DialogTitle").getBoundingClientRect().top,
        surfaceTop: surface.getBoundingClientRect().top,
      };
    });
    assert(longHistory.scrollHeight > longHistory.clientHeight);
    assert(longHistory.titleTop >= longHistory.surfaceTop);
    await history.screenshot({ path: path.join(output, "reward-history-long.png") });
    await history.getByRole("button", { name: "Вернуться к профилю" }).click();
    await history.waitFor({ state: "hidden" });
    await page.waitForFunction(() => document.activeElement?.matches(".employee-reward-card"));
    await page.waitForFunction((expected) => {
      const scrollTop = document.querySelector(".employee-profile-dialog .fui-DialogContent")?.scrollTop ?? 0;
      return Math.abs(scrollTop - expected) < 8;
    }, profileScrollBeforeHistory);
    const profileScrollAfterHistory = await dialog.locator(".fui-DialogContent").evaluate((content) => content.scrollTop);
    assert(Math.abs(profileScrollAfterHistory - profileScrollBeforeHistory) < 8,
      `profile scroll changed: ${profileScrollBeforeHistory} → ${profileScrollAfterHistory}`);
    await dialog.getByRole("button", { name: "Выдать награду", exact: true }).click();
    await page.locator(".reward-icon-picker").waitFor();
    await page.waitForFunction(() => [...document.querySelectorAll(".reward-icon-picker img")]
      .every((image) => image.complete && image.naturalWidth > 0));
    assert.equal(await page.locator(".reward-icon-picker img.recognition-badge-artwork").count(), 9);
    const rewardBases = await page.locator(".reward-catalog-option .recognition-card-surface").evaluateAll((surfaces) => surfaces.map((surface) => getComputedStyle(surface).backgroundImage));
    assert.equal(new Set(rewardBases).size, 9, "every reward must have a distinct shimmer palette");
    await dialog.screenshot({ path: path.join(output, "reward-types.png") });
    await page.locator(".reward-icon-picker").screenshot({ path: path.join(output, "reward-picker.png") });
    await page.getByRole("dialog", { name: "Выдать награду" }).getByRole("button", { name: "Отмена" }).click();
    await page.waitForTimeout(350);
    await dialog.getByRole("button", { name: "Как это работает" }).click();
    const guide = page.getByRole("dialog", { name: "Как работают награды и достижения" });
    await guide.waitFor();
    assert.equal(await dialog.count(), 1, "profile must remain mounted under guide");
    await page.waitForTimeout(450);
    assert.equal(await guide.locator(".recognition-guide-reward-grid article").count(), 9);
    await guide.screenshot({ path: path.join(output, "recognition-guide.png") });
    await guide.getByText("Карта достижений", { exact: true }).scrollIntoViewIfNeeded();
    const guideGeometry = await guide.evaluate((dialog) => {
      const title = dialog.querySelector(".fui-DialogTitle");
      const content = dialog.querySelector(".fui-DialogContent");
      return {
        top: dialog.getBoundingClientRect().top,
        titleTop: title.getBoundingClientRect().top,
        contentHeight: content.clientHeight,
        contentScrollHeight: content.scrollHeight,
        contentScrollTop: content.scrollTop,
      };
    });
    assert(guideGeometry.contentScrollHeight > guideGeometry.contentHeight);
    assert(guideGeometry.contentScrollTop > 0);
    assert(guideGeometry.titleTop >= guideGeometry.top, "guide title should remain visible while scrolling");
    await guide.screenshot({ path: path.join(output, "recognition-guide-ladders.png") });
    await page.setViewportSize({ width: 1024, height: 768 });
    await guide.screenshot({ path: path.join(output, "recognition-guide-compact.png") });
    assert.equal(await page.evaluate(() => document.documentElement.scrollWidth > innerWidth), false);
    await page.setViewportSize({ width: 720, height: 720 });
    await guide.screenshot({ path: path.join(output, "recognition-guide-narrow.png") });
    assert.equal(await page.evaluate(() => document.documentElement.scrollWidth > innerWidth), false);
    await page.setViewportSize({ width: 1440, height: 960 });
    await guide.getByRole("button", { name: "Вернуться к профилю" }).click();
    await dialog.waitFor();
    await page.waitForFunction(() => document.activeElement?.textContent?.includes("Как это работает"));

    await page.emulateMedia({ reducedMotion: "reduce" });
    const reducedMotion = await page.locator(".recognition-holographic-card").first().evaluate((card) => ({
      transform: getComputedStyle(card).transform,
      transition: getComputedStyle(card).transitionDuration,
    }));
    assert.equal(reducedMotion.transform, "none");
    assert.deepEqual(errors, []);
    await fs.writeFile(path.join(output, "results.json"), JSON.stringify({
      renderedTiers,
      iconCount: await page.locator(".achievement-card").count(),
      rewardTypeCount: 9,
      cardStates,
      guideGeometry,
      reducedMotion,
      errors,
    }, null, 2));
    console.log(`PASS: recognition artwork verified in ${output}`);
  } finally {
    await browser.close();
  }
}

main().catch((error) => {
  console.error(error);
  process.exitCode = 1;
});
