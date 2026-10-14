const assert=require('node:assert/strict');
module.exports=async function checkVvcUi(browser,baseUrl){
  for(const available of [false,true]){
    const page=await browser.newPage({viewport:{width:1280,height:900}});
    try{
      await page.route('http://127.0.0.1:9351/**',async route=>{
        const path=new URL(route.request().url()).pathname;
        let body={ok:true,records:[]};
        if(path==='/api/health')body={backend:'windows-native',platform:'windows',available:true,
          cpu:'VVC browser fixture',gpus:[],ffmpegVersion:'test',bridgeVersion:6,taskSchemaVersion:4,
          globalOptions:['-fps_mode'],hasAss:true,encoders:[{Key:'libvvenc',Available:available,
            Runtime:available,RuntimeValidation:'encode-mkv-decode-v1',RuntimeError:available?'':'VVC decoder unavailable',Options:['-preset','-qp'],PixelFormats:['yuv420p10le']}]};
        await route.fulfill({status:200,contentType:'application/json',body:JSON.stringify(body)});
      });
      await page.goto(baseUrl+'/?windowsNative=http%3A%2F%2F127.0.0.1%3A9351&token=vvc-browser-test');
      await page.waitForFunction(()=>document.body.dataset.runtimeBackend==='windows-native');
      await page.locator('[data-media-mode="transcode"]').click();
      const option=page.locator('[name="codec"] option[value="h266"]');
      assert.equal(await option.count(),1,'H.266 must be visible as an explicit capability');
      await page.waitForFunction(expected=>document.querySelector('[name="codec"] option[value="h266"]').disabled===!expected,available);
      if(!available){
        assert.match(await page.locator('#taskVvcCapability').textContent(),/不可用/);
        continue;
      }
      await page.locator('[name="codec"]').selectOption('h266');
      assert.equal(await page.locator('[name="encoder"]').inputValue(),'libvvenc');
      assert.equal(await page.locator('[name="pixelFormat"]').inputValue(),'yuv420p10le');
      assert.equal(await page.locator('[name="quality"]').inputValue(),'32');
      assert.deepEqual(await page.locator('[name="preset"] option').evaluateAll(os=>os.map(o=>o.value)),['faster','fast','medium','slow','slower']);
      assert.match(await page.locator('[name="quality"]').locator('..').textContent(),/QP/);
      assert.equal(await page.locator('[name="twoPass"]').isDisabled(),true);
      assert.equal(await page.locator('#taskExploreCurve').isDisabled(),true);
      assert.match(await page.locator('#taskVvcCapability').textContent(),/实验/);
      assert.match(await page.locator('#taskVvcCapability').textContent(),/播放器/);
      await page.screenshot({path:'media-workspace-vvc-desktop.png',fullPage:true});
      await page.setViewportSize({width:390,height:844});
      await page.waitForFunction(()=>document.documentElement.dataset.uiShell==='phone');
      await page.evaluate(()=>new Promise(resolve=>requestAnimationFrame(()=>requestAnimationFrame(resolve))));
      const geometry=await page.evaluate(()=>({width:innerWidth,scroll:document.documentElement.scrollWidth,overflow:[...document.querySelectorAll('body *')].filter(el=>el.getBoundingClientRect().right>innerWidth+1).slice(0,12).map(el=>({tag:el.tagName,id:el.id,class:el.className,right:el.getBoundingClientRect().right}))}));
      assert.ok(geometry.scroll<=geometry.width,'VVC UI must not overflow mobile: '+JSON.stringify(geometry));
      await page.screenshot({path:'media-workspace-vvc-mobile.png',fullPage:true});
      await page.locator('[name="codec"]').selectOption('h264');
      assert.equal(await page.locator('[name="pixelFormat"]').inputValue(),'yuv420p');
      assert.match(await page.locator('[name="quality"]').locator('..').textContent(),/CRF/);
    }finally{await page.close();}
  }
  console.log('VVC browser capability and QP controls passed (mocked Native capabilities).');
};
