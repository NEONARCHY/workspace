// Read-only layout QA against the authenticated TEST browser on port 9224.
// --before records the previous layout without asserting the new design.
const assert=require('node:assert/strict'),fs=require('node:fs/promises'),path=require('node:path');
const origin='https://192.168.31.176:8443',before=process.argv.includes('--before');
const output=path.resolve('tmp/workspace-edge-polish'),pause=ms=>new Promise(r=>setTimeout(r,ms));
async function main(){
  const page=(await(await fetch('http://127.0.0.1:9224/json')).json()).find(p=>p.type==='page'&&p.url.startsWith(origin));
  assert(page,'Open the authenticated TEST browser.');
  const ws=new WebSocket(page.webSocketDebuggerUrl);await new Promise((r,j)=>{ws.onopen=r;ws.onerror=j;});
  let id=0;const pending=new Map(),errors=[],results=[];
  const send=(method,params={})=>new Promise((resolve,reject)=>{
    const key=++id,timer=setTimeout(()=>{pending.delete(key);reject(Error(method+' timeout'));},12000);
    pending.set(key,{resolve,reject,timer});ws.send(JSON.stringify({id:key,method,params}));
  });
  ws.onmessage=async e=>{
    const message=JSON.parse(e.data),entry=pending.get(message.id);
    if(entry){pending.delete(message.id);clearTimeout(entry.timer);message.error?entry.reject(Error(message.error.message)):entry.resolve(message.result);}
    if(message.method==='Runtime.exceptionThrown')errors.push(message.params.exceptionDetails.text);
    if(message.method==='Fetch.requestPaused'){
      const p=message.params;
      try{
        if(p.request.method==='GET'||new URL(p.request.url).pathname==='/api/v1/auth/web/refresh')await send('Fetch.continueRequest',{requestId:p.requestId});
        else await send('Fetch.fulfillRequest',{requestId:p.requestId,responseCode:403,body:Buffer.from('{"detail":"Read-only layout QA"}').toString('base64')});
      }catch(error){errors.push(error.message);}
    }
  };
  const evaluate=async expression=>{const r=await send('Runtime.evaluate',{expression,returnByValue:true,awaitPromise:true});assert(!r.exceptionDetails,r.exceptionDetails?.text);return r.result.value;};
  const waitFor=async expression=>{for(let n=0;n<45;n++){if(await evaluate(expression))return;await pause(150);}throw Error('Missing UI: '+expression);};
  const original=await evaluate('({width:innerWidth,height:innerHeight,deviceScaleFactor:devicePixelRatio})');
  const section=async key=>{
    await evaluate(`(() => {if(!document.querySelector('[data-navigation-key="${key}"] button'))document.querySelector('.rail-more-action')?.click();})()`);
    await pause(280);
    await evaluate(`(() => {const b=document.querySelector('[data-navigation-key="${key}"] button');if(!b)throw Error('Missing section ${key}');b.click();})()`);
    await pause(500);
  };
  const screenshot=async (name,clip)=>{const r=await send('Page.captureScreenshot',{format:'png',...(clip?{clip}: {})});await fs.writeFile(path.join(output,(before?'before-':'after-')+name+'.png'),Buffer.from(r.data,'base64'));};
  const assertEdge=(value,label)=>{if(!before)assert(Math.abs(value-20)<1,label+' must be 20px, got '+value);};
  const luminance=rgb=>rgb.map(c=>c/255).map(c=>c<=.04045?c/12.92:((c+.055)/1.055)**2.4).reduce((sum,c,i)=>sum+c*[.2126,.7152,.0722][i],0);
  try{
    await fs.mkdir(output,{recursive:true});await send('Page.enable');await send('Runtime.enable');await send('Page.bringToFront');
    await send('Fetch.enable',{patterns:[{urlPattern:origin+'/api/v1/*',requestStage:'Request'}]});
    await send('Page.reload',{ignoreCache:true});await waitFor("!!document.querySelector('.rail-toggle')");
    for(const [width,height] of [[2048,900],[1440,900],[1024,768],[620,900],[640,480]]){
      await send('Emulation.setDeviceMetricsOverride',{width,height,deviceScaleFactor:1,mobile:false});
      await evaluate("if(!document.querySelector('.app-shell').classList.contains('rail-collapsed'))document.querySelector('.rail-toggle').click()");await pause(600);
      const navigation=await evaluate(`(() => {
        const rail=document.querySelector('.app-rail').getBoundingClientRect(),nav=document.querySelector('.adaptive-rail-nav');
        const profile=document.querySelector('.rail-profile').getBoundingClientRect(),avatar=document.querySelector('.rail-profile .fui-Avatar').getBoundingClientRect();
        const buttons=Array.from(nav.querySelectorAll(':scope > .rail-slot > .rail-action'));
        const more=document.querySelector('.rail-more-action'),last=buttons.at(-1).getBoundingClientRect();
        return {more:!!more,lastBottom:last.bottom,navBottom:nav.getBoundingClientRect().bottom,profileTop:profile.top,
          avatarOffset:avatar.x+avatar.width/2-(rail.x+rail.width/2),scrollHeight:nav.scrollHeight,clientHeight:nav.clientHeight,
          rootOverflow:document.documentElement.scrollWidth>innerWidth};
      })()`);
      if(!before){assert(navigation.lastBottom<=navigation.profileTop-4,'Navigation overlaps profile');assert(navigation.lastBottom<=navigation.navBottom+1,'More clipped');assert(navigation.scrollHeight<=navigation.clientHeight+1,'Rail must not scroll');assert(Math.abs(navigation.avatarOffset)<.6,'Avatar must be centered');assert(!navigation.rootOverflow);}
      if(navigation.more){
        if(before)await evaluate("document.querySelector('.rail-more-action').click()");
        else{
          const point=await evaluate("(()=>{const r=document.querySelector('.rail-more-action').getBoundingClientRect();return {x:r.x+r.width/2,y:r.y+r.height/2};})()");
          await send('Input.dispatchMouseEvent',{type:'mouseMoved',...point});
          await send('Input.dispatchMouseEvent',{type:'mousePressed',button:'left',clickCount:1,...point});
          await send('Input.dispatchMouseEvent',{type:'mouseReleased',button:'left',clickCount:1,...point});
        }
        await pause(300);
        assert(await evaluate("!!document.querySelector('#rail-more-drawer')"));
        await send('Input.dispatchKeyEvent',{type:'keyDown',key:'Escape',code:'Escape',windowsVirtualKeyCode:27});
        await send('Input.dispatchKeyEvent',{type:'keyUp',key:'Escape',code:'Escape',windowsVirtualKeyCode:27});await pause(300);
        assert(await evaluate("document.activeElement.matches('.rail-more-action')"),'Escape must restore More focus');
      }
      await screenshot(width+'x'+height+'-rail');
      await section('messenger');await waitFor("!!document.querySelector('.messenger-view')");
      const messenger=await evaluate(`(() => {const panes=Array.from(document.querySelectorAll('.messenger-view > .list-pane,.messenger-view > .conversation-pane')).filter(p=>getComputedStyle(p).display!=='none');const r=panes.at(-1).getBoundingClientRect();return {right:innerWidth-r.right,rootOverflow:document.documentElement.scrollWidth>innerWidth};})()`);
      assertEdge(messenger.right,'Messenger edge');if(!before)assert(!messenger.rootOverflow);
      await screenshot(width+'x'+height+'-messenger');
      await section('calendar');await waitFor("!!document.querySelector('.calendar-board')");
      const calendar=[];
      for(const past of [false,true]){
        await evaluate(`(() => {const days=Array.from(document.querySelectorAll('.calendar-view:not(.task-calendar-embedded) .calendar-day'));const today=days.findIndex(d=>d.classList.contains('today'));days[today-${past?1:0}].querySelector('.calendar-day-number').click();})()`);await pause(250);
        const metrics=await evaluate(`(() => {
          const view=document.querySelector('.calendar-view:not(.task-calendar-embedded)'),summary=view.querySelector('.calendar-day-summary').getBoundingClientRect();
          const empty=view.querySelector('.calendar-empty')?.getBoundingClientRect(),board=view.querySelector('.calendar-board').getBoundingClientRect();
          const aside=view.querySelector('.calendar-side'),side=aside.getBoundingClientRect();
          const heading=view.querySelector('.calendar-day-heading > span'),range=document.createRange();range.selectNodeContents(heading);
          const text=range.getBoundingClientRect(),style=getComputedStyle(aside);
          return {right:innerWidth-summary.right,emptyRight:empty?innerWidth-empty.right:null,
            heading:heading.textContent,sideRadius:style.borderTopLeftRadius,sideOverflow:style.overflowY,headingInset:text.x-side.x,
            columnGap:side.x>board.right?summary.x-board.right:null,width:summary.width,past:!!view.querySelector('.calendar-past-note'),rootOverflow:document.documentElement.scrollWidth>innerWidth};
        })()`);
        assertEdge(metrics.right,'Calendar day edge');if(metrics.emptyRight!==null)assertEdge(metrics.emptyRight,'Calendar empty edge');if(metrics.columnGap!==null)assertEdge(metrics.columnGap,'Calendar grid/agenda gap');
        if(!before){assert(!metrics.rootOverflow);assert.equal(metrics.sideRadius,'0px','Transparent agenda must not clip the heading with a rounded scroll viewport');}
        calendar.push(metrics);await screenshot(width+'x'+height+'-calendar-'+(past?'past':'today'));
        if(past){
          await evaluate("document.querySelector('.calendar-day-heading').scrollIntoView({block:'center'})");await pause(150);
          const clip=await evaluate("(()=>{const r=document.querySelector('.calendar-day-heading').getBoundingClientRect();return {x:r.x,y:r.y,width:Math.min(r.width,360),height:r.height,scale:1};})()");
          await screenshot(width+'x'+height+'-past-heading',clip);
        }
      }
      await section('absences');await waitFor("!!document.querySelector('.absence-summary')");
      const absenceEdges=await evaluate(`(() => {
        const view=document.querySelector('.absences-view'),right=s=>innerWidth-view.querySelector(s).getBoundingClientRect().right;
        return {header:right('.record-header'),action:right('.record-header > button'),summary:right('.absence-summary'),panels:right('.absence-canvas'),rootOverflow:document.documentElement.scrollWidth>innerWidth};
      })()`);
      for(const key of ['header','action','summary','panels'])assertEdge(absenceEdges[key],'Absences '+key);
      if(!before)assert(!absenceEdges.rootOverflow);
      const presence=await evaluate(`Array.from(document.querySelectorAll('.absence-summary > div'),tile=>{
        const label=tile.querySelector('span'),number=tile.querySelector('strong'),box=tile.getBoundingClientRect(),range=document.createRange();range.selectNodeContents(label);const text=range.getBoundingClientRect();
        return {status:tile.dataset.presenceStatus,gradient:getComputedStyle(tile).backgroundImage,accent:getComputedStyle(tile).getPropertyValue('--ws-presence-accent').trim(),color:getComputedStyle(label).color,
          numberSize:parseFloat(getComputedStyle(number).fontSize),labelSize:parseFloat(getComputedStyle(label).fontSize),overflow:tile.scrollWidth>tile.clientWidth||tile.scrollHeight>tile.clientHeight,
          labelClearance:[text.top-box.top,box.right-text.right,box.bottom-text.bottom,text.left-box.left]};
      })`);
      if(!before){
        assert.equal(presence.length,7);assert.equal(new Set(presence.map(t=>t.gradient)).size,7);assert(presence.every(t=>t.gradient.startsWith('linear-gradient(90deg')));
        for(const tile of presence){
          assert.equal(tile.numberSize,36);assert.equal(tile.labelSize,16);assert(!tile.overflow,'Presence text must fit: '+tile.status);assert(tile.labelClearance.every(c=>c>=12),'Presence label touches an edge: '+tile.status);
          const accent=tile.accent.replace('#','').match(/../g).map(c=>parseInt(c,16));
          const background=accent.map((c,i)=>c*.22+[252,254,254][i]*.78),text=tile.color.match(/[\d.]+/g).slice(0,3).map(Number);
          tile.labelContrast=(luminance(background)+.05)/(luminance(text)+.05);
          assert(tile.labelContrast>=4.5,'Low presence label contrast: '+tile.status+' '+tile.labelContrast.toFixed(2));
        }
      }
      await screenshot(width+'x'+height+'-presence');results.push({width,height,navigation,messenger,calendar,presence,absenceEdges});
      if(!before){
        await evaluate("document.querySelector('.absence-presence').scrollIntoView({block:'end'})");await pause(150);
        assert(await evaluate("(()=>{const v=document.querySelector('.absences-view').getBoundingClientRect(),p=document.querySelector('.absence-presence').getBoundingClientRect();return p.bottom<=v.bottom+1&&p.top>=v.top-1})()"),'Lower presence panel must remain reachable');
      }
      console.log('PASS',width+'x'+height,before?'baseline captured':'centered rail, More reachable, 20px edges, seven washes');
    }
    if(!before){
      await send('Emulation.setEmulatedMedia',{features:[{name:'forced-colors',value:'active'}]});await pause(250);
      assert(await evaluate("Array.from(document.querySelectorAll('.absence-summary > div')).every(t=>getComputedStyle(t).backgroundImage==='none')"),'Forced colors must remove washes');
      await send('Emulation.setEmulatedMedia',{features:[{name:'prefers-reduced-motion',value:'reduce'}]});await pause(250);
      assert(await evaluate("document.documentElement.scrollWidth<=innerWidth"));
      console.log('PASS forced colors and reduced motion');
    }
    assert.deepEqual(errors,[]);await fs.writeFile(path.join(output,before?'before.json':'after.json'),JSON.stringify(results,null,2));
  }finally{
    await send('Fetch.disable');await send('Emulation.setEmulatedMedia',{features:[]});await send('Emulation.setDeviceMetricsOverride',{...original,mobile:false});await send('Page.reload',{ignoreCache:true});ws.close();
  }
}
main().catch(error=>{console.error(error.message);process.exitCode=1;});
