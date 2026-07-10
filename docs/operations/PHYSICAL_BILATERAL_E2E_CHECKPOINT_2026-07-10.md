# Checkpoint — E2E físico bilateral

Pausa solicitada em 10/07/2026, aproximadamente 19h50 (America/Sao_Paulo).

## Estado congelado

- Branch: `codex/p0-p1-no-regression-hardening`.
- RC: `7be3b0797b87e44208c84a2fdc292a8ec3425b18`.
- Worktree estava limpo antes da criação deste checkpoint.
- Android instalado: Leaf `1.0.4 (126)`.
- iOS instalado: Leaf `1.0.4 (34)`.
- Android APK SHA-256: `fa2df4ba11d2df5173cd362ba7bb3ec45f2cc2d2ef87873f0bec00b0127a8766`.
- iOS executável SHA-256: `9d9dd838c373c208dc66e8eb97e1de541b7ca74821d6893e35e5673218ec835a`.
- Os dois artefatos usam runtime `1.0.4`, canal OTA `production`, perfil mobile `full` e não embutem bypass, E2E ou ferramentas de usuário de teste.
- Runtime remoto: `ride_flow_validation`; gateways `leaf-websocket`, `leaf-websocket-gateway-2` e `leaf-websocket-gateway-3` saudáveis.
- Timeout de oferta efetivo nos três gateways: sandbox `20s`; produtivo `20s`.
- Rollback do backend: `/opt/leaf-app/backups/modular-rollout-20260710-190321`.
- Backup anterior do env remoto: `/opt/leaf-app/backups/runtime-env-20260711-000309/.env.before`.

## Estado dos aparelhos ao pausar

- iPhone: usuário motorista, explicitamente colocado offline antes da pausa.
- Android: usuário passageiro, sem corrida ativa; voltou ao home após expiração do Pix sandbox.
- Nenhum processo de gravação, log contínuo ou simulação de localização permaneceu ativo.
- Simulação iOS limpa.
- Test provider Android removido, permissão de mock negada e rotação automática restaurada para `1`.
- Evidência visual local do checkpoint:
  - `qa-artifacts/physical-bilateral-e2e-20260710/final-physical-rc/checkpoint/ios-driver-offline.jpeg`;
  - `qa-artifacts/physical-bilateral-e2e-20260710/final-physical-rc/checkpoint/android-passenger-home-paused.png`.

## O que foi concluído antes da pausa

- Deadline autoritativo da oferta implementado no backend e propagado ao mobile.
- Contagem regressiva compartilhada em `MM:SS`, recomposição após background e CTAs bloqueados em `00:00`.
- Evento autoritativo `clearRideRequest` com `DRIVER_RESPONSE_TIMEOUT` / `offer_timeout`.
- Full mobile: 107 suítes e 872 testes verdes.
- Full backend: 205 suítes e 1.069 testes verdes.
- Guards mobile, config do perfil, governança e scans de segredo verdes.
- Rollout progressivo dos três gateways concluído sem restart de workers.
- Builds finais geradas, assinadas, verificadas e instaladas preservando as sessões.
- Posições físicas foram comprovadas antes da pausa: passageiro em Leblon e motorista em Ipanema, cerca de 2 km distante.

## Tentativa interrompida e evidência honesta

O primeiro cenário de timeout não foi aceito como E2E:

- O Xiaomi bloqueou a instalação do APK auxiliar do Maestro com `INSTALL_FAILED_USER_RESTRICTED`.
- O fluxo foi continuado por ADB até categoria e Pix, mas a confirmação sandbox não ocorreu automaticamente.
- A credencial administrativa local estava expirada; a tentativa seguinte via Firebase app-auth chegou após o vencimento exato do intent e recebeu `SANDBOX_PAYMENT_INTENT_EXPIRED`.
- Nenhum booking foi criado e nenhuma oferta chegou ao motorista.
- A gravação foi preservada, mas renomeada para não ser confundida com aprovação:
  `qa-artifacts/physical-bilateral-e2e-20260710/final-physical-rc/a-ios-driver-android-passenger/00-aborted-maestro-and-expired-pix/`.

## Ponto exato de retomada

1. Reconectar os dois aparelhos e confirmar as versões `126` / `34`; não rebuildar.
2. Reativar localização controlada:
   - Android passageiro em `-22.984880,-43.222150`;
   - iOS motorista em `-22.982600,-43.201000`, usando `pymobiledevice3 --userspace`.
3. No Android, definir a origem explicitamente no card inicial como Praça Antero de Quental; o home volta ao endereço físico após a expiração.
4. Colocar o motorista iOS online.
5. Iniciar novas gravações em `01-offer-timeout`; não reutilizar a pasta abortada.
6. Criar o Pix sandbox e, imediatamente, localizar o único intent `charge_created` recente desse passageiro, validar prazo/ownership/ambiente e confirmar pela rota app-auth com o ID exato.
7. Validar busca no passageiro e oferta no motorista por toda a janela `00:20 → 00:00`, seguida da remoção autoritativa.
8. Prosseguir com cancelamento, caminho feliz, aproximação/câmera/heading, relaunch e inversão de papéis.

## Fora desta pausa

- KYC/liveness não foi iniciado.
- Nenhum teste Woovi com dinheiro real foi executado.
- Nenhuma regra financeira foi alterada.
