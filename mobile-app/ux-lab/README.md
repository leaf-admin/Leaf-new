# Leaf UX Lab

## Objetivo

Estudar o produto atual como uma sequência de decisões e estados, reunindo evidência
visual, comportamento observado e validação lógica sem misturar superfícies legado.

O laboratório não substitui E2E. Ele combina três provas distintas:

1. **E2E lógico:** rota, estado, backend e transição funcionam.
2. **Auditoria visual:** hierarquia, composição, tipografia e consistência estão corretas.
3. **Sessão de uso:** uma pessoa conclui a tarefa sem ajuda, com tempo, hesitações e erros registrados.

Nenhuma dessas provas pode representar as outras duas.

## Estrutura

- `config/journeys.json`: jornadas canônicas e testIDs obrigatórios.
- `config/rubric.json`: critérios ponderados de 0 a 3 e prioridade P0–P3.
- `templates/observation.json`: contrato de observação por estado.
- `scripts/qa/ux-lab.cjs`: cria uma rodada, executa o doctor e gera o relatório.
- `test-results/ux-lab/<run-id>/`: evidências e observações de cada rodada.

## Gates obrigatórios

- Build Debug para iOS Simulator durante todo o diagnóstico; Release somente no gate final.
- Início canônico em `leafapp://robotaxi/home`.
- Deep links de destination, booking e payment não valem como entrada de aceite.
- Estados semeados validam a superfície isolada, mas não contam como E2E integrado.
- Screenshot sem vídeo e observação não valida UX.
- Passageiro e motorista são avaliados separadamente.
- Uma tela com decisão duplicada, legado visível ou ação crítica ambígua é P0.

## Checkpoints atuais do motorista

O lifecycle integrado do motorista é validado na home atual, pela
`DriverLiveRideOverlay`. O laboratório não aceita IDs das telas standalone como prova dos
estados abaixo.

| Estado | Superfície atual | Ação/checkpoint decisivo |
| --- | --- | --- |
| Oferta | `driver-live-offer-card` | `driver-live-offer-accept-button` |
| A caminho do embarque | `driver-live-trip-card` | `driver-live-primary-action-arrive-button` |
| No embarque | `driver-live-trip-card` | `driver-live-primary-action-start-button` |
| Em viagem | `driver-live-trip-card` | `driver-live-primary-action-complete-button` |
| Interrupção operacional | `driver-live-ride-overlay-wrap` | `driver-live-operational-hold-title` |

Todos esses estados também exigem o contêiner integrado
`driver-live-ride-overlay-wrap`. Identificadores como `driver-offer-screen`,
`driver-live-trip-screen` e `driver-trip-*` pertencem às superfícies standalone e são
rejeitados pelo validador do laboratório.

## Primeira execução

```bash
cd mobile-app
npm run ux:lab:validate
npm run ux:lab:init -- --run-id baseline-debug-ios
npm run ux:lab:doctor -- --run-dir test-results/ux-lab/baseline-debug-ios
```

O comando `init` cria uma observação para cada estado. Preencha durante a sessão:

- `platform` e `device`;
- `status`: `pass`, `fail` ou `blocked`;
- métricas de tempo, erros, retornos, hesitação e confiança;
- notas de 0 a 3 para todos os critérios;
- findings com severidade, evidência e recomendação;
- caminhos relativos de vídeo e screenshots.

Depois gere o relatório:

```bash
npm run ux:lab:report -- --run-dir test-results/ux-lab/baseline-debug-ios
```

## Execução recomendada

### Rodada 1 — baseline interno em simuladores iOS

- Dois simuladores iOS nativos: passageiro e motorista.
- Matriz inicial: iPhone 17 Pro e iPhone 17e no mesmo runtime iOS estável.
- Repetição posterior em viewport menor e Dynamic Type ampliado.
- Jornada integrada sem deep link intermediário.
- Estados de exceção podem ser semeados, identificados como prova isolada.
- Gravar a sessão completa e capturar somente os estados decisivos.

Use a infraestrutura existente para preparar Debug:

```bash
bash scripts/qa/current-flow-e2e-debug-run.sh --doctor
bash scripts/qa/current-flow-e2e-debug-run.sh --metro
```

Grave cada simulador com `xcrun simctl io <UDID> recordVideo`. Mantenha passageiro e
motorista em vídeos separados, sincronizados pelo início da tarefa, e copie os arquivos para
`evidence/<role>/` sem recompressão. Dispositivos físicos não fazem parte deste laboratório;
eles entram somente no gate posterior de hardware, GPS, háptica, câmera e desempenho real.

### Rodada 2 — pesquisa qualitativa

- Cinco participantes de passageiro.
- Cinco participantes com experiência como motorista de app.
- Um facilitador lê a tarefa, mas não ensina o caminho.
- Um observador registra hesitações, erros e interpretação do próximo passo.
- Não usar A/B test enquanto a amostra não tiver poder estatístico.

### Rodada 3 — pós-correção

Repita as mesmas tarefas, dispositivos e métricas. Compare o baseline com a nova rodada;
não troque simultaneamente tarefa, cenário e interface.

## Critério de aceite

Um estado é elegível para aceite quando:

- o estado e o próximo passo são compreendidos em até cinco segundos;
- existe no máximo uma ação preenchida dominante;
- nenhuma decisão já tomada é solicitada novamente;
- não aparece superfície legado;
- os gates da rubrica têm nota mínima 2;
- há vídeo, captura e observação preenchida;
- o E2E lógico correspondente passou ou está explicitamente classificado como bloqueado.

## Priorização

- `P0 / critical`: bloqueio, legado, decisão errada, risco financeiro ou de segurança.
- `P1 / high`: hesitação importante, ação concorrente ou informação decisiva escondida.
- `P2 / medium`: inconsistência, densidade ou recuperação melhorável.
- `P3 / low`: acabamento sem impacto relevante na conclusão da tarefa.
