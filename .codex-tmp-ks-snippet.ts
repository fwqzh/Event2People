import { chromium } from 'playwright';

(async () => {
  const browser = await chromium.launch({ headless: true, args: ['--disable-blink-features=AutomationControlled'] });
  const context = await browser.newContext({
    locale: 'en-US',
    timezoneId: 'America/New_York',
    userAgent: 'Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/141.0.0.0 Safari/537.36',
    viewport: { width: 1440, height: 900 },
  });
  await context.addInitScript(() => {
    Object.defineProperty(navigator, 'webdriver', { get: () => undefined });
    Object.defineProperty(navigator, 'platform', { get: () => 'MacIntel' });
    Object.defineProperty(navigator, 'languages', { get: () => ['en-US', 'en'] });
    (window as typeof window & { chrome?: { runtime: Record<string, never> } }).chrome = { runtime: {} };
  });
  const page = await context.newPage();
  await page.goto('https://www.kickstarter.com/discover/advanced?category_id=16&sort=newest', { waitUntil: 'domcontentloaded', timeout: 60000 });
  await page.waitForTimeout(5000);
  const html = await page.content();
  const slugs = ['deepview-mount', 'dataleakz-data-breach-intelligence-0', 'zen-echo', 'wiqwiic-32', 'fridgepower'];
  for (const slug of slugs) {
    const idx = html.indexOf(slug);
    console.log(`--- ${slug} @ ${idx} ---`);
    if (idx >= 0) {
      console.log(html.slice(Math.max(0, idx - 300), idx + 900));
    }
  }
  await page.close();
  await context.close();
  await browser.close();
})().catch((error) => {
  console.error(error);
  process.exit(1);
});
