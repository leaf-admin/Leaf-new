const { withDangerousMod, withXcodeProject } = require('@expo/config-plugins');
const fs = require('fs');
const path = require('path');
const files = ['LeafMaterialView.swift', 'LeafMaterialView.m'];

// Use the exact source images from the approved Swift reference. The native
// TabView prepares its 32 pt thumbnails with the same UIKit renderer as the lab.
function copyTabImages(platformRoot) {
  const sources = { leafNavHome: 'leafAHome', leafNavActivity: 'leafAActivity', leafNavAccount: 'leafAAccount' };
  Object.entries(sources).forEach(([name, source]) => {
    const destination = path.join(platformRoot, 'Leaf', 'Images.xcassets', name + '.imageset');
    fs.mkdirSync(destination, { recursive: true });
    const filename = source + '.png';
    fs.copyFileSync(path.join(__dirname, '..', 'assets', 'leaf-ui', filename), path.join(destination, filename));
    const images = [{ idiom: 'universal', filename }];
    fs.writeFileSync(path.join(destination, 'Contents.json'), JSON.stringify({ images, info: { version: 1, author: 'xcode' } }, null, 2) + '\n');
  });
}

module.exports = function withLeafMaterial(config) {
  config = withDangerousMod(config, ['ios', async config => {
    const destination = path.join(config.modRequest.platformProjectRoot, 'Leaf');
    fs.mkdirSync(destination, { recursive: true });
    files.forEach(file => fs.copyFileSync(path.join(__dirname, '..', 'native', 'ui', 'ios', file), path.join(destination, file)));
    copyTabImages(config.modRequest.platformProjectRoot);
    return config;
  }]);
  return withXcodeProject(config, config => {
    const project = config.modResults;
    const target = project.getFirstTarget().uuid;
    const group = project.findPBXGroupKey({ name: 'Leaf' });
    if (!group) throw new Error('withLeafMaterial: grupo Leaf ausente');
    files.forEach(file => {
      const source = 'Leaf/' + file;
      if (!project.hasFile(source)) project.addSourceFile(source, { target }, group);
    });
    return config;
  });
};
