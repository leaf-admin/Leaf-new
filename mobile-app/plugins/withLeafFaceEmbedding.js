const { withDangerousMod, withXcodeProject } = require('@expo/config-plugins');
const fs = require('fs');
const path = require('path');

const TEMPLATES_ROOT = path.join(__dirname, '..', 'native', 'face-embedding');
const ANDROID_PACKAGE_PATH = path.join('app', 'src', 'main', 'java', 'br', 'com', 'leaf', 'ride');
const ANDROID_ASSETS_FACE_MODELS_PATH = path.join('app', 'src', 'main', 'assets', 'face_models');
const IOS_APP_GROUP = 'Leaf';
const IOS_FACE_MODELS_PATH = path.join(IOS_APP_GROUP, 'FaceModels');

function ensureDir(dirPath) {
  fs.mkdirSync(dirPath, { recursive: true });
}

function copyFile(sourcePath, targetPath) {
  ensureDir(path.dirname(targetPath));
  fs.copyFileSync(sourcePath, targetPath);
}

function copyDirectoryContents(sourceDir, targetDir) {
  if (!fs.existsSync(sourceDir)) {
    return;
  }

  ensureDir(targetDir);
  for (const entry of fs.readdirSync(sourceDir, { withFileTypes: true })) {
    const sourcePath = path.join(sourceDir, entry.name);
    const targetPath = path.join(targetDir, entry.name);
    if (entry.isDirectory()) {
      copyDirectoryContents(sourcePath, targetPath);
    } else if (entry.isFile()) {
      copyFile(sourcePath, targetPath);
    }
  }
}

function patchAndroidMainApplication(mainApplicationPath) {
  if (!fs.existsSync(mainApplicationPath)) {
    console.warn('[withLeafFaceEmbedding] MainApplication.kt not found');
    return;
  }

  let content = fs.readFileSync(mainApplicationPath, 'utf8');
  if (content.includes('LeafFaceEmbeddingPackage()')) {
    return;
  }

  const packageLine = '              add(LeafFaceEmbeddingPackage())';
  const awsLine = '              add(LeafAwsLivenessPackage())';
  const commentLine = '              // add(MyReactNativePackage())';
  const packagesApplyLine = '            PackageList(this).packages.apply {';

  if (content.includes(awsLine)) {
    content = content.replace(awsLine, `${awsLine}\n${packageLine}`);
  } else if (content.includes(commentLine)) {
    content = content.replace(commentLine, `${commentLine}\n${packageLine}`);
  } else if (content.includes(packagesApplyLine)) {
    content = content.replace(packagesApplyLine, `${packagesApplyLine}\n${packageLine}`);
  } else {
    console.warn('[withLeafFaceEmbedding] Could not find package insertion point in MainApplication.kt');
    return;
  }

  fs.writeFileSync(mainApplicationPath, content);
}

function addXcodeSource(project, filePath, groupKey, target) {
  if (project.hasFile(filePath)) {
    return;
  }
  project.addSourceFile(filePath, { target }, groupKey);
}

function addXcodeResource(project, filePath, groupKey, target) {
  if (project.hasFile(filePath)) {
    return;
  }
  project.addResourceFile(filePath, {
    lastKnownFileType: 'folder',
    target,
  }, groupKey);
}

const withLeafFaceEmbedding = (config) => {
  config = withDangerousMod(config, [
    'android',
    async (config) => {
      const projectRoot = config.modRequest.platformProjectRoot;
      const androidTargetDir = path.join(projectRoot, ANDROID_PACKAGE_PATH);

      copyFile(
        path.join(TEMPLATES_ROOT, 'android', 'LeafFaceEmbeddingModule.kt'),
        path.join(androidTargetDir, 'LeafFaceEmbeddingModule.kt')
      );
      copyFile(
        path.join(TEMPLATES_ROOT, 'android', 'LeafFaceEmbeddingPackage.kt'),
        path.join(androidTargetDir, 'LeafFaceEmbeddingPackage.kt')
      );
      copyDirectoryContents(
        path.join(TEMPLATES_ROOT, 'face_models'),
        path.join(projectRoot, ANDROID_ASSETS_FACE_MODELS_PATH)
      );
      patchAndroidMainApplication(path.join(androidTargetDir, 'MainApplication.kt'));

      return config;
    },
  ]);

  config = withDangerousMod(config, [
    'ios',
    async (config) => {
      const projectRoot = config.modRequest.platformProjectRoot;

      copyFile(
        path.join(TEMPLATES_ROOT, 'ios', 'LeafFaceEmbeddingModule.swift'),
        path.join(projectRoot, IOS_APP_GROUP, 'LeafFaceEmbeddingModule.swift')
      );
      copyFile(
        path.join(TEMPLATES_ROOT, 'ios', 'LeafFaceEmbeddingModule.m'),
        path.join(projectRoot, IOS_APP_GROUP, 'LeafFaceEmbeddingModule.m')
      );
      copyDirectoryContents(
        path.join(TEMPLATES_ROOT, 'face_models'),
        path.join(projectRoot, IOS_FACE_MODELS_PATH)
      );

      return config;
    },
  ]);

  config = withXcodeProject(config, (config) => {
    const project = config.modResults;
    const target = project.getFirstTarget()?.uuid;
    const leafGroupKey = project.findPBXGroupKey({ name: IOS_APP_GROUP });

    if (!leafGroupKey) {
      console.warn('[withLeafFaceEmbedding] Leaf PBXGroup not found');
      return config;
    }

    addXcodeSource(project, 'Leaf/LeafFaceEmbeddingModule.swift', leafGroupKey, target);
    addXcodeSource(project, 'Leaf/LeafFaceEmbeddingModule.m', leafGroupKey, target);
    addXcodeResource(project, 'Leaf/FaceModels', leafGroupKey, target);

    return config;
  });

  return config;
};

module.exports = withLeafFaceEmbedding;
