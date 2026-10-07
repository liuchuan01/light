import type { Scene } from '../domain/scenes';

export interface DeviceSnapshot {
  connection: 'disconnected' | 'connecting' | 'connected';
  activeScene: Scene | null;
  preview: { scene: Scene; points: number[] } | null;
}
export interface DeviceAdapter {
  readonly kind: 'mock' | 'ble';
  getSnapshot(): DeviceSnapshot;
  subscribe(listener: () => void): () => void;
  connect(id?: string): Promise<void>;
  disconnect(): void | Promise<void>;
  activate(scene: Scene): Promise<void>;
  preview(scene: Scene, points: number[]): Promise<void>;
  stop(): void | Promise<void>;
}
