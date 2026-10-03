// Read-only WebGL regression in an authenticated TEST browser (CDP port 9224).
// Usage: node scripts/orb-hover-smoke.cjs
const assert = require('node:assert/strict');
const fs = require('node:fs/promises');
const path = require('node:path');
const origin = 'https://192.168.31.176:8443';
const pause = ms => new Promise(resolve => setTimeout(resolve, ms));
const output = path.resolve('tmp/orb-hover-restored');

async function main() {
  const pages = await (await fetch('http://127.0.0.1:9224/json')).json();
  const page = pages.find(p => p.type === 'page' && p.url.startsWith(origin));
  assert(page, 'Open the authenticated TEST site in the QA browser on port 9224.');
  const ws = new WebSocket(page.webSocketDebuggerUrl);
  await new Promise((resolve, reject) => { ws.onopen = resolve; ws.onerror = reject; });
  const pending = new Map(), errors = [], results = [];
  let id = 0, script;
  const send = (method, params = {}) => new Promise((resolve, reject) => {
    const key = ++id;
    const timer = setTimeout(() => { pending.delete(key); reject(Error('CDP timeout: '+method)); }, 10000);
    pending.set(key, {resolve,reject,timer}); ws.send(JSON.stringify({id:key,method,params}));
  });
  ws.onmessage = async event => {
    const message = JSON.parse(event.data), request = pending.get(message.id);
    if (request) {
      pending.delete(message.id); clearTimeout(request.timer);
      message.error ? request.reject(Error(message.error.message)) : request.resolve(message.result);
    }
    if (message.method === 'Runtime.exceptionThrown') errors.push(message.params.exceptionDetails.text);
    if (message.method === 'Fetch.requestPaused') {
      const request = message.params;
      try {
        if (request.request.method === 'GET' || new URL(request.request.url).pathname === '/api/v1/auth/web/refresh') {
          await send('Fetch.continueRequest', {requestId:request.requestId});
        } else {
          await send('Fetch.fulfillRequest', {requestId:request.requestId,responseCode:403,
            body:Buffer.from('{"detail":"Visual QA is read-only"}').toString('base64')});
        }
      } catch (error) { errors.push(error.message); }
    }
  };
  const evaluate = async expression => {
    const result = await send('Runtime.evaluate', {expression,returnByValue:true,awaitPromise:true});
    assert(!result.exceptionDetails, result.exceptionDetails?.text); return result.result.value;
  };
  const original = await evaluate('({width:innerWidth,height:innerHeight,deviceScaleFactor:devicePixelRatio})');
  const state = () => evaluate(`(() => {
    const button=document.querySelector('.assistant-launcher'), rect=button.getBoundingClientRect();
    return {...window.__orbQA,rect:{x:rect.x,y:rect.y,width:rect.width,height:rect.height},
      transform:getComputedStyle(button).transform,canvas:!!button.querySelector('canvas'),
      fallback:!!button.querySelector('.gradient-orb-fallback')};
  })()`);
  const screenshot = async (name, rect) => {
    const clip = {x:Math.max(0,rect.x-16),y:Math.max(0,rect.y-8),width:rect.width+32,height:rect.height+24,scale:1};
    const result = await send('Page.captureScreenshot', {format:'png',clip});
    await fs.writeFile(path.join(output,name+'.png'),Buffer.from(result.data,'base64'));
  };
  try {
    await fs.mkdir(output,{recursive:true}); await send('Page.enable'); await send('Page.bringToFront'); await send('Runtime.enable');
    await send('Fetch.enable',{patterns:[{urlPattern:origin+'/api/v1/*',requestStage:'Request'}]});
    // Observe real GPU uniforms and shader source; do not replace their values.
    script = (await send('Page.addScriptToEvaluateOnNewDocument',{source:`(() => {
      window.__orbQA={hover:0,rot:0,hasWaves:false,hasRotation:false,frames:0};
      const names=new WeakMap();
      for(const Type of [window.WebGLRenderingContext,window.WebGL2RenderingContext]) {
        if(!Type)continue;
        const proto=Type.prototype, locate=proto.getUniformLocation, uniform=proto.uniform1f, shader=proto.shaderSource;
        proto.getUniformLocation=function(program,name){const location=locate.call(this,program,name);if(location)names.set(location,name);return location;};
        proto.uniform1f=function(location,value){
          if(this.canvas.closest('.assistant-launcher')) {
            const name=names.get(location);
            if(name==='hover'||name==='rot')window.__orbQA[name]=value;
            if(name==='iTime')window.__orbQA.frames++;
          }
          return uniform.call(this,location,value);
        };
        proto.shaderSource=function(handle,source){
          if(source.includes('vec4 mainImage')) {
            window.__orbQA.hasWaves=source.includes('uv.x += hover * hoverIntensity')&&source.includes('uv.y += hover * hoverIntensity');
            window.__orbQA.hasRotation=source.includes('uv = vec2(c * uv.x - s * uv.y, s * uv.x + c * uv.y)');
          }
          return shader.call(this,handle,source);
        };
      }
    })();`})).identifier;
    await send('Page.reload',{ignoreCache:true}); await pause(1500);
    for(let i=0;i<30&&!await evaluate("!!document.querySelector('.assistant-launcher canvas')");i++)await pause(200);
    for(const [width,height] of [[1440,900],[1024,768],[620,900]]) {
      await send('Emulation.setDeviceMetricsOverride',{width,height,deviceScaleFactor:1,mobile:false});
      await send('Input.dispatchMouseEvent',{type:'mouseMoved',x:1,y:1}); await pause(1000);
      const before=await state(); assert(before.canvas&&before.hasWaves&&before.hasRotation&&before.frames>0,'Missing restored GPU shader: '+JSON.stringify(before));
      assert(before.hover<.01); await screenshot(width+'-rest',before.rect);
      await send('Input.dispatchMouseEvent',{type:'mouseMoved',x:before.rect.x+before.rect.width/2,y:before.rect.y+before.rect.height/2});
      await pause(80); const entering=await state(); assert(entering.hover>0&&entering.hover<.99,'Hover must ease in');
      await pause(800); const on=await state(); assert(on.hover>.95&&on.rot>before.rot+.05,'Missing hover rotation');
      assert.deepEqual(on.rect,before.rect,'Launcher moved or changed size'); assert.equal(on.transform,'none');
      await screenshot(width+'-hover',on.rect);
      await send('Input.dispatchMouseEvent',{type:'mouseMoved',x:1,y:1}); await pause(80);
      const leaving=await state(); assert(leaving.hover>0&&leaving.hover<on.hover,'Hover must ease out');
      await pause(1000); const off=await state(); assert(off.hover<.01);
      await pause(300); const settled=await state(); assert(Math.abs(settled.rot-off.rot)<.005,'Rotation must settle after leaving');
      assert.deepEqual(settled.rect,before.rect); await screenshot(width+'-released',settled.rect);
      results.push({width,before,entering,on,leaving,settled});
      console.log('PASS',width,'real GPU waves/rotation; smooth enter/exit; no size or position change');
    }
    await evaluate("document.querySelector('.assistant-launcher').focus()"); await pause(700);
    const focused=await state(); assert(focused.hover>.9,'Keyboard focus must activate hover');
    await evaluate('document.activeElement.blur()'); await pause(900);
    assert((await state()).hover<.01); console.log('PASS keyboard focus/blur');
    for(const feature of ['prefers-reduced-motion','forced-colors']) {
      await send('Emulation.setEmulatedMedia',{features:[{name:feature,value:feature==='forced-colors'?'active':'reduce'}]});
      await pause(300); const fallback=await state(); assert(fallback.fallback&&!fallback.canvas,'Missing static accessibility fallback');
      console.log('PASS',feature,'static ring');
    }
    assert.deepEqual(errors,[]); await fs.writeFile(path.join(output,'browser-report.json'),JSON.stringify(results,null,2));
  } finally {
    if(script)await send('Page.removeScriptToEvaluateOnNewDocument',{identifier:script});
    await send('Fetch.disable'); await send('Emulation.setEmulatedMedia',{features:[]});
    await send('Emulation.setDeviceMetricsOverride',{...original,mobile:false});
    await send('Page.reload',{ignoreCache:true}); await pause(300); ws.close();
  }
}
main().catch(error=>{console.error(error.message);process.exitCode=1;});
