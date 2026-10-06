// Authenticated TEST origin only; the post/comment and every deletion are mocked.
const assert=require('node:assert/strict'),fs=require('node:fs/promises'),path=require('node:path');
const origin='https://192.168.31.176:8443',before=process.argv.includes('--before');
const out=path.resolve('tmp/confirm-dialog-polish'),pause=ms=>new Promise(r=>setTimeout(r,ms));
async function main(){
  const page=(await(await fetch('http://127.0.0.1:9224/json')).json()).find(p=>p.type==='page'&&p.url.startsWith(origin));assert(page,'Open authenticated TEST browser');
  const ws=new WebSocket(page.webSocketDebuggerUrl);await new Promise((r,j)=>{ws.onopen=r;ws.onerror=j;});
  let id=0,fixture,heldDelete,deleteCount=0,longTitle=false;const pending=new Map(),errors=[],results=[];
  const send=(method,params={})=>new Promise((resolve,reject)=>{const key=++id,timer=setTimeout(()=>{pending.delete(key);reject(Error(method+' timeout'));},12000);pending.set(key,{resolve,reject,timer});ws.send(JSON.stringify({id:key,method,params}));});
  const fulfill=(requestId,body,status=200)=>send('Fetch.fulfillRequest',{requestId,responseCode:status,responseHeaders:[{name:'Content-Type',value:'application/json'}],body:Buffer.from(JSON.stringify(body)).toString('base64')});
  ws.onmessage=async e=>{
    const m=JSON.parse(e.data),entry=pending.get(m.id);if(entry){pending.delete(m.id);clearTimeout(entry.timer);m.error?entry.reject(Error(m.error.message)):entry.resolve(m.result);}
    if(m.method==='Runtime.exceptionThrown')errors.push(m.params.exceptionDetails.text);
    if(m.method!=='Fetch.requestPaused')return;const p=m.params,url=new URL(p.request.url);
    try{
      if(p.responseStatusCode&&url.pathname==='/api/v1/workspace/bootstrap'){
        const body=await send('Fetch.getResponseBody',{requestId:p.requestId}),data=JSON.parse(body.base64Encoded?Buffer.from(body.body,'base64').toString():body.body);
        fixture={id:'qa-confirm-post',authorUserId:data.currentUser.id,title:'Проверка подтверждения',body:'Временный пример интерфейса — не сохраняется.',isPinned:false,likedByCurrentUser:false,likeCount:0,reactions:[],canEdit:true,canDelete:true,canPin:true,createdAt:new Date().toISOString(),updatedAt:new Date().toISOString(),comments:[{id:'qa-confirm-comment',authorUserId:data.currentUser.id,body:'Пример комментария для проверки окна',reactions:[],canDelete:true,createdAt:new Date().toISOString()}]};
        if(longTitle)fixture.title='Согласование рабочего плана региональной команды и подготовка совместных мероприятий на следующий квартал — проверка длинного названия публикации';
        data.feedPosts=[fixture];await fulfill(p.requestId,data);
      }else if(p.request.method==='GET'||url.pathname==='/api/v1/auth/web/refresh')await send('Fetch.continueRequest',{requestId:p.requestId});
      else if(p.request.method==='DELETE'&&url.pathname==='/api/v1/feed/posts/qa-confirm-post/comments/qa-confirm-comment'){deleteCount++;heldDelete=p.requestId;}
      else await fulfill(p.requestId,{detail:'Read-only UI QA'},403);
    }catch(e){errors.push(e.message);await send('Fetch.failRequest',{requestId:p.requestId,errorReason:'BlockedByClient'}).catch(()=>{});}
  };
  const evaluate=async expression=>{const r=await send('Runtime.evaluate',{expression,returnByValue:true,awaitPromise:true});assert(!r.exceptionDetails,r.exceptionDetails?.text);return r.result.value;};
  const waitFor=async expression=>{for(let n=0;n<65;n++){if(await evaluate(expression))return;await pause(150);}throw Error('Missing UI: '+expression);};
  const key=async (key,code=key,modifiers=0)=>{await send('Input.dispatchKeyEvent',{type:'keyDown',key,code,modifiers});await send('Input.dispatchKeyEvent',{type:'keyUp',key,code,modifiers});await pause(120);};
  const open=async()=>{
    await evaluate("document.querySelector('.feed-comment-delete').scrollIntoView({block:'center'});document.querySelector('.feed-comment-delete').focus();document.querySelector('.feed-comment-delete').click()");
    await waitFor("!!document.querySelector('.confirm-action-dialog')");await pause(380);
  };
  const shot=async name=>{
    const clip=await evaluate("(()=>{const r=document.querySelector('.confirm-action-dialog').getBoundingClientRect();return {x:Math.max(0,r.x-12),y:Math.max(0,r.y-12),width:Math.min(innerWidth,r.width+24),height:Math.min(innerHeight,r.height+24),scale:1}})()");
    const r=await send('Page.captureScreenshot',{format:'png',clip});await fs.writeFile(path.join(out,(before?'before-':'after-')+name+'.png'),Buffer.from(r.data,'base64'));
  };
  const original=await evaluate('({width:innerWidth,height:innerHeight,deviceScaleFactor:devicePixelRatio})');
  try{
    await fs.mkdir(out,{recursive:true});await send('Page.enable');await send('Runtime.enable');await send('Page.bringToFront');
    await send('Fetch.enable',{patterns:[{urlPattern:origin+'/api/v1/*',requestStage:'Request'},{urlPattern:origin+'/api/v1/workspace/bootstrap',requestStage:'Response'}]});
    await send('Page.reload',{ignoreCache:true});await waitFor("!!document.querySelector('.rail-toggle')");
    await evaluate("if(!document.querySelector('[data-navigation-key=feed] button'))document.querySelector('.rail-more-action')?.click()");await pause(250);
    await evaluate("document.querySelector('[data-navigation-key=feed] button').click()");await waitFor("!!document.querySelector('.feed-comment-delete')");
    for(const [width,height] of [[1440,900],[1024,768],[640,480],[360,640],[320,568]]){
      await send('Emulation.setDeviceMetricsOverride',{width,height,deviceScaleFactor:1,mobile:false});await pause(300);await open();
      const metrics=await evaluate(`(()=>{
        const d=document.querySelector('.confirm-action-dialog'),r=d.getBoundingClientRect(),title=d.querySelector('.fui-DialogTitle'),content=d.querySelector('.fui-DialogContent'),actions=d.querySelector('.fui-DialogActions'),buttons=[...actions.querySelectorAll('button')].map(b=>{const x=b.getBoundingClientRect();return {width:x.width,height:x.height,left:x.left,right:x.right,top:x.top,bottom:x.bottom}}),s=getComputedStyle(d);
        const center=e=>{const x=e.getBoundingClientRect();return x.x+x.width/2-(r.x+r.width/2)};
        return {width:r.width,height:r.height,left:r.left,right:r.right,top:r.top,bottom:r.bottom,viewport:[innerWidth,innerHeight],padding:[s.paddingLeft,s.paddingRight],icons:d.querySelectorAll('svg').length,copyAlign:[getComputedStyle(title).textAlign,getComputedStyle(content).textAlign],centers:[center(title),center(content),center(actions)],buttons,description:document.getElementById(d.getAttribute('aria-describedby'))?.textContent,initialFocus:document.activeElement.textContent,overflow:d.scrollWidth>d.clientWidth};
      })()`);
      if(!before){
        assert.equal(metrics.icons,1);assert.deepEqual(metrics.copyAlign,['center','center']);assert(metrics.centers.every(c=>Math.abs(c)<1));assert.equal(metrics.padding[0],metrics.padding[1]);assert(!metrics.overflow);assert(metrics.left>=15&&metrics.right<=width-15&&metrics.top>=15&&metrics.bottom<=height-15);
        assert(Math.abs(metrics.buttons[0].width-metrics.buttons[1].width)<1);assert(metrics.buttons.every(b=>b.height>=44));assert.equal(metrics.initialFocus,'Отмена');assert(metrics.description.includes('нельзя отменить'));
        await key('Tab');assert(await evaluate("document.activeElement.matches('.confirm-action-danger')"));await key('Tab');assert(await evaluate("document.activeElement.matches('.confirm-action-cancel')"));await key('Tab','Tab',8);assert(await evaluate("document.activeElement.matches('.confirm-action-danger')"));
      }
      await shot(width+'x'+height);await key('Escape');await waitFor("!document.querySelector('.confirm-action-dialog')");await pause(220);
      if(!before){
        const focus=await evaluate("({returned:document.activeElement.matches('.feed-comment-delete'),tag:document.activeElement.tagName,className:document.activeElement.className})");
        assert(focus.returned,'Escape must restore the triggering control: '+JSON.stringify(focus));
      }
      results.push(metrics);console.log('PASS',width+'x'+height,before?'baseline':'symmetric copy/actions, one icon, keyboard and focus return');
    }
    if(!before){
      await send('Emulation.setDeviceMetricsOverride',{width:1024,height:768,deviceScaleFactor:1,mobile:false});await open();
      await evaluate("document.querySelector('.confirm-action-danger').click()");await waitFor("document.querySelector('.confirm-action-dialog')?.getAttribute('aria-busy')==='true'");
      assert(await evaluate("[...document.querySelectorAll('.confirm-action-dialog button')].every(b=>b.disabled)"));await key('Escape');assert(await evaluate("!!document.querySelector('.confirm-action-dialog')"));
      await evaluate("document.querySelector('.confirm-action-danger').click();document.querySelector('.confirm-action-cancel').click()");assert.equal(deleteCount,1);
      for(let n=0;!heldDelete&&n<40;n++)await pause(100);assert(heldDelete);
      await fulfill(heldDelete,{...fixture,comments:[]});heldDelete=undefined;await waitFor("!document.querySelector('.confirm-action-dialog')");assert(await evaluate("!document.querySelector('.feed-comment-delete')"));
      console.log('PASS mocked pending/success delete; no business data changed');
      // Reload restores the temporary fixture, never a database record.
      longTitle=true;await send('Page.reload',{ignoreCache:true});await waitFor("!!document.querySelector('.feed-comment-delete')");
      await send('Emulation.setDeviceMetricsOverride',{width:320,height:568,deviceScaleFactor:1,mobile:false});
      await evaluate("const b=document.querySelector('button[aria-label=\"Удалить публикацию\"]');b.scrollIntoView({block:'center'});b.focus();b.click()");await waitFor("!!document.querySelector('.confirm-action-dialog')");await pause(380);
      assert(await evaluate("(()=>{const d=document.querySelector('.confirm-action-dialog'),r=d.getBoundingClientRect();return d.scrollWidth<=d.clientWidth&&r.left>=15&&r.right<=innerWidth-15&&r.top>=15&&r.bottom<=innerHeight-15&&d.querySelector('.fui-DialogContent').textContent.includes('региональной команды')})()"),'Long publication description must fit');
      await shot('320x568-long-publication');await key('Escape');await waitFor("!document.querySelector('.confirm-action-dialog')");await pause(200);await open();
      await send('Emulation.setEmulatedMedia',{features:[{name:'forced-colors',value:'active'}]});await pause(250);await shot('forced-colors');
      assert(await evaluate("getComputedStyle(document.querySelector('.confirm-action-dialog')).boxShadow==='none'"));
      await send('Emulation.setEmulatedMedia',{features:[{name:'prefers-reduced-motion',value:'reduce'}]});await pause(250);await shot('reduced-motion');await key('Escape');
    }
    assert.deepEqual(errors,[]);assert.equal(deleteCount,before?0:1);await fs.writeFile(path.join(out,before?'before.json':'after.json'),JSON.stringify(results,null,2));
  }finally{
    if(heldDelete)await fulfill(heldDelete,{detail:'QA cancelled'},403);
    await send('Fetch.disable');await send('Emulation.setEmulatedMedia',{features:[]});await send('Emulation.setDeviceMetricsOverride',{...original,mobile:false});await send('Page.reload',{ignoreCache:true});ws.close();
  }
}
main().catch(e=>{console.error(e.message);process.exitCode=1;});
