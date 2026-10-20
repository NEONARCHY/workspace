// Local Vite QA only; every API request is intercepted before reaching a server.
const { chromium } = require(process.env.PLAYWRIGHT_MODULE || "playwright");
const fs = require("node:fs/promises");
const path = require("node:path");
const assert = require("node:assert/strict");

async function main() {
  const output = path.resolve("tmp/grants-smoke-output");
  await fs.mkdir(output, { recursive: true });
  const browser = await chromium.launch({ channel: "msedge", headless: true });
  const page = await browser.newPage();
  const errors = [];
  const checks = [];
  const creationAttempts = [];
  page.on("pageerror", (error) => errors.push(error.message));
  const grant = {
    id: "synthetic-grant", title: "Подготовка грантовой заявки: развитие местных инициатив",
    description: "Подготовить описание проекта, рабочий план и бюджет. Проверить комплектность документов для подачи на конкурс.",
    authorUserId: "actor-0", assigneeId: "actor-1", coAssigneeIds: ["actor-2"],
    leaderUserId: "actor-3", chairUserId: "actor-4", dueAt: "2099-11-01T12:00:00Z",
    status: "author_review", revision: 4, resultText: "Подготовлены проектная заявка, календарный план и бюджет. Материалы переданы для проверки.",
    checklist: [{id:"item-1",title:"Подготовить описание проекта",completed:true,completedByUserId:"actor-1",completedAt:"2026-10-20T12:00:00Z"},
      {id:"item-2",title:"Проверить бюджет и комплектность",completed:true,completedByUserId:"actor-2",completedAt:"2026-10-20T12:00:00Z"}],
    chatId: "synthetic-chat", createdAt: "2026-10-20T10:00:00Z",updatedAt:"2026-10-20T12:00:00Z",
    allowedActions:["approve","return","comment"], attachments:[],
    events:[{id:"event-1",actorUserId:"actor-1",action:"submit",text:"Материалы подготовлены",fromStatus:"in_progress",toStatus:"author_review",createdAt:"2026-10-20T12:00:00Z"}],
  };
  await page.route("**/api/v1/**", async (route) => {
    const url = new URL(route.request().url());
    let data;
    if (url.pathname === "/api/v1/grants" && route.request().method() === "POST") {
      creationAttempts.push(route.request().postDataJSON());
      return route.fulfill({status:503,headers:{"Content-Type":"application/json","Access-Control-Allow-Origin":"*"},body:JSON.stringify({detail:"Synthetic retry test"})});
    }
    if (url.pathname === "/api/v1/grants/settings") data = {leaderUserId:"actor-3",chairUserId:"actor-4",revision:1};
    else if (url.pathname === "/api/v1/grants") data = [grant];
    else if (url.pathname === "/api/v1/grants/synthetic-grant") data = grant;
    else return route.fulfill({status:403,contentType:"application/json",body:JSON.stringify({detail:"Synthetic test route only"})});
    return route.fulfill({status:200,headers:{"Content-Type":"application/json","Access-Control-Allow-Origin":"*"},body:JSON.stringify(data)});
  });
  try {
    for (const [width,height,theme] of [[1440,1000,"light"],[1024,768,"light"],[640,480,"light"],[1440,1000,"dark"]]) {
      await page.setViewportSize({width,height});
      await page.goto(`http://127.0.0.1:5179/qa/grants/index.html?theme=${theme}`);
      await page.getByRole("button",{name:grant.title}).click();
      const dialog = page.getByRole("dialog",{name:grant.title});
      await dialog.waitFor();
      await page.evaluate(async()=>{await document.fonts.ready; await new Promise(r=>requestAnimationFrame(()=>requestAnimationFrame(r)));});
      await dialog.evaluate(async(el)=>{await Promise.all(el.getAnimations({subtree:true}).map(animation=>animation.finished.catch(()=>undefined)));});
      const bounds = await dialog.boundingBox();
      assert(bounds.x >= 0 && bounds.y >=0 && bounds.x+bounds.width <= width+1 && bounds.y+bounds.height <= height+1,"dialog contained");
      const footer = await dialog.locator(".grants-dialog-footer").boundingBox();
      assert(footer.y+footer.height <= height+1,"review footer reachable");
      const scroll = await dialog.locator(".grants-dialog-body").evaluate(el=>({client:el.clientHeight,scroll:el.scrollHeight}));
      assert(scroll.client>80,"content has usable scroll viewport");
      await page.screenshot({path:path.join(output,`detail-${width}-${theme}.png`)});
      await page.addScriptTag({path:require.resolve("axe-core/axe.min.js")});
      const axe = await page.evaluate(async()=>await axe.run(document.querySelector('[role="dialog"]'),{runOnly:{type:"tag",values:["wcag2a","wcag2aa","wcag21aa","wcag22aa"]}}));
      assert.equal(axe.violations.length,0,JSON.stringify(axe.violations.map(v=>({id:v.id,nodes:v.nodes.map(n=>n.target)}))));
      await page.keyboard.press("Tab");
      assert(await dialog.evaluate(el=>el.contains(document.activeElement)),"focus stays in dialog");
      await page.keyboard.press("Escape");
      await dialog.waitFor({state:"hidden"});
      checks.push(`${width}x${height} ${theme}: bounds, footer, scroll, keyboard, axe`);
    }
    await page.setViewportSize({width:1440,height:1000});
    await page.goto("http://127.0.0.1:5179/qa/grants/index.html");
    await page.getByRole("button",{name:grant.title}).waitFor();
    await page.screenshot({path:path.join(output,"list-light.png")});
    await page.getByRole("button",{name:"Новая заявка",exact:true}).click();
    const form=page.getByRole("dialog",{name:"Новая заявка на грант"});
    await form.waitFor();
    await page.screenshot({path:path.join(output,"create-light.png")});
    await form.getByLabel("Название гранта *",{exact:true}).fill("Синтетическая заявка для проверки повтора");
    await form.getByRole("combobox",{name:/Ответственный/}).selectOption("actor-1");
    await form.getByLabel(/Срок/).fill("2099-11-01T09:00");
    await form.getByRole("button",{name:"Сохранить заявку",exact:true}).click();
    await form.getByRole("alert").filter({hasText:"Synthetic retry test"}).waitFor();
    assert.equal(await form.getByLabel("Название гранта *",{exact:true}).inputValue(),"Синтетическая заявка для проверки повтора");
    await form.getByRole("button",{name:"Сохранить заявку",exact:true}).click();
    await page.waitForFunction(()=>!document.querySelector('.grants-editor button[type="submit"]').disabled);
    assert.equal(creationAttempts.length,2);
    assert.equal(creationAttempts[0].requestId,creationAttempts[1].requestId);
    await form.getByRole("button",{name:"Отмена",exact:true}).click();
    await form.waitFor({state:"hidden"});
    checks.push("real browser: failed creation preserves input, retries the same request, and cancels without another request");
    assert.equal(errors.length,0,errors.join("\n"));
    await fs.writeFile(path.join(output,"report.json"),JSON.stringify({checks,errors},null,2));
    console.log(JSON.stringify({checks,errors,output}));
  } catch (error) {
    await page.screenshot({path:path.join(output,"failure.png")});
    console.log((await page.locator("body").innerText()).slice(0,2000), errors);
    throw error;
  } finally {await browser.close();}
}
main().catch(error=>{console.error(error);process.exitCode=1;});
