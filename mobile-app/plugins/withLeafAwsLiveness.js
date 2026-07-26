const { IOSConfig, withDangerousMod, withXcodeProject } = require('@expo/config-plugins');
const fs = require('fs');
const path = require('path');

const TEMPLATES_ROOT = path.join(__dirname, '..', 'native', 'aws-liveness');
const ANDROID_PACKAGE_PATH = path.join('app', 'src', 'main', 'java', 'br', 'com', 'leaf', 'ride');
const IOS_APP_GROUP = 'Leaf';
const IOS_LOCALIZATION_BLOCK_START = '/* LEAF_AWS_LIVENESS_PT_BR_START */';
const IOS_LOCALIZATION_BLOCK_END = '/* LEAF_AWS_LIVENESS_PT_BR_END */';
const IOS_LOCALIZATION_REGIONS = ['Base', 'pt-BR'];

const AWS_PACKAGE_ID = 'B9D64E3D8B8C4A40A1F2C901';
const AWS_PRODUCT_ID = 'B9D64E3D8B8C4A40A1F2C902';
const AWS_FRAMEWORK_BUILD_ID = 'B9D64E3D8B8C4A40A1F2C903';
const AWS_PACKAGE_REPOSITORY = 'https://github.com/aws-amplify/amplify-ui-swift-liveness';

function ensureDir(dirPath) {
  fs.mkdirSync(dirPath, { recursive: true });
}

function copyFile(sourcePath, targetPath) {
  ensureDir(path.dirname(targetPath));
  fs.copyFileSync(sourcePath, targetPath);
}

function escapeRegExp(value) {
  return value.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
}

function readIosLocalizationKeys(content) {
  return Array.from(
    content.matchAll(/^\s*"([^"]+)"\s*=/gm),
    (match) => match[1]
  );
}

function mergeIosLocalizationFile(sourcePath, targetPath) {
  const source = fs.readFileSync(sourcePath, 'utf8').trim();
  const managedKeys = readIosLocalizationKeys(source);
  const managedBlockPattern = new RegExp(
    `${escapeRegExp(IOS_LOCALIZATION_BLOCK_START)}[\\s\\S]*?${escapeRegExp(IOS_LOCALIZATION_BLOCK_END)}\\s*`,
    'g'
  );
  const managedEntryPattern = managedKeys.length > 0
    ? new RegExp(
      `^\\s*"(?:${managedKeys.map(escapeRegExp).join('|')})"\\s*=\\s*"(?:[^"\\\\]|\\\\.)*"\\s*;\\s*$`,
      'gm'
    )
    : null;
  const existing = fs.existsSync(targetPath) ? fs.readFileSync(targetPath, 'utf8') : '';

  let preserved = existing.replace(managedBlockPattern, '');
  if (managedEntryPattern) {
    preserved = preserved.replace(managedEntryPattern, '');
  }
  preserved = preserved.trim();

  const managedBlock = [
    IOS_LOCALIZATION_BLOCK_START,
    source,
    IOS_LOCALIZATION_BLOCK_END,
  ].join('\n');
  const next = `${preserved ? `${preserved}\n\n` : ''}${managedBlock}\n`;

  if (next !== existing) {
    ensureDir(path.dirname(targetPath));
    fs.writeFileSync(targetPath, next);
  }
}

function patchFile(filePath, patcher) {
  if (!fs.existsSync(filePath)) {
    return;
  }
  const before = fs.readFileSync(filePath, 'utf8');
  const after = patcher(before);
  if (after !== before) {
    fs.writeFileSync(filePath, after);
  }
}

function patchAndroidMainApplication(mainApplicationPath) {
  patchFile(mainApplicationPath, (content) => {
    if (content.includes('LeafAwsLivenessPackage()')) {
      return content;
    }

    const packageLine = '              add(LeafAwsLivenessPackage())';
    const commentLine = '              // add(MyReactNativePackage())';
    const packagesApplyLine = '            PackageList(this).packages.apply {';

    if (content.includes(commentLine)) {
      return content.replace(commentLine, `${commentLine}\n${packageLine}`);
    }
    if (content.includes(packagesApplyLine)) {
      return content.replace(packagesApplyLine, `${packagesApplyLine}\n${packageLine}`);
    }
    console.warn('[withLeafAwsLiveness] Could not find package insertion point in MainApplication.kt');
    return content;
  });
}

function patchAndroidManifest(manifestPath) {
  patchFile(manifestPath, (content) => {
    if (content.includes('LeafAwsLivenessActivity')) {
      return content;
    }
    const activityLine = '    <activity android:name=".LeafAwsLivenessActivity" android:screenOrientation="portrait" android:theme="@style/AppTheme" android:exported="false"/>';
    return content.replace(/(\s*<activity android:name="\.MainActivity")/, `${activityLine}\n$1`);
  });
}

function patchAndroidRootBuildGradle(buildGradlePath) {
  patchFile(buildGradlePath, (content) => {
    if (content.includes("org.jetbrains.kotlin:compose-compiler-gradle-plugin")) {
      return content;
    }
    return content.replace(
      /(\s*classpath\('org\.jetbrains\.kotlin:kotlin-gradle-plugin'\).*)/,
      `$1\n    classpath('org.jetbrains.kotlin:compose-compiler-gradle-plugin')`
    );
  });
}

function patchAndroidAppBuildGradle(appBuildGradlePath) {
  patchFile(appBuildGradlePath, (content) => {
    let updated = content;

    if (!updated.includes('org.jetbrains.kotlin.plugin.compose')) {
      updated = updated.replace(
        'apply plugin: "org.jetbrains.kotlin.android"',
        'apply plugin: "org.jetbrains.kotlin.android"\napply plugin: "org.jetbrains.kotlin.plugin.compose"'
      );
    }
    if (!updated.includes('coreLibraryDesugaringEnabled true')) {
      updated = updated.replace(
        /(\s*compileOptions \{\n)/,
        '$1        coreLibraryDesugaringEnabled true\n'
      );
    }
    updated = updated.replace(
      /sourceCompatibility JavaVersion\.VERSION_1_8/g,
      'sourceCompatibility JavaVersion.VERSION_17'
    );
    updated = updated.replace(
      /targetCompatibility JavaVersion\.VERSION_1_8/g,
      'targetCompatibility JavaVersion.VERSION_17'
    );
    if (!updated.includes("jvmTarget = '17'")) {
      updated = updated.replace(
        /(\s*kotlinOptions \{\n\s*jvmTarget = ['"][^'"]+['"]\n\s*\})/,
        "    kotlinOptions {\n        jvmTarget = '17'\n    }"
      );
    }
    if (!updated.includes('compose true')) {
      updated = updated.replace(
        /(\s*buildFeatures \{\n)/,
        '$1        compose true\n'
      );
    }

    if (!updated.includes('com.amplifyframework.ui:liveness')) {
      updated = updated.replace(
        /(\s*implementation\("com\.facebook\.react:react-android"\).*)/,
        `$1\n    implementation("com.amplifyframework.ui:liveness:1.5.0")`
      );
    }
    if (!updated.includes('androidx.activity:activity-compose')) {
      updated = updated.replace(
        /(\s*implementation\("com\.amplifyframework\.ui:liveness:1\.5\.0"\).*)/,
        `$1\n    implementation("androidx.activity:activity-compose:1.9.3")`
      );
    }
    if (!updated.includes('androidx.compose.material3:material3')) {
      updated = updated.replace(
        /(\s*implementation\("androidx\.activity:activity-compose:1\.9\.3"\).*)/,
        `$1\n    implementation("androidx.compose.material3:material3:1.1.2")`
      );
    }
    if (!updated.includes('desugar_jdk_libs')) {
      updated = updated.replace(
        /(\s*implementation\("androidx\.compose\.material3:material3:1\.1\.2"\).*)/,
        `$1\n    coreLibraryDesugaring("com.android.tools:desugar_jdk_libs:2.1.5")`
      );
    }

    return updated;
  });
}

function addXcodeSource(project, filePath, groupKey, target) {
  if (project.hasFile(filePath)) {
    return;
  }
  project.addSourceFile(filePath, { target }, groupKey);
}

function addXcodeLocalizationResource(project, region, targetUuid) {
  const fileName = 'Localizable.strings';
  const groupName = `${IOS_APP_GROUP}/Supporting/${region}.lproj`;
  const group = IOSConfig.XcodeUtils.ensureGroupRecursively(project, groupName);

  project.addKnownRegion(region);
  if (group?.children.some(({ comment }) => comment === fileName)) {
    return project;
  }

  return IOSConfig.XcodeUtils.addResourceFileToGroup({
    filepath: `${region}.lproj/${fileName}`,
    groupName,
    project,
    isBuildFile: true,
    verbose: true,
    targetUuid,
  });
}

function addSwiftPackageText(pbxprojPath) {
  patchFile(pbxprojPath, (content) => {
    if (content.includes(AWS_PACKAGE_REPOSITORY)) {
      return content;
    }

    let updated = content;
    const frameworkBuildLine = `\t\t${AWS_FRAMEWORK_BUILD_ID} /* FaceLiveness in Frameworks */ = {isa = PBXBuildFile; productRef = ${AWS_PRODUCT_ID} /* FaceLiveness */; };`;
    updated = updated.replace(
      '/* Begin PBXBuildFile section */',
      `/* Begin PBXBuildFile section */\n${frameworkBuildLine}`
    );

    updated = updated.replace(
      /(\s*files = \(\n)([\s\S]*?)(\s*\);\n\s*runOnlyForDeploymentPostprocessing = 0;\n\s*};\n\/\* End PBXFrameworksBuildPhase section \*\/)/,
      (match, start, files, end) => {
        if (files.includes('FaceLiveness in Frameworks')) {
          return match;
        }
        return `${start}${files}\t\t\t\t${AWS_FRAMEWORK_BUILD_ID} /* FaceLiveness in Frameworks */,\n${end}`;
      }
    );

    updated = updated.replace(
      /(\s*packageProductDependencies = \(\n)([\s\S]*?)(\s*\);\n\s*productName = Leaf;)/,
      (match, start, deps, end) => {
        if (deps.includes('FaceLiveness')) {
          return match;
        }
        return `${start}${deps}\t\t\t\t${AWS_PRODUCT_ID} /* FaceLiveness */,\n${end}`;
      }
    );
    if (!updated.includes(`${AWS_PRODUCT_ID} /* FaceLiveness */`) || !/packageProductDependencies = \([\s\S]*FaceLiveness[\s\S]*\);\n\s*productName = Leaf;/.test(updated)) {
      updated = updated.replace(
        /(\s*productName = Leaf;)/,
        `\t\t\tpackageProductDependencies = (\n\t\t\t\t${AWS_PRODUCT_ID} /* FaceLiveness */,\n\t\t\t);\n$1`
      );
    }

    updated = updated.replace(
      /(\s*packageReferences = \(\n)([\s\S]*?)(\s*\);\n\s*productRefGroup = )/,
      (match, start, refs, end) => {
        if (refs.includes('amplify-ui-swift-liveness')) {
          return match;
        }
        return `${start}${refs}\t\t\t\t${AWS_PACKAGE_ID} /* XCRemoteSwiftPackageReference "amplify-ui-swift-liveness" */,\n${end}`;
      }
    );
    if (!/packageReferences = \([\s\S]*amplify-ui-swift-liveness[\s\S]*\);\n\s*productRefGroup = /.test(updated)) {
      updated = updated.replace(
        /(\s*productRefGroup = )/,
        `\t\t\tpackageReferences = (\n\t\t\t\t${AWS_PACKAGE_ID} /* XCRemoteSwiftPackageReference "amplify-ui-swift-liveness" */,\n\t\t\t);\n$1`
      );
    }

    const packageSection = `/* Begin XCRemoteSwiftPackageReference section */
\t\t${AWS_PACKAGE_ID} /* XCRemoteSwiftPackageReference "amplify-ui-swift-liveness" */ = {
\t\t\tisa = XCRemoteSwiftPackageReference;
\t\t\trepositoryURL = "${AWS_PACKAGE_REPOSITORY}";
\t\t\trequirement = {
\t\t\t\tkind = upToNextMajorVersion;
\t\t\t\tminimumVersion = 1.4.4;
\t\t\t};
\t\t};
/* End XCRemoteSwiftPackageReference section */

/* Begin XCSwiftPackageProductDependency section */
\t\t${AWS_PRODUCT_ID} /* FaceLiveness */ = {
\t\t\tisa = XCSwiftPackageProductDependency;
\t\t\tpackage = ${AWS_PACKAGE_ID} /* XCRemoteSwiftPackageReference "amplify-ui-swift-liveness" */;
\t\t\tproductName = FaceLiveness;
\t\t};
/* End XCSwiftPackageProductDependency section */
`;

    updated = updated.replace(
      /(\s*};\n\s*rootObject = )/,
      `\n${packageSection}\t$1`
    );

    return updated;
  });
}

const withLeafAwsLiveness = (config) => {
  config = withDangerousMod(config, [
    'android',
    async (config) => {
      const projectRoot = config.modRequest.platformProjectRoot;
      const androidTargetDir = path.join(projectRoot, ANDROID_PACKAGE_PATH);

      copyFile(
        path.join(TEMPLATES_ROOT, 'android', 'LeafAwsLivenessModule.kt'),
        path.join(androidTargetDir, 'LeafAwsLivenessModule.kt')
      );
      copyFile(
        path.join(TEMPLATES_ROOT, 'android', 'LeafAwsLivenessActivity.kt'),
        path.join(androidTargetDir, 'LeafAwsLivenessActivity.kt')
      );
      copyFile(
        path.join(TEMPLATES_ROOT, 'android', 'LeafAwsLivenessPackage.kt'),
        path.join(androidTargetDir, 'LeafAwsLivenessPackage.kt')
      );
      copyFile(
        path.join(TEMPLATES_ROOT, 'android', 'res', 'values-pt-rBR', 'leaf_aws_liveness_strings.xml'),
        path.join(projectRoot, 'app', 'src', 'main', 'res', 'values', 'leaf_aws_liveness_strings.xml')
      );
      copyFile(
        path.join(TEMPLATES_ROOT, 'android', 'res', 'values-pt-rBR', 'leaf_aws_liveness_strings.xml'),
        path.join(projectRoot, 'app', 'src', 'main', 'res', 'values-pt-rBR', 'leaf_aws_liveness_strings.xml')
      );

      patchAndroidMainApplication(path.join(androidTargetDir, 'MainApplication.kt'));
      patchAndroidManifest(path.join(projectRoot, 'app', 'src', 'main', 'AndroidManifest.xml'));
      patchAndroidRootBuildGradle(path.join(projectRoot, 'build.gradle'));
      patchAndroidAppBuildGradle(path.join(projectRoot, 'app', 'build.gradle'));

      return config;
    },
  ]);

  config = withDangerousMod(config, [
    'ios',
    async (config) => {
      const projectRoot = config.modRequest.platformProjectRoot;

      copyFile(
        path.join(TEMPLATES_ROOT, 'ios', 'LeafAwsLivenessModule.swift'),
        path.join(projectRoot, IOS_APP_GROUP, 'LeafAwsLivenessModule.swift')
      );
      copyFile(
        path.join(TEMPLATES_ROOT, 'ios', 'LeafAwsLivenessModule.m'),
        path.join(projectRoot, IOS_APP_GROUP, 'LeafAwsLivenessModule.m')
      );
      for (const region of IOS_LOCALIZATION_REGIONS) {
        mergeIosLocalizationFile(
          path.join(TEMPLATES_ROOT, 'ios', 'pt-BR.lproj', 'Localizable.strings'),
          path.join(projectRoot, IOS_APP_GROUP, 'Supporting', `${region}.lproj`, 'Localizable.strings')
        );
      }

      return config;
    },
  ]);

  config = withXcodeProject(config, (config) => {
    const project = config.modResults;
    const target = project.getFirstTarget()?.uuid;
    const leafGroupKey = project.findPBXGroupKey({ name: IOS_APP_GROUP });

    if (!leafGroupKey) {
      console.warn('[withLeafAwsLiveness] Leaf PBXGroup not found');
      return config;
    }

    addXcodeSource(project, 'Leaf/LeafAwsLivenessModule.swift', leafGroupKey, target);
    addXcodeSource(project, 'Leaf/LeafAwsLivenessModule.m', leafGroupKey, target);
    for (const region of IOS_LOCALIZATION_REGIONS) {
      config.modResults = addXcodeLocalizationResource(config.modResults, region, target);
    }
    return config;
  });

  config = withDangerousMod(config, [
    'ios',
    async (config) => {
      const pbxprojPath = path.join(
        config.modRequest.platformProjectRoot,
        'Leaf.xcodeproj',
        'project.pbxproj'
      );
      addSwiftPackageText(pbxprojPath);
      return config;
    },
  ]);

  return config;
};

module.exports = withLeafAwsLiveness;
module.exports.__private = {
  mergeIosLocalizationFile,
  readIosLocalizationKeys,
};
