#!/usr/bin/env bash

set -euo pipefail

SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
PROJECT_DIR="$(cd "${SCRIPT_DIR}/.." && pwd)"

# shellcheck source=/dev/null
source "${SCRIPT_DIR}/source-local-build-env.sh"

resolve_default_archive() {
  local signed_archive
  local unsigned_archive

  signed_archive="$(find "${PROJECT_DIR}/ios/build" -maxdepth 1 -name "Leaf.xcarchive" -type d 2>/dev/null | head -n 1 || true)"
  unsigned_archive="$(find "${PROJECT_DIR}/ios/build" -maxdepth 1 -name "Leaf-unsigned.xcarchive" -type d 2>/dev/null | head -n 1 || true)"

  if [[ -n "${signed_archive}" ]]; then
    echo "${signed_archive}"
    return
  fi

  if [[ -n "${unsigned_archive}" ]]; then
    echo "${unsigned_archive}"
    return
  fi

  find "${PROJECT_DIR}/ios/build" -maxdepth 1 -name "*.xcarchive" -type d 2>/dev/null | head -n 1 || true
}

resolve_team_id() {
  if [[ -n "${IOS_DEVELOPMENT_TEAM:-}" ]]; then
    echo "${IOS_DEVELOPMENT_TEAM}"
    return
  fi

  local pbxproj="${PROJECT_DIR}/ios/Leaf.xcodeproj/project.pbxproj"
  if [[ -f "${pbxproj}" ]]; then
    local team
    team="$(grep -Eo 'DEVELOPMENT_TEAM = [A-Z0-9]{10};' "${pbxproj}" | head -n 1 | awk '{print $3}' | tr -d ';' || true)"
    if [[ -n "${team}" ]]; then
      echo "${team}"
      return
    fi
  fi

  echo ""
}

main() {
  local archive_path
  local export_path
  local export_method
  local team_id
  local export_options

  archive_path="${IOS_ARCHIVE_PATH:-$(resolve_default_archive)}"
  export_path="${IOS_EXPORT_PATH:-${PROJECT_DIR}/ios/build/export-appstore}"
  export_method="${IOS_EXPORT_METHOD:-app-store-connect}"
  team_id="$(resolve_team_id)"

  if [[ -z "${archive_path}" || ! -d "${archive_path}" ]]; then
    echo "❌ Archive iOS não encontrado. Gere primeiro com: FORCE_UNSIGNED_ARCHIVE=1 npm run build:local:ios:archive"
    exit 1
  fi

  if [[ -z "${team_id}" ]]; then
    echo "❌ Team ID não resolvido. Defina IOS_DEVELOPMENT_TEAM=XXXXXXXXXX"
    exit 1
  fi

  mkdir -p "${PROJECT_DIR}/ios/build"
  rm -rf "${export_path}"

  export_options="${PROJECT_DIR}/ios/build/export-options-${export_method}.plist"

  cat > "${export_options}" <<PLIST
<?xml version="1.0" encoding="UTF-8"?>
<!DOCTYPE plist PUBLIC "-//Apple//DTD PLIST 1.0//EN" "http://www.apple.com/DTDs/PropertyList-1.0.dtd">
<plist version="1.0">
<dict>
  <key>method</key>
  <string>${export_method}</string>
  <key>signingStyle</key>
  <string>automatic</string>
  <key>teamID</key>
  <string>${team_id}</string>
  <key>manageAppVersionAndBuildNumber</key>
  <false/>
  <key>stripSwiftSymbols</key>
  <true/>
  <key>compileBitcode</key>
  <false/>
</dict>
</plist>
PLIST

  echo "══════════════════════════════════════════════════════"
  echo "   Export iOS IPA Local"
  echo "══════════════════════════════════════════════════════"
  echo "📦 Archive: ${archive_path}"
  echo "🏷️  Team ID: ${team_id}"
  echo "🧭 Method: ${export_method}"
  echo "📁 Output: ${export_path}"

  xcodebuild -exportArchive \
    -archivePath "${archive_path}" \
    -exportPath "${export_path}" \
    -exportOptionsPlist "${export_options}" \
    -allowProvisioningUpdates

  if [[ -f "${export_path}/Leaf.ipa" ]]; then
    echo "✅ IPA exportado com sucesso: ${export_path}/Leaf.ipa"
  else
    echo "⚠️  Export finalizado sem Leaf.ipa no diretório esperado"
  fi
}

main "$@"
