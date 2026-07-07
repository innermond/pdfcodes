import { chromium } from 'playwright'
const SS='/tmp/claude-1000/-home-gabriel-Project-pdfcodes/3f3ab6ea-2ed7-4a5d-bf09-2517a10f2175/scratchpad'
const b=await chromium.launch({executablePath:'/usr/bin/google-chrome'})
const page=await b.newPage({viewport:{width:1400,height:1200}})
page.on('pageerror',e=>console.log('PAGEERR:',e.message))
await page.goto('http://localhost:5173',{waitUntil:'networkidle'});await page.waitForTimeout(800)
await page.getByText('Simplu',{exact:true}).click();await page.waitForTimeout(500)
await page.getByRole('button',{name:/Contur/}).click();await page.waitForTimeout(300)
await page.getByText('Formă presetată',{exact:true}).click();await page.waitForTimeout(800)
await page.getByRole('button',{name:/Date/}).click();await page.waitForTimeout(500)
// Generează CSV in Date step
const gen=page.getByRole('button',{name:/Generează CSV/})
console.log('Generează CSV btn:', await gen.count())
if(await gen.count()){ await gen.first().click(); await page.waitForTimeout(1500) }
await page.getByRole('button',{name:/Coduri/}).click();await page.waitForTimeout(700)
console.log('reached Coduri (Text exemplu present):', await page.getByText('Text exemplu').count())
console.log('OLD "Padding fundal text" present:', await page.getByText('Padding fundal text').count())
// select first code so per-word sections show
const stilCount=await page.getByText('Fundal text',{exact:true}).count()
console.log('Fundal text header count:', stilCount)
// Expand "Fundal text" section (collapsible) then set a background color to reveal Padding
const header = page.getByText('Fundal text',{exact:true}).first()
await header.click().catch(()=>{}); await page.waitForTimeout(400)
console.log('Padding (mm) label present:', await page.getByText('Padding (mm)').count())
await page.screenshot({path:SS+'/pad-coduri.png',fullPage:true})
await b.close()
