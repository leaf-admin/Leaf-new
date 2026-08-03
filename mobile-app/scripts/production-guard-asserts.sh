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
  if command -v rg >/dev/null 2>&1; then
    rg -q "$pattern" "$file" || fail "$label missing in $file"
  elif ! grep -Eq "$pattern" "$file"; then
    fail "$label missing in $file"
  fi
}

node scripts/qa/validate-release-runtime-policy.cjs

for file in \
  "src/services/TripDataService.js" \
  "src/common-local/locationactions.js"; do
  if [[ -e "$file" ]]; then
    fail "legacy direct trip_data writer must remain removed: $file"
  fi
done

if [[ -e "src/services/VehicleService.js" ]]; then
  fail "legacy direct vehicle writer must remain removed"
fi

if command -v rg >/dev/null 2>&1; then
  if rg -q "@react-native-firebase/database|RECEIPT_RTDATABASE_FALLBACK" "src/services/ReceiptService.js"; then
    fail "receipt recovery must remain Leaf API-only"
  fi
elif grep -Eq "@react-native-firebase/database|RECEIPT_RTDATABASE_FALLBACK" "src/services/ReceiptService.js"; then
  fail "receipt recovery must remain Leaf API-only"
fi

if [[ -e "src/utils/userDatabaseService.js" ]]; then
  fail "misleading direct-database onboarding profile layer must remain removed"
fi

for file in \
  "src/screens/CNHUploadScreen.js" \
  "src/screens/CRLVUploadScreen.js" \
  "src/screens/CompleteRegistrationScreen.js" \
  "src/screens/DriverTermsScreen.js" \
  "src/screens/OTPScreen.js" \
  "src/screens/Registration.js" \
  "src/screens/ProfileSelectionScreen.js" \
  "src/screens/WelcomeScreen.js"; do
  if [[ -e "$file" ]]; then
    fail "simulated document/onboarding screen must remain removed: $file"
  fi
done

if command -v rg >/dev/null 2>&1; then
  if rg -q "@react-native-firebase/database" "src/services/UserAuthService.js"; then
    fail "password/auth resolution must not read RTDB from the mobile client"
  fi
elif grep -q "@react-native-firebase/database" "src/services/UserAuthService.js"; then
  fail "password/auth resolution must not read RTDB from the mobile client"
fi

for file in \
  "src/services/canonical/rideService.js" \
  "src/services/runtime/bookingStateBridge.js" \
  "src/services/runtime/ratingStateBridge.js"; do
  if [[ -e "$file" ]]; then
    fail "retired ride Redux action graph must remain removed: $file"
  fi
done

if [[ -d "src/common-local/actions" ]] && find "src/common-local/actions" -maxdepth 1 -type f -name '*.js' -print -quit | grep -q .; then
  fail "retired common-local Redux action modules must remain removed"
fi

if command -v rg >/dev/null 2>&1; then
  if rg -q "EXPO_PUBLIC_ALLOW_LEGACY_FIREBASE_BOOKING|Fluxo legado de criação de corrida bloqueado" src; then
    fail "retired direct Firebase booking override must remain removed"
  fi
elif grep -REq "EXPO_PUBLIC_ALLOW_LEGACY_FIREBASE_BOOKING|Fluxo legado de criação de corrida bloqueado" src; then
  fail "retired direct Firebase booking override must remain removed"
fi

require_pattern "src/services/HelpService.js" "__DEV__" "dev-only help fallback guard"
require_pattern "src/utils/axiosInterceptor.js" "currentUser.getIdToken" "Firebase bearer token interceptor"
require_pattern "src/services/UserAuthService.js" "/api/auth/password/login" "phone password login endpoint"
require_pattern "src/services/UserAuthService.js" "/api/auth/password/setup" "phone password setup endpoint"
require_pattern "src/services/OnboardingProfileService.js" "MobileProfileService" "canonical onboarding profile adapter"
require_pattern "src/components/auth/AuthFlow.js" "OnboardingProfileService.saveOnboardingProfile" "canonical onboarding profile persistence"
require_pattern "src/components/auth/AuthFlow.js" "onPasswordLoginSuccess" "password login flow handoff"
require_pattern "src/components/auth/steps/PhoneInputStep.js" "requiresPassword" "inline password gating"
require_pattern "src/components/auth/steps/PhoneInputStep.js" "Esqueci minha senha" "inline forgot password action"
require_pattern "src/components/auth/steps/ProfileDataStep.js" "confirmPassword" "single-screen passenger password confirmation"
require_pattern "src/screens/prototype/RobotaxiHomeScreen.js" "fetchDynamicPricingQuote" "canonical backend pricing call"
require_pattern "src/screens/prototype/RobotaxiHomeScreen.js" "if \(!selectedHomeBackendQuoteReady \|\| !homeBackendQuote\?\.quote\)" "backend pricing unavailable guard"
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
require_pattern "src/config/runtimeAccessPolicy.js" "hasExplicitClientDirectGoogleFallbackFlag" "direct Google fallback explicit flag gate"
require_pattern "src/config/runtimeAccessPolicy.js" "allowTestUserTools\\(\\) && hasExplicitPaymentBypassFlag" "forced payment bypass requires QA tools gate"
require_pattern "src/services/PaymentBypassService.js" "allowPaymentBypass" "payment bypass service runtime policy gate"
require_pattern "src/services/DatabaseBypass.js" "allowTestUserTools" "database bypass service test-user runtime policy gate"
require_pattern "src/screens/prototype/prototypeRideRuntime.js" "allowCustomOtpFallback" "prototype runtime OTP fallback gate"
require_pattern "src/screens/prototype/prototypeRideRuntime.js" "allowTestUserTools" "prototype runtime test-user gate"
require_pattern "src/screens/prototype/prototypeRideRuntime.js" "Restauração de sessão por OTP customizado bloqueada" "prototype runtime OTP production block"
require_pattern "app.config.js" "ACCESS_BACKGROUND_LOCATION" "Android background location permission"
require_pattern "app.config.js" "FOREGROUND_SERVICE_LOCATION" "Android foreground service location permission"
require_pattern "app.config.js" "isAndroidForegroundServiceEnabled" "Expo Location foreground service config"
require_pattern "app.config.js" "isIosBackgroundLocationEnabled" "iOS background location config"

echo "[production-guards] PASS"
