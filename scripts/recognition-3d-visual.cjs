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
  rewards: [],
  canIssueReward: true,
  canManageSettings: false,
};

async function main() {
  const origin = process.env.YUKSALISH_VISUAL_URL || "http://127.0.0.1:4173";
  const output = path.resolve("tmp/recognition-3d");
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
    return route.fulfill({ status: 204, body: "" });
  });

  try {
    await page.goto(origin);
    await page.getByLabel(/Логин/).fill("visual");
    await page.getByLabel(/Пароль/).fill("visual-only");
    await page.getByRole("button", { name: "Войти", exact: true }).click();
    await page.locator(".app-shell").waitFor();
    await page.getByRole("button", { name: /Открыть меню профиля:/ }).click();
    await page.getByRole("button", { name: "Профиль сотрудника", exact: true }).click();
    const dialog = page.getByRole("dialog", { name: "Публичный профиль сотрудника" });
    await dialog.waitFor();
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
    assert.equal(await page.locator("svg.recognition-badge-artwork").count(), 0);
    assert.equal(await page.locator("img.recognition-badge-artwork").count(), achievements.length);
    await dialog.screenshot({ path: path.join(output, "all-tiers.png") });

    const cosmicCard = page.locator(".recognition-rarity-cosmic");
    await cosmicCard.hover();
    await page.waitForTimeout(180);
    await dialog.screenshot({ path: path.join(output, "cosmic-hover.png") });

    await dialog.getByRole("button", { name: "Награды", exact: true }).click();
    await dialog.getByRole("button", { name: "Выдать награду", exact: true }).click();
    await page.locator(".reward-icon-picker").waitFor();
    await page.waitForFunction(() => [...document.querySelectorAll(".reward-icon-picker img")]
      .every((image) => image.complete && image.naturalWidth > 0));
    assert.equal(await page.locator(".reward-icon-picker img.recognition-badge-artwork").count(), 6);
    await dialog.screenshot({ path: path.join(output, "reward-types.png") });
    await page.locator(".reward-icon-picker").screenshot({ path: path.join(output, "reward-picker.png") });

    await page.emulateMedia({ reducedMotion: "reduce" });
    const reducedMotion = await page.locator(".recognition-holographic-card").first().evaluate((card) => ({
      transform: getComputedStyle(card).transform,
      transition: getComputedStyle(card).transitionDuration,
    }));
    assert.equal(reducedMotion.transform, "none");
    assert.deepEqual(errors, []);
    await fs.writeFile(path.join(output, "results.json"), JSON.stringify({
      renderedTiers,
      iconCount: achievements.length,
      rewardTypeCount: 6,
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
