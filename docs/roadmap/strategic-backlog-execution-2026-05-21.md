# Strategic Backlog Execution - 2026-05-21

## Escopo

Este plano consolida as frentes estrategicas que sairam das auditorias recentes e separa o que ja pode operar atras de flag do que ainda depende de canary/device.

## Estado por frente

| Frente | Estado apos esta rodada | Flag/Gate |
| --- | --- | --- |
| Orquestrador N1/N2/N3 | Copiloto produtivo com runs duraveis em JSON, polling, analise N1/N2/N3, acao real aprovada por humano para nota interna e escalacao. Continua sem autosend/autoresolve. | `SUPPORT_ORCHESTRATOR_TOKEN`, `SUPPORT_STORE_PATH`, `SUPPORT_AUTONOMOUS_MODE=false` |
| Convites/waitlist | Backend de convites e waitlist ja existia. Dashboard agora tambem expoe leads da landing e permite mover para `contacted`/`converted`. | `ENABLE_REFERRAL_PROGRAMS`, `ENABLE_ADMIN_MUTATIONS` |
| Leaf Delas | Base real mobile/backend ja existe: preferencia no booking e filtro de motorista por genero. Agora tem flag propria para rollout controlado. | `ENABLE_LEAF_DELAS`, `EXPO_PUBLIC_ENABLE_LEAF_DELAS` |
| Destino do motorista | Base real mobile/socket/backend ja existe: destino salvo no status do motorista e filtro por rota/progresso. Agora tem flag propria. | `ENABLE_DRIVER_DESTINATION_MODE`, `EXPO_PUBLIC_ENABLE_DRIVER_DESTINATION_MODE` |
| Tarifa dinamica | Engine backend e badge mobile ja existem. Agora tem flag propria para ativacao controlada. | `ENABLE_DYNAMIC_PRICING`, `EXPO_PUBLIC_ENABLE_DYNAMIC_PRICING` |
| Smart push/ML | Modelo heuristico v0 e preview admin existem. Agora tem flag propria separada de `demandPredictionEnabled`. | `ENABLE_SMART_PUSH`, `EXPO_PUBLIC_ENABLE_SMART_PUSH`, `ENABLE_DEMAND_PREDICTION` |
| UI mobile pos-canary | Nao deve ser fechada antes do canary. Refinamento final fica condicionado a evidencia real Android/iOS. | Canary completo |

## Gates obrigatorios antes de producao ampla

1. Rodar canary real Android/iOS com passageiro e motorista: inicio, cotacao, Pix, match, aceite, chegada, inicio, finalizacao e ledger.
2. Validar push real em background e deep link para corrida ativa.
3. Validar Leaf Delas com tres cenarios: motorista mulher disponivel, indisponivel e genero ausente.
4. Validar destino do motorista com destino ativo, destino expirado e rota fora do caminho.
5. Validar tarifa dinamica com pressao normal, aquecida e excepcional, confirmando copy e valor final.
6. Validar smart push apenas em modo preview/assistido ate existir feedback `sent/opened/actioned/suppressed`.
7. Rodar QA visual final mobile somente depois do canary, usando o Figma canonico e screenshots reais.

## Proximos blocos recomendados

1. Persistir runs do orquestrador em Firestore/Postgres quando houver infra definida. O JSON duravel resolve restart local/VPS simples, mas nao substitui banco operacional multi-instancia.
2. Criar paginas web/deep links para `/convite/:code` e `/motorista/convite/:code`.
3. Ligar beneficio de convite de passageiro ao pricing/checkout com idempotencia.
4. Criar cockpit dashboard para Leaf Delas, destino do motorista, dynamic pricing e smart push.
5. Persistir serie temporal H3 e feedback de smart push para evoluir de heuristica para ML treinavel.
6. Fazer rodada de UI final pos-canary, sem mexer nos cards iniciais de passageiro/motorista.
