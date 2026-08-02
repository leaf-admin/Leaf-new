const fs = require('fs');
const os = require('os');
const path = require('path');

const plugin = require('../plugins/withLeafAwsLiveness');

const IOS_KEYS = [
  'amplify_ui_liveness_get_ready_page_title',
  'amplify_ui_liveness_get_ready_photosensitivity_title',
  'amplify_ui_liveness_get_ready_photosensitivity_description',
  'amplify_ui_liveness_get_ready_photosensitivity_icon_a11y',
  'amplify_ui_liveness_get_ready_photosensitivity_dialog_title',
  'amplify_ui_liveness_get_ready_photosensitivity_dialog_description',
  'amplify_ui_liveness_get_ready_begin_check',
  'amplify_ui_liveness_challenge_recording_indicator_label',
  'amplify_ui_liveness_challenge_instruction_hold_face_during_countdown',
  'amplify_ui_liveness_challenge_instruction_hold_face_during_freshness',
  'amplify_ui_liveness_challenge_instruction_move_face_back',
  'amplify_ui_liveness_challenge_instruction_move_face_closer',
  'amplify_ui_liveness_challenge_instruction_move_face',
  'amplify_ui_liveness_challenge_instruction_move_face_in_front_of_camera',
  'amplify_ui_liveness_challenge_instruction_multiple_faces_detected',
  'amplify_ui_liveness_challenge_instruction_hold_still',
  'amplify_ui_liveness_challenge_connecting',
  'amplify_ui_liveness_challenge_verifying',
  'amplify_ui_liveness_challenge_cancel_a11y',
  'amplify_ui_liveness_camera_setting_alert_title',
  'amplify_ui_liveness_camera_setting_alert_message',
  'amplify_ui_liveness_camera_setting_alert_update_setting_button_text',
  'amplify_ui_liveness_camera_setting_alert_not_now_button_text',
  'amplify_ui_liveness_close_button_a11y',
  'amplify_ui_liveness_center_your_face_text',
  'amplify_ui_liveness_camera_permission_page_title',
  'amplify_ui_liveness_camera_permission_button_title',
  'amplify_ui_liveness_camera_permission_button_header',
  'amplify_ui_liveness_camera_permission_button_description',
  'amplify_ui_liveness_face_not_prepared_reason_pendingCheck',
  'amplify_ui_liveness_face_not_prepared_reason_not_in_oval',
  'amplify_ui_liveness_face_not_prepared_reason_move_face_closer',
  'amplify_ui_liveness_face_not_prepared_reason_move_face_right',
  'amplify_ui_liveness_face_not_prepared_reason_move_face_left',
  'amplify_ui_liveness_face_not_prepared_reason_move_to_dimmer_area',
  'amplify_ui_liveness_face_not_prepared_reason_move_to_brighter_area',
  'amplify_ui_liveness_face_not_prepared_reason_no_face',
  'amplify_ui_liveness_face_not_prepared_reason_multiple_faces',
  'amplify_ui_liveness_face_not_prepared_reason_face_too_close',
];

const ANDROID_KEYS = [
  'amplify_ui_liveness_challenge_a11y_cancel_content_description',
  'amplify_ui_liveness_challenge_connecting',
  'amplify_ui_liveness_challenge_instruction_hold_face_during_freshness',
  'amplify_ui_liveness_challenge_instruction_move_face',
  'amplify_ui_liveness_challenge_instruction_move_face_closer',
  'amplify_ui_liveness_challenge_instruction_move_face_further',
  'amplify_ui_liveness_challenge_instruction_multiple_faces_detected',
  'amplify_ui_liveness_challenge_recording_indicator_label',
  'amplify_ui_liveness_challenge_verifying',
  'amplify_ui_liveness_get_ready_a11y_photosensitivity_icon_content_description',
  'amplify_ui_liveness_get_ready_begin_check',
  'amplify_ui_liveness_get_ready_center_face_label',
  'amplify_ui_liveness_get_ready_photosensitivity_description',
  'amplify_ui_liveness_get_ready_photosensitivity_dialog_description',
  'amplify_ui_liveness_get_ready_photosensitivity_dialog_dismiss',
  'amplify_ui_liveness_get_ready_photosensitivity_dialog_title',
  'amplify_ui_liveness_get_ready_photosensitivity_title',
];

function read(relativePath) {
  return fs.readFileSync(path.join(__dirname, '..', relativePath), 'utf8');
}

function countOccurrences(content, value) {
  return content.split(value).length - 1;
}

describe('AWS native liveness localization contract', () => {
  test('ships the complete iOS SDK key set in pt-BR without format placeholders', () => {
    const content = read('native/aws-liveness/ios/pt-BR.lproj/Localizable.strings');
    const actualKeys = plugin.__private.readIosLocalizationKeys(content);

    expect(actualKeys.sort()).toEqual([...IOS_KEYS].sort());
    expect(content).not.toMatch(/%(?:\d+\$)?[@a-zA-Z]/);
    expect(content).toContain(
      '"amplify_ui_liveness_face_not_prepared_reason_pendingCheck" = " ";'
    );
    expect(content).toContain('Centralize seu rosto');
    expect(content).toContain('Posicione o rosto em frente à câmera');
    expect(content.match(/Aproxime o rosto da câmera/g)).toHaveLength(2);
  });

  test('ships the complete Android SDK key set in pt-BR without format placeholders', () => {
    const content = read(
      'native/aws-liveness/android/res/values-pt-rBR/leaf_aws_liveness_strings.xml'
    );
    const actualKeys = Array.from(
      content.matchAll(/<string name="([^"]+)">/g),
      (match) => match[1]
    );

    expect(actualKeys.sort()).toEqual([...ANDROID_KEYS].sort());
    expect(content).not.toMatch(/%(?:\d+\$)?[a-zA-Z]/);
    expect(content).toContain('Centralize seu rosto');
    expect(content).toContain('Posicione o rosto em frente à câmera');
    expect(content).toContain('Aproxime o rosto da câmera');
  });

  test('iOS merge preserves unrelated strings and is byte-identical on a second run', () => {
    const tempRoot = fs.mkdtempSync(path.join(os.tmpdir(), 'leaf-liveness-localization-'));
    const sourcePath = path.join(
      __dirname,
      '..',
      'native',
      'aws-liveness',
      'ios',
      'pt-BR.lproj',
      'Localizable.strings'
    );
    const targetPath = path.join(tempRoot, 'Localizable.strings');

    try {
      fs.writeFileSync(targetPath, '"leaf_unrelated_key" = "Preservar";\n');
      plugin.__private.mergeIosLocalizationFile(sourcePath, targetPath);
      const firstRun = fs.readFileSync(targetPath, 'utf8');
      plugin.__private.mergeIosLocalizationFile(sourcePath, targetPath);
      const secondRun = fs.readFileSync(targetPath, 'utf8');

      expect(secondRun).toBe(firstRun);
      expect(secondRun).toContain('"leaf_unrelated_key" = "Preservar";');
      expect(countOccurrences(secondRun, 'LEAF_AWS_LIVENESS_PT_BR_START')).toBe(1);
      for (const key of IOS_KEYS) {
        expect(countOccurrences(secondRun, `"${key}"`)).toBe(1);
      }
    } finally {
      fs.rmSync(tempRoot, { recursive: true, force: true });
    }
  });

  test('plugin writes Portuguese fallback resources for both native platforms', () => {
    const source = read('plugins/withLeafAwsLiveness.js');
    const iosBase = read('ios/Leaf/Supporting/Base.lproj/Localizable.strings');
    const iosPtBr = read('ios/Leaf/Supporting/pt-BR.lproj/Localizable.strings');
    const androidDefault = read(
      'android/app/src/main/res/values/leaf_aws_liveness_strings.xml'
    );
    const androidPtBr = read(
      'android/app/src/main/res/values-pt-rBR/leaf_aws_liveness_strings.xml'
    );
    const xcodeProject = read('ios/Leaf.xcodeproj/project.pbxproj');

    expect(source).toContain("const IOS_LOCALIZATION_REGIONS = ['Base', 'pt-BR']");
    expect(source).toContain("'res', 'values', 'leaf_aws_liveness_strings.xml'");
    expect(source).toContain("'res', 'values-pt-rBR', 'leaf_aws_liveness_strings.xml'");
    expect(source).toContain('addXcodeLocalizationResource');
    expect(iosBase).toBe(iosPtBr);
    expect(androidDefault).toBe(androidPtBr);
    expect(`${iosBase}\n${androidDefault}`).not.toMatch(
      /Start verification|Start video check/i
    );
    expect(xcodeProject.match(/path = "Base\.lproj\/Localizable\.strings"/g)).toHaveLength(1);
    expect(xcodeProject.match(/path = "pt-BR\.lproj\/Localizable\.strings"/g)).toHaveLength(1);
    expect(xcodeProject).toMatch(/knownRegions = \([\s\S]*\bpt-BR,/);
  });
});
