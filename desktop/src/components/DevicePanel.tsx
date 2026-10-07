import { useState, useSyncExternalStore } from 'react';
import { isTauri } from '@tauri-apps/api/core';
import { Bluetooth, Plus, Unplug } from 'lucide-react';
import Dialog from './Dialog';
import type { DeviceAdapter, DeviceSnapshot } from '../device/adapter';
import { nativeDevice } from '../device/native';

export default function DevicePanel({ device, snapshot, mode, onMode, run }: {
  device: DeviceAdapter; snapshot: DeviceSnapshot; mode: 'mock' | 'ble';
  onMode: (mode: 'mock' | 'ble') => Promise<void>;
  run: (action: () => void | Promise<void>, message?: string) => Promise<void>;
}) {
  const native = useSyncExternalStore(nativeDevice.subscribe, nativeDevice.getSnapshot);
  const [open, setOpen] = useState(false);
  const connected = snapshot.connection === 'connected';
  const busy = native.busy || snapshot.connection === 'connecting';
  const real = mode === 'ble';
  return <>
    <div className="device-card">
      <div className="segmented device-mode" aria-label="设备模式">
        <button aria-pressed={real} className={real ? 'active' : ''} disabled={!isTauri() || busy} onClick={() => run(() => onMode('ble'))}>真实灯组</button>
        <button aria-pressed={!real} className={!real ? 'active' : ''} disabled={busy} onClick={() => run(() => onMode('mock'))}>模拟</button>
      </div>
      <div className="device-title"><Bluetooth size={17} /><span>{real ? '极梦匠灯组' : '模拟灯组'}</span><span className={`connection-dot ${connected ? 'connected' : ''}`} /></div>
      <p>{busy ? '正在与灯组通信…' : connected ? real ? '蓝牙已连接 · 预设已读取' : '23 个灯位 · 模拟连接正常' : '离线编辑随时可用'}</p>
      <button className="connect-button" disabled={busy} onClick={() => run(async () => {
        if (connected) await device.disconnect();
        else if (real) { setOpen(true); await nativeDevice.scan(); }
        else await device.connect();
      })}>{connected ? <Unplug size={14} /> : <Plus size={14} />}{connected ? real ? '断开灯组' : '断开模拟设备' : snapshot.connection === 'connecting' ? '正在连接…' : real ? '扫描蓝牙灯组' : '连接模拟设备'}</button>
      {real ? <button className="button text full" onClick={() => setOpen(true)}>设备与通信记录</button> : !isTauri() && <p>真实蓝牙连接请在 Mac 桌面应用中使用</p>}
      {real && native.error && <p className="device-error" role="alert">{native.error}</p>}
    </div>
    {open && <Dialog title="蓝牙灯组" onClose={() => setOpen(false)}>
      <p className="dialog-description">选择附近的极梦匠灯组。连接后读取设备预设；场景仍由本机场景库管理。</p>
      <div className="dialog-actions"><button className="button secondary" disabled={busy || connected} onClick={() => run(nativeDevice.scan)}>重新扫描</button><button className="button secondary" disabled={busy || !connected} onClick={() => run(nativeDevice.refresh)}>刷新设备预设</button></div>
      {busy && <p role="status">正在通信，请稍候…</p>}
      {!connected && !busy && !native.devices.length && <p>未找到灯组。请检查电源、蓝牙权限，并断开手机 App 的连接后重试。</p>}
      {!connected && native.devices.map(found => <button className="ble-device" key={found.id} disabled={busy} onClick={() => run(async () => { await nativeDevice.connect(found.id); })}><strong>{found.name}</strong><span>{found.id}</span><small>{found.rssi === null ? '信号未知' : `${found.rssi} dBm`} · 连接</small></button>)}
      {native.error && <p className="device-error" role="alert">{native.error}</p>}
      {native.inventory && <div className="device-inventory"><h3>设备预设</h3><p>全身 {native.inventory.whole.length} / 4 · 局部 {native.inventory.local.length} / 14 · 组合 {native.inventory.advanced.length} / 4</p><p>设备返回的开启项：{[...native.inventory.whole.filter(p => p.enabled).map(p => `全身 ${p.slot + 1}`), ...native.inventory.advanced.filter(p => p.enabled).map(p => `组合 ${p.slot + 1}`)].join('、') || '无'}</p><details><summary>查看原始预设详情</summary><pre>{JSON.stringify(native.inventory, null, 2)}</pre></details></div>}
      <details className="ble-log"><summary>通信记录（最近 100 条）</summary><p>完整日志：{native.logPath || '连接或扫描完成后显示'}</p><pre>{native.events.map(event => `${new Date(event.timestamp).toLocaleTimeString()} ${event.kind.toUpperCase()} ${event.message}${event.hex ? `\n${event.hex}` : ''}`).join('\n')}</pre></details>
      <p className="field-note">通信响应和预设回读用于判断写入结果；实际发光效果以模型为准。断开蓝牙不会自动关闭已保存灯效。</p>
    </Dialog>}
  </>;
}
