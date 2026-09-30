// Isolated UI regression: every API request is intercepted, with no real login or writes.
const { chromium } = require(process.env.PLAYWRIGHT_MODULE || "playwright");
const assert = require("node:assert/strict");

async function main() {
  const origin = process.env.YUKSALISH_SMOKE_URL || "http://127.0.0.1:5188";
  assert(["127.0.0.1", "localhost"].includes(new URL(origin).hostname));
  const browser = await chromium.launch({ channel: "msedge", headless: true });
  const page = await browser.newPage({ viewport: { width: 1080, height: 690 } });
  const failures = [];
  page.on("pageerror", (error) => failures.push(error.message));
  let departments = [{ id: "d1", code: "finance", name: "Финансы", scope: "central", assignedUsersCount: 1, memberIds: ["u1"] }];
  const employees = [{ id: "u1", username: "bakhtiyor", name: "Бахтиёр Самугов", role: "employee", status: "active", departmentId: "d1", jobTitle: "Специалист" }];
  await page.route("**/api/v1/**", async (route) => {
    const request = route.request(), endpoint = new URL(request.url()).pathname;
    let data;
    if (endpoint === "/api/v1/directory" && request.method() === "GET") {
      data = { departments, employees, positions: [], roles: [], modules: [], accessRules: [] };
    } else if (endpoint === "/api/v1/recognition/settings") {
      data = { activeTaskCountVisible: true };
    } else if (endpoint === "/api/v1/directory/departments" && request.method() === "POST") {
      data = { id: "d2", ...request.postDataJSON(), assignedUsersCount: 0, memberIds: [] };
      departments = [...departments, data];
    } else if (endpoint === "/api/v1/directory/departments/d2/members" && request.method() !== "GET") {
      data = { ...departments[1], assignedUsersCount: 1, memberIds: ["u1"] };
      departments = [departments[0], data];
    } else {
      failures.push(`Unexpected API: ${request.method()} ${endpoint}`);
      return route.fulfill({ status: 404, json: {} });
    }
    return route.fulfill({ json: data });
  });
  try {
    await page.goto(origin + "/qa/department-focus.html");
    await page.locator(".employee-record-manage").first().click();
    await page.getByRole("button", { name: "Закрыть карточку сотрудника" }).click();
    await page.getByRole("button", { name: "Отделы и подразделения" }).click();
    await page.getByRole("button", { name: "Новое подразделение" }).click();
    await page.getByRole("textbox", { name: "Название нового отдела" }).fill("IT & AI");
    await page.getByRole("textbox", { name: "Код нового отдела" }).fill("it-ai");
    await page.getByRole("button", { name: "Создать", exact: true }).click();
    await page.getByText("Подразделение создано. Служебная группа готова.").waitFor();
    await page.mouse.click(2, 2);
    const input = page.getByRole("textbox", { name: "Поиск сотрудников для отдела" });
    await input.click();
    await input.type("Бах", { delay: 120 });
    const state = await input.evaluate((element) => ({ focused: document.activeElement === element, value: element.value }));
    await page.waitForTimeout(1500);
    const later = await input.evaluate((element) => ({ focused: document.activeElement === element, value: element.value }));
    const toastPresent = await page.getByText("Подразделение создано. Служебная группа готова.").isVisible();
    await page.getByRole("checkbox", { name: "Добавить Бахтиёр Самугов" }).check();
    await page.getByRole("button", { name: "Сохранить состав" }).click();
    await page.getByText("Состав отдела и служебной группы обновлён.").waitFor();
    await input.fill("Бах");
    const afterSave = await input.evaluate((element) => ({ focused: document.activeElement === element, value: element.value }));
    await page.getByText("Состав отдела и служебной группы обновлён.").waitFor({ state: "hidden", timeout: 6000 });
    const afterSaveLater = await input.evaluate((element) => ({ focused: document.activeElement === element, value: element.value }));
    console.log(JSON.stringify({ state, later, toastPresent, afterSave, afterSaveLater, failures }));
    assert.deepEqual(failures, []);
    assert.equal(later.focused, true, "Search input must retain focus after department creation");
    assert.equal(later.value, "Бах");
    assert.equal(afterSaveLater.focused, true, "Search input must retain focus after member save");
  } finally { await browser.close(); }
}
main().catch((error) => { console.error(error); process.exitCode = 1; });
