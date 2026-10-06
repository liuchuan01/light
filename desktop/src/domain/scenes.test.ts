import { describe, expect, it } from 'vitest';
import { changeScope, copyScene, createLibrary, effectiveLights, groupCount, loadLibrary,
  parseLibrary, patchLights, replaceScene, STORAGE_KEY } from './scenes';

describe('scene editing and persistence', () => {
  it('edits selected points without changing saved scenes or other points', () => {
    const library = createLibrary();
    const original = JSON.stringify(library);
    const draft = changeScope(copyScene(library.scenes[0]), 'points');
    const edited = patchLights(draft, [0, 22], { color: '#00ff00' });
    expect(effectiveLights(edited)[0].color).toBe('#00ff00');
    expect(effectiveLights(edited)[22].color).toBe('#00ff00');
    expect(effectiveLights(edited)[1].color).toBe('#ff5267');
    expect(groupCount(edited)).toBe(2);
    expect(JSON.stringify(library)).toBe(original);
  });
  it('replaces exactly one destination and does not alias the editor draft', () => {
    const library = createLibrary();
    const draft = { ...copyScene(library.scenes[0]), name: '新场景' };
    const next = replaceScene(library, 'scene-3', draft);
    draft.points[0].color = '#abcdef';
    expect(next.scenes[2].id).toBe('scene-3');
    expect(next.scenes[2].name).toBe('新场景');
    expect(next.scenes[2].points[0].color).toBe('#ff5267');
    expect(next.scenes[0]).toEqual(library.scenes[0]);
    expect(next.scenes[1]).toEqual(library.scenes[1]);
    expect(next.scenes[3]).toEqual(library.scenes[3]);
  });
  it('round trips all four scenes and rejects invalid storage', () => {
    const library = createLibrary();
    expect(parseLibrary(JSON.stringify(library))).toEqual(library);
    for (const mutation of [
      (value: typeof library) => { value.scenes.pop(); },
      (value: typeof library) => { value.scenes[0].points.pop(); },
      (value: typeof library) => { value.scenes[0].light.brightness = 100; },
      (value: typeof library) => { value.scenes[0].points[0].effect = 9; },
      (value: typeof library) => { value.scenes[0].name = ' '; },
      (value: typeof library) => { value.scenes[1].id = 'scene-1'; },
    ]) {
      const invalid = structuredClone(library); mutation(invalid);
      expect(() => parseLibrary(JSON.stringify(invalid))).toThrow();
    }
    const storage = { getItem: (key: string) => key === STORAGE_KEY ? '{broken' : null };
    const loaded = loadLibrary(storage);
    expect(loaded.error).toBeTruthy();
    expect(loaded.library.scenes).toHaveLength(4);
    expect(storage.getItem(STORAGE_KEY)).toBe('{broken');
  });
  it('does not carry whole-body-only effects into local groups', () => {
    const scene = createLibrary().scenes[0];
    scene.light.effect = 7;
    expect(changeScope(scene, 'points').points.every(light => light.effect === 0)).toBe(true);
  });
});
