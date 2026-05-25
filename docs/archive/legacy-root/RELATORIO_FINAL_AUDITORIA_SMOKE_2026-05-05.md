# RELATORIO FINAL - AUDITORIA + SMOKE MANUAL GUIADO

Data: 2026-05-05  
Workspace: `/Users/izaakdias/Documents/Leaf-new`

## 1) Escopo consolidado

- Auditoria UI/UX P0 + P1 + P2.
- Hardening de visibilidade de exclusao de conta para App Review.
- Smokes manuais guiados (Android + iOS simulator) com coleta de artefatos.
- Validacao de fluxo phone-first (telefone existente -> senha / novo -> OTP).

## 2) Build validada apos correcao

### iOS (simulator)

- Bundle ID: `br.com.leaf.ride`
- Versao validada: `1.0.1 (16)`
- Build gerada localmente via `xcodebuild` e instalada no simulador.

### Android (emulator)

- Package: `br.com.leaf.ride`
- VersionName: `1.0.2`
- VersionCode: `106`

## 3) Correcao aplicada (compliance 5.1.1(v))

### O que foi ajustado

- `mobile-app/src/screens/prototype/robotaxiMenuConfig.js`
  - "Privacidade e exclusao de conta" movida para o topo de "Suporte e ajustes".
- `mobile-app/src/screens/prototype/RobotaxiProfileScreen.js`
  - "Privacidade e exclusao de conta" movida para o topo de "Acessos rapidos".
- `mobile-app/__tests__/robotaxi-menu-config.test.js`
  - Novo teste para garantir shortcut de exclusao em motorista e passageiro.

### Validacao visual na build 16

- Menu do motorista: item "Privacidade e exclusao de conta" visivel.
- Perfil do motorista: item "Privacidade e exclusao de conta" visivel.
- Navegacao para tela `Privacidade e Conta` funcionando.
- Botao `Excluir Conta` visivel no primeiro viewport da tela de privacidade.

## 4) Smokes guiados executados (pos-correcao)

Artefatos:

- `mobile-app/test-results/phase6_manual_device_20260505_052202`
- `mobile-app/test-results/phase6_cross_20260505_052306`

Resultado objetivo:

- Android critical log lines: `0`
- iOS critical log lines: `0`
- Sem crash fatal nos filtros do smoke.

Limitacao de ambiente:

- `backend-health.json` permaneceu vazio (falha de conexao para `https://api.147.182.204.181.sslip.io/health` neste ambiente local).

## 5) Testes automatizados desta rodada

Executados e PASS:

- `cd mobile-app && npx jest --runInBand __tests__/phone-input-step.auth.test.js __tests__/robotaxi-menu-config.test.js`
- `cd mobile-app && npx jest --runInBand __tests__/driver-live-ride-overlay.test.js -t "renders an accepted active ride without requiring driverTripMeta|keeps trip actions compact while the trip is started"`
- `cd leaf-websocket-backend && npx jest --config config/jest.unit.config.js tests/unit/routes/auth-otp.unit.test.js tests/unit/routes/auth-password.unit.test.js`

Observacao:

- A suite mobile `phone-input-step.auth.test.js` foi atualizada para o contrato atual de OTP QA (sem expectativa legada de custom token login).

## 6) Status final

### Compliance Apple (Guideline 5.1.1(v))

**RESOLVIDO na build iOS 1.0.1 (16)**, com evidencia visual de:

- caminho curto para privacidade/exclusao no menu,
- caminho no perfil,
- opcao de exclusao visivel na tela de privacidade.

### Smoke E2E autoritativo completo

**PARCIAL**, por indisponibilidade do endpoint de health no ambiente local de validacao.

## 7) Veredito objetivo

- Para o bloqueio de exclusao de conta da Apple: **OK para reenvio**.
- Para fechamento E2E backend-source-of-truth nesta maquina: **pendente somente conectividade do backend**.

