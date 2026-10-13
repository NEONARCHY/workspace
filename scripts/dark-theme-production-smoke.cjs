// Built web entry point, including its pre-paint script and unchanged CSP.
// Isolated loopback server, empty synthetic session, no real API access.
const {chromium}=require('playwright');
const fs=require('node:fs'),path=require('node:path'),http=require('node:http'),assert=require('node:assert/strict');
const root=path.resolve('apps/desktop/dist-web'),output=path.resolve('tmp/dark-theme/production');fs.mkdirSync(output,{recursive:true});
const types={'.html':'text/html','.js':'application/javascript','.css':'text/css','.json':'application/json','.woff2':'font/woff2','.png':'image/png'};
(async()=>{
  const server=http.createServer((req,res)=>{
    const file=path.resolve(root,'.'+decodeURIComponent(new URL(req.url,'http://localhost').pathname==='/'?'/index.html':new URL(req.url,'http://localhost').pathname));
    if(!file.startsWith(root+path.sep)||!fs.existsSync(file)||!fs.statSync(file).isFile()){res.writeHead(404);res.end();return;}
    res.writeHead(200,{'Content-Type':types[path.extname(file)]||'application/octet-stream'});res.end(fs.readFileSync(file));
  });
  await new Promise(resolve=>server.listen(0,'127.0.0.1',resolve));
  const origin='http://127.0.0.1:'+server.address().port;
  const browser=await chromium.launch({channel:'msedge',headless:true});
  try{
    for(const preference of ['dark','light','system','invalid']){
      const context=await browser.newContext({viewport:{width:1440,height:900},colorScheme:'dark',reducedMotion:'reduce'});
      await context.addInitScript(preference=>localStorage.setItem('yuksalish:color-theme:last',preference),preference);
      await context.route('**/api/**',route=>route.fulfill({status:503,contentType:'application/json',body:JSON.stringify({detail:'QA: unavailable'})}));
      let release;const gate=new Promise(resolve=>{release=resolve;});
      await context.route('**/assets/index-*.js',async route=>{await gate;await route.continue();});
      const page=await context.newPage(),errors=[];page.on('pageerror',error=>errors.push(error.message));
      await page.goto(origin,{waitUntil:'commit'});
      const expected=preference==='dark'||preference==='system'?'dark':'light';
      await page.waitForFunction(expected=>document.documentElement.dataset.colorTheme===expected,expected);
      assert.equal(await page.locator('.auth-screen').count(),0,'bootstrap must run before the React bundle');
      if(expected==='dark')assert.equal(await page.evaluate(()=>getComputedStyle(document.documentElement).backgroundColor),'rgb(11, 23, 36)');
      release();await page.locator('.auth-screen').waitFor();await page.waitForTimeout(300);
      assert.equal(await page.evaluate(()=>document.documentElement.dataset.colorTheme),expected);
      await page.screenshot({path:path.join(output,preference+'.png')});
      assert.deepEqual(errors,[]);console.log('Built web pre-paint/CSP/login:',preference,'=>',expected);await context.close();
    }
  }finally{await browser.close();await new Promise(resolve=>server.close(resolve));}
})().catch(error=>{console.error(error);process.exitCode=1;});
