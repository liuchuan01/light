import { afterEach, describe, expect, it, vi } from 'vitest';
import { NativeDevice, type BleEvent, type BleStatus, type Bridge } from './native';
import { createLibrary } from '../domain/scenes';
const status: BleStatus = { connected: true, device: { id: 'one', name: '极梦匠', rssi: -50 }, inventory: { whole: [], local: [], advanced: [] }, logPath: '/logs/test.jsonl' };
function setup() {
  let handler: (event: BleEvent) => void = () => {};
  const invoke = vi.fn<Bridge['invoke']>().mockImplementation(async () => structuredClone(status) as never);
  const listen = vi.fn(async (next: typeof handler) => { handler = next; return () => {}; });
  const device = new NativeDevice({ invoke: async <T>(command: string, args?: Record<string, unknown>) => await invoke(command, args) as T, listen });
  return { device, invoke, listen, event: (event: BleEvent) => handler(event) };
}
afterEach(() => vi.useRealTimers());
describe('native BLE adapter', () => {
  it('requires explicit scan selection and installs events before connecting', async () => {
    const { device, invoke, listen } = setup();
    await expect(device.connect()).rejects.toThrow('选择'); expect(invoke).not.toHaveBeenCalled();
    await device.connect('one'); expect(listen).toHaveBeenCalledTimes(1);
    expect(invoke).toHaveBeenCalledWith('ble_connect', { id: 'one' });
    expect(device.getSnapshot().connection).toBe('connected');
  });
  it('does not optimistically report playback and rejects concurrent commands', async () => {
    const { device, invoke } = setup(); await device.connect('one');
    let resolve!: (value: BleStatus) => void;
    invoke.mockImplementationOnce(() => new Promise(r => { resolve = r as typeof resolve; }));
    const scene = createLibrary().scenes[0]; const work = device.activate(scene);
    await vi.waitFor(() => expect(invoke).toHaveBeenCalledWith('ble_activate', { scene }));
    expect(device.getSnapshot().activeScene).toBeNull(); expect(device.getSnapshot().busy).toBe(true);
    await expect(device.stop()).rejects.toThrow('进行中');
    resolve(status); await work; scene.name = 'changed';
    expect(device.getSnapshot().activeScene?.name).toBe('毁灭模式'); expect(device.getSnapshot().busy).toBe(false);
  });
  it('surfaces backend errors without retrying or faking a successful preview', async () => {
    const { device, invoke } = setup(); await device.connect('one'); invoke.mockRejectedValueOnce('等待设备响应超时');
    await expect(device.preview(createLibrary().scenes[0], [0])).rejects.toThrow('超时');
    expect(device.getSnapshot().preview).toBeNull(); expect(device.getSnapshot().busy).toBe(false);
    expect(invoke.mock.calls.filter(([cmd]) => cmd === 'ble_preview')).toHaveLength(1);
  });
  it('ignores a late success after a disconnect event', async () => {
    const { device, invoke, event } = setup(); await device.connect('one');
    let resolve!: (value: BleStatus) => void;
    invoke.mockImplementationOnce(() => new Promise(r => { resolve = r as typeof resolve; }));
    const work = device.activate(createLibrary().scenes[0]);
    await vi.waitFor(() => expect(invoke).toHaveBeenCalledTimes(2));
    event({ timestamp: Date.now(), kind: 'disconnected', message: '连接断开', hex: null }); resolve(status);
    await expect(work).rejects.toThrow('状态未确认');
    expect(device.getSnapshot().connection).toBe('disconnected'); expect(device.getSnapshot().activeScene).toBeNull(); expect(device.getSnapshot().inventory).toBeNull();
  });
  it('keeps the draft intact and clears the approximate preview indicator after three seconds', async () => {
    vi.useFakeTimers(); const { device, invoke } = setup(); await device.connect('one');
    const scene = createLibrary().scenes[0]; await device.preview(scene, [0, 1]); scene.light.color = '#000000';
    expect(device.getSnapshot().preview?.scene.light.color).toBe('#ff5267');
    await vi.advanceTimersByTimeAsync(3000); expect(device.getSnapshot().preview).toBeNull();
    expect(invoke.mock.calls.filter(([cmd]) => cmd === 'ble_stop')).toHaveLength(0);
  });
  it('bounds UI diagnostics while keeping errors visible', async () => {
    const { device, event } = setup(); await device.connect('one');
    for (let i = 0; i < 130; i++) event({ timestamp: i, kind: 'rx', message: String(i), hex: 'CC' });
    expect(device.getSnapshot().events).toHaveLength(100); expect(device.getSnapshot().events[0].message).toBe('30');
  });
});
