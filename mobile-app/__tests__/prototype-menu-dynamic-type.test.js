const fs = require('fs');
const path = require('path');

describe('Prototype menu Dynamic Type geometry', () => {
  const source = fs.readFileSync(
    path.join(__dirname, '..', 'src', 'components', 'prototype', 'PrototypeMenuSurface.js'),
    'utf8',
  );

  it('caps text growth without disabling font scaling', () => {
    expect(source).toContain('const TEXT_SCALE_CAP = 1.35');
    expect(source).toContain('maxFontSizeMultiplier={TEXT_SCALE_CAP}');
    expect(source).not.toContain('allowFontScaling={false}');
  });

  it('applies the cap to titles, subtitles, rows, badges and stats', () => {
    const cappedTextCount = (source.match(/maxFontSizeMultiplier=\{TEXT_SCALE_CAP\}/g) || []).length;
    expect(cappedTextCount).toBeGreaterThanOrEqual(12);
  });
});
