const fs = require('fs');
const path = require('path');
jest.mock('@expo/config-plugins', () => ({
  withDangerousMod: jest.fn(config => config),
  withXcodeProject: jest.fn(config => config),
  withMainApplication: jest.fn(config => config),
  withAndroidManifest: jest.fn(config => config),
  withAppBuildGradle: jest.fn(config => config),
}));
const { registerVoicePackage, normalizeAndroidResourceLocales } = require('../plugins/withLeafMaterial');
const root = path.resolve(__dirname, '..');
const os = require('os');
const { syncNativeUi } = require('../scripts/sync-leaf-ui-native.cjs');
describe('voice native build contract', () => {
  it('registers the Android package once and rejects unknown templates', () => {
    const original = 'PackageList(this).packages.apply {\n add(ExistingPackage())\n}';
    const patched = registerVoicePackage(original);
    expect(patched).toContain('add(LeafVoiceGuidancePackage())');
    expect(patched).toContain('add(ExistingPackage())');
    expect(registerVoicePackage(patched)).toBe(patched);
    expect(() => registerVoicePackage('unknown template')).toThrow('registro de pacotes');
  });
  it('uses only device speech with cancellation and offline Android voices', () => {
    const ios = fs.readFileSync(path.join(root, 'native/ui/ios/LeafVoiceGuidance.swift'), 'utf8');
    const android = fs.readFileSync(path.join(root, 'native/ui/android/LeafVoiceGuidanceModule.java'), 'utf8');
    expect(ios).toContain('AVSpeechSynthesizer');
    expect(ios).toContain('stopSpeaking(at: .immediate)');
    expect(android).toContain('!voice.isNetworkConnectionRequired()');
    expect(android).toContain('request != generation');
    expect(android).toContain('speech.shutdown()');
  });
  it('synchronizes existing native folders without requiring a destructive prebuild', () => {
    const directory = fs.mkdtempSync(path.join(os.tmpdir(), 'leaf-native-sync-test-'));
    try {
      const copy = (file, contents) => { const target = path.join(directory, file); fs.mkdirSync(path.dirname(target), { recursive: true }); fs.writeFileSync(target, contents); };
      ['LeafVoiceGuidanceModule.java', 'LeafVoiceGuidancePackage.java'].forEach(file => copy(`native/ui/android/${file}`, fs.readFileSync(path.join(root, 'native/ui/android', file))));
      copy('android/app/src/main/java/br/com/leaf/ride/MainApplication.kt', 'PackageList(this).packages.apply {\n}');
      copy('android/app/src/main/AndroidManifest.xml', '<manifest><queries></queries><application /></manifest>');
      copy('android/app/build.gradle', 'resourceConfigurations += ["pt-BR"]');
      syncNativeUi('android', directory);
      const manifest = fs.readFileSync(path.join(directory, 'android/app/src/main/AndroidManifest.xml'), 'utf8');
      const main = fs.readFileSync(path.join(directory, 'android/app/src/main/java/br/com/leaf/ride/MainApplication.kt'), 'utf8');
      syncNativeUi('android', directory);
      expect(fs.readFileSync(path.join(directory, 'android/app/src/main/AndroidManifest.xml'), 'utf8')).toBe(manifest);
      expect(fs.readFileSync(path.join(directory, 'android/app/src/main/java/br/com/leaf/ride/MainApplication.kt'), 'utf8')).toBe(main);
      expect(manifest).toContain('android.intent.action.TTS_SERVICE');
      expect(main.match(/add\(LeafVoiceGuidancePackage\(\)\)/g)).toHaveLength(1);
      expect(fs.readFileSync(path.join(directory, 'android/app/build.gradle'), 'utf8')).toBe('resourceConfigurations += ["pt-rBR"]');
      expect(normalizeAndroidResourceLocales('resourceConfigurations += ["en"]')).toBe('resourceConfigurations += ["en"]');
      expect(fs.existsSync(path.join(directory, 'android/app/src/main/java/br/com/leaf/ride/LeafVoiceGuidanceModule.java'))).toBe(true);
      expect(() => syncNativeUi('unknown', directory)).toThrow('ios ou android');
    } finally { fs.rmSync(directory, { recursive: true, force: true }); }
    expect(fs.readFileSync(path.join(root, 'scripts/build-local-ios.sh'), 'utf8')).toContain('sync-leaf-ui-native.cjs" ios');
    expect(fs.readFileSync(path.join(root, 'scripts/build-local-android.sh'), 'utf8')).toContain('sync-leaf-ui-native.cjs" android');
  });
});
