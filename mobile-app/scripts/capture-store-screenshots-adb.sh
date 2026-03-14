#!/usr/bin/env bash
set -euo pipefail

# Captura screenshots do app em dispositivo Android via ADB sem Maestro.
# Uso:
#   bash scripts/capture-store-screenshots-adb.sh
#
# Fluxo:
# 1) Garanta que o app está aberto no estado desejado.
# 2) Pressione Enter para cada tela.
# 3) Arquivos serão salvos em screenshots-for-stores/android/phone/.

ROOT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
OUT_DIR="$ROOT_DIR/screenshots-for-stores/android/phone"
mkdir -p "$OUT_DIR"

if ! command -v adb >/dev/null 2>&1; then
  echo "❌ adb não encontrado. Instale Android Platform Tools."
  exit 1
fi

DEVICE_LINE="$(adb devices | awk 'NR>1 && $2=="device" {print $1; exit}')"
if [[ -z "${DEVICE_LINE}" ]]; then
  echo "❌ Nenhum dispositivo Android conectado/autorizado."
  exit 1
fi

echo "📱 Dispositivo detectado: ${DEVICE_LINE}"
echo "📁 Saída: $OUT_DIR"
echo
echo "Navegue manualmente nas telas do app. Quando a tela estiver pronta, pressione Enter."
echo

SCREENS=(
  "01-home"
  "02-search-address"
  "03-price-card"
  "04-payment-modal"
  "05-searching-driver"
  "06-driver-arriving"
)

ensure_leaf_foreground() {
  local focused
  focused="$(adb shell dumpsys window | rg 'mFocusedApp' || true)"
  if echo "$focused" | rg -q 'br.com.leaf.ride/(.MainActivity|expo.modules.devlauncher.launcher.DevLauncherActivity)'; then
    return 0
  fi

  echo "🚀 Abrindo Leaf app..."
  adb shell am start -n br.com.leaf.ride/.MainActivity >/dev/null 2>&1 || true
  sleep 2
  focused="$(adb shell dumpsys window | rg 'mFocusedApp' || true)"
  if ! echo "$focused" | rg -q 'br.com.leaf.ride/(.MainActivity|expo.modules.devlauncher.launcher.DevLauncherActivity)'; then
    echo "❌ App Leaf não está em foreground. Foco atual:"
    echo "$focused"
    return 1
  fi
}

for name in "${SCREENS[@]}"; do
  if [[ "${AUTO_CAPTURE:-0}" != "1" ]]; then
    read -r -p "Capturar ${name}? [Enter] "
  fi
  ensure_leaf_foreground
  TS="$(date +%Y%m%d_%H%M%S)"
  FILE="$OUT_DIR/${name}_${TS}.png"
  adb exec-out screencap -p > "$FILE"
  echo "✅ $FILE"
done

echo
echo "Concluído. Screenshots salvos em: $OUT_DIR"
