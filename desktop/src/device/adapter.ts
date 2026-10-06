import type { Scene } from '../domain/scenes';

export interface DeviceSnapshot {
  connection: 'disconnected' | 'connecting' | 'connected';
  activeScene: Scene | null;
  preview: { scene: Scene; points: number[] } | null;
}
export interface DeviceAdapter {
  readonly kind: 'mock';
  getSnapshot(): DeviceSnapshot;
  subscribe(listener: () => void): () => void;
  connect(): Promise<void>;
  disconnect(): void;
  activate(scene: Scene): Promise<void>;
  preview(scene: Scene, points: number[]): Promise<void>;
  stop(): void;
}
