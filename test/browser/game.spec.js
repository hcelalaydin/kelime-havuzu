const { test, expect } = require('@playwright/test');
const { default: AxeBuilder } = require('@axe-core/playwright');

async function createRoom(page, name = 'Deniz') {
  await page.goto('/');
  await expect(page.locator('#connection')).toBeHidden();
  await page.getByLabel('Sana ne diyelim?').fill(name);
  await page.locator('#entry-submit').click();
  await expect(page.locator('#lobby-screen')).toBeVisible();
  return page.locator('#lobby-code').textContent();
}
async function joinRoom(page, code, name, team) {
  await page.goto(`/?room=${code}`);
  await expect(page.locator('#connection')).toBeHidden();
  await page.getByLabel('Sana ne diyelim?').fill(name);
  await page.locator(`input[name=team][value=${team}]`).check();
  await page.locator('#entry-submit').click();
  await expect(page.locator('#lobby-screen')).toBeVisible();
}
async function fillWords(page, prefix) {
  for (let i = 0; i < 5; i++)
    await page
      .getByLabel(`${i + 1}. kelime veya ifade`, { exact: true })
      .fill(`${prefix} kelime ${i}`);
  // A pending auto-save may still be completing; wait for the visible saved acknowledgement.
  await expect(page.locator('#draft-status')).toContainText('Kaydedildi');
  await page.locator('#submit-words').click();
  await expect(page.locator('#submitted-box')).toBeVisible();
}
async function noOverflow(page) {
  expect(
    await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth + 1),
  ).toBeTruthy();
}
async function access(page) {
  const results = await new AxeBuilder({ page })
    .withTags(['wcag2a', 'wcag2aa', 'wcag21aa'])
    .analyze();
  expect(
    results.violations.map((v) => ({
      id: v.id,
      description: v.description,
      targets: v.nodes.map((n) => n.target),
    })),
  ).toEqual([]);
}
test('home, themes, rules, keyboard and form errors are accessible', async ({ page }, info) => {
  await page.goto('/');
  await expect(page.locator('#connection')).toBeHidden();
  await noOverflow(page);
  await access(page);
  await page.screenshot({ path: info.outputPath('home-light.png'), fullPage: true });
  await page.getByRole('button', { name: 'Gece temasını aç' }).click();
  await access(page);
  await noOverflow(page);
  await page.screenshot({ path: info.outputPath('home-dark.png'), fullPage: true });
  await page.getByRole('button', { name: 'Nasıl oynanır?' }).click();
  await expect(page.getByRole('dialog')).toBeVisible();
  await access(page);
  await page.getByRole('button', { name: 'Anlaştık!' }).click();
  await expect(page.getByRole('dialog')).toBeHidden();
  await page.getByRole('tab', { name: 'Odaya katıl' }).click();
  await page.getByLabel('Sana ne diyelim?').fill('Ziyaretçi');
  await page.getByLabel('Oda kodu', { exact: true }).fill('AAAAAA');
  await page.locator('#entry-submit').click();
  await expect(page.locator('#entry-error')).toContainText('Oda bulunamadı');
});
test('private drafts survive reload, counts and settings stay in sync', async ({ page }, info) => {
  await createRoom(page);
  await page.getByLabel('1. kelime veya ifade', { exact: true }).fill('Kırmızı başlıklı kız');
  await expect(page.locator('#pool-count')).toHaveText('1');
  await expect(page.locator('#draft-status')).toContainText('Kaydedildi');
  await page.reload();
  await expect(page.locator('#lobby-screen')).toBeVisible();
  await expect(page.getByLabel('1. kelime veya ifade', { exact: true })).toHaveValue(
    'Kırmızı başlıklı kız',
  );
  await page.locator('#setting-words').selectOption('7');
  await page.locator('#confirm-ok').click();
  await expect(page.locator('#word-inputs input')).toHaveCount(7);
  await expect(page.getByLabel('1. kelime veya ifade', { exact: true })).toHaveValue(
    'Kırmızı başlıklı kız',
  );
  await expect(page.locator('#pool-target')).toContainText('7');
  await noOverflow(page);
  await access(page);
  await page.screenshot({ path: info.outputPath('lobby.png'), fullPage: true });
});
test('five people: role privacy, challenge, countdown, reconnect and reset through real UI', async ({
  browser,
}, info) => {
  const contexts = [],
    pages = [],
    errors = [];
  try {
    const options = info.project.use;
    for (let i = 0; i < 5; i++) {
      const context = await browser.newContext({
        viewport: options.viewport,
        isMobile: options.isMobile,
        deviceScaleFactor: options.deviceScaleFactor,
        hasTouch: options.hasTouch,
      });
      contexts.push(context);
      const page = await context.newPage();
      page.on('pageerror', (e) => errors.push(e.message));
      pages.push(page);
    }
    const code = await createRoom(pages[0], 'Deniz');
    const names = ['Deniz', 'Ece', 'Mert', 'İpek', 'Can'];
    for (let i = 1; i < 5; i++) await joinRoom(pages[i], code, names[i], i % 2 ? 'blue' : 'red');
    for (let i = 0; i < 5; i++) await fillWords(pages[i], names[i]);
    await expect(pages[0].locator('#pool-count')).toHaveText('25');
    await expect(pages[0].locator('#start-game')).toBeEnabled();
    await pages[0].screenshot({ path: info.outputPath('five-player-lobby.png'), fullPage: true });
    await pages[0].locator('#start-game').click();
    for (const p of pages) await expect(p.locator('#game-screen')).toBeVisible();
    let narrator;
    for (let i = 0; i < 5; i++)
      if (await pages[i].getByRole('button', { name: 'Hazırım, kelimeyi çek' }).isVisible())
        narrator = i;
    expect(narrator).toBeDefined();
    await pages[narrator].getByRole('button', { name: 'Hazırım, kelimeyi çek' }).click();
    const opponent = narrator % 2 ? 0 : 1;
    const guesser = pages.find((_, i) => i !== narrator && i % 2 === narrator % 2);
    await expect(pages[opponent].locator('.word-card .word')).toBeVisible();
    const secret = await pages[narrator].locator('.word-card .word').textContent();
    await expect(guesser.locator('#play-content')).not.toContainText(secret);
    await expect(guesser.getByText('Kulaklar sende!')).toBeVisible();
    await noOverflow(pages[narrator]);
    await access(pages[narrator]);
    await access(pages[opponent]);
    await pages[narrator].screenshot({ path: info.outputPath('narrator.png'), fullPage: true });
    await pages[opponent].screenshot({ path: info.outputPath('referee.png'), fullPage: true });
    await pages[narrator].getByRole('button', { name: '✓ Bildiler!' }).click();
    await pages[opponent].getByRole('button', { name: 'Son doğruya itiraz', exact: true }).click();
    await expect(pages[0].getByText('Bir saniye, itiraz var.')).toBeVisible();
    await pages[0].getByRole('button', { name: 'İhlal var, sayılmasın' }).click();
    await expect(pages[0].locator('#score-red')).toHaveText('0');
    await expect(pages[0].locator('#score-blue')).toHaveText('0');
    await pages[0].getByRole('button', { name: 'Kaldığımız yerden devam' }).click();
    await expect(pages[narrator].getByRole('button', { name: '✓ Bildiler!' })).toBeVisible();
    await pages[narrator].reload();
    await expect(pages[narrator].getByText('Masa seni bekler.')).toBeVisible();
    let host;
    for (const p of pages)
      if (await p.getByRole('button', { name: 'Kaldığımız yerden devam' }).isVisible()) host = p;
    expect(host).toBeDefined();
    await host.getByRole('button', { name: 'Kaldığımız yerden devam' }).click();
    await expect(pages[narrator].getByRole('button', { name: '✓ Bildiler!' })).toBeVisible();
    await host.locator('#game-duration').selectOption('90');
    await expect(host.locator('#game-duration')).toHaveValue('90');
    await host.locator('#reset-game').click();
    await host.locator('#confirm-ok').click();
    for (const p of pages) await expect(p.locator('#lobby-screen')).toBeVisible();
    await expect(pages[0].locator('#pool-count')).toHaveText('0');
    await expect(pages[0].locator('#word-inputs input')).toHaveCount(5);
    expect(errors).toEqual([]);
  } finally {
    for (const context of contexts) await context.close();
  }
});
test('four complete phases end at 80 points and new game clears all screens', async ({
  browser,
}, info) => {
  test.setTimeout(100000);
  const contexts = [],
    pages = [];
  try {
    for (let i = 0; i < 4; i++) {
      const context = await browser.newContext({
        viewport: info.project.use.viewport,
        isMobile: info.project.use.isMobile,
        hasTouch: info.project.use.hasTouch,
      });
      contexts.push(context);
      pages.push(await context.newPage());
    }
    const code = await createRoom(pages[0], 'Ada');
    for (let i = 1; i < 4; i++) await joinRoom(pages[i], code, `Dost ${i}`, i % 2 ? 'blue' : 'red');
    for (let i = 0; i < 4; i++) await fillWords(pages[i], `Oyuncu ${i}`);
    await pages[0].locator('#start-game').click();
    for (const p of pages) await expect(p.locator('#game-screen')).toBeVisible();
    let narrator;
    for (const page of pages)
      if (await page.getByRole('button', { name: 'Hazırım, kelimeyi çek' }).isVisible())
        narrator = page;
    await narrator.getByRole('button', { name: 'Hazırım, kelimeyi çek' }).click();
    for (let phase = 1; phase <= 4; phase++) {
      for (let word = 0; word < 20; word++) {
        await narrator.getByRole('button', { name: '✓ Bildiler!' }).click();
        await expect(narrator.locator('#remaining-count')).toContainText(`${19 - word} / 20`);
      }
      if (phase < 4) {
        await expect(pages[0].getByRole('button', { name: 'Sonraki aşamaya geç' })).toBeEnabled();
        await pages[0].getByRole('button', { name: 'Sonraki aşamaya geç' }).click();
        await expect(narrator.getByRole('button', { name: '✓ Bildiler!' })).toBeVisible();
      }
    }
    await expect(pages[0].getByText('Aşama aşama puanlar', { exact: true })).toBeVisible();
    expect(
      Number(await pages[0].locator('#score-red').textContent()) +
        Number(await pages[0].locator('#score-blue').textContent()),
    ).toBe(80);
    await noOverflow(pages[0]);
    await access(pages[0]);
    await pages[0].screenshot({ path: info.outputPath('finished.png'), fullPage: true });
    await expect(pages[0].getByRole('button', { name: 'Yeni oyun, yeni kelimeler' })).toBeEnabled();
    await pages[0].getByRole('button', { name: 'Yeni oyun, yeni kelimeler' }).click();
    for (const p of pages) {
      await expect(p.locator('#lobby-screen')).toBeVisible();
      await expect(p.getByLabel('1. kelime veya ifade', { exact: true })).toHaveValue('');
    }
  } finally {
    for (const c of contexts) await c.close();
  }
});
