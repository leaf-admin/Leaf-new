#!/usr/bin/env bash

set -euo pipefail

SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
PROJECT_DIR="$(cd "${SCRIPT_DIR}/.." && pwd)"

# shellcheck source=/dev/null
source "${SCRIPT_DIR}/source-local-build-env.sh"

TOOLS_ROOT="${HOME}/.local/mobile-build-tools"
DOWNLOADS_DIR="${TOOLS_ROOT}/downloads"
JDK_TARGET_DIR="${TOOLS_ROOT}/jdk-17"

mkdir -p "${DOWNLOADS_DIR}"

log() {
  echo "➡️  $1"
}

done_ok() {
  echo "✅ $1"
}

warn() {
  echo "⚠️  $1"
}

fail() {
  echo "❌ $1"
  exit 1
}

require_cmd() {
  local cmd="$1"
  local message="$2"
  command -v "${cmd}" >/dev/null 2>&1 || fail "${message}"
}

install_local_jdk() {
  if command -v java >/dev/null 2>&1 && java -version >/dev/null 2>&1; then
    done_ok "Java já disponível: $(java -version 2>&1 | head -n 1)"
    return
  fi

  local machine
  local arch
  local jdk_archive
  local temp_extract
  machine="$(uname -m)"
  case "${machine}" in
    arm64) arch="aarch64" ;;
    x86_64) arch="x64" ;;
    *) fail "Arquitetura não suportada para download automático de JDK: ${machine}" ;;
  esac

  jdk_archive="${DOWNLOADS_DIR}/jdk17-${arch}.tar.gz"
  temp_extract="${TOOLS_ROOT}/tmp-jdk-extract"

  log "Instalando JDK 17 local em ${JDK_TARGET_DIR}"
  curl -fsSL -L "https://api.adoptium.net/v3/binary/latest/17/ga/mac/${arch}/jdk/hotspot/normal/eclipse" -o "${jdk_archive}"

  rm -rf "${temp_extract}" "${JDK_TARGET_DIR}"
  mkdir -p "${temp_extract}" "${JDK_TARGET_DIR}"
  tar -xzf "${jdk_archive}" -C "${temp_extract}"

  local extracted_dir
  extracted_dir="$(find "${temp_extract}" -mindepth 1 -maxdepth 1 -type d | head -n 1)"
  [[ -n "${extracted_dir}" ]] || fail "Não foi possível extrair o JDK."

  cp -R "${extracted_dir}/Contents/Home/." "${JDK_TARGET_DIR}/"
  rm -rf "${temp_extract}"

  export JAVA_HOME="${JDK_TARGET_DIR}"
  export PATH="${JAVA_HOME}/bin:${PATH}"
  done_ok "JDK 17 instalado localmente em ${JAVA_HOME}"
}

install_android_cmdline_tools() {
  local sdkmanager_bin="${ANDROID_SDK_ROOT}/cmdline-tools/latest/bin/sdkmanager"
  if [[ -x "${sdkmanager_bin}" ]]; then
    done_ok "Android cmdline-tools já instalados"
    return
  fi

  local revisions=("13114758" "12266719" "11076708" "10406996" "9477386")
  local selected_url=""
  local revision
  for revision in "${revisions[@]}"; do
    local candidate="https://dl.google.com/android/repository/commandlinetools-mac-${revision}_latest.zip"
    if curl -fsI "${candidate}" >/dev/null 2>&1; then
      selected_url="${candidate}"
      break
    fi
  done

  [[ -n "${selected_url}" ]] || fail "Não foi possível localizar URL válida do Android cmdline-tools."

  local archive="${DOWNLOADS_DIR}/android-cmdline-tools.zip"
  local temp_extract="${TOOLS_ROOT}/tmp-android-cmdline-tools"

  log "Baixando Android cmdline-tools"
  mkdir -p "${ANDROID_SDK_ROOT}"
  curl -fsSL -L "${selected_url}" -o "${archive}"

  rm -rf "${temp_extract}" "${ANDROID_SDK_ROOT}/cmdline-tools/latest"
  mkdir -p "${temp_extract}" "${ANDROID_SDK_ROOT}/cmdline-tools/latest"
  unzip -q "${archive}" -d "${temp_extract}"

  [[ -d "${temp_extract}/cmdline-tools" ]] || fail "Estrutura inesperada no zip de cmdline-tools."
  cp -R "${temp_extract}/cmdline-tools/." "${ANDROID_SDK_ROOT}/cmdline-tools/latest/"
  rm -rf "${temp_extract}"

  export PATH="${ANDROID_SDK_ROOT}/cmdline-tools/latest/bin:${PATH}"
  done_ok "Android cmdline-tools instalados"
}

install_android_packages() {
  require_cmd sdkmanager "sdkmanager não encontrado após instalação do Android cmdline-tools."

  log "Aceitando licenças do Android SDK"
  yes | sdkmanager --sdk_root="${ANDROID_SDK_ROOT}" --licenses >/dev/null || true

  log "Instalando pacotes Android necessários"
  sdkmanager --sdk_root="${ANDROID_SDK_ROOT}" "platform-tools" >/dev/null
  sdkmanager --sdk_root="${ANDROID_SDK_ROOT}" "platforms;android-35" >/dev/null
  if ! sdkmanager --sdk_root="${ANDROID_SDK_ROOT}" "build-tools;35.0.0" >/dev/null; then
    warn "build-tools 35.0.0 indisponível, tentando 34.0.0"
    sdkmanager --sdk_root="${ANDROID_SDK_ROOT}" "build-tools;34.0.0" >/dev/null
  fi

  done_ok "Pacotes Android instalados"
}

install_cocoapods() {
  local required_version="1.15.2"
  local current_version=""
  if command -v pod >/dev/null 2>&1; then
    current_version="$(pod --version 2>/dev/null || true)"
    if ruby -e 'exit Gem::Version.new(ARGV[0]) >= Gem::Version.new(ARGV[1]) ? 0 : 1' "${current_version}" "${required_version}"; then
      done_ok "CocoaPods já disponível: ${current_version}"
      return
    fi
    warn "CocoaPods ${current_version} é antigo para SDK 54 iOS; atualizando para ${required_version}+"
  fi

  log "Instalando CocoaPods no usuário atual"
  if ! gem install --user-install cocoapods -v "${required_version}" --no-document; then
    warn "Falha ao instalar CocoaPods ${required_version}, tentando com gems auxiliares"
    gem install --user-install ffi -v 1.15.5 --no-document || true
    gem install --user-install securerandom -v 0.3.2 --no-document || true
    gem install --user-install drb -v 2.0.6 --no-document || true
    gem install --user-install cocoapods -v "${required_version}" --no-document
  fi

  # shellcheck source=/dev/null
  source "${SCRIPT_DIR}/source-local-build-env.sh"
  require_cmd pod "Falha ao instalar CocoaPods (pod não encontrado no PATH)."
  current_version="$(pod --version 2>/dev/null || true)"
  if ! ruby -e 'exit Gem::Version.new(ARGV[0]) >= Gem::Version.new(ARGV[1]) ? 0 : 1' "${current_version}" "${required_version}"; then
    fail "CocoaPods ${current_version} ainda incompatível. Atualize para ${required_version}+."
  fi
  done_ok "CocoaPods instalado: ${current_version}"
}

main() {
  echo "══════════════════════════════════════════════════════"
  echo "   Setup Local de Build (macOS) - Sem depender do EAS"
  echo "══════════════════════════════════════════════════════"
  echo "Projeto: ${PROJECT_DIR}"
  echo

  require_cmd curl "curl é obrigatório."
  require_cmd unzip "unzip é obrigatório."
  require_cmd tar "tar é obrigatório."
  require_cmd ruby "Ruby é obrigatório para instalar CocoaPods."
  require_cmd xcodebuild "Xcode não encontrado. Instale Xcode antes de continuar."

  install_local_jdk
  install_android_cmdline_tools
  install_android_packages
  install_cocoapods

  echo
  done_ok "Setup concluído."
  echo "Próximo passo: npm run env:local:doctor"
}

main "$@"
