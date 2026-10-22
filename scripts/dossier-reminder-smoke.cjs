// Synthetic dev lab only. Its fetch adapter never contacts a live API.
const { chromium } = require(process.env.PLAYWRIGHT_MODULE || "playwright");
const fs = require("node:fs/promises");
const path = require("node:path");
const assert = require("node:assert/strict");

async function main() {
  const output = path.resolve("tmp/dossier-reminder-smoke");
  await fs.mkdir(output, {recursive:true});
  const browser = await chromium.launch({channel:"msedge",headless:true});
  const page = await browser.newPage();
  const errors = [], checks = [];
  page.on("pageerror", error => errors.push(error.message));
  const prompt = page.getByRole("dialog", {name:"Ежемесячная проверка объективки",exact:true});
  try {
    for(const [width,height,theme] of [[1440,1000,"light"],[1024,768,"light"],[640,480,"light"],[390,844,"light"],[1440,1000,"dark"]]) {
      await page.setViewportSize({width,height});
      await page.goto(`http://127.0.0.1:5179/qa/dossier-reminder/index.html?theme=${theme}`);
      await prompt.waitFor();
      await prompt.evaluate(async el => { await document.fonts.ready; await Promise.all(el.getAnimations({subtree:true}).map(a=>a.finished.catch(()=>undefined))); });
      const box = await prompt.boundingBox();
      assert(box.x>=0 && box.y>=0 && box.x+box.width<=width+1 && box.y+box.height<=height+1,"bounded modal");
      const footer=await prompt.locator(".fui-DialogActions").boundingBox();
      assert(footer.y+footer.height<=height+1,"reachable actions");
      await page.keyboard.press("Tab");
      assert(await prompt.evaluate(el=>el.contains(document.activeElement)),"trapped focus");
      await page.screenshot({path:path.join(output,`prompt-${width}-${theme}.png`)});
      await page.addScriptTag({path:require.resolve("axe-core/axe.min.js")});
      const axe=await page.evaluate(async()=>await axe.run(document.querySelector('[role="dialog"]'),{runOnly:{type:"tag",values:["wcag2a","wcag2aa","wcag21aa","wcag22aa"]}}));
      assert.deepEqual(axe.violations.map(v=>({id:v.id,impact:v.impact})),[],"axe accessibility");
      await page.keyboard.press("Escape");
      await prompt.waitFor({state:"hidden"});
      checks.push(`${width}x${height} ${theme}: bounds, footer, keyboard, Escape, axe`);
    }
    await page.getByRole("button",{name:"Начать пример заново",exact:true}).click();
    await prompt.getByRole("button",{name:"Изменений нет",exact:true}).click();
    await prompt.waitFor({state:"hidden"});
    await page.evaluate(()=>window.dispatchEvent(new Event("focus")));
    assert.equal(await prompt.count(),0,"no repeat after answered check-in");
    await page.getByRole("button",{name:"Пример с ошибкой ответа",exact:true}).click();
    await prompt.getByRole("button",{name:"Изменений нет",exact:true}).click();
    await prompt.getByRole("alert").waitFor();
    await page.screenshot({path:path.join(output,"answer-error.png")});
    await prompt.getByRole("button",{name:"Изменений нет",exact:true}).click();
    await prompt.waitFor({state:"hidden"});
    await page.getByRole("button",{name:"Начать пример заново",exact:true}).click();
    await prompt.getByRole("button",{name:"Обновить объективку",exact:true}).click();
    const editor=page.getByRole("dialog",{name:"Объективка сотрудника",exact:true});
    await editor.getByLabel("Место рождения",{exact:true}).fill("Тестовый город");
    await editor.getByRole("button",{name:"Сохранить черновик",exact:true}).click();
    await editor.getByText("Объективка сохранена. Версия 1.",{exact:true}).waitFor();
    await editor.getByRole("button",{name:"Закрыть объективку",exact:true}).click();
    await editor.waitFor({state:"hidden"});
    await page.getByRole("button",{name:"Продолжить проверку",exact:true}).click();
    await prompt.getByRole("button",{name:"Обновить объективку",exact:true}).click();
    await editor.getByRole("button",{name:"Сохранить объективку",exact:true}).click();
    await editor.getByText("Объективка сохранена. Версия 2.",{exact:true}).waitFor();
    await editor.getByRole("button",{name:"Закрыть объективку",exact:true}).click();
    await editor.waitFor({state:"hidden"});
    assert.equal(await page.getByRole("button",{name:"Продолжить проверку",exact:true}).count(),0,"saved dossier completes month");
    checks.push("no-changes, retry after error, own editor, draft stays pending, final save completes month");
    assert.deepEqual(errors,[],"browser errors");
    await fs.writeFile(path.join(output,"report.json"),JSON.stringify({checks,errors},null,2));
    process.stdout.write(JSON.stringify({checks,errors},null,2)+"\n");
  } finally { await browser.close(); }
}
main().catch(error=>{process.stderr.write(String(error.stack||error)+"\n");process.exitCode=1;});
