// Real browser encoders + synthetic audio. This does NOT certify physical microphones.
const { chromium, webkit } = require('playwright');
const fs = require('node:fs');
const assert = require('node:assert/strict');
const output=process.env.QA_THEME==='dark'?'tmp/dark-theme/voice':'tmp/mobile-voice';
fs.mkdirSync(output,{recursive:true});
(async()=>{
  for(const engine of ['edge','webkit']){
    const browser=await(engine==='edge'?chromium.launch({channel:'msedge',headless:true}):webkit.launch({headless:true}));
    try {
      const context=await browser.newContext({viewport:{width:390,height:844},hasTouch:true,isMobile:true,reducedMotion:'reduce'});
      await context.route('**/api/**',route=>route.fulfill({json:[]}));
      const page=await context.newPage(),errors=[];
      page.on('pageerror',e=>errors.push(e.message));
      await page.goto('http://127.0.0.1:5173/qa/mobile-domains.html'+(process.env.QA_THEME==='dark'?'?theme=dark':''));
      await page.locator('.chat-row').first().click();
      await page.getByLabel('Записать голосовое сообщение').waitFor();
      const media = await page.evaluate(()=>({ recorder:typeof MediaRecorder, devices:typeof navigator.mediaDevices }));
      if(media.recorder==='undefined'||media.devices==='undefined'){
        assert.equal(engine,'webkit','Chromium must provide real media support');
        await page.getByLabel('Записать голосовое сообщение').click();
        await page.getByText('Не удалось записать',{exact:true}).waitFor();
        assert(await page.locator('.voice-recorder').innerText().then(text=>text.includes('не поддерживает')));
        await page.getByRole('button',{name:'Повторить',exact:true}).click();
        await page.getByText('Не удалось записать',{exact:true}).waitFor();
        await page.getByRole('button',{name:'Отмена',exact:true}).click();
        console.log('Windows WebKit has no media API: unsupported / retry / cancel verified; physical Safari recording remains unverified');
        assert.deepEqual(errors,[]);
        await context.close();continue;
      }
      await page.evaluate(forceMp4=>{
        window.qaStoppedTracks=0;
        Object.defineProperty(navigator.mediaDevices,'getUserMedia',{configurable:true,value:async()=>{
          const context=new AudioContext(), source=context.createOscillator(), output=context.createMediaStreamDestination();
          source.connect(output);source.start();await context.resume();
          for(const track of output.stream.getTracks()){
            const stop=track.stop.bind(track);track.stop=()=>{window.qaStoppedTracks++;stop();source.stop();void context.close();};
          }
          return output.stream;
        }});
        if(forceMp4){
          if(!MediaRecorder.isTypeSupported('audio/mp4'))throw new Error('WebKit must support MP4');
          const supported=MediaRecorder.isTypeSupported.bind(MediaRecorder);
          MediaRecorder.isTypeSupported=type=>type==='audio/mp4'&&supported(type);
        }
      },engine==='webkit');
      await page.getByLabel('Записать голосовое сообщение').click();
      await page.getByText('Идёт запись',{exact:true}).waitFor();
      await page.waitForTimeout(850);
      await page.getByRole('button',{name:'Завершить',exact:true}).click();
      await page.getByText('Запись готова',{exact:true}).waitFor();
      const recorder=page.locator('.voice-recorder');
      const box=await recorder.boundingBox();assert(box.x>=0&&box.x+box.width<=391,'recorder bounds');
      for(const control of ['Воспроизвести','Громкость']){
        const button=page.getByRole('button',{name:control,exact:true});
        const b=await button.boundingBox();assert(b.width>=48&&b.height>=48,'48px control '+control+' '+JSON.stringify(b));
      }
      assert.equal(await page.evaluate(()=>window.qaStoppedTracks),1,'capture releases stream on stop');
      await page.getByRole('button',{name:'Отправить',exact:true}).click();
      await recorder.getByRole('alert').waitFor();
      assert.equal(await page.evaluate(()=>document.documentElement.dataset.qaVoiceRoute),engine==='webkit'?'file':'voice');
      const mime=await page.evaluate(()=>document.documentElement.dataset.qaVoiceMime);
      assert(mime.startsWith(engine==='webkit'?'audio/mp4':'audio/webm'),'correct MIME '+mime);
      await page.getByRole('button',{name:'Отправить',exact:true}).click();
      await recorder.getByRole('alert').waitFor();
      await page.screenshot({path:output+'/'+engine+'-retry.png'});
      await page.getByRole('button',{name:'Удалить запись',exact:true}).click();
      await recorder.waitFor({state:'detached'});
      await page.getByLabel('Записать голосовое сообщение').click();
      await page.getByText('Идёт запись',{exact:true}).waitFor();
      await page.getByRole('button',{name:'Отмена',exact:true}).click();
      await recorder.waitFor({state:'detached'});
      assert.equal(await page.evaluate(()=>window.qaStoppedTracks),2,'cancel releases stream');
      assert.deepEqual(errors,[]);
      console.log(engine+' voice record / preview / MIME / retry / cleanup passed');
      await context.close();
    }finally{await browser.close();}
  }
})().catch(e=>{console.error(e);process.exitCode=1;});
