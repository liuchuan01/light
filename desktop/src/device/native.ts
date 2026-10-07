import { invoke } from '@tauri-apps/api/core';
import { listen } from '@tauri-apps/api/event';
import { copyScene, type Scene, type LightSetting } from '../domain/scenes';
import type { DeviceAdapter, DeviceSnapshot } from './adapter';
export interface FoundDevice { id: string; name: string; rssi: number | null }
export interface BleEvent { timestamp: number; kind: string; message: string; hex: string | null }
export interface Inventory {
  whole: { slot: number; enabled: boolean; colorType: number; light: LightSetting; direction: number; speed: number }[];
  local: { slot: number; points: number[]; colorType: number; light: LightSetting }[];
  advanced: { slot: number; enabled: boolean; locals: number[]; mode: number; direction: number; speed: number; step: number; orders: { index: number; locals: number[] }[] }[];
}
export interface BleStatus { connected: boolean; device: FoundDevice | null; inventory: Inventory | null; logPath: string }
export interface NativeSnapshot extends DeviceSnapshot {
  busy: boolean; devices: FoundDevice[]; inventory: Inventory | null; events: BleEvent[]; logPath: string; error: string;
}
export interface Bridge {
  invoke<T>(command: string, args?: Record<string, unknown>): Promise<T>;
  listen(handler: (event: BleEvent) => void): Promise<() => void>;
}
const defaultBridge: Bridge = { invoke, listen: handler => listen<BleEvent>('ble:event', event => handler(event.payload)) };
export class NativeDevice implements DeviceAdapter {
  readonly kind = 'ble' as const;
  private snapshot: NativeSnapshot = { connection: 'disconnected', activeScene: null, preview: null, busy: false, devices: [], inventory: null, events: [], logPath: '', error: '' };
  private listeners = new Set<() => void>();
  private listening: Promise<void> | undefined;
  private previewTimer: ReturnType<typeof setTimeout> | undefined;
  private disconnectVersion = 0;
  constructor(private bridge: Bridge = defaultBridge) {}
  getSnapshot = () => this.snapshot;
  subscribe = (listener: () => void) => { this.listeners.add(listener); return () => { this.listeners.delete(listener); }; };
  private update(patch: Partial<NativeSnapshot>) { this.snapshot = { ...this.snapshot, ...patch }; this.listeners.forEach(listener => listener()); }
  private clearPlayback() { clearTimeout(this.previewTimer); this.update({ activeScene: null, preview: null }); }
  private async initialize() {
    this.listening ??= this.bridge.listen(event => {
      this.update({ events: [...this.snapshot.events.slice(-99), event] });
      if (event.kind === 'disconnected') {
        this.disconnectVersion++; this.clearPlayback();
        this.update({ connection: 'disconnected', inventory: null, error: event.message });
      }
    }).then(() => undefined).catch(error => { this.listening = undefined; throw error; });
    await this.listening;
  }
  private async operation<T>(action: () => Promise<T>): Promise<T> {
    if (this.snapshot.busy) throw new Error('设备操作进行中，请稍候。');
    this.update({ busy: true, error: '' });
    try { await this.initialize(); return await action(); }
    catch (error) {
      const message = error instanceof Error ? error.message : String(error);
      this.update({ error: message }); throw new Error(message);
    } finally { this.update({ busy: false }); }
  }
  private status(status: BleStatus) {
    this.update({ connection: status.connected ? 'connected' : 'disconnected', inventory: status.inventory, logPath: status.logPath });
    if (!status.connected) this.clearPlayback();
  }
  private requireConnection() { if (this.snapshot.connection !== 'connected') throw new Error('请先连接真实灯组。'); }
  scan = () => this.operation(async () => {
    this.update({ devices: [] });
    this.status(await this.bridge.invoke<BleStatus>('ble_status'));
    const devices = await this.bridge.invoke<FoundDevice[]>('ble_scan');
    this.update({ devices });
    this.status(await this.bridge.invoke<BleStatus>('ble_status'));
  });
  connect = (id?: string) => this.operation(async () => {
    if (!id) throw new Error('请先扫描并选择一台灯组。');
    this.update({ connection: 'connecting' });
    try { this.status(await this.bridge.invoke<BleStatus>('ble_connect', { id })); }
    catch (error) { this.update({ connection: 'disconnected', inventory: null }); throw error; }
  });
  disconnect = () => this.operation(async () => {
    await this.bridge.invoke('ble_disconnect'); this.clearPlayback(); this.update({ connection: 'disconnected', inventory: null });
  });
  refresh = () => this.operation(async () => { this.requireConnection(); this.status(await this.bridge.invoke<BleStatus>('ble_refresh')); this.clearPlayback(); });
  activate = (scene: Scene) => this.operation(async () => {
    this.requireConnection(); const captured = copyScene(scene); const version = this.disconnectVersion;
    const status = await this.bridge.invoke<BleStatus>('ble_activate', { scene: captured });
    if (version !== this.disconnectVersion || !status.connected) throw new Error('连接已断开，播放状态未确认，请重连读取。');
    this.status(status); this.clearPlayback(); this.update({ activeScene: captured });
  });
  preview = (scene: Scene, points: number[]) => this.operation(async () => {
    this.requireConnection(); const captured = copyScene(scene); const selected = [...points]; const version = this.disconnectVersion;
    await this.bridge.invoke('ble_preview', { scene: captured, points: selected });
    if (version !== this.disconnectVersion) throw new Error('连接已断开，试灯状态未确认。');
    clearTimeout(this.previewTimer); this.update({ activeScene: null, preview: { scene: captured, points: selected } });
    this.previewTimer = setTimeout(() => this.update({ preview: null }), 3000);
  });
  stop = () => this.operation(async () => {
    this.requireConnection(); const version = this.disconnectVersion;
    const status = await this.bridge.invoke<BleStatus>('ble_stop');
    if (version !== this.disconnectVersion || !status.connected) throw new Error('连接已断开，停止状态未确认。');
    this.status(status); this.clearPlayback();
  });
}
export const nativeDevice = new NativeDevice();
