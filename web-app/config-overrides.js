const path = require('path')
const { override, babelInclude, addBabelPlugin, addBabelPreset } = require('customize-cra')

module.exports = function (config, env) {
  return Object.assign(
    config,
    override(
      babelInclude([
        /* transpile (converting to es5) code in src/ and shared component library */
        path.resolve('src'),
        path.resolve('../node_modules/@react-native-async-storage/async-storage')
      ]),
      addBabelPlugin('@babel/plugin-proposal-nullish-coalescing-operator'),
      addBabelPlugin('@babel/plugin-proposal-optional-chaining'),
      addBabelPreset(['@babel/preset-env', {
        targets: {
          node: 'current',
          browsers: [">0.2%", "not dead", "not op_mini all"]
        },
        useBuiltIns: 'usage',
        corejs: 3
      }])
    )(config, env)
  )
}