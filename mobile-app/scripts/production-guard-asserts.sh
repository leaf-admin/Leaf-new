#!/usr/bin/env bash
set -euo pipefail

ROOT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
cd "$ROOT_DIR"

fail() {
  echo "[production-guards][fail] $1" >&2
  exit 2
}

require_pattern() {
  local file="$1"
  local pattern="$2"
  local label="$3"
  if ! rg -q "$pattern" "$file"; then
    fail "$label missing in $file"
  fi
}

for file in \
  "src/common-local/actions/bookingactions.js" \
  "src/common-local/bookingactions.js"; do
  require_pattern "$file" "assertCanonicalBookingPath" "legacy Firebase booking blocker"
  require_pattern "$file" "EXPO_PUBLIC_ALLOW_LEGACY_FIREBASE_BOOKING" "explicit legacy-booking override flag"
  require_pattern "$file" "Fluxo legado de criação de corrida bloqueado" "legacy booking production error"
done

require_pattern "src/services/HelpService.js" "__DEV__" "dev-only help fallback guard"
require_pattern "src/utils/axiosInterceptor.js" "currentUser.getIdToken" "Firebase bearer token interceptor"
require_pattern "src/services/UserAuthService.js" "/api/auth/password/login" "phone password login endpoint"
require_pattern "src/services/UserAuthService.js" "/api/auth/password/setup" "phone password setup endpoint"
require_pattern "src/components/auth/AuthFlow.js" "onPasswordLoginSuccess" "password login flow handoff"
require_pattern "src/components/auth/steps/PhoneInputStep.js" "requiresPassword" "inline password gating"
require_pattern "src/components/auth/steps/PhoneInputStep.js" "Esqueci minha senha" "inline forgot password action"
require_pattern "src/components/auth/steps/ProfileDataStep.js" "confirmPassword" "single-screen passenger password confirmation"
require_pattern "src/components/map/PassengerUI.js" "pricingUnavailable" "backend pricing unavailable guard"
require_pattern "src/components/auth/steps/PhoneInputStep.js" "FORCE_CUSTOM_OTP_NUMBERS" "controlled review account gate"
require_pattern "src/components/auth/AuthFlow.js" "isReviewEnv" "review OTP gate runtime guard"
require_pattern "src/components/auth/AuthFlow.js" "canBypass = skipOTP" "review OTP bypass gate expression"
require_pattern "src/components/auth/steps/OTPStep.js" "allowQaOtpForceFlow" "QA OTP gate"
require_pattern "src/components/auth/steps/OTPStep.js" "allowReviewAccess" "review OTP validation gate"
require_pattern "src/components/auth/steps/OTPStep.js" "Código de teste não permitido neste ambiente" "test OTP production block"
require_pattern "src/config/runtimeAccessPolicy.js" "hasExplicitCustomOtpFallbackFlag" "custom OTP fallback explicit flag gate"
require_pattern "src/config/runtimeAccessPolicy.js" "hasExplicitQaOtpForceFlag" "QA OTP force explicit flag gate"
require_pattern "src/config/runtimeAccessPolicy.js" "hasExplicitTestUserToolsFlag" "test tools explicit flag gate"
require_pattern "src/config/runtimeAccessPolicy.js" "allowPaymentBypass" "payment bypass function presence"
require_pattern "src/config/runtimeAccessPolicy.js" "hasExplicitPaymentBypassFlag" "payment bypass explicit flag gate"
require_pattern "src/screens/prototype/prototypeRideRuntime.js" "allowCustomOtpFallback" "prototype runtime OTP fallback gate"
require_pattern "src/screens/prototype/prototypeRideRuntime.js" "allowTestUserTools" "prototype runtime test-user gate"
require_pattern "src/screens/prototype/prototypeRideRuntime.js" "Restauração de sessão por OTP customizado bloqueada" "prototype runtime OTP production block"
require_pattern "app.config.js" "ACCESS_BACKGROUND_LOCATION" "Android background location permission"
require_pattern "app.config.js" "FOREGROUND_SERVICE_LOCATION" "Android foreground service location permission"
require_pattern "app.config.js" "isAndroidForegroundServiceEnabled" "Expo Location foreground service config"
require_pattern "app.config.js" "isIosBackgroundLocationEnabled" "iOS background location config"

echo "[production-guards] PASS"
