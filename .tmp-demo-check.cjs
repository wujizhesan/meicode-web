const { chromium } = require('D:/MeiCode-Full/node_modules/playwright-core')
const EXE = 'C:/Users/17223/AppData/Local/ms-playwright/chromium-1243/chrome-win64/chrome.exe'

;(async () => {
  const browser = await chromium.launch({ executablePath: EXE })
  const page = await browser.newPage({ viewport: { width: 1100, height: 820 } })
  const errors = []
  page.on('pageerror', (e) => errors.push(e.message))

  await page.goto('http://127.0.0.1:5274/', { waitUntil: 'networkidle' })
  console.log('title:', await page.title())

  await page.fill('textarea', '给我看看工具和文件改动')
  await page.keyboard.press('Enter')
  await page.waitForTimeout(7000)

  console.log('read_file card:', await page.getByText('read_file', { exact: true }).count())
  console.log('edit_file card:', await page.getByText('edit_file', { exact: true }).count())
  console.log('diff block:', await page.getByText('收起变更').count())
  console.log('output block:', await page.getByText('收起输出').count())
  console.log('answer rendered:', await page.getByText('做了什么').count())

  await page.fill('textarea', '给个代码示例')
  await page.keyboard.press('Enter')
  await page.waitForSelector('.md-body pre code', { timeout: 30000 })
  console.log('code class:', await page.getAttribute('.md-body pre code', 'class'))
  console.log('page errors:', errors.length ? errors : 'none')
  await page.screenshot({ path: '.tmp-demo.png' })
  await browser.close()
})().catch((e) => { console.error('FAILED:', e.message); process.exit(1) })
