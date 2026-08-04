#!/usr/bin/env bash

set -euo pipefail

if [[ "${EAS_BUILD_PLATFORM:-}" != "ios" ]]; then
  echo "[eas-build-post-install] Nenhum ajuste necessário para ${EAS_BUILD_PLATFORM:-plataforma desconhecida}."
  exit 0
fi

if [[ "$(uname -s)" != "Darwin" || ! -x /usr/bin/defaults ]]; then
  echo "[eas-build-post-install] Ambiente macOS/Xcode esperado não está disponível." >&2
  exit 1
fi

# O AWS Amplify Liveness fixa o pacote Smithy no Package.resolved e usa o
# SmithyCodeGeneratorPlugin durante o archive. O EAS é não interativo, então o
# Xcode não consegue exibir o diálogo de confiança do plugin. Esta chave tem a
# grafia histórica "Validatation" no Xcode e equivale ao argumento
# -skipPackagePluginValidation já usado pela build iOS local.
/usr/bin/defaults write com.apple.dt.Xcode IDESkipPackagePluginFingerprintValidatation -bool YES

if [[ "$(/usr/bin/defaults read com.apple.dt.Xcode IDESkipPackagePluginFingerprintValidatation)" != "1" ]]; then
  echo "[eas-build-post-install] Não foi possível habilitar o plugin Smithy no Xcode não interativo." >&2
  exit 1
fi

echo "[eas-build-post-install] Validação interativa do plugin Swift desabilitada para dependências fixadas."
