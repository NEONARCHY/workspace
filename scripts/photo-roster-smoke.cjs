// Synthetic HR lab only. Every API request is intercepted; no employee data is read or changed.
const { chromium } = require(process.env.PLAYWRIGHT_MODULE || "playwright");
const fs = require("node:fs/promises");
const path = require("node:path");
const assert = require("node:assert/strict");

async function main() {
  const output = path.resolve("tmp/photo-roster-smoke");
  await fs.mkdir(output, {recursive:true});
  const browser = await chromium.launch({channel:"msedge",headless:true});
  const page = await browser.newPage();
  const errors = [], checks = [], requests = [];
  const cards = Array.from({length:42}, (_,index) => ({userId:`qa-${index}`, fullName:`Тестовый Сотрудник ${index + 1}`, jobTitle:index===41?"Особая должность":"Сунъий интеллект ва рақамлаштириш бўлими бош мутахассиси", departmentId:null, birthYear:index===2?null:1990,universities:index===2?[]:["Тестовый университет международных отношений"]}));
  let failNext = false;
  page.on("pageerror",error=>errors.push(error.message));
  await page.route("**/api/v1/**",async route=>{
    const url = new URL(route.request().url());
    let data;
    if(url.pathname==="/api/v1/hr") data={calculatedAt:"2026-10-22",settings:{hrUserId:"qa-0"},profiles:[],registers:[]};
    else if(url.pathname==="/api/v1/personnel-dossiers/context") data={canManageAccess:true,canViewPhotoRoster:true};
    else if(url.pathname==="/api/v1/personnel-dossiers/photos") data=cards;
    else if(url.pathname==="/api/v1/personnel-dossiers") data=[];
    else if(url.pathname.startsWith("/api/v1/personnel-dossiers/photos/export/")) {
      requests.push(route.request().postDataJSON());
      if(failNext){failNext=false;return route.fulfill({status:503,contentType:"application/json",body:JSON.stringify({detail:"Тестовая ошибка PDF"})});}
      const kind=url.pathname.split("/").at(-1);
      const extension={word:"docx",excel:"xlsx",pdf:"pdf"}[kind];
      const contentType={word:"application/vnd.openxmlformats-officedocument.wordprocessingml.document",excel:"application/vnd.openxmlformats-officedocument.spreadsheetml.sheet",pdf:"application/pdf"}[kind];
      return route.fulfill({status:200,contentType,body:await fs.readFile(`tmp/photo-roster-qa/photo-roster.${extension}`)});
    } else throw new Error(`Unexpected synthetic API route: ${url.pathname}`);
    await route.fulfill({status:200,contentType:"application/json",body:JSON.stringify(data)});
  });
  try {
    for(const [width,height,theme] of [[1440,1000,"light"],[1024,768,"light"],[640,480,"light"],[390,844,"light"],[1440,1000,"dark"]]) {
      await page.setViewportSize({width,height});
      await page.goto(`http://127.0.0.1:5179/qa/dossiers/index.html?theme=${theme}`);
      await page.getByRole("tab",{name:"Фотокарточки",exact:true}).click();
      const controls=page.getByRole("region",{name:"Скачивание фотокарточек",exact:true});
      await controls.getByRole("button",{name:"Скачать фотокарточки в Word",exact:true}).waitFor();
      await controls.evaluate(async element=>{await document.fonts.ready;await Promise.all(element.getAnimations({subtree:true}).map(animation=>animation.finished.catch(()=>undefined)));});
      await page.screenshot({path:path.join(output,`photos-${width}-${theme}.png`)});
      assert(await page.evaluate(()=>document.documentElement.scrollWidth<=innerWidth),"no whole-page overflow");
      for(const label of ["Word","Excel","PDF"]){const box=await controls.getByRole("button",{name:`Скачать фотокарточки в ${label}`,exact:true}).boundingBox();assert(box.x>=0&&box.x+box.width<=width+1&&box.height>=32,JSON.stringify({width,height,theme,label,box,layout:await page.evaluate(()=>[...document.querySelectorAll('.hr-view,.hr-tabs,.dossiers-workspace,.photo-roster-exports,.record-table-frame')].map(el=>({class:el.className,client:el.clientWidth,scroll:el.scrollWidth,left:el.scrollLeft,wrap:getComputedStyle(el).flexWrap,width:getComputedStyle(el).width}))) }));}
      await page.addScriptTag({path:require.resolve("axe-core/axe.min.js")});
      const scan=await page.evaluate(async()=>await axe.run(document.querySelector('.dossiers-workspace[aria-label="Фотокарточки сотрудников"]'),{runOnly:{type:"tag",values:["wcag2a","wcag2aa","wcag21aa","wcag22aa"]}}));
      assert.equal(scan.violations.length,0,JSON.stringify(scan.violations.map(v=>({id:v.id,nodes:v.nodes.map(n=>n.target)}))));
      await page.screenshot({path:path.join(output,`photos-${width}-${theme}.png`)});
      checks.push(`${width}x${height} ${theme}: layout and axe`);
    }
    await page.setViewportSize({width:1024,height:768});
    for(const [label,extension] of [["Word","docx"],["Excel","xlsx"],["PDF","pdf"]]) {
      const event=page.waitForEvent("download");
      await page.getByRole("button",{name:`Скачать фотокарточки в ${label}`,exact:true}).click();
      const download=await event;
      assert.equal(download.suggestedFilename(),`Фотокарточки сотрудников.${extension}`);
      await download.saveAs(path.join(output,`download.${extension}`));
      assert.equal(requests.at(-1).userIds.length,42,"all pages are included");
    }
    await page.getByRole("searchbox").fill("Особая должность");
    failNext=true;
    await page.getByRole("button",{name:"Скачать фотокарточки в PDF",exact:true}).click();
    await page.getByRole("alert").filter({hasText:"Тестовая ошибка PDF"}).waitFor();
    await page.screenshot({path:path.join(output,"retry.png")});
    const retry=page.waitForEvent("download");
    await page.getByRole("button",{name:"Скачать фотокарточки в Word",exact:true}).click();
    await retry;
    assert.deepEqual(requests.at(-1).userIds,["qa-41"]);
    await page.getByRole("searchbox").fill("Никого не найдено");
    assert(await page.getByRole("button",{name:"Скачать фотокарточки в Word",exact:true}).isDisabled());
    assert.deepEqual(errors,[]);
    checks.push("three real fixture downloads; all pages; filtered selection; error/retry; empty state");
    await fs.writeFile(path.join(output,"report.json"),JSON.stringify({checks,errors},null,2));
    console.log(JSON.stringify({checks,errors},null,2));
  } finally {await browser.close();}
}
main().catch(error=>{console.error(error);process.exitCode=1;});
