const { withDangerousMod } = require('@expo/config-plugins');
const fs = require('fs');
const path = require('path');

// Ícone monocromático da barra de status. Sem ele o Android usa o ícone do app, que
// aparece como um quadrado branco. Glifo "leaf" do Material Design Icons (Apache 2.0).
const ICON_XML = `<vector xmlns:android="http://schemas.android.com/apk/res/android"
    android:width="24dp"
    android:height="24dp"
    android:viewportWidth="24"
    android:viewportHeight="24">
    <path
        android:fillColor="#FFFFFFFF"
        android:pathData="M17,8C8,10 5.9,16.17 3.82,21.34L5.71,22L6.66,19.7C7.14,19.87 7.64,20 8,20C19,20 22,3 22,3C21,5 14,5.25 9,6.25C4,7.25 2,11.5 2,13.5C2,15.5 3.75,17.25 3.75,17.25C7,8 17,8 17,8Z" />
</vector>
`;

module.exports = function withLeafNotificationIcon(config) {
  return withDangerousMod(config, ['android', async (modConfig) => {
    const drawableDir = path.join(modConfig.modRequest.platformProjectRoot, 'app', 'src', 'main', 'res', 'drawable');
    fs.mkdirSync(drawableDir, { recursive: true });
    fs.writeFileSync(path.join(drawableDir, 'ic_stat_leaf.xml'), ICON_XML);
    return modConfig;
  }]);
};
