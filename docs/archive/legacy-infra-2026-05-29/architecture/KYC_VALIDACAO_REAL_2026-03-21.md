# KYC - Validacao Real (VPS + iOS Simulator)
Data: 2026-03-21
Ambiente backend: `https://api.147.182.204.181.sslip.io`
App iOS: Dev Client (Simulator `iPhone 16e`)

## 1) Ajustes aplicados no backend (producao)
- Endpoint de sessao AWS exige `userId`.
- Endpoint de credenciais AWS exige `userId`.
- Sessao AWS inexistente retorna `404` (antes voltava `500`).

Arquivo:
- `leaf-websocket-backend/routes/kyc-routes.js`

## 2) Matriz de validacao KYC (API real na VPS)
Resultado consolidado: `11/11` cenarios aprovados.

Cenarios aprovados:
- Provider AWS liveness ativo.
- Criar sessao sem `userId` => `400`.
- Criar sessao com `userId` => `201`.
- Credenciais sem `userId` => `400`.
- Credenciais com `userId` => `200`.
- Resultado de sessao do proprio usuario => `200`.
- Resultado de sessao com usuario divergente => `403`.
- Resultado de sessao inexistente => `404`.
- Verify sem `userId` => `400`.
- Verify sem `deviceKyc` => `400`.
- Tentativa de bypass por flags de cliente (`livenessPassed/isLive`) => `412 KYC_LIVENESS_REQUIRED`.

Latencia observada no pacote:
- Min: ~735ms
- Media: ~835ms
- Max: ~1144ms

## 3) Front-end (tratamento de erro, estado vazio e falha de conexao)
Testes automatizados executados no app:
- `__tests__/kyc-service.liveness.test.js`
- `__tests__/friendly-error-messages.test.js`
- `__tests__/document-step.kyc.test.js`

Resultado:
- `3` suites passando
- `14` testes passando

Cobertura funcional validada:
- Fallback de liveness para modo local em falha de rede.
- Timeout/falha de fetch com retorno amigavel.
- Sanitizacao de erro tecnico para mensagem legivel.
- Estado vazio com fallback de mensagem.
- Falha de extracao de CNH exibe erro amigavel.
- Extracao de CNH com dados obrigatorios avanca fluxo automaticamente.

## 4) Evidencias no iOS Simulator
Diretorio de capturas:
- `mobile-app/test-results/kyc-live-20260321-131810/`

Capturas principais:
- `01-launch.png` (Dev Client sem servidor)
- `02-connected.png` (carregando bundle)
- `03-app-loaded.png` (app inicializado)
- `13-after-cmd-shift-k-and-cmd-d.png` (UI carregada apos fechar overlay)

## 5) Bloqueio remanescente para validacao visual completa de liveness
No iOS Simulator, o fluxo de camera/liveness real tem limitacoes praticas:
- Sem captura biometrica equivalente a device fisico para validar prova de vida de ponta a ponta.
- Estado atual do app abre em fluxo com modal PIX devido estado/sessao, sem rota de QA dedicada para onboarding KYC por deep link.

Conclusao:
- Regras de KYC e tratamento de erro/estado estao validados tecnicamente em ambiente real.
- Para homologacao visual de prova de vida completa (captura + resultado final AWS em estado `completed`), o passo final deve ocorrer em device fisico.
