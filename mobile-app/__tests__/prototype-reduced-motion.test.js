const fs = require('fs');
const path = require('path');

describe('Robotaxi reduced motion contract', () => {
  const transitionSource = fs.readFileSync(
    path.join(__dirname, '..', 'src', 'components', 'prototype', 'PrototypeScreenTransition.js'),
    'utf8',
  );
  const sheetSource = fs.readFileSync(
    path.join(__dirname, '..', 'src', 'components', 'prototype', 'PrototypeDismissibleSheet.js'),
    'utf8',
  );

  it('renders screen transitions without animation when reduced motion is enabled', () => {
    expect(transitionSource).toContain('useReducedMotion');
    expect(transitionSource).toContain('if (!animated || reduceMotion)');
  });

  it('opens and closes shared sheets immediately when reduced motion is enabled', () => {
    expect(sheetSource).toContain('const reduceMotion = useReducedMotion()');
    expect(sheetSource).toContain('if (reduceMotion)');
    expect(sheetSource).toContain('translateY.value = 0');
    expect(sheetSource).toContain('onClose?.()');
    expect(sheetSource).toContain('translateY.value = reduceMotion ? 0 : withSpring');
  });
});
