export const POINT_IDS = Array.from({ length: 23 }, (_, index) => `D${index + 1}`);
export const SCENE_IDS = ['scene-1', 'scene-2', 'scene-3', 'scene-4'] as const;
export type SceneId = typeof SCENE_IDS[number];

export const EFFECTS = [
  '常亮', '单色呼吸', '彩色呼吸', '单向跑马', '往返跑马', '环形跑马',
  '流光', '彩虹流光', '彩虹循环', '彩虹渐变', '波浪',
] as const;

export interface LightSetting { color: string; brightness: number; effect: number }
export interface Scene {
  id: SceneId;
  name: string;
  scope: 'whole' | 'points';
  light: LightSetting;
  points: LightSetting[];
  direction: 0 | 1;
  speed: number;
}
export interface SceneLibrary { version: 1; scenes: Scene[] }

export function createLibrary(): SceneLibrary {
  const names = ['毁灭模式', '觉醒时刻', '静谧深蓝', '暖光陈列'];
  const colors = ['#ff5267', '#66e6b2', '#6c9fff', '#ffc580'];
  return { version: 1, scenes: SCENE_IDS.map((id, index) => {
    const light = { color: colors[index], brightness: 10, effect: index === 1 ? 1 : 0 };
    return { id, name: names[index], scope: 'whole', light,
      points: POINT_IDS.map(() => ({ ...light })), direction: 0, speed: 0 };
  }) };
}

export function copyScene(scene: Scene): Scene { return structuredClone(scene); }
export function effectiveLights(scene: Scene): LightSetting[] {
  return scene.scope === 'whole' ? POINT_IDS.map(() => scene.light) : scene.points;
}
export function groupCount(scene: Scene): number {
  return new Set(effectiveLights(scene).map(light => `${light.color.toLowerCase()}/${light.brightness}/${light.effect}`)).size;
}

export function changeScope(scene: Scene, scope: Scene['scope']): Scene {
  if (scope === scene.scope) return scene;
  return scope === 'points'
    ? { ...scene, scope, points: POINT_IDS.map(() => ({ ...scene.light, effect: scene.light.effect <= 2 ? scene.light.effect : 0 })) }
    : { ...scene, scope };
}

export function patchLights(scene: Scene, selected: number[], patch: Partial<LightSetting>): Scene {
  if (scene.scope === 'whole') return { ...scene, light: { ...scene.light, ...patch } };
  return { ...scene, points: scene.points.map((light, index) => selected.includes(index) ? { ...light, ...patch } : light) };
}

export function replaceScene(library: SceneLibrary, target: SceneId, draft: Scene): SceneLibrary {
  return { version: 1, scenes: library.scenes.map(scene => scene.id === target ? { ...copyScene(draft), id: target } : scene) };
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null;
}
function validLight(value: unknown, maxEffect: number): value is LightSetting {
  return isRecord(value) && typeof value.color === 'string' && /^#[\da-f]{6}$/i.test(value.color)
    && Number.isInteger(value.brightness) && Number(value.brightness) >= 1 && Number(value.brightness) <= 10
    && Number.isInteger(value.effect) && Number(value.effect) >= 0 && Number(value.effect) <= maxEffect;
}
export function parseLibrary(raw: string): SceneLibrary {
  const value: unknown = JSON.parse(raw);
  if (!isRecord(value) || value.version !== 1 || !Array.isArray(value.scenes) || value.scenes.length !== 4)
    throw new Error('场景文件格式不正确。');
  const scenes: Scene[] = value.scenes.map((scene, index) => {
    if (!isRecord(scene) || scene.id !== SCENE_IDS[index]
      || typeof scene.name !== 'string' || !scene.name.trim() || scene.name.length > 24
      || !['whole', 'points'].includes(String(scene.scope)) || !validLight(scene.light, 10)
      || !Array.isArray(scene.points) || scene.points.length !== 23 || !scene.points.every(light => validLight(light, 2))
      || ![0, 1].includes(Number(scene.direction)) || typeof scene.direction !== 'number'
      || !Number.isInteger(scene.speed) || Number(scene.speed) < 0 || Number(scene.speed) > 100)
      throw new Error('场景数据不完整，原文件已保留。');
    return { id: SCENE_IDS[index], name: scene.name, scope: scene.scope as Scene['scope'],
      light: { ...scene.light }, points: scene.points.map(light => ({ ...light })),
      direction: scene.direction as 0 | 1, speed: Number(scene.speed) };
  });
  return { version: 1, scenes };
}

export const STORAGE_KEY = 'unicorn-light-studio.library.v1';
export function loadLibrary(storage: Pick<Storage, 'getItem'>): { library: SceneLibrary; error?: string } {
  try {
    const raw = storage.getItem(STORAGE_KEY);
    return { library: raw ? parseLibrary(raw) : createLibrary() };
  } catch {
    return { library: createLibrary(), error: '本地场景无法读取，暂时显示示例。原数据尚未覆盖；下次保存会先备份原数据。' };
  }
}
