const { withDangerousMod, withXcodeProject, withMainApplication, withAndroidManifest } = require('@expo/config-plugins');
const fs = require('fs');
const path = require('path');
const files = ['LeafMaterialView.swift', 'LeafMaterialView.m', 'LeafVoiceGuidance.swift', 'LeafVoiceGuidance.m'];

function registerVoicePackage(contents) {
  if (contents.includes('add(LeafVoiceGuidancePackage())')) return contents;
  const anchor = 'PackageList(this).packages.apply {';
  if (!contents.includes(anchor)) throw new Error('withLeafMaterial: registro de pacotes Android ausente');
  return contents.replace(anchor, `${anchor}\n              add(LeafVoiceGuidancePackage())`);
}

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
  config = withMainApplication(config, config => {
    config.modResults.contents = registerVoicePackage(config.modResults.contents);
    return config;
  });
  config = withDangerousMod(config, ['android', async config => {
    const destination = path.join(config.modRequest.platformProjectRoot, 'app/src/main/java/br/com/leaf/ride');
    fs.mkdirSync(destination, { recursive: true });
    for (const file of ['LeafVoiceGuidanceModule.java', 'LeafVoiceGuidancePackage.java']) {
      fs.copyFileSync(path.join(__dirname, '..', 'native/ui/android', file), path.join(destination, file));
    }
    return config;
  }]);
  config = withAndroidManifest(config, config => {
    const manifest = config.modResults.manifest;
    if (!manifest.queries?.length) manifest.queries = [{}];
    const queries = manifest.queries[0];
    queries.intent = queries.intent || [];
    if (!queries.intent.some(intent => intent.action?.some(action => action.$?.['android:name'] === 'android.intent.action.TTS_SERVICE'))) {
      queries.intent.push({ action: [{ $: { 'android:name': 'android.intent.action.TTS_SERVICE' } }] });
    }
    return config;
  });
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

module.exports.registerVoicePackage = registerVoicePackage;
