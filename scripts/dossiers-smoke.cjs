// No authentication and no live data: all API requests are intercepted before any server.
const { chromium } = require(process.env.PLAYWRIGHT_MODULE || "playwright");
const fs = require("node:fs/promises");
const path = require("node:path");
const assert = require("node:assert/strict");

async function main() {
  const output = path.resolve("tmp/dossiers-smoke-output");
  await fs.mkdir(output, {recursive:true});
  const browser = await chromium.launch({channel:"msedge",headless:true});
  const page = await browser.newPage();
  const errors = [], checks = [], saves = [];
  page.on("pageerror", error => errors.push(error.message));
  const detail = {userId:"qa-1", fullName:"Тестовый Сотрудник Полное ФИО",jobTitle:"Mutaxassis",revision:1,status:"draft",updatedAt:null,permissions:{canView:true,canEdit:true},fields:{birthDate:"1991-05-12",birthPlace:"Тестовый город",education:[{institution:"Тестовый университет",graduationYear:2013,specialty:"Тестовая специальность",qualification:"Бакалавр"}],employment:[{organization:"Тестовая организация",position:"Специалист",startDate:"2020-01-01",endDate:null}],languages:"Узбекский, русский",academicDegree:"",awards:"",additionalInfo:"Синтетические сведения только для проверки интерфейса."}};
  Object.assign(detail.fields, {appointmentDate:null,nationality:"",partyMembership:"",educationLevel:"",academicTitle:"",militaryRank:"",electedMembership:"",relatives:[]});
  detail.fields.education[0].startYear=2008;
  detail.fields.employment[0].period="";
  let exports=0, pdfExports=0, importFailure=false;
  const importPreview={sourceFullName:"Тестовое ФИО в Word",sourceJobTitle:"Должность из документа",fields:{...detail.fields,birthPlace:"Город из Word",languages:"Языки из Word"},detectedFields:["birthPlace","languages"],warnings:["Тестовое предупреждение: проверьте документ"],unrecognizedText:"Дополнительный текст для ручной проверки"};
  const upload={name:"synthetic-objective.docx",mimeType:"application/vnd.openxmlformats-officedocument.wordprocessingml.document",buffer:await fs.readFile("apps/api/src/yuksalish_api/hr_assets/dossier-template.docx")};
  await page.route("**/api/v1/**", async route => {
    const url = new URL(route.request().url());
    let data;
    if (url.pathname === "/api/v1/hr") data = {calculatedAt:"2026-10-22",settings:{hrUserId:"qa-0"},profiles:[],registers:[]};
    else if (url.pathname === "/api/v1/personnel-dossiers/context") data = {canManageAccess:true,canViewPhotoRoster:true};
    else if (url.pathname === "/api/v1/personnel-dossiers") data = [{userId:detail.userId,fullName:detail.fullName,jobTitle:detail.jobTitle,departmentId:null,status:"draft",updatedAt:null}];
    else if (url.pathname === "/api/v1/personnel-dossiers/photos") data = [{userId:detail.userId,fullName:detail.fullName,jobTitle:detail.jobTitle,departmentId:null,birthYear:1991,universities:["Тестовый университет"]}];
    else if (url.pathname === "/api/v1/personnel-dossiers/access") data = {revision:0,rules:[]};
    else if (url.pathname.endsWith("/history")) data = [];
    else if (url.pathname.endsWith("/import-preview")) {
      if(importFailure){importFailure=false;return route.fulfill({status:503,contentType:"application/json",body:JSON.stringify({detail:"Тестовая ошибка импорта"})});}
      data=importPreview;
    }
    else if (url.pathname.endsWith("/pdf")) {
      pdfExports++;
      if(pdfExports===1)return route.fulfill({status:503,contentType:"application/json",body:JSON.stringify({detail:"Тестовая ошибка PDF"})});
      return route.fulfill({status:200,contentType:"application/pdf",body:Buffer.from("%PDF-1.7\n% Synthetic download UI fixture, not a layout test")});
    }
    else if (url.pathname.endsWith("/word")) {
      exports++;
      if(exports===1) return route.fulfill({status:503,contentType:"application/json",body:JSON.stringify({detail:"Тестовая ошибка скачивания"})});
      return route.fulfill({status:200,contentType:"application/vnd.openxmlformats-officedocument.wordprocessingml.document",headers:{"Content-Disposition":'attachment; filename="test-dossier.docx"'},body:await fs.readFile("apps/api/src/yuksalish_api/hr_assets/dossier-template.docx")});
    }
    else if (url.pathname === "/api/v1/personnel-dossiers/qa-1" && route.request().method() === "PUT") {
      saves.push(route.request().postDataJSON());
      if (saves.length === 1) return route.fulfill({status:503,contentType:"application/json",body:JSON.stringify({detail:"Тестовая ошибка сохранения"})});
      data = {...detail,fields:saves.at(-1).fields,revision:2,status:"saved"};
    } else if (url.pathname === "/api/v1/personnel-dossiers/qa-1") data = detail;
    else return route.fulfill({status:403,contentType:"application/json",body:JSON.stringify({detail:"Synthetic QA route only"})});
    return route.fulfill({status:200,contentType:"application/json",body:JSON.stringify(data)});
  });
  const contained = async (dialog, width, height) => {
    const box = await dialog.boundingBox();
    assert(box.x>=0 && box.y>=0 && box.x+box.width<=width+1 && box.y+box.height<=height+1,"dialog stays within viewport");
    const footer = await dialog.locator(".fui-DialogActions").boundingBox();
    assert(footer.y+footer.height<=height+1,"footer remains reachable");
    const scroll=await dialog.locator(".fui-DialogContent").evaluate(el=>({client:el.clientHeight,scroll:el.scrollHeight}));
    assert(scroll.client>60 && scroll.scroll>scroll.client,"questionnaire has internal scrolling");
    await page.keyboard.press("Tab");
    assert(await dialog.evaluate(el=>el.contains(document.activeElement)),"focus remains inside dialog");
  };
  try {
    for (const [width,height,theme] of [[1440,1000,"light"],[1024,768,"light"],[640,480,"light"],[1440,1000,"dark"]]) {
      await page.setViewportSize({width,height});
      await page.goto(`http://127.0.0.1:5179/qa/dossiers/index.html?theme=${theme}`);
      await page.getByRole("tab",{name:"Объективки",exact:true}).click();
      await page.getByRole("button",{name:`Объективка: ${detail.fullName}`}).click();
      const dialog=page.getByRole("dialog",{name:"Объективка сотрудника"});
      await dialog.getByLabel("Место рождения",{exact:true}).waitFor();
      await dialog.evaluate(async el=>{await document.fonts.ready;await Promise.all(el.getAnimations({subtree:true}).map(a=>a.finished.catch(()=>undefined)));});
      await contained(dialog,width,height);
      await page.screenshot({path:path.join(output,`dossier-${width}-${theme}.png`)});
      await dialog.getByLabel("Выбрать объективку Word",{exact:true}).setInputFiles(upload);
      await dialog.getByText("ФИО в документе: Тестовое ФИО в Word",{exact:true}).waitFor();
      assert(await dialog.getByRole("button",{name:"Перенести выбранные поля в форму",exact:true}).isDisabled(),"identity confirmation is required");
      await contained(dialog,width,height);
      await page.screenshot({path:path.join(output,`import-${width}-${theme}.png`)});
      await page.addScriptTag({path:require.resolve("axe-core/axe.min.js")});
      const axe=await page.evaluate(async()=>await axe.run(document.querySelector('[role="dialog"]'),{runOnly:{type:"tag",values:["wcag2a","wcag2aa","wcag21aa","wcag22aa"]}}));
      assert.equal(axe.violations.length,0,JSON.stringify(axe.violations.map(v=>({id:v.id,nodes:v.nodes.map(n=>n.target)}))));
      await dialog.getByRole("button",{name:"Отменить импорт",exact:true}).click();
      await page.keyboard.press("Escape"); await dialog.waitFor({state:"hidden"});
      await page.getByRole("tab",{name:"Фотокарточки",exact:true}).click();
      await page.getByRole("cell",{name:"Тестовый университет",exact:true}).waitFor();
      assert.equal(await page.getByRole("cell",{name:"1991",exact:true}).count(),1);
      assert(await page.evaluate(()=>document.documentElement.scrollWidth<=window.innerWidth),"roster does not overflow page");
      await page.screenshot({path:path.join(output,`photos-${width}-${theme}.png`)});
      checks.push(`${width}x${height} ${theme}: dossier, roster, footer, keyboard, axe`);
    }
    await page.setViewportSize({width:1024,height:768});
    await page.getByRole("tab",{name:"Объективки",exact:true}).click();
    await page.getByRole("button",{name:`Объективка: ${detail.fullName}`}).click();
    const dialog=page.getByRole("dialog",{name:"Объективка сотрудника"});
    await dialog.getByLabel("Место рождения",{exact:true}).fill("Новые тестовые сведения");
    await dialog.getByRole("button",{name:"Сохранить объективку",exact:true}).click();
    await dialog.getByRole("alert").filter({hasText:"Тестовая ошибка сохранения"}).waitFor();
    assert.equal(await dialog.getByLabel("Место рождения",{exact:true}).inputValue(),"Новые тестовые сведения");
    await dialog.getByRole("button",{name:"Сохранить объективку",exact:true}).click();
    await dialog.getByRole("status").filter({hasText:"Объективка сохранена"}).waitFor();
    assert.equal(saves.length,2);assert.deepEqual(saves[0],saves[1]);
    await dialog.getByRole("button",{name:"Скачать Word",exact:true}).click();
    await dialog.getByRole("alert").filter({hasText:"Тестовая ошибка скачивания"}).waitFor();
    const downloaded=page.waitForEvent("download");
    await dialog.getByRole("button",{name:"Скачать Word",exact:true}).click();
    assert((await downloaded).suggestedFilename().endsWith(".docx"));
    assert.equal(exports,2);
    await dialog.getByRole("button",{name:"Скачать PDF",exact:true}).click();
    await dialog.getByRole("alert").filter({hasText:"Тестовая ошибка PDF"}).waitFor();
    const pdfDownloaded=page.waitForEvent("download");
    await dialog.getByRole("button",{name:"Скачать PDF",exact:true}).click();
    assert((await pdfDownloaded).suggestedFilename().endsWith(".pdf"));
    importFailure=true;
    await dialog.getByLabel("Выбрать объективку Word",{exact:true}).setInputFiles(upload);
    await dialog.getByRole("alert").filter({hasText:"Тестовая ошибка импорта"}).waitFor();
    assert.equal(await dialog.getByLabel("Место рождения",{exact:true}).inputValue(),"Новые тестовые сведения");
    await dialog.getByLabel("Выбрать объективку Word",{exact:true}).setInputFiles(upload);
    await dialog.getByText("ФИО в документе: Тестовое ФИО в Word",{exact:true}).waitFor();
    await dialog.getByRole("checkbox",{name:"Перенести: Место рождения",exact:true}).uncheck();
    await dialog.getByRole("checkbox",{name:`Я проверил документ: сведения относятся к сотруднику ${detail.fullName}`,exact:true}).check();
    await dialog.getByRole("button",{name:"Перенести выбранные поля в форму",exact:true}).click();
    assert.equal(await dialog.getByLabel("Место рождения",{exact:true}).inputValue(),"Новые тестовые сведения");
    assert.equal(await dialog.getByLabel("Владение языками",{exact:true}).inputValue(),"Языки из Word");
    assert.equal(saves.length,2,"import never saves automatically");
    assert(await dialog.getByRole("button",{name:"Скачать PDF",exact:true}).isDisabled(),"unsaved import cannot be downloaded");
    await dialog.getByRole("button",{name:"Закрыть",exact:true}).click();
    await dialog.getByRole("button",{name:"Закрыть без сохранения",exact:true}).click();
    await page.getByRole("button",{name:"Настроить доступ",exact:true}).click();
    const access=page.getByRole("dialog",{name:"Доступ к объективкам"});
    await access.getByText("Дополнительный доступ не выдан.").waitFor();
    for (const [width,height] of [[1024,768],[640,480]]) {
      await page.setViewportSize({width,height}); await contained(access,width,height);
      await page.screenshot({path:path.join(output,`access-${width}.png`)});
    }
    checks.push("failed save, import and PDF retain state and retry; import is selective, identity-confirmed and never autosaves; access dialog stays bounded");
    assert.deepEqual(errors,[]); await fs.writeFile(path.join(output,"report.json"),JSON.stringify({checks,errors},null,2));
    console.log(JSON.stringify({checks,errors},null,2));
  } catch (error) { await page.screenshot({path:path.join(output,"failure.png")}); throw error; }
  finally {await browser.close();}
}
main().catch(error=>{console.error(error);process.exitCode=1;});
