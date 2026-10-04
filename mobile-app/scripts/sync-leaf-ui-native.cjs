const fs = require('fs');
const path = require('path');
const { registerVoicePackage, normalizeAndroidResourceLocales } = require('../plugins/withLeafMaterial');
const root = path.resolve(__dirname, '..');

function writeIfChanged(destination, contents) {
  if (fs.existsSync(destination) && fs.readFileSync(destination).equals(Buffer.from(contents))) return;
  fs.mkdirSync(path.dirname(destination), { recursive: true });
  fs.writeFileSync(destination, contents);
}

function syncNativeUi(platform, projectRoot = root) {
  if (!['ios', 'android'].includes(platform)) throw new Error('Use ios ou android para sincronizar a UI nativa.');
  const source = path.join(projectRoot, 'native/ui', platform);
  if (platform === 'ios') {
    const project = fs.readFileSync(path.join(projectRoot, 'ios/Leaf.xcodeproj/project.pbxproj'), 'utf8');
    for (const file of ['LeafMaterialView.swift', 'LeafMaterialView.m', 'LeafVoiceGuidance.swift', 'LeafVoiceGuidance.m']) {
      if (!project.includes(`${file} in Sources`)) throw new Error(`Execute prebuild: ${file} não está registrado no projeto iOS.`);
      writeIfChanged(path.join(projectRoot, 'ios/Leaf', file), fs.readFileSync(path.join(source, file)));
    }
  } else {
    const gradle = path.join(projectRoot, 'android/app/build.gradle');
    writeIfChanged(gradle, normalizeAndroidResourceLocales(fs.readFileSync(gradle, 'utf8')));
    const destination = path.join(projectRoot, 'android/app/src/main/java/br/com/leaf/ride');
    for (const file of ['LeafVoiceGuidanceModule.java', 'LeafVoiceGuidancePackage.java']) {
      writeIfChanged(path.join(destination, file), fs.readFileSync(path.join(source, file)));
    }
    const main = path.join(destination, 'MainApplication.kt');
    writeIfChanged(main, registerVoicePackage(fs.readFileSync(main, 'utf8')));
    const manifestPath = path.join(projectRoot, 'android/app/src/main/AndroidManifest.xml');
    let manifest = fs.readFileSync(manifestPath, 'utf8');
    if (!manifest.includes('android.intent.action.TTS_SERVICE')) {
      const intent = '    <intent>\n      <action android:name="android.intent.action.TTS_SERVICE"/>\n    </intent>\n';
      if (manifest.includes('</queries>')) manifest = manifest.replace('</queries>', `${intent}  </queries>`);
      else if (manifest.includes('<application')) manifest = manifest.replace('<application', `<queries>\n${intent}  </queries>\n  <application`);
      else throw new Error('AndroidManifest sem application; não foi possível registrar TTS.');
      writeIfChanged(manifestPath, manifest);
    }
  }
}

if (require.main === module) {
  syncNativeUi(process.argv[2]);
  console.log(`UI nativa sincronizada: ${process.argv[2]}`);
}
module.exports = { syncNativeUi };
