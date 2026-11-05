import { chromium } from 'playwright-core';
import assert from 'node:assert/strict';
import { existsSync, mkdirSync } from 'node:fs';
const executablePath = [process.env.CHROME_PATH, 'C:/Program Files/Google/Chrome/Application/chrome.exe', 'C:/Program Files (x86)/Microsoft/Edge/Application/msedge.exe','/usr/bin/chromium'].find(p=>p&&existsSync(p));
const browser=await chromium.launch({executablePath,headless:true});
const base=process.env.BASE_URL??'http://localhost:8787';
mkdirSync('.e2e/planner',{recursive:true});
try {
for (const width of [320,390,428,768,1440]) {
 const ctx=await browser.newContext({viewport:{width,height:900}});
 await ctx.route(/googlesyndication|doubleclick|adtrafficquality|googletagservices/,r=>r.abort());
 await ctx.addInitScript(()=>{
  localStorage.setItem('landing.saved.v1',JSON.stringify({chicago:['chi-31','chi-21','chi-60']}));
  localStorage.setItem('landing.compare.v1',JSON.stringify({city:'chicago',ids:['chi-31','chi-21','chi-60']}));
 });
 const p=await ctx.newPage();
 for (const route of ['saved','compare','data','chicago']) {
  await p.goto(`${base}/${route}`,{waitUntil:'networkidle'});
  await p.locator('h1').waitFor();
  assert.ok(await p.evaluate(()=>document.documentElement.scrollWidth<=innerWidth+1),`${route} overflows at ${width}`);
  if(route==='compare') {
   const table=p.getByRole('region',{name:'Neighborhood comparison'});
   assert.ok(await table.evaluate(el=>el.scrollWidth>=el.clientWidth),'comparison remains scrollable');
   await table.evaluate(el=>el.scrollLeft=el.scrollWidth);
   assert.ok(await p.evaluate(()=>document.documentElement.scrollWidth<=innerWidth+1),'table scroll is contained');
  }
  if(route==='chicago') {
   await p.getByRole('button',{name:'Preferences',exact:true}).click();
   assert.ok(await p.evaluate(()=>document.documentElement.scrollWidth<=innerWidth+1),`drawer overflows at ${width}`);
   await p.keyboard.press('Escape');
  }
  if(width===390) await p.screenshot({path:`.e2e/planner/${route}-populated.png`});
  console.log(`PASS ${route}: ${width}px, page and controls fit`);
 }
 await ctx.close();
}
} finally { await browser.close(); }
