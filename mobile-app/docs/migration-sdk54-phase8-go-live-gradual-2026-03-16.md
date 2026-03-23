# Fase 8 - Go-live gradual (soft release)

Data: 2026-03-16
Branch: codex/migracao-expo-sdk54-zero-debito

## Sim, e um soft release

Go-live gradual = publicar em ondas controladas, com gates de qualidade entre as ondas.

## Estrategia sugerida

1. Onda 0 - Interno
- Android: Play Internal Testing / Firebase App Distribution.
- iOS: TestFlight Internal.
- Participantes: time interno (produto + engenharia + operacao).
- Objetivo: validar crash-free, tracking e fluxo de corrida real.

2. Onda 1 - Piloto fechado (5-10%)
- Grupo pequeno de motoristas/passageiros selecionados.
- Monitoramento intensivo por 24h.
- Gate para seguir: sem regressao critica em login, corrida ativa, push e finalizacao.

3. Onda 2 - Escala controlada (25-50%)
- Expandir gradualmente mantendo observabilidade.
- Gate para seguir: estabilidade mantida por 48h.

4. Onda 3 - 100%
- Liberacao total com monitoramento por 72h.

## Gates de decisao por onda

- Crash-free acima do limite definido internamente.
- Taxa de erro backend sem degradacao relevante.
- Sem aumento material de falha em:
  - iniciar corrida,
  - tracking de localizacao,
  - notificacoes,
  - pagamento/finalizacao.

## Plano de rollback (objetivo)

Rollback automatico/manual se ocorrer qualquer um:

- falha sistemica em corrida ativa,
- queda relevante de crash-free,
- perda de tracking/estado de corrida,
- aumento anormal de falhas de login/pagamento.

Acoes de rollback:

1. Pausar rollout da loja imediatamente.
2. Voltar para build anterior estavel (tag `backup-pre-sdk54-20260316` + artefatos validados).
3. Congelar novas promos ate RCA e patch.

## Conclusao

- Sim, a abordagem correta aqui e soft release.
- O objetivo e reduzir risco operacional enquanto validamos comportamento real em producao.
