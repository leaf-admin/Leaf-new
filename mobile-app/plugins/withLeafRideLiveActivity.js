const { withDangerousMod, withInfoPlist, withXcodeProject } = require('@expo/config-plugins');
const fs = require('fs');
const path = require('path');

const TEMPLATES_ROOT = path.join(__dirname, '..', 'native', 'live-activity', 'ios');
const IOS_APP_GROUP = 'Leaf';
const WIDGET_TARGET_NAME = 'LeafRideActivityWidget';
const WIDGET_BUNDLE_IDENTIFIER = 'br.com.leaf.ride.LeafRideActivityWidget';

function ensureDir(dirPath) {
  fs.mkdirSync(dirPath, { recursive: true });
}

function copyFile(sourcePath, targetPath) {
  ensureDir(path.dirname(targetPath));
  fs.copyFileSync(sourcePath, targetPath);
}

function copyIosTemplates(projectRoot) {
  copyFile(
    path.join(TEMPLATES_ROOT, 'app', 'LeafRideActivityModule.swift'),
    path.join(projectRoot, IOS_APP_GROUP, 'LeafRideActivityModule.swift')
  );
  copyFile(
    path.join(TEMPLATES_ROOT, 'app', 'LeafRideActivityModule.m'),
    path.join(projectRoot, IOS_APP_GROUP, 'LeafRideActivityModule.m')
  );
  copyFile(
    path.join(TEMPLATES_ROOT, 'app', 'LeafRideActivityAttributes.swift'),
    path.join(projectRoot, IOS_APP_GROUP, 'LeafRideActivityAttributes.swift')
  );

  copyFile(
    path.join(TEMPLATES_ROOT, 'widget', 'LeafRideActivityWidget.swift'),
    path.join(projectRoot, WIDGET_TARGET_NAME, 'LeafRideActivityWidget.swift')
  );
  copyFile(
    path.join(TEMPLATES_ROOT, 'widget', 'LeafRideActivityWidgetBundle.swift'),
    path.join(projectRoot, WIDGET_TARGET_NAME, 'LeafRideActivityWidgetBundle.swift')
  );
  copyFile(
    path.join(TEMPLATES_ROOT, 'widget', 'LeafRideActivityAttributes.swift'),
    path.join(projectRoot, WIDGET_TARGET_NAME, 'LeafRideActivityAttributes.swift')
  );
  copyFile(
    path.join(TEMPLATES_ROOT, 'widget', 'Info.plist'),
    path.join(projectRoot, WIDGET_TARGET_NAME, 'Info.plist')
  );
  copyFile(
    path.join(TEMPLATES_ROOT, 'widget', 'LeafRideActivityWidget.entitlements'),
    path.join(projectRoot, WIDGET_TARGET_NAME, 'LeafRideActivityWidget.entitlements')
  );
}

function addXcodeSource(project, filePath, groupKey, target) {
  const sourcePhase = project.buildPhase('Sources', target)
    ? project.pbxSourcesBuildPhaseObj(target)
    : null;
  const alreadyInTarget = sourcePhase?.files?.some((file) => file.comment === `${path.basename(filePath)} in Sources`);
  if (alreadyInTarget) {
    return;
  }

  project.addSourceFile(filePath, { target }, groupKey);
}

function ensureTargetBuildPhases(project, target) {
  if (!project.buildPhase('Sources', target)) {
    project.addBuildPhase([], 'PBXSourcesBuildPhase', 'Sources', target);
  }
  if (!project.buildPhase('Frameworks', target)) {
    project.addBuildPhase([], 'PBXFrameworksBuildPhase', 'Frameworks', target);
  }
}

function ensureWidgetGroup(project) {
  const existing = project.findPBXGroupKey({ name: WIDGET_TARGET_NAME });
  if (existing) {
    return existing;
  }

  project.addPbxGroup([], WIDGET_TARGET_NAME, WIDGET_TARGET_NAME);
  const widgetGroupKey = project.findPBXGroupKey({ name: WIDGET_TARGET_NAME });
  const rootGroupKey = project.getFirstProject()?.firstProject?.mainGroup;
  if (rootGroupKey && widgetGroupKey) {
    const rootGroup = project.hash.project.objects.PBXGroup[rootGroupKey];
    const alreadyLinked = rootGroup.children?.some((child) => child.value === widgetGroupKey);
    if (!alreadyLinked) {
      rootGroup.children.push({ value: widgetGroupKey, comment: WIDGET_TARGET_NAME });
    }
  }
  return widgetGroupKey;
}

function ensureWidgetTarget(project) {
  const targets = project.pbxNativeTargetSection();
  for (const [uuid, target] of Object.entries(targets)) {
    if (uuid.endsWith('_comment') || !target || typeof target !== 'object') {
      continue;
    }
    const name = String(target.name || '').replace(/^"|"$/g, '');
    if (name === WIDGET_TARGET_NAME) {
      return uuid;
    }
  }

  const target = project.addTarget(
    WIDGET_TARGET_NAME,
    'app_extension',
    WIDGET_TARGET_NAME,
    WIDGET_BUNDLE_IDENTIFIER
  );

  return target.uuid;
}

function readTargetBuildSetting(project, targetUuid, settingName, fallback) {
  const target = project.pbxNativeTargetSection()[targetUuid];
  const configListId = target?.buildConfigurationList;
  const configList = project.pbxXCConfigurationList()[configListId];
  const firstConfigRef = configList?.buildConfigurations?.[0];
  const config = firstConfigRef ? project.pbxXCBuildConfigurationSection()[firstConfigRef.value] : null;
  return config?.buildSettings?.[settingName] || fallback;
}

function patchWidgetBuildSettings(project, widgetTargetUuid, appTargetUuid, appConfig = {}) {
  const currentProjectVersion = appConfig.ios?.buildNumber
    || readTargetBuildSetting(project, appTargetUuid, 'CURRENT_PROJECT_VERSION', '1');
  const marketingVersion = appConfig.version
    || readTargetBuildSetting(project, appTargetUuid, 'MARKETING_VERSION', '1.0');
  const target = project.pbxNativeTargetSection()[widgetTargetUuid];
  const configListId = target?.buildConfigurationList;
  const configList = project.pbxXCConfigurationList()[configListId];
  const configs = configList?.buildConfigurations || [];

  for (const configRef of configs) {
    const config = project.pbxXCBuildConfigurationSection()[configRef.value];
    if (!config?.buildSettings) {
      continue;
    }

    config.buildSettings.ASSETCATALOG_COMPILER_GLOBAL_ACCENT_COLOR_NAME = 'AccentColor';
    config.buildSettings.CODE_SIGN_ENTITLEMENTS = `${WIDGET_TARGET_NAME}/${WIDGET_TARGET_NAME}.entitlements`;
    config.buildSettings.CODE_SIGN_IDENTITY = '"Apple Development"';
    config.buildSettings.CODE_SIGN_STYLE = 'Automatic';
    config.buildSettings.CURRENT_PROJECT_VERSION = currentProjectVersion;
    config.buildSettings.DEVELOPMENT_TEAM = config.buildSettings.DEVELOPMENT_TEAM || 'DTA8W5KA5D';
    config.buildSettings.GENERATE_INFOPLIST_FILE = 'NO';
    config.buildSettings.INFOPLIST_FILE = `${WIDGET_TARGET_NAME}/Info.plist`;
    config.buildSettings.IPHONEOS_DEPLOYMENT_TARGET = '17.0';
    config.buildSettings.MARKETING_VERSION = marketingVersion;
    config.buildSettings.PRODUCT_BUNDLE_IDENTIFIER = WIDGET_BUNDLE_IDENTIFIER;
    config.buildSettings.PRODUCT_NAME = `"${WIDGET_TARGET_NAME}"`;
    config.buildSettings.SKIP_INSTALL = 'YES';
    config.buildSettings.SWIFT_VERSION = '5.0';
    config.buildSettings.TARGETED_DEVICE_FAMILY = '1';
  }

  project.addTargetAttribute('DevelopmentTeam', 'DTA8W5KA5D', { uuid: widgetTargetUuid });
  project.addTargetAttribute('ProvisioningStyle', 'Automatic', { uuid: widgetTargetUuid });
}

const withLeafRideLiveActivity = (config) => {
  config = withInfoPlist(config, (config) => {
    config.modResults.NSSupportsLiveActivities = true;
    config.modResults.NSSupportsLiveActivitiesFrequentUpdates = true;
    return config;
  });

  config = withDangerousMod(config, [
    'ios',
    async (config) => {
      copyIosTemplates(config.modRequest.platformProjectRoot);
      return config;
    },
  ]);

  config = withXcodeProject(config, (config) => {
    const project = config.modResults;
    const appTarget = project.getFirstTarget()?.uuid;
    const leafGroupKey = project.findPBXGroupKey({ name: IOS_APP_GROUP });
    const widgetGroupKey = ensureWidgetGroup(project);
    const widgetTarget = ensureWidgetTarget(project);

    if (!leafGroupKey) {
      console.warn('[withLeafRideLiveActivity] Leaf PBXGroup not found');
      return config;
    }
    if (!widgetGroupKey || !widgetTarget) {
      console.warn('[withLeafRideLiveActivity] Widget target/group not available');
      return config;
    }

    ensureTargetBuildPhases(project, appTarget);
    ensureTargetBuildPhases(project, widgetTarget);

    addXcodeSource(project, 'Leaf/LeafRideActivityModule.swift', leafGroupKey, appTarget);
    addXcodeSource(project, 'Leaf/LeafRideActivityModule.m', leafGroupKey, appTarget);
    addXcodeSource(project, 'Leaf/LeafRideActivityAttributes.swift', leafGroupKey, appTarget);

    addXcodeSource(project, 'LeafRideActivityWidget.swift', widgetGroupKey, widgetTarget);
    addXcodeSource(project, 'LeafRideActivityWidgetBundle.swift', widgetGroupKey, widgetTarget);
    addXcodeSource(project, 'LeafRideActivityAttributes.swift', widgetGroupKey, widgetTarget);

    patchWidgetBuildSettings(project, widgetTarget, appTarget, config);
    return config;
  });

  return config;
};

module.exports = withLeafRideLiveActivity;
