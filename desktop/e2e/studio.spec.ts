import { test, expect } from '@playwright/test';

test('edit two points, replace one slot, and restore after reload', async ({ page }) => {
  await page.goto('/');
  await expect(page.getByRole('heading', { name: '让独角兽，亮出你的设定。' })).toBeVisible();
  await expect(page.locator('.scene-card')).toHaveCount(4);
  await page.getByRole('button', { name: '编辑当前场景' }).click();
  await page.getByLabel('场景名称', { exact: true }).fill('自定义双色');
  await page.getByRole('button', { name: '灯位 D1', exact: true }).click();
  await page.getByRole('button', { name: '灯位 D23', exact: true }).click();
  await page.getByRole('button', { name: '使用颜色 #66e6b2' }).click();
  await page.getByRole('button', { name: '保存场景', exact: true }).click();
  await page.getByRole('button', { name: '03 静谧深蓝' }).click();
  await page.getByRole('button', { name: '替换并保存' }).click();
  await expect(page.getByText('已保存到本机', { exact: true })).toBeVisible();
  const library = await page.evaluate(() => JSON.parse(localStorage.getItem('unicorn-light-studio.library.v1')!));
  expect(library.scenes[0].name).toBe('毁灭模式');
  expect(library.scenes[2].name).toBe('自定义双色');
  expect(library.scenes[2].points[0].color).toBe('#66e6b2');
  expect(library.scenes[2].points[22].color).toBe('#66e6b2');
  expect(library.scenes[2].points[1].color).toBe('#ff5267');
  await page.reload();
  await expect(page.locator('.scene-card')).toHaveCount(4);
  await expect(page.locator('.scene-card').filter({ hasText: '自定义双色' })).toBeVisible();
});

test('dirty navigation can be cancelled or discarded', async ({ page }) => {
  await page.goto('/');
  await page.getByRole('button', { name: '编辑当前场景' }).click();
  await page.getByLabel('场景名称', { exact: true }).fill('未保存');
  await page.getByRole('button', { name: '展示台', exact: true }).click();
  await expect(page.getByRole('dialog')).toBeVisible();
  await page.getByRole('button', { name: '继续编辑' }).click();
  await expect(page.getByLabel('场景名称', { exact: true })).toHaveValue('未保存');
  await page.getByRole('button', { name: '展示台', exact: true }).click();
  await page.getByRole('button', { name: '放弃修改' }).click();
  await expect(page.getByRole('heading', { name: '毁灭模式', exact: true })).toBeVisible();
});

test('mock connection, preview timeout, mixed selection and playback', async ({ page }) => {
  await page.goto('/');
  await expect(page.getByRole('button', { name: '模拟播放', exact: true })).toBeDisabled();
  await page.getByRole('button', { name: '连接模拟设备', exact: true }).click();
  await expect(page.getByRole('button', { name: '断开模拟设备', exact: true })).toBeVisible();
  await page.getByRole('button', { name: '模拟播放', exact: true }).click();
  await expect(page.locator('.playback-status')).toContainText('毁灭模式');
  await page.getByRole('button', { name: '编辑当前场景' }).click();
  await page.getByRole('button', { name: '灯位 D1', exact: true }).click();
  await page.getByRole('button', { name: '使用颜色 #66e6b2' }).click();
  await page.getByRole('button', { name: '模拟试灯 · 3 秒', exact: true }).click();
  await expect(page.locator('.point.testing')).toHaveCount(1);
  await expect(page.locator('.point.testing')).toHaveCount(0, { timeout: 5000 });
  await page.getByRole('button', { name: '灯位 D2', exact: true }).click();
  await expect(page.getByRole('button', { name: '模拟试灯 · 3 秒', exact: true })).toBeDisabled();
  await page.getByRole('button', { name: '停止模拟播放', exact: true }).click();
  await expect(page.locator('.playback-status')).toContainText('尚未播放');
});

test('corrupt local data is preserved until an explicit save creates a backup', async ({ page }) => {
  await page.addInitScript(() => {
    if (!localStorage.getItem('seeded')) {
      localStorage.setItem('unicorn-light-studio.library.v1', '{broken');
      localStorage.setItem('seeded', 'yes');
    }
  });
  await page.goto('/');
  await expect(page.getByRole('alert')).toContainText('无法读取');
  expect(await page.evaluate(() => localStorage.getItem('unicorn-light-studio.library.v1'))).toBe('{broken');
  await page.getByRole('button', { name: '编辑当前场景' }).click();
  await page.getByRole('button', { name: '保存场景', exact: true }).click();
  await page.getByRole('button', { name: '替换并保存' }).click();
  const hasBackup = await page.evaluate(() => Object.keys(localStorage).some(key => key.includes('.backup.') && localStorage.getItem(key) === '{broken'));
  expect(hasBackup).toBe(true);
  await expect(page.getByRole('alert')).toHaveCount(0);
});

test('preview remains usable at minimum desktop width without console errors', async ({ page }) => {
  const errors: string[] = [];
  page.on('pageerror', error => errors.push(error.message));
  await page.setViewportSize({ width: 800, height: 800 });
  await page.goto('/');
  await page.getByRole('button', { name: '编辑当前场景' }).click();
  await expect(page.getByLabel('场景名称', { exact: true })).toBeVisible();
  expect(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth)).toBe(true);
  expect(errors).toEqual([]);
});

test('keyboard save and JSON export preserve the saved library', async ({ page }, testInfo) => {
  await page.goto('/');
  await page.getByRole('button', { name: '编辑当前场景' }).click();
  await page.getByLabel('场景名称', { exact: true }).fill('快捷键保存');
  await page.keyboard.press('ControlOrMeta+s');
  await expect(page.getByRole('dialog')).toBeVisible();
  await page.getByRole('button', { name: '替换并保存' }).click();
  const downloadPromise = page.waitForEvent('download');
  await page.getByRole('button', { name: '导出已保存场景' }).click();
  const download = await downloadPromise;
  expect(download.suggestedFilename()).toBe('unicorn-scenes.json');
  const path = testInfo.outputPath('export.json');
  await download.saveAs(path);
  const { readFile } = await import('node:fs/promises');
  const data = JSON.parse(await readFile(path, 'utf8'));
  expect(data.scenes).toHaveLength(4);
  expect(data.scenes[0].name).toBe('快捷键保存');
});

test('SVG view switching, region selection, color and index selection stay linked', async ({ page }) => {
  await page.goto('/');
  await page.getByRole('button', { name: '编辑当前场景' }).click();
  await expect(page.locator('.model-region')).toHaveCount(18);
  await page.getByRole('button', { name: '背面 5', exact: true }).click();
  await expect(page.locator('.model-region')).toHaveCount(5);
  await page.locator('.model-label[data-point-id="D6"]').click();
  await expect(page.getByRole('button', { name: '灯位 D6', exact: true })).toHaveAttribute('aria-pressed', 'true');
  await expect(page.getByRole('button', { name: '灯位 D5', exact: true })).toHaveAttribute('aria-pressed', 'false');
  await page.getByRole('button', { name: '使用颜色 #66e6b2' }).click();
  await expect(page.locator('.model-region[data-point-id="D6"] .region-light')).toHaveCSS('fill', 'rgb(102, 230, 178)');
  await page.getByRole('button', { name: '正面 18', exact: true }).click();
  await page.locator('.model-label[data-point-id="D3"]').click();
  await page.getByRole('button', { name: '使用颜色 #6c9fff' }).click();
  await expect(page.locator('.model-region[data-point-id="D3"] .region-light')).toHaveCSS('fill', 'rgb(108, 159, 255)');
  await page.getByRole('button', { name: '背面 5', exact: true }).click();
  await expect(page.locator('.model-region[data-point-id="D6"] .region-light')).toHaveCSS('fill', 'rgb(108, 159, 255)');
  await page.getByRole('button', { name: '显示灯位编号', exact: true }).click();
  await expect(page.locator('.model-label')).toHaveCount(0);
});

test('SVG regions support keyboard selection and grid navigates to rear points', async ({ page }) => {
  await page.goto('/');
  await page.getByRole('button', { name: '编辑当前场景' }).click();
  await page.getByRole('button', { name: 'D3 右胸', exact: true }).focus();
  await page.keyboard.press('Enter');
  await expect(page.getByRole('button', { name: '灯位 D3', exact: true })).toHaveAttribute('aria-pressed', 'true');
  await expect(page.getByRole('button', { name: '灯位 D4', exact: true })).toHaveAttribute('aria-pressed', 'false');
  await page.getByRole('button', { name: '灯位 D13', exact: true }).click();
  await expect(page.getByRole('button', { name: '背面 5', exact: true })).toHaveAttribute('aria-pressed', 'true');
  await expect(page.getByRole('button', { name: 'D13 背部', exact: true })).toHaveAttribute('aria-pressed', 'true');
});
