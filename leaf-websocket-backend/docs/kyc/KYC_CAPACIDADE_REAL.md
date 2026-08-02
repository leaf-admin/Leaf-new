# KYC: contrato real de capacidade AWS

Atualizado em: 2026-08-02

## Objetivo

Este documento define como comprovar se o fluxo canônico de identidade suporta o
pico operacional da Leaf. Ele não autoriza mudança de provedor, aumento de quota,
teste pago ou alteração da cadência de KYC.

O fluxo em análise é:

```text
App -> AWS Face Liveness -> backend Leaf -> comparação facial canônica -> gate online
```

Não fazem parte da arquitetura atual:

- aprovação por embedding dummy;
- proxy KYC legado;
- fila perceptível ao motorista;
- aprovação quando o provedor está indisponível;
- verificação biométrica durante corrida ativa.

## Fonte de verdade

O runtime versionado usa `us-east-1` nos perfis canônicos e exige:

- AWS Rekognition Face Liveness;
- comparação facial server-side confiável;
- política backend fail-closed;
- sessão nova para cada tentativa;
- vínculo entre sessão, motorista e resultado.

As quotas realmente aplicadas pertencem à conta e à região AWS. Elas não podem ser
deduzidas do código, de médias diárias nem dos valores padrão publicados. Antes de
qualquer teste de carga, o responsável pela conta deve registrar uma evidência
read-only da página AWS Service Quotas para `us-east-1`.

## Quotas padrão publicadas

Valores padrão consultados na documentação oficial em 2026-08-02:

| Operação em `us-east-1` | Quota padrão |
| --- | ---: |
| `CreateFaceLivenessSession` | 25 TPS |
| `StartFaceLivenessSession` | 25 TPS |
| `GetFaceLivenessSessionResults` | 25 TPS |
| Sessões Face Liveness concorrentes | 75 |
| `CompareFaces` | 100 TPS |

Esses valores são defaults ajustáveis, não evidência das quotas atualmente
aplicadas à conta Leaf.

Referências oficiais:

- https://docs.aws.amazon.com/general/latest/gr/rekognition.html
- https://docs.aws.amazon.com/rekognition/latest/dg/limits.html
- https://docs.aws.amazon.com/rekognition/latest/APIReference/API_CreateFaceLivenessSession.html
- https://docs.aws.amazon.com/rekognition/latest/APIReference/API_rekognitionstreaming_StartFaceLivenessSession.html
- https://aws.amazon.com/rekognition/pricing/

## Cenário obrigatório: 1.000 motoristas simultâneos

Com as quotas padrão de `us-east-1`, o cenário não está aprovado:

- 1.000 sessões excedem a concorrência padrão de 75 em mais de 13 vezes;
- a 25 criações por segundo, admitir 1.000 sessões exige no mínimo 40 segundos;
- throttling pode retornar `ProvisionedThroughputExceededException`,
  `ServiceQuotaExceededException` ou `429`;
- `CompareFaces` a 100 TPS levaria no mínimo 10 segundos para 1.000 chamadas se
  todas chegassem juntas.

Portanto, “suporta 1.000 verificações por dia” não prova capacidade para “1.000
motoristas ficando online ao mesmo tempo”.

## Cálculo de quota

Definições:

- `N`: motoristas no pico;
- `W`: janela máxima de admissão das sessões, em segundos;
- `D`: duração observada de uma sessão, em segundos;
- `H`: headroom operacional; mínimo recomendado para planejamento: 50%.

Fórmulas:

```text
TPS de admissão = ceil(N / W)
Concorrência para pico isolado = N
Concorrência para carga sustentada = TPS de admissão * D
Quota solicitada = requisito * (1 + H)
```

Exemplos de planejamento, ainda não aprovados como SLA:

| Cenário | TPS mínimo | Concorrência mínima do pico | Com 50% de headroom |
| --- | ---: | ---: | ---: |
| 1.000 admitidos em 5 s | 200 | 1.000 | 300 TPS / 1.500 sessões |
| 1.000 admitidos em 2 s | 500 | 1.000 | 750 TPS / 1.500 sessões |

Se a chegada for sustentada, a concorrência deve ser recalculada com a duração
real `D`. Exemplo: 200 novas sessões/s durante sessões de 10 s exige 2.000
sessões concorrentes antes do headroom.

As quotas de Create, Start, Get e CompareFaces devem ser verificadas
separadamente. A aprovação de uma operação não aumenta automaticamente as demais.

## Política de experiência

“Sem fila” significa:

- o app não mostra posição de espera;
- o backend não guarda solicitações biométricas para processar minutos depois;
- não existe aprovação temporária enquanto a AWS está indisponível;
- o motorista recebe início de sessão ou erro controlado dentro do timeout;
- throttling usa somente retries curtos, limitados, com backoff e jitter;
- esgotados os retries, o fluxo falha fechado ou usa provedor alternativo já
  homologado.

Uma fila interna longa não é alternativa aceitável para insuficiência de quota.
O tratamento correto é provisionar capacidade antes do lançamento ou trocar de
provedor.

## Gate de aceitação

AWS só pode ser declarada capaz para o pico quando todas as evidências abaixo
existirem:

1. quotas aplicadas da conta e região registradas;
2. quota de cada operação maior ou igual ao cálculo aprovado com headroom;
3. teste de criação/resultado sem `429` fora da tolerância;
4. teste de comparação facial dentro do mesmo pico;
5. p95 e p99 de criação, início, resultado e comparação registrados;
6. taxa de conclusão e taxa de throttling registradas;
7. custo do ensaio aprovado previamente;
8. teste em dispositivos físicos cobrindo Android e iOS suportados;
9. comportamento fail-closed comprovado na indisponibilidade do provedor;
10. nenhuma verificação disparada durante corrida ativa.

Critério provisório de engenharia para o ensaio:

- conclusão bem-sucedida >= 99,5%;
- throttling final, após retries curtos, < 0,5%;
- nenhuma aprovação sem Liveness e comparação confiável;
- nenhuma sessão atribuída ao motorista errado;
- nenhum bloqueio global do gate online por falha de uma sessão individual.

Os limites de latência precisam de aprovação de produto antes de virarem SLA.

## Plano de ensaio

### Etapa 1: preflight read-only

- confirmar região ativa;
- capturar quotas aplicadas;
- confirmar política biométrica estrita;
- confirmar limites diários/mensais de custo;
- confirmar que o motorista QA não está em corrida ativa.

### Etapa 2: carga controlada

- executar degraus pequenos antes do pico total;
- registrar IDs únicos e impedir reuso de sessão;
- medir Create, Start, Get e CompareFaces separadamente;
- interromper o ensaio ao alcançar o limite de custo ou erro;
- não usar dados biométricos reais fora dos dispositivos autorizados.

### Etapa 3: dispositivos físicos

Face Liveness usa câmera, vídeo e challenge interativo. Um teste HTTP sintético não
prova o streaming real. A comprovação final exige dispositivos físicos e permanece
parcial até existir autorização, frota de teste e quota aprovada.

### Etapa 4: decisão de provedor

Homologar outro provedor antes do lançamento se qualquer condição ocorrer:

- a AWS não aprovar as quotas necessárias;
- o ensaio não atingir o pico com headroom;
- throttling ou latência violarem o SLA aprovado;
- custo projetado ultrapassar o limite comercial;
- indisponibilidade regional não tiver mitigação aceitável.

## Custo

Na faixa inicial publicada, Face Liveness custa aproximadamente US$ 0,015 por
verificação. Mil verificações representam cerca de US$ 15 somente de Liveness;
CompareFaces e demais infraestrutura são cobrados separadamente. O valor deve ser
recalculado na data do ensaio.

## Estado atual

| Evidência | Estado |
| --- | --- |
| Arquitetura AWS canônica no código | Implementada |
| Quotas padrão documentadas | Confirmadas |
| Quotas aplicadas à conta Leaf | Não verificadas |
| Aumento de quota aprovado | Não verificado |
| Teste de 1.000 sessões | Não executado |
| Teste físico Android/iOS | Não executado |
| Segundo provedor homologado | Não verificado |

Conclusão atual: a implementação existe, mas a capacidade para 1.000 motoristas
simultâneos não está comprovada. Com as quotas padrão, ela não atende ao cenário.
