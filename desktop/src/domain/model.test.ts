import { describe, expect, it } from 'vitest';
import { readFileSync } from 'node:fs';
import { MODEL_POINTS, MODEL_REGIONS, MODEL_VIEWS } from './model';
import { POINT_IDS } from './scenes';

describe('source-grounded model map', () => {
  it('maps every physical D label exactly once across the two views', () => {
    expect(MODEL_REGIONS.map(point => point.id)).toEqual(POINT_IDS);
    expect(new Set(MODEL_REGIONS.map(point => point.id)).size).toBe(23);
    expect(MODEL_REGIONS.filter(point => point.view === 'front')).toHaveLength(18);
    expect(MODEL_REGIONS.filter(point => point.view === 'back').map(point => point.id)).toEqual(['D6', 'D8', 'D10', 'D12', 'D13']);
    MODEL_POINTS.forEach((point, index) => expect(point.protocolIndex).toBe(index));
  });
  it('keeps clickable markers in their view and exposes schematic geometry', () => {
    for (const point of MODEL_REGIONS) {
      const [x, y, width, height] = MODEL_VIEWS[point.view].viewBox.split(' ').map(Number);
      expect(point.label[0] - 23).toBeGreaterThanOrEqual(x);
      expect(point.label[0] + 23).toBeLessThanOrEqual(x + width);
      expect(point.label[1] - 13).toBeGreaterThanOrEqual(y);
      expect(point.label[1] + 13).toBeLessThanOrEqual(y + height);
      expect(point.path.startsWith('M')).toBe(true);
    }
    expect(MODEL_REGIONS.filter(point => point.geometry === 'schematic').map(point => point.id)).toEqual(['D1', 'D14']);
  });
  it('ships real vector geometry instead of wrapping the PNG in SVG', () => {
    const svg = readFileSync(new URL('../assets/unicorn-linework.svg', import.meta.url), 'utf8');
    expect(svg).toContain('<path');
    expect(svg).not.toMatch(/<image|data:image|\.png["']/);
    const review = readFileSync(new URL('../../../docs/unicorn-map.svg', import.meta.url), 'utf8');
    POINT_IDS.forEach(id => expect(review).toContain(`id="${id}"`));
  });
});
