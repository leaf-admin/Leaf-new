# OTP por WhatsApp com Firebase Auth — 15/09/2026

## Decisão

O canal de entrega do código passa a ser a WhatsApp Cloud API da Meta. O Firebase Auth continua sendo a autoridade da sessão: depois da confirmação do código no backend, o Leaf Admin SDK emite um custom token e o app conclui com `signInWithCustomToken`.

O app nunca chama a Meta diretamente e não contém access token, WABA ID ou phone number ID. A API da Meta é chamada somente pelo backend, no endpoint versionado `/{PHONE_NUMBER_ID}/messages`, usando um template aprovado da categoria `AUTHENTICATION`.

## Fluxo de login

1. O app envia o telefone para `POST /api/custom-otp/request-otp`.
2. O backend normaliza o E.164, gera um código criptograficamente seguro de seis dígitos e grava somente o HMAC contextualizado no Redis, com TTL de 300 segundos.
3. O backend envia o template de autenticação pela Meta. O código nunca é retornado ao app nem registrado em log.
4. Em falha transitória da Meta, o adaptador tenta novamente no máximo duas vezes. Em falha definitiva, o desafio é removido do Redis e o app recebe uma mensagem genérica.
5. O app envia o código para `POST /api/custom-otp/verify-otp`. O backend compara o HMAC em tempo constante, consome o desafio com compare-and-delete atômico no Redis, apaga todas as chaves de alias e emite o custom token Firebase.
6. O app chama `auth().signInWithCustomToken(customToken)`. UID e telefone continuam sujeitos ao guard de identidade existente.

O reset de senha usa o mesmo canal (`/api/auth/password/reset/request` e `/api/auth/password/reset/confirm`) e o mesmo armazenamento com HMAC. Bypasses de contas de teste continuam isolados para QA/review; a simulação local existe apenas fora de produção. O fallback para Firebase SMS ficou disponível somente quando a política explícita de fallback está habilitada em desenvolvimento/review.

## Variáveis do backend

Use [`config/whatsapp-otp.env.example`](../../../leaf-websocket-backend/config/whatsapp-otp.env.example) como modelo (as mesmas chaves também aparecem no perfil [`soft-release.env.example`](../../../leaf-websocket-backend/config/soft-release.env.example)). Para ativar o provedor no gateway:

```dotenv
AUTH_OTP_PROVIDER=whatsapp
AUTH_OTP_HMAC_KEY=<segredo-dedicado-com-pelo-menos-32-bytes>
WHATSAPP_META_ACCESS_TOKEN=<token-do-system-user>
WHATSAPP_META_PHONE_NUMBER_ID=<phone-number-id-da-meta>
WHATSAPP_META_WABA_ID=<waba-id-opcional-para-operacao>
WHATSAPP_META_GRAPH_BASE_URL=https://graph.facebook.com
WHATSAPP_META_GRAPH_VERSION=v23.0
WHATSAPP_OTP_TEMPLATE_NAME=<nome-exato-do-template-aprovado>
WHATSAPP_OTP_TEMPLATE_LANGUAGE=pt_BR
WHATSAPP_OTP_TIMEOUT_MS=10000
WHATSAPP_OTP_MAX_ATTEMPTS=2
WHATSAPP_OTP_RETRY_DELAY_MS=150
```

`AUTH_OTP_HMAC_KEY` é uma chave nova e dedicada. Ela não deve ser gerada, impressa ou compartilhada no repositório. O validador de runtime exige a chave e as credenciais da Meta no gateway de produção, mas mostra apenas presença e metadados não sensíveis.

O template precisa existir e estar aprovado na WABA com a mesma combinação de nome/locale. O contrato enviado pelo adaptador contém um parâmetro de corpo e o botão OTP no índice `0`; qualquer alteração do template exige atualizar o contrato e os testes antes da ativação.

A geração, o armazenamento e o consumo do OTP são responsabilidades do gateway. Os adaptadores mobile mantêm apenas a chamada aos endpoints Leaf; não geram códigos, não guardam credenciais da Meta e não usam Firebase Phone Auth no fluxo normal.

## Validação local executada

```bash
npx jest --config config/jest.unit.config.js \
  tests/unit/services/otp-challenge-service.unit.test.js \
  tests/unit/services/whatsapp-otp-service.unit.test.js \
  tests/unit/routes/auth-otp.unit.test.js \
  tests/unit/routes/auth-password.unit.test.js \
  --runInBand --coverage=false

npx jest --config config/jest.unit.config.js \
  tests/unit/scripts/validate-runtime-config.unit.test.js \
  --runInBand --coverage=false

npx jest --config jest.config.js \
  __tests__/phone-input-step.auth.test.js \
  __tests__/otp-step.auth.test.js \
  __tests__/auth-flow.recovery.test.js \
  __tests__/friendly-error-messages.test.js \
  --runInBand --coverage=false
```

Nenhuma chamada real à Meta, alteração no Firebase Console, rotação de segredo ou deploy foi feita nesta etapa. Antes de produção ainda é necessário criar/aprovar o template, provisionar o system user com as permissões `whatsapp_business_management` e `whatsapp_business_messaging`, inserir os segredos no runtime e executar um smoke com um número autorizado.

## Verificação externa da Meta — 15/09/2026

A sessão do navegador estava autenticada no portfólio empresarial `Serafy`. Esse portfólio não é a identidade canônica da Leaf: os artefatos legais e o recibo E3 identificam a operação como `LEAF - Freedom Tecnologia e Serviços LTDA`. Portanto, a WABA exibida dentro de `Serafy` é apenas uma descoberta incidental e não pode ser usada para ativar o OTP da Leaf.

Não foi localizado no navegador um portfólio Meta próprio da Leaf. Nenhum número, template, token, permissão ou segredo foi criado ou alterado; o cadastro iniciado em `Serafy` deve ser descartado. A ativação correta precisa começar no Business Portfolio pertencente à Leaf, com nome comercial e dados legais correspondentes.

O gateway continua sem `WHATSAPP_META_PHONE_NUMBER_ID`, template `AUTHENTICATION`, token de system user e chave dedicada `AUTH_OTP_HMAC_KEY` no `.env` protegido (`/opt/leaf-app/.env` no deploy Contabo). Nenhum desses valores foi criado, exibido ou salvo nesta worktree.
