import { test, expect } from '@playwright/test';

test('desktop BLE flow scans, reads, writes and reports failures without claiming success', async ({ page }) => {
  await page.addInitScript(() => {
    const root = window as unknown as Record<string, unknown>;
    root.isTauri = true;
    const calls: { command: string; args: Record<string, unknown> }[] = [];
    root.bleCalls = calls;
    let connected = false;
    let enabled = false;
    let fail = false;
    root.failNextWrite = () => { fail = true; };
    const callbacks = new Map<number, (value: unknown) => void>();
    let sequence = 0;
    const status = () => ({ connected, device: connected ? { id: 'test-device', name: '极梦匠', rssi: -42 } : null, logPath: '/test/ble.jsonl', inventory: connected ? { whole: [{ slot: 0, enabled, colorType: 0, light: { color: '#ff0000', brightness: 10, effect: 0 }, direction: 0, speed: 0 }], local: [], advanced: [] } : null });
    root.__TAURI_INTERNALS__ = {
      transformCallback: (callback: (value: unknown) => void) => { callbacks.set(++sequence, callback); return sequence; },
      invoke: async (command: string, args: Record<string, unknown> = {}) => {
        calls.push({ command, args });
        if (command === 'runtime_info') return { label: 'Mac 桌面', device_mode: 'ble' };
        if (command === 'plugin:event|listen') return 1;
        if (command === 'ble_scan') return [{ id: 'test-device', name: '极梦匠', rssi: -42 }];
        if (command === 'ble_connect') { connected = true; return status(); }
        if (command === 'ble_status' || command === 'ble_refresh') return status();
        if (command === 'ble_activate') {
          if (fail) { fail = false; throw '保存后详情与请求不一致'; }
          enabled = true; return status();
        }
        if (command === 'ble_stop') { enabled = false; return status(); }
        if (command === 'ble_disconnect') { connected = false; return; }
        if (command === 'ble_preview') return;
        throw new Error(`Unexpected IPC ${command}`);
      },
    };
  });
  await page.goto('/');
  await expect(page.getByRole('button', { name: '写入并播放', exact: true })).toBeDisabled();
  await page.getByRole('button', { name: '扫描蓝牙灯组' }).click();
  await page.getByRole('button', { name: /极梦匠.*test-device/ }).click();
  await expect(page.getByText('全身 1 / 4 · 局部 0 / 14 · 组合 0 / 4')).toBeVisible();
  await page.getByRole('button', { name: '关闭对话框' }).click();
  await page.getByRole('button', { name: '写入并播放', exact: true }).click();
  await expect(page.locator('.playback-status')).toContainText('设备已开启：毁灭模式');
  await page.getByRole('button', { name: '停止设备播放' }).click();
  await expect(page.locator('.playback-status')).not.toContainText('设备已开启');
  await page.evaluate(() => (window as unknown as { failNextWrite(): void }).failNextWrite());
  await page.getByRole('button', { name: '写入并播放', exact: true }).click();
  await expect(page.locator('.toast')).toContainText('保存后详情与请求不一致');
  await expect(page.locator('.playback-status')).not.toContainText('设备已开启');
  const calls = await page.evaluate(() => (window as unknown as { bleCalls: { command: string; args: { scene?: { id: string } } }[] }).bleCalls);
  expect(calls.filter(call => call.command === 'ble_activate')).toHaveLength(2);
  expect(calls.find(call => call.command === 'ble_activate')?.args.scene?.id).toBe('scene-1');
  await page.getByRole('button', { name: '模拟', exact: true }).click();
  expect((await page.evaluate(() => (window as unknown as { bleCalls: { command: string }[] }).bleCalls)).filter(call => call.command === 'ble_disconnect')).toHaveLength(1);
  await expect(page.getByRole('button', { name: '连接模拟设备', exact: true })).toBeVisible();
});
