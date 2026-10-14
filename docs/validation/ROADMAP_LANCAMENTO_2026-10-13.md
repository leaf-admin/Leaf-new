# Leaf — Roadmap para fechar o lançamento (piloto controlado)

Data: 2026-10-13. Base: `docs/validation/LAUNCH_READINESS_TODO_2026-09-24.md` (checklist oficial, desatualizado desde 24/09) cruzado com o estado real verificado até hoje.
Itens sem evidência ficam como "a confirmar".

## Fase 0 — fechar o que já está pronto
- [ ] Push dos commits `afde8d8aa` (câmera do motorista) e `4d2263eec` (rota "Map" duplicada) + PR para `main` (o PR #230 não está mais aberto).
- [ ] Novo build 1.0.6 (iOS 43 / Android 137) com essas correções; upload para TestFlight e trilha interna (promoção para produção é feita pelo Izaak nos consoles).
- [ ] Limpar a branch suja do checkout principal (`codex/uiux-integration-validation`): dashboard, pricing e backend misturados e sem commit (bloqueio `[!]` do checklist).

## Fase 1 — P0 segurança e configuração
- [ ] `config:validate` no artefato que vai para o ar.
- [ ] Confirmar no servidor público: `AUTH_OTP_SIMULATION_ENABLED=false`, `DEBUG_OTP=false`, `AUTH_TEST_OTP_BYPASS_ENABLED=false`, bypass de review desligado.
- [ ] Janela de KYC de QA (`KYC_QA_ONLINE_TRUST_WINDOW_*`) desligada/expirada no GO (hoje ligada só para UIDs de QA, 24h).
- [ ] Revalidar `CPF_REVIEW_HMAC_KEY` no runtime candidato.

## Fase 2 — P0 KYC real
- [ ] Smoke com motorista real: liveness aprovado, reprovado, expirado, rosto diferente, revisão manual e retry autorizado (até hoje só com a janela de QA).

## Fase 3 — P0 fluxo de negócio com dinheiro real
- [ ] Corrida ponta a ponta com versões das lojas e Pix real: reconexão, relaunch, perda de rede; evidência por `bookingId` / `chargeId` / `rideId` (até hoje: builds de desenvolvimento + Pix sandbox).
- [ ] Woovi real: charge, webhook, expiração, refund, idempotência; leitura server-side de `/statement` para conciliação.
- [ ] Mesma corrida conferida em app passageiro, app motorista, recibo, dashboard, ledger e Woovi.
- [ ] Dashboard em ambiente real: login admin, permissões, suporte, conciliação, exportação.

## Fase 4 — P1 operação
- [ ] Backup e restore testados (Redis/Firestore); alertas (pagamento, webhook atrasado, corrida presa, divergência); rollback sem afetar outros produtos do VPS.
- [ ] Plantão, canal de incidente, autoridade para pausar corridas, treinamento de suporte.
- [ ] Privacidade, termos, consentimentos, exclusão de conta (`landing-page/excluir-conta`) conferidos.
- [ ] Aprovação formal do GO (aprovador, escopo, horário, condições de abort).

## Decisões pendentes do Izaak
1. Taxa de saque: R$ 1,00 fixo em todo saque, ou a regra atual (R$ 1,00 abaixo de R$ 500, grátis a partir de R$ 500)?
2. Encerrar longe do destino: hoje cobra a corrida inteira com motivo "passageiro pediu para descer" — confirmar.
3. Critérios objetivos de expansão, pausa e encerramento do piloto.

## Fase UI/UX (pedido em aberto)
- [ ] Animação de busca de motorista no passageiro (ver proposta em andamento).
- [ ] Micro-interações do app (botões, cards, números, sucesso, haptics).
