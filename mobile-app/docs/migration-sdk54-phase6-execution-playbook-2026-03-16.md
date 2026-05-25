# Fase 6 - Playbook de execucao (simulador x device real x distribuicao interna)

Data: 2026-03-16
Branch: codex/migracao-expo-sdk54-zero-debito

## Resumo executivo

- Simulador/emulador cobre boa parte do fluxo de UI e integracao basica, mas **nao fecha Fase 6 sozinho**.
- Para concluir ponta a ponta com confianca, precisamos de **device real Android e iOS**.
- Distribuicao interna (TestFlight/Firebase/Play internal) deve ser usada **antes** de ampliar para device real de QA ampliado.

## O que da para validar no simulador/emulador

- Login/logout e persistencia local de sessao.
- Fluxo de telas de corrida (criar/aceitar/iniciar/finalizar) com backend real ou mock controlado.
- Chat/websocket basico.
- Regressao de navegacao e estado global.
- Integracoes de API, tratamento de erro e retries.

## O que precisa de device real

- Permissao de localizacao em background real e comportamento com app minimizado.
- Push notification real (foreground/background/cold start) com APNs/FCM de verdade.
- Deep links externos e retorno do app apos abrir Waze/Google Maps.
- Estabilidade de tracking em corrida longa (GPS real, oscilacao de rede e bateria).
- Camera/galeria/PDF com comportamento de permissao do sistema operacional real.

## Ordem recomendada de execucao

1. Emulador/simulador: validar smoke rapido e regressao de UI.
2. Distribuicao interna fechada:
   - Android: Firebase App Distribution ou Play Internal Testing.
   - iOS: TestFlight Internal Testing.
3. Device real de QA (1 Android + 1 iPhone) com checklist de corrida completa.
4. Device real adicional (2-5 pessoas internas) para medir crash-free e estabilidade em uso real.

## Matriz minima para fechar Fase 6

- Android real (motorista):
  - online -> aceitar corrida -> iniciar -> navegar externo -> finalizar.
- Android real (passageiro):
  - solicitar -> acompanhar -> pagamento -> recibo.
- iOS real (motorista/passsageiro):
  - mesmos fluxos + push/background/cold start.
- Evidencias:
  - logs de backend por corrida,
  - captura de telas,
  - IDs de corrida com trilha de tracking persistida.

## Conclusao

- Sim, vale conectar celular agora.
- Prioridade pratica: **Android real primeiro** (ciclo mais rapido), depois **iOS real**.
- Simulador sozinho nao fecha Fase 6; ele e etapa de pre-validacao.
