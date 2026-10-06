import { copyScene, type Scene } from '../domain/scenes';
import type { DeviceAdapter, DeviceSnapshot } from './adapter';

export class MockDevice implements DeviceAdapter {
  readonly kind = 'mock' as const;
  private snapshot: DeviceSnapshot = { connection: 'disconnected', activeScene: null, preview: null };
  private listeners = new Set<() => void>();
  private previewTimer: ReturnType<typeof setTimeout> | undefined;
  private connectionAttempt = 0;
  getSnapshot = () => this.snapshot;
  subscribe = (listener: () => void) => { this.listeners.add(listener); return () => { this.listeners.delete(listener); }; };
  private update(patch: Partial<DeviceSnapshot>) {
    this.snapshot = { ...this.snapshot, ...patch };
    this.listeners.forEach(listener => listener());
  }
  async connect() {
    if (this.snapshot.connection !== 'disconnected') return;
    const attempt = ++this.connectionAttempt;
    this.update({ connection: 'connecting' });
    await new Promise(resolve => setTimeout(resolve, 450));
    if (attempt === this.connectionAttempt) this.update({ connection: 'connected' });
  }
  disconnect() {
    ++this.connectionAttempt;
    clearTimeout(this.previewTimer);
    this.update({ connection: 'disconnected', preview: null });
  }
  private requireConnection() {
    if (this.snapshot.connection !== 'connected') throw new Error('请先连接模拟设备。');
  }
  async activate(scene: Scene) {
    this.requireConnection();
    clearTimeout(this.previewTimer);
    this.update({ activeScene: copyScene(scene), preview: null });
  }
  async preview(scene: Scene, points: number[]) {
    this.requireConnection();
    if (!points.length) throw new Error('请先选择要试灯的灯位。');
    clearTimeout(this.previewTimer);
    this.update({ preview: { scene: copyScene(scene), points: [...points] } });
    // UI simulation only. Restoring activeScene after a preview is not a firmware claim.
    this.previewTimer = setTimeout(() => this.update({ preview: null }), 3000);
  }
  stop() {
    this.requireConnection();
    clearTimeout(this.previewTimer);
    this.update({ activeScene: null, preview: null });
  }
}
export const device = new MockDevice();
