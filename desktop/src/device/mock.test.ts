import { afterEach, describe, expect, it, vi } from 'vitest';
import { createLibrary } from '../domain/scenes';
import { MockDevice } from './mock';

afterEach(() => vi.useRealTimers());
describe('mock lifecycle', () => {
  it('requires a connection and cancels an in-flight connection on disconnect', async () => {
    vi.useFakeTimers();
    const device = new MockDevice();
    await expect(device.activate(createLibrary().scenes[0])).rejects.toThrow('连接');
    const connecting = device.connect();
    device.disconnect();
    await vi.advanceTimersByTimeAsync(500); await connecting;
    expect(device.getSnapshot().connection).toBe('disconnected');
  });
  it('a second preview replaces the first and resets the three-second timer', async () => {
    vi.useFakeTimers();
    const device = new MockDevice();
    const connection = device.connect();
    await vi.advanceTimersByTimeAsync(450); await connection;
    const scene = createLibrary().scenes[0];
    await device.preview(scene, [0]);
    await vi.advanceTimersByTimeAsync(600);
    await device.preview(scene, [1]);
    expect(device.getSnapshot().preview?.points).toEqual([1]);
    await vi.advanceTimersByTimeAsync(2400);
    expect(device.getSnapshot().preview).not.toBeNull();
    await vi.advanceTimersByTimeAsync(600);
    expect(device.getSnapshot().preview).toBeNull();
  });
  it('playback retains its saved snapshot when the editor changes', async () => {
    vi.useFakeTimers();
    const device = new MockDevice();
    const connection = device.connect();
    await vi.advanceTimersByTimeAsync(450); await connection;
    const scene = createLibrary().scenes[0];
    await device.activate(scene);
    scene.name = 'modified';
    expect(device.getSnapshot().activeScene?.name).toBe('毁灭模式');
    device.disconnect();
    expect(device.getSnapshot().activeScene?.name).toBe('毁灭模式');
    expect(device.getSnapshot().preview).toBeNull();
  });
});
