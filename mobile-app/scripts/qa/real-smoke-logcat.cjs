"use strict";

const APP_CRASH_CONTEXT_LINES = 40;

function extractCriticalAppLines(logcatText, appPackage = "br.com.leaf.ride") {
  const lines = String(logcatText || "").split(/\r?\n/);
  const critical = [];

  lines.forEach((line, index) => {
    if (/ReactNativeJS.*(TypeError|ReferenceError|Unhandled)|Cannot read propert/i.test(line)) {
      critical.push(line);
      return;
    }

    if (/No bundle URL present|Unable to load script|Network Error/i.test(line)) {
      const context = lines.slice(Math.max(0, index - 5), index + APP_CRASH_CONTEXT_LINES).join("\n");
      if (!appPackage || context.includes(appPackage) || /ReactNativeJS/i.test(context)) {
        critical.push(line);
      }
      return;
    }

    if (!/FATAL EXCEPTION/i.test(line)) return;

    const context = lines.slice(index, index + APP_CRASH_CONTEXT_LINES).join("\n");
    if (/com\.android\.commands\.uiautomator|UiAutomationService/i.test(context)) {
      return;
    }
    if (!appPackage || context.includes(`Process: ${appPackage}`) || context.includes(appPackage)) {
      critical.push(line);
    }
  });

  return critical;
}

module.exports = { extractCriticalAppLines };
