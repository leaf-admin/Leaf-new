# Production Real Readiness - 2026-04-10

## Status honesto

- Backend/realtime na Contabo: `GO`
- Build de release do app:
  - Android local release: `GO`
  - iOS local release: `GO`
  - iOS remoto no EAS: `em fila`
- Store submission pública: `NO-GO` até fechar itens manuais de console e validação real em device

## Ajustes técnicos fechados hoje

- Host padrão do app e URLs legais migrados para `https://api.62.169.31.231.sslip.io`
- WebSocket padrão migrado para `https://socket.62.169.31.231.sslip.io`
- Fallback legado em `src/common-local` alinhado ao host novo
- Geofence remoto no `MapScreen` deixou de cair no host antigo
- Fluxo de saque/repasse do motorista desligado por padrão no release
- Backend da Contabo com flags de segurança alinhadas:
  - `PAYMENT_BYPASS_ON_WOOVI_FAILURE=false`
  - `PAYMENT_FORCE_BYPASS=false`
  - `BYPASS_GEOFENCE=false`
  - `APP_REVIEW=false`
  - `ENABLE_DRIVER_WITHDRAWALS=false`

## O que já está pronto

- Login por telefone usa Firebase Phone Auth no caminho real
- Exclusão de conta existe no app e no backend
- Privacy policy, terms, refund policy e account deletion estão publicados no host atual
- Corridas, pricing, dispatch e capacidade operacional já foram validados na Contabo
- Credenciais remotas iOS de release estão válidas no EAS:
  - bundle `br.com.leaf.ride`
  - team `DTA8W5KA5D`
  - certificate/profile válidos até `2026-12-26`
- Credenciais remotas Android de release estão válidas no EAS:
  - keystore `Build Credentials J8NqhgdaGa`
- Arquivos Firebase de Android/iOS já foram cadastrados como file env vars no EAS:
  - `GOOGLE_SERVICES_JSON`
  - `GOOGLE_SERVICES_INFO_PLIST`

## Validação adicional fechada depois do preflight

- `EAS iOS`: upload reaberto com archive reduzido de `1.6 GB` para `1.3 GB` após criar `.easignore` na raiz do monorepo.
- `EAS iOS`: o build remoto antigo falhou por `react_native_maps.AIRMapCalloutManager`; esse erro foi corrigido no código com patch persistente pós-install.
- `EAS iOS`: novo build remoto registrado em fila:
  - build id `22018065-1b25-4891-8d75-24911634d436`
  - status atual: `IN_QUEUE`
- `iOS local Release`: `BUILD SUCCEEDED` no simulador após o patch do `react-native-maps`, sem reproduzir o erro antigo de `RCTViewManager` / `AIRMapCalloutManager`.
- `iOS local Release cold start`: depois do boot completo do simulador, a release saiu do splash e caiu na tela correta de telefone:
  - `Bem-vindo(a) à Leaf`
  - campo de número com DDI `+55`
  - botão `Continuar` desabilitado até preencher o número
- `Android local Release APK`: `BUILD SUCCESSFUL`, instalado e aberto em device real Android.
- `Android local Release cold start`: após `pm clear`, o app caiu na tela correta de telefone:
  - `Bem-vindo(a) à Leaf`
  - campo `auth-phone-input`
  - botão `auth-continue-btn` desabilitado até preencher o número
- `Android local AAB`: `BUILD SUCCESSFUL`
  - artefato: `/Users/izaakdias/Documents/Leaf-new/mobile-app/android/app/build/outputs/bundle/release/app-release.aab`
- `EAS Android`: novo build remoto registrado:
  - build id `fc84905a-f7e4-4483-addc-f0b79dcdd02c`
  - status atual: `NEW`
- como fallback seguro, o `.aab` local assinado já existe mesmo sem depender do EAS.
- `Repo hygiene`: artefatos grandes de QA/build do `mobile-app` foram removidos do índice Git e protegidos por `.gitignore`, mantendo os arquivos no disco local mas tirando esse peso do fluxo de release.

## O que ainda precisa de signoff antes da produção pública

### Validação real em build release

- Android release:
  - login OTP real
  - criação de corrida
  - pagamento Woovi real
  - aceite/início/finalização
  - geofence dentro e fora da área
  - mapa, rota e navegação
- iOS release:
  - login OTP real
  - criação de corrida
  - pagamento Woovi real
  - aceite/início/finalização
  - geofence dentro e fora da área
  - mapa, rota e navegação
  - archive local gerado: `ios/build/Leaf.xcarchive`, bundle `br.com.leaf.ride`

## Bloqueador atual encontrado no OTP Android release

- O app release Android local chegou até o `signInWithPhoneNumber`, mas falhou na verificação do Firebase Auth antes de enviar o SMS.
- Evidência do `logcat`:
  - `Invalid PlayIntegrity token; app not Recognized by Play Store`
  - `GetAuthDomainTask`: `INVALID_APP_ID 400`
  - `Failed to get reCAPTCHA token ... [ INVALID_APP_ID ]`
  - `SMS verification code request failed: unknown status code: 17093`
- Reteste após adicionar fingerprints no console:
  - APK release local confirmado com as fingerprints abaixo via `apksigner`.
  - App instalado em device real como sideload (`installerPackageName=null`).
  - O erro permaneceu no mesmo ponto, antes do envio do SMS.
- Interpretação:
  - em build sideloadada, o fluxo de Play Integrity falha por não ser uma instalação da Play Store;
  - o fallback de reCAPTCHA também não está aceitando a configuração atual do app.
- Pela documentação oficial da Firebase Auth para Android, isso normalmente exige conferir:
  - `SHA-256` do app para Play Integrity
  - `SHA-1` do app para o fallback reCAPTCHA
  - API key irrestrita ou allowlist para `leaf-reactnative.firebaseapp.com`

### Fingerprints da assinatura release local

- `SHA-1`: `CA:87:E4:2C:77:FF:E0:EA:83:C7:F0:18:63:85:3B:56:2C:D0:8B:D3`
- `SHA-256`: `B8:A2:ED:46:34:36:06:A6:2C:C1:26:92:BE:62:32:3E:29:69:CD:F4:C8:3F:B5:41:80:D9:24:73:8A:7C:9B:F4`

### Ação manual necessária

- Firebase Console > Project settings > Android app `br.com.leaf.ride`
  - confirmar `SHA-1` e `SHA-256` acima
- Google Cloud Console > Credentials
  - abrir a API key usada pelo Android/Firebase Auth
  - deixar irrestrita ou allowlist para `leaf-reactnative.firebaseapp.com`
- Se houver Play App Signing no Google Play, adicionar também as fingerprints do certificado de assinatura da Play, além da keystore local.
- Para validar o caminho Android de produção real, preferir instalar via faixa interna/fechada do Google Play; o sideload dispara o fallback de reCAPTCHA nas versões recentes do SDK.

### Correção aplicada via Firebase Management API

- Causa raiz encontrada:
  - o `google_app_id` anterior (`1:106504629884:android:b85380c4a25ce8c7a1a3f9`) estava associado no Firebase ao Android package `br.app.leaf.ride`;
  - o APK real usa `br.com.leaf.ride`;
  - por isso o app caía em `INVALID_APP_ID` mesmo com as SHAs corretas.
- Ação aplicada:
  - criado novo Android app no projeto `leaf-reactnative` para `br.com.leaf.ride`;
  - novo `google_app_id`: `1:106504629884:android:7940a5a0c0ef6dbda1a3f9`;
  - adicionadas as fingerprints release local (`SHA-1` e `SHA-256`) ao app novo;
  - atualizado `google-services.json` e `android/app/google-services.json`;
  - recompilado APK release e reinstalado em device real.
- Reteste após correção:
  - `INVALID_APP_ID` não apareceu mais;
  - o callback reCAPTCHA voltou para `leaf-reactnative.firebaseapp.com/__/auth/callback`;
  - o bloqueio atual virou `FirebaseAuth` status `17010`, compatível com throttle/too many requests após várias tentativas no mesmo device/número.
  - novo reteste local em `2026-04-10 17:10 BRT` com APK release recompilado, `pm clear` no app e número `+5521998991886` ausente no Firebase Auth, RTDB (`users`/`drivers`) e Firestore (`users`/`drivers`);
  - resultado do reteste: o app exibiu corretamente `Limite de Tentativas` e o `logcat` confirmou `We have blocked all requests from this device due to unusual activity. Try again later.`
- Artefatos/builds após correção:
  - APK release local recompilado e instalado em device real;
  - AAB release local recompilado e validado com `jarsigner` (`jar verified`, com avisos esperados de AAB/certificado local);
  - EAS `GOOGLE_SERVICES_JSON` production atualizado com o novo arquivo;
  - EAS Android production build novo registrado: `52dcd9a9-9fe2-47e3-9dea-5e7a6fef7de7` (`NEW`);
  - `.easignore` raiz ajustado para reduzir o archive EAS de ~1.3 GB para ~88.4 MB.
- Próximo reteste:
  - aguardar a janela de throttle do Firebase ou testar com outro número real;
  - evitar novas tentativas repetidas com o mesmo número para não prolongar o bloqueio.

### UX de erro de autenticacao endurecida

- O fluxo `PhoneInputStep` agora trata explicitamente erros do Firebase Auth por codigo, incluindo:
  - `auth/too-many-requests`
  - `17010`
  - `auth/invalid-phone-number`
  - `auth/quota-exceeded`
  - `auth/network-request-failed`
- Resultado:
  - throttle do Firebase agora aparece para o usuario como `Limite de Tentativas`, em vez de um erro generico;
  - erros de telefone invalido, limite de SMS e falha de rede tambem ficaram mais claros.
- Cobertura validada por testes:
  - `__tests__/friendly-error-messages.test.js`
  - `__tests__/phone-input-step.auth.test.js`

### Console / revisão de lojas

- Google Play Console:
  - Data Safety completo e publicado
  - account deletion URL preenchida
  - App Access com credenciais de review
  - declaração de background location enviada
  - vídeo de background location anexado
- App Store Connect:
  - App Privacy / Nutrition Labels revisadas
  - Review notes preenchidas
  - acesso de review preenchido
  - metadata final e URLs finais conferidas

## Regras para chamar de GO

- `OTP real`: PASS em Android e iOS release
- `Woovi real`: PASS ponta a ponta no host Contabo
- `Geofence`: PASS dentro e fora da área operacional
- `Maps/routes`: PASS em corrida real release
- `Play Console`: todos os campos obrigatórios enviados
- `App Store Connect`: todos os campos obrigatórios enviados

## Regra de proteção operacional

- Saque do motorista fica desligado por padrão até existir signoff explícito do fluxo backend + app.
- Qualquer build pública deve sair com:
  - `APP_REVIEW=false`
  - `driverWithdrawalsEnabled=false`
  - host atual da Contabo, nunca o host antigo da provedor anterior

## Comando útil

Rodar preflight local do app antes de gerar release:

```bash
cd /Users/izaakdias/Documents/Leaf-new/mobile-app
bash scripts/store-console-preflight.sh
```
