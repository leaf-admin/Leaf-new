const fs = require('fs');
const path = require('path');
const { parse } = require('@babel/parser');

const source = fs.readFileSync(path.join(__dirname, '../src/navigation/AppNavigator.js'), 'utf8');
const ast = parse(source, { sourceType: 'module', plugins: ['jsx'] });
const declarations = new Map();
const screens = [];
function visit(node) {
  if (!node || typeof node !== 'object') return;
  if (node.type === 'VariableDeclarator' && node.id.type === 'Identifier') declarations.set(node.id.name, node.init);
  if (node.type === 'JSXOpeningElement' && node.name.type === 'JSXMemberExpression' && node.name.object.name === 'Stack' && node.name.property.name === 'Screen') screens.push(node);
  Object.values(node).forEach(value => Array.isArray(value) ? value.forEach(visit) : value && typeof value === 'object' && visit(value));
}
visit(ast);
function resolve(node) {
  if (node.type === 'Identifier') return resolve(declarations.get(node.name));
  if (node.type === 'ObjectExpression') return Object.assign({}, ...node.properties.map(property => property.type === 'SpreadElement'
    ? resolve(property.argument) : { [property.key.name || property.key.value]: resolve(property.value) }));
  if (node.type === 'MemberExpression') return `${node.object.name}.${node.property.name}`;
  return node.value;
}

describe('root tab navigation surfaces', () => {
  it('uses the same flat, opaque, non-interactive transition for both home entries, account and activity', () => {
    const roots = screens.filter(screen => ['RobotaxiPrototype', 'RobotaxiPrototypeMenu', 'RobotaxiMenuTripHistory'].includes(screen.attributes.find(a => a.name?.name === 'name')?.value?.value));
    expect(roots).toHaveLength(4);
    roots.forEach(screen => {
      const options = screen.attributes.find(a => a.name?.name === 'options').value.expression;
      const usesRootOptions = options.type === 'Identifier'
        ? options.name === 'prototypeRootScreenOptions'
        : options.properties.some(p => p.type === 'SpreadElement' && p.argument.name === 'prototypeRootScreenOptions');
      expect(usesRootOptions).toBe(true);
      expect(resolve(options)).toEqual(expect.objectContaining({
        animationEnabled: false,
        cardStyleInterpolator: 'CardStyleInterpolators.forNoAnimation',
        gestureEnabled: false,
        cardOverlayEnabled: false,
        cardStyle: { backgroundColor: '#FFFFFF' },
        detachPreviousScreen: false,
      }));
    });
  });
});
