import { test, expect, chromium, type BrowserContext, type Worker } from '@playwright/test';
import { mkdtemp, rm, mkdir, readFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { createServer, type Server } from 'node:http';
let context: BrowserContext;
let worker: Worker;
let extensionId: string;
let profile: string;
let server: Server;
let port: number;
const requests: string[] = [];
let listed: string;
test.beforeAll(async () => {
  const feed = JSON.parse(await readFile('public/data/threats.json', 'utf8'));
  listed = feed.domains.find((d: string) => !d.startsWith('xn--') && d.split('.').length === 2);
  server = createServer((req, res) => {
    requests.push(req.url ?? '');
    res.setHeader('Content-Type', 'text/html; charset=utf-8');
    res.end(
      `<!doctype html><html><head><title>Local test fixture</title></head><body><h1>Local browser fixture</h1><form><label for="seed">Recovery phrase</label><textarea id="seed" placeholder="Seed phrase"></textarea><button type="submit">Submit</button></form><a id="deceptive" href="http://other.lynk.test:${port}/link">https://metamask.io</a></body></html>`,
    );
  });
  await new Promise<void>((resolve) => server.listen(0, '127.0.0.1', resolve));
  port = (server.address() as { port: number }).port;
  profile = await mkdtemp(path.join(tmpdir(), 'lynk-e2e-'));
  context = await chromium.launchPersistentContext(profile, {
    channel: 'chromium',
    headless: true,
    executablePath: process.env.LYNK_CHROMIUM_PATH,
    args: [
      `--disable-extensions-except=${path.resolve('dist')}`,
      `--load-extension=${path.resolve('dist')}`,
      '--host-resolver-rules=MAP * 127.0.0.1',
      '--no-proxy-server',
    ],
  });
  worker = context.serviceWorkers()[0] ?? (await context.waitForEvent('serviceworker'));
  extensionId = new URL(worker.url()).host;
  // Wait for cold-start initialization and network rules.
  const popup = await context.newPage();
  await popup.goto(`chrome-extension://${extensionId}/popup.html`);
  await expect(popup.locator('#status-label')).toHaveText('PROTECTION IS ON');
  await popup.close();
});
test.afterAll(async () => {
  await context?.close();
  await new Promise<void>((resolve) => server?.close(() => resolve()));
  if (profile) await rm(profile, { recursive: true, force: true });
});
async function uiMessage<T>(type: string, extra = {}): Promise<T> {
  const ui = await context.newPage();
  await ui.goto(`chrome-extension://${extensionId}/settings.html`);
  try {
    const result = await ui.evaluate(
      async ({ type, extra }) => chrome.runtime.sendMessage({ type, ...extra }),
      { type, extra },
    );
    if (!result.ok) throw new Error(result.error);
    return result.data;
  } finally {
    await ui.close();
  }
}
test('native rules intercept a known threat before the local server receives it', async () => {
  const page = await context.newPage();
  const marker = `/must-never-reach-server-${Date.now()}`;
  await page.goto(`http://${listed}:${port}${marker}`).catch(() => {});
  await expect(page).toHaveURL(new RegExp(`chrome-extension://${extensionId}/warning.html`));
  await expect(page.locator('#blocked-host')).toHaveText(listed);
  await expect(page.locator('#warning-detail')).toContainText('Reported phishing domain');
  expect(requests).not.toContain(marker);
  await expect(page.locator('#continue')).toBeDisabled();
  await page.locator('#advanced').evaluate((element: HTMLDetailsElement) => {
    element.open = true;
  });
  await page.locator('#accept-risk').check();
  await page.locator('#continue').click();
  await expect(page).toHaveURL(`http://${listed}:${port}${marker}`);
  await expect(page.locator('h1')).toHaveText('Local browser fixture');
  expect(requests).toContain(marker);
  // The pass is scoped to this tab; another tab still hits the warning.
  const second = await context.newPage();
  await second.goto(`http://${listed}:${port}/second-tab`).catch(() => {});
  await expect(second).toHaveURL(new RegExp('/warning.html'));
  expect(requests).not.toContain('/second-tab');
  await page.goto('about:blank');
  await expect
    .poll(() => worker.evaluate(() => chrome.declarativeNetRequest.getSessionRules()))
    .toEqual([]);
  await page.goto(`http://${listed}:${port}/after-leaving-origin`).catch(() => {});
  await expect(page).toHaveURL(new RegExp('/warning.html'));
  expect(requests).not.toContain('/after-leaving-origin');
  await mkdir('artifacts', { recursive: true });
  await page.setViewportSize({ width: 1100, height: 900 });
  await page.screenshot({ path: 'artifacts/warning.png', fullPage: true });
  await second.close();
  await page.close();
});
test('detects new lookalikes and shows the real registered domain', async () => {
  const page = await context.newPage();
  await page.goto(`http://metamask.io.lynk.test:${port}/`).catch(() => {});
  await expect(page).toHaveURL(new RegExp('/warning.html'));
  await expect(page.locator('#warning-detail')).toContainText('registered domain is lynk.test');
  await expect(page.locator('#official')).toHaveAttribute('href', 'https://metamask.io/');
  await page.close();
});
test('popup URL checker, views, and settings work without a network reputation service', async () => {
  const page = await context.newPage();
  await page.goto(`chrome-extension://${extensionId}/popup.html`);
  await page.locator('#check-url').fill('https://metamaks.io');
  await page.locator('#check-form').evaluate((form: HTMLFormElement) => form.requestSubmit());
  await expect(page.locator('#check-result')).toContainText('Risk detected');
  await page.locator('#check-url').fill('https://example.org');
  await page.locator('#check-form').evaluate((form: HTMLFormElement) => form.requestSubmit());
  await expect(page.locator('#check-result')).toContainText('No known URL threats detected');
  await page.locator('#check-url').fill('');
  await page.locator('#check-result').evaluate((element: HTMLElement) => {
    element.hidden = true;
  });
  await page.locator('#tab-activity').click();
  await expect(page.locator('#activity')).toBeVisible();
  await page.locator('#clear-activity').click();
  await expect(page.locator('#activity-list')).toContainText('A quiet corner');
  await page.locator('#tab-overview').click();
  await mkdir('artifacts', { recursive: true });
  await page.setViewportSize({ width: 400, height: 600 });
  expect(
    await page.locator('#check-form').evaluate((form) => form.getBoundingClientRect().bottom),
  ).toBeLessThanOrEqual(600);
  await page.screenshot({ path: 'artifacts/popup.png', fullPage: true });
  await page.close();
  const settingsPage = await context.newPage();
  await settingsPage.goto(`chrome-extension://${extensionId}/settings.html`);
  await settingsPage.locator('#enabled').uncheck();
  await expect(settingsPage.locator('#paused')).toBeVisible();
  await expect
    .poll(() => worker.evaluate(() => chrome.declarativeNetRequest.getEnabledRulesets()))
    .toEqual([]);
  await settingsPage.locator('#enabled').check();
  await expect(settingsPage.locator('#paused')).toBeHidden();
  await expect
    .poll(() => worker.evaluate(() => chrome.declarativeNetRequest.getEnabledRulesets()))
    .toEqual(['threats']);
  await settingsPage.setViewportSize({ width: 1200, height: 1000 });
  await settingsPage.screenshot({ path: 'artifacts/settings.png', fullPage: true });
  await settingsPage.close();
});
test('recovery field metadata creates a warning without transmitting typed secrets', async () => {
  const page = await context.newPage();
  await page.goto(`http://127.0.0.1:${port}/seed-form`);
  await expect(page.locator('[data-lynk-warning]')).toBeVisible();
  await page.locator('#seed').fill('TEST SECRET MUST REMAIN IN PAGE');
  const state = await worker.evaluate(() => chrome.storage.session.get(null));
  expect(JSON.stringify(state)).not.toContain('TEST SECRET');
  expect(JSON.stringify(state)).toContain('recovery-phrase');
  await page.close();
});
test('deceptive visible link text is stopped on click', async () => {
  await uiMessage('UPDATE_SETTINGS', { patch: { pageGuard: false } });
  const page = await context.newPage();
  await page.goto(`http://127.0.0.1:${port}/links`);
  await page.waitForFunction(() => document.readyState === 'complete');
  // The settings response reaches the content script asynchronously.
  await expect
    .poll(() =>
      worker.evaluate(async () => JSON.stringify(await chrome.storage.local.get('settings'))),
    )
    .toContain('"pageGuard":false');
  await page.locator('#deceptive').click();
  await expect(page).toHaveURL(`http://127.0.0.1:${port}/links`);
  await expect(page.locator('[data-lynk-warning]')).toBeVisible();
  await page.close();
  await uiMessage('UPDATE_SETTINGS', { patch: { pageGuard: true } });
});
test('page content cannot invoke privileged settings changes', async () => {
  // Chrome's actual external boundary: pages do not receive chrome.runtime.sendMessage.
  const page = await context.newPage();
  await page.goto(`http://127.0.0.1:${port}/boundary`);
  expect(
    await page.evaluate(
      () =>
        typeof (globalThis as unknown as { chrome?: { runtime?: { sendMessage?: unknown } } })
          .chrome?.runtime?.sendMessage,
    ),
  ).toBe('undefined');
  const cdp = await context.newCDPSession(page);
  const worlds: { id: number; origin: string; name: string }[] = [];
  cdp.on('Runtime.executionContextCreated', ({ context: world }) => worlds.push(world));
  await cdp.send('Runtime.enable');
  await expect
    .poll(() => worlds.some((world) => world.origin === `chrome-extension://${extensionId}`))
    .toBe(true);
  const isolated = worlds.find((world) => world.origin === `chrome-extension://${extensionId}`)!;
  for (const message of [
    { type: 'UPDATE_SETTINGS', patch: { enabled: false } },
    { type: 'CLEAR_ACTIVITY' },
    { type: 'CONTINUE_ONCE' },
  ]) {
    const result = await cdp.send('Runtime.evaluate', {
      expression: `chrome.runtime.sendMessage(${JSON.stringify(message)})`,
      contextId: isolated.id,
      awaitPromise: true,
      returnByValue: true,
    });
    expect(result.result.value).toMatchObject({ ok: false });
  }
  await cdp.detach();
  await page.close();
});

test('known malicious embedded requests remain blocked', async () => {
  const page = await context.newPage();
  await page.goto(`http://127.0.0.1:${port}/embedded`);
  const marker = `/blocked-script-${Date.now()}`;
  const loaded = await page.evaluate(
    (url) =>
      new Promise((resolve) => {
        const script = document.createElement('script');
        script.src = url;
        script.onload = () => resolve(true);
        script.onerror = () => resolve(false);
        document.head.append(script);
      }),
    `http://${listed}:${port}${marker}`,
  );
  expect(loaded).toBe(false);
  expect(requests).not.toContain(marker);
  await page.close();
});
