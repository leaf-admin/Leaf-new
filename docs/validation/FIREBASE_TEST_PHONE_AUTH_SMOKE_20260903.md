# Firebase Test Phone Auth — smoke QA

Data: **3 de setembro de 2026**
Nível: **E2 — autenticação real no bundle Debug**
Device: `Leaf iPhone 17 Dedicated` (`6BC9EC30-C939-4598-A85D-A9E071E90CE5`)

## Objetivo

Confirmar que os usuários QA documentados usam o Firebase Phone Auth com o OTP configurado no Firebase, sem desvio automático para senha, OTP customizado ou bypass de pagamento.

## Perfil executado

- Bundle: `br.com.leaf.ride`, Debug `1.0.4 (35)`.
- Metro isolado: `http://127.0.0.1:8097`.
- `APP_REVIEW=false`.
- `EXPO_PUBLIC_E2E_TEST=true` apenas para o suporte controlado de simulador/app verification; não habilita OTP customizado.
- `EXPO_PUBLIC_ENABLE_QA_OTP_FORCE_FLOW=false`.
- `EXPO_PUBLIC_ENABLE_CUSTOM_OTP_FALLBACK=false`.
- `EXPO_PUBLIC_ENABLE_TEST_USER_TOOLS=false`.
- `EXPO_PUBLIC_FORCE_PAYMENT_BYPASS=false`.
- `EXPO_PUBLIC_BYPASS_PAYMENTS=false`.
- API utilizada pelo app: `https://api.leaf.app.br`.

## Resultado

| Papel | Resultado | Assert final | Artefatos |
| --- | --- | --- | --- |
| Passageiro | PASS | `passenger-home-destination-input` | [`Maestro commands`](../../mobile-app/test-results/ux-lab/20260903T0245-firebase-passenger-auth-smoke/2026-09-02_234948/commands-(qa-session-bootstrap-ios.yaml).json), [`home screenshot`](../../mobile-app/test-results/ux-lab/20260903T0245-firebase-passenger-auth-smoke/passenger-home-firebase.png) |
| Motorista | PASS | `driver-home-toggle-online` | [`Maestro commands`](../../mobile-app/test-results/ux-lab/20260903T0245-firebase-driver-auth-smoke/2026-09-02_235408/commands-(qa-session-bootstrap-ios.yaml).json), [`home screenshot`](../../mobile-app/test-results/ux-lab/20260903T0245-firebase-driver-auth-smoke/driver-home-firebase.png) |

## Evidência de provider

O log nativo do processo `Leaf` registrou, nas duas sessões:

```text
RNFBAuthModule signInWithPhoneNumber
```

Também foi verificado que o recorte do log não contém `custom-otp` nem `OTP_PROVIDER_NOT_CONFIGURED`. O endpoint customizado só apareceu na rodada histórica v8 porque a flag de força QA estava ligada; ele não é o provider dos usuários Firebase Test Phone Numbers.

## Limites

Este smoke prova autenticação Firebase e entrada nas superfícies reais. Não prova corrida E3, quote, Socket.IO operacional, Pix, webhook, recibo ou ledger. Nenhuma cobrança Woovi foi criada e nenhuma corrida foi aberta.

O próximo passo de integração continua condicionado a dois devices Leaf autorizados, ambos bootados e com o app pronto antes do início do cenário bilateral.
