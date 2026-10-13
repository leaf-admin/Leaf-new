const { withMainApplication } = require('@expo/config-plugins');

// Keeps the fix in MainApplication.onCreate across `expo prebuild`: create the
// expo-task-manager TaskService with the Application context before React
// starts. See the comment inserted below for the reason.
const MARKER = '@leaf-task-service-application-context';
const IMPORT = 'import expo.modules.interfaces.taskManager.TaskServiceProviderHelper';
const BLOCK = `    // ${MARKER} begin
    // expo-task-manager 14 keeps one TaskService per process, holding a weak
    // reference to whatever context created it. Created later by React, that is
    // a ReactContext which dies on reload or after a headless task, and every
    // background-location start then fails with a NullPointerException. Creating
    // it here binds it to the Application, which lives as long as the process.
    TaskServiceProviderHelper.getTaskServiceImpl(applicationContext)
    // ${MARKER} end
`;

module.exports = function withTaskServiceApplicationContext(config) {
  return withMainApplication(config, (mod) => {
    let contents = mod.modResults.contents;
    if (mod.modResults.language !== 'kt' || contents.includes(MARKER)) {
      return mod;
    }
    if (!contents.includes(IMPORT)) {
      contents = contents.replace(
        /(import expo\.modules\.ReactNativeHostWrapper\n)/,
        `$1${IMPORT}\n`,
      );
    }
    contents = contents.replace(
      /(override fun onCreate\(\) \{\n\s*super\.onCreate\(\)\n)/,
      `$1${BLOCK}`,
    );
    mod.modResults.contents = contents;
    return mod;
  });
};
