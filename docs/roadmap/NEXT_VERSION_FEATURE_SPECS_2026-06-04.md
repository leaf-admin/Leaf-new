# Leaf - specs de features candidatas para próxima revisão

Data: 2026-06-04
Escopo: desenho de produto, UX, contratos e critérios de aceite. Sem implementação.

## Resumo executivo

O backlog atual tem quatro grupos:

1. **Bloqueio P0 de release:** `LEA-94` - nova build iOS com `GoogleService-Info.plist` correto para `br.com.leaf.ride` e validação FCM/APNs.
2. **Operação/infra P1:** `LEA-90`, `LEA-91`, `LEA-92` - manutenção Contabo, containers órfãos e decisão explícita sobre AWS liveness.
3. **Features P1/P2 com base já iniciada:** `LEA-77`, `LEA-78`, `LEA-79`, `LEA-80`, `LEA-84`, `LEA-93`.
4. **UX refinements do ciclo de corrida:** `LEA-50` a `LEA-64`, `LEA-81`, `LEA-86`.

Recomendação de pacote para a próxima versão de app:

- **Pacote A, mais seguro para revisão:** refinamentos de UI/UX e correções técnicas: iOS push, recibo financeiro, estados vazios, conexão/offline, App Links.
- **Pacote B, feature de produto com baixo atrito:** tarifa dinâmica bem explicada + destino do motorista em beta controlado.
- **Pacote C, feature safety:** Leaf Delas, apenas se política, copy, elegibilidade e fallback estiverem muito bem definidos.
- **Pacote D, inteligência operacional:** heatmap H3 e smart push, preferencialmente assistidos/flagged antes de automação ampla.

Não recomendo subir tudo em uma única revisão. Melhor ter uma versão com correções + uma feature de produto bem fechada do que uma versão com cinco novidades parcialmente acopladas.

## Princípios para qualquer feature nova

- Feature flag por ambiente, cidade e público.
- Sem novas chamadas pagas no app para renderização visual.
- App consome apenas API Leaf; nunca chama Google/Woovi/Firebase diretamente para lógica de produto.
- Fallback silencioso quando dado operacional não existir.
- Copy curta, clara e sem promessa operacional absoluta.
- Dashboard/backoffice sempre consegue desligar a feature.
- Eventos auditáveis: impression, action, error, fallback, disabled_by_flag.

## LEA-77 - Leaf Delas

### Objetivo

Permitir que passageiras selecionem uma opção de viagem com motoristas mulheres, quando houver disponibilidade e elegibilidade operacional.

### Decisão de produto proposta

MVP por corrida, não por perfil.

Motivo:

- Menor risco de estado persistido incorreto.
- Mais claro para o usuário: a preferência vale para aquela solicitação.
- Permite desligar por cidade/horário/cobertura sem mexer em conta.

### Entry point

Na seleção de categoria, próximo de tarifa/tempo, como opção discreta:

- Label: `Leaf Delas`
- Estado off: `Motoristas mulheres, quando disponível`
- Estado on: `Buscando motoristas mulheres`

Não usar linguagem que exponha gênero de motoristas individualmente no card público.

### Estados de UI

1. **Disponível**
   - Badge pequeno dentro do card de categoria.
   - CTA principal segue igual: `Confirmar`.

2. **Ativado**
   - Badge com tom Leaf, sem candy color.
   - Copy curta: `Leaf Delas ativo nesta corrida`.

3. **Sem motorista elegível**
   - Não expor motivo sensível.
   - Copy: `Não encontramos uma motorista disponível agora. Você pode tentar novamente ou pedir uma corrida padrão.`
   - CTA primário: `Buscar corrida padrão`.
   - CTA secundário: `Tentar novamente`.

4. **Indisponível na cidade/horário**
   - Ocultar a opção ou mostrar desabilitada apenas se houver valor educativo.
   - Preferência inicial: ocultar para reduzir frustração.

### Contrato técnico esperado

Entrada no booking:

```json
{
  "preferences": {
    "leafDelas": true,
    "femaleDriverOnly": true
  }
}
```

Elegibilidade do motorista:

```json
{
  "driverEligibility": {
    "genderVerified": true,
    "gender": "female",
    "kycStatus": "approved",
    "safetyStatus": "clear"
  }
}
```

### Flags

- `leafDelasEnabled`
- `leafDelasCityWhitelist`
- `leafDelasPassengerEntryPointEnabled`
- `leafDelasFallbackToStandardRideEnabled`

### Dashboard e operação

Backoffice deve mostrar:

- corridas Leaf Delas solicitadas;
- taxa de sucesso;
- tempo médio até aceite;
- fallback para corrida padrão;
- cancelamentos depois de ativar;
- motoristas elegíveis por cidade.

### Riscos

- Frustração se houver pouca oferta.
- Exposição indevida de dados sensíveis se a copy for ruim.
- App Review pode avaliar como feature sensível se prometer segurança absoluta.

### Critérios de aceite

- Passageira consegue ativar a preferência antes do Pix.
- Backend só oferta para motorista elegível.
- Indisponibilidade tem fallback claro.
- Métricas aparecem no backoffice.
- Feature pode ser desligada sem nova build.

## LEA-78 - Destino do motorista

### Objetivo

Permitir que o motorista informe um destino alvo e receba corridas que o aproximem desse destino.

### Decisão de produto proposta

MVP com sessão temporária:

- Ativo por até 90 minutos ou até chegar perto do destino.
- Limite diário inicial: 2 ativações por dia.
- Só disponível quando o motorista estiver offline ou disponível, nunca durante corrida ativa.

### Entry point

Tela inicial do motorista:

- Botão/atalho discreto perto das preferências.
- Copy: `Definir destino`
- Quando ativo: chip no card inicial `Destino ativo: Leblon`.

### Fluxo UX

1. Motorista toca em `Definir destino`.
2. Campo de busca abre em bottom sheet.
3. Motorista seleciona destino.
4. Tela mostra resumo:
   - destino;
   - tempo restante do modo;
   - aviso: `Você receberá corridas que ajudem no caminho.`
5. Motorista confirma.
6. Home mostra modo ativo e ação `Encerrar`.

### Estados de UI

- `idle`: sem destino.
- `searching_destination`: buscando endereço.
- `active`: destino ativo.
- `expired`: modo expirou.
- `arrived_near_target`: destino encerrado automaticamente.
- `disabled_limit_reached`: limite diário atingido.
- `blocked_active_trip`: indisponível durante corrida.

### Contrato técnico esperado

```json
{
  "driverDestinationMode": {
    "enabled": true,
    "target": {
      "label": "Leblon",
      "latitude": -22.984,
      "longitude": -43.223
    },
    "expiresAt": "2026-06-04T23:59:00.000Z",
    "minProgressKm": 0.5,
    "arrivalRadiusKm": 1.5
  }
}
```

### Flags

- `driverDestinationModeEnabled`
- `driverDestinationModeDailyLimit`
- `driverDestinationModeCityWhitelist`

### Métricas

- ativações por motorista;
- corridas aceitas com destino ativo;
- corridas rejeitadas por incompatibilidade;
- tempo até expirar;
- cancelamentos;
- impacto no matching.

### Riscos

- Reduz oferta disponível para passageiros se muitos motoristas ativarem ao mesmo tempo.
- Motorista pode tentar manipular destino para filtrar corridas.
- UX ruim se não explicar que o modo não garante corrida.

### Critérios de aceite

- Motorista define e encerra destino.
- Modo expira sozinho.
- Corridas que afastam do destino não são ofertadas.
- Dashboard consegue observar uso e impacto.

## LEA-79 - Badge de tarifa dinâmica

### Objetivo

Explicar ao passageiro quando a tarifa está acima do normal usando uma única quote backend antes do Pix.

### Decisão de produto proposta

Badge informativo, não modal bloqueante.

### Copy

Estado normal:

- `Tarifa normal`

Estado dinâmico moderado:

- `Tarifa mais alta agora`
- Subcopy curta: `Maior demanda na região.`

Estado dinâmico alto:

- `Tarifa alta agora`
- Subcopy curta: `Demanda e trânsito aumentaram o valor.`

Evitar:

- `surge`;
- linguagem agressiva;
- justificar com cálculo técnico.

### Contrato técnico esperado

```json
{
  "quoteId": "quote_123",
  "grossAmount": 38.08,
  "currency": "BRL",
  "dynamic": {
    "enabled": true,
    "percentage": 18,
    "level": "moderate",
    "passengerNotice": "Tarifa mais alta agora"
  },
  "expiresAt": "2026-06-04T23:59:00.000Z"
}
```

### Regras

- Uma única quote backend define valor, badge e validade.
- Não fazer duas chamadas de Routes para comparar preço normal vs dinâmico.
- Se quote expirar antes do Pix, recalcular uma vez com feedback claro.

### Flags

- `dynamicPricingBadgeEnabled`
- `dynamicPricingQuoteRequiredBeforePix`
- `dynamicPricingTelemetryEnabled`

### Métricas

- quotes geradas;
- quotes expiradas;
- conversão com tarifa normal vs dinâmica;
- cancelamento após badge;
- fallback local usado.

### Critérios de aceite

- Passageiro entende por que o valor está diferente.
- Valor do Pix usa exatamente a quote selecionada.
- Dashboard consegue auditar quote usada na corrida.

## LEA-84 - Heatmap H3 do motorista

### Objetivo

Mostrar áreas com maior chance de corrida no mapa do motorista, sem poluir o card principal e sem chamar APIs pagas.

### Decisão de produto proposta

Começar com overlay discreto por intensidade e TTL curto.

### Visual

- Células suaves no mapa, com opacidade baixa.
- Sem vermelho agressivo.
- Paleta sugerida:
  - baixa: `rgba(26, 51, 14, 0.10)`
  - média: `rgba(26, 51, 14, 0.18)`
  - alta: `rgba(26, 51, 14, 0.28)`
- Não exibir labels em todas as células.
- Só mostrar um label curto se houver foco: `Maior procura`.

### Contrato técnico esperado

```json
{
  "generatedAt": "2026-06-04T22:00:00.000Z",
  "ttlSeconds": 60,
  "resolution": 8,
  "cells": [
    {
      "h3": "88a8a8...",
      "score": 0.82,
      "level": "high",
      "center": {
        "latitude": -22.984,
        "longitude": -43.223
      }
    }
  ]
}
```

### Fonte de dados

- buscas recentes;
- solicitações criadas;
- corridas aceitas/concluídas;
- motoristas online por célula;
- cancelamentos por falta de motorista;
- score de `LEA-80` quando disponível.

### Regras

- Não mostrar heatmap se o card inicial ainda não hidratou.
- Atualizar em intervalo controlado.
- Não mover câmera automaticamente.
- Não prometer corrida.

### Flags

- `driverDemandHeatmapEnabled`
- `driverDemandHeatmapCityWhitelist`
- `driverDemandHeatmapMinScore`

### Métricas

- visualizações do heatmap;
- taps em áreas aquecidas, se houver;
- deslocamento voluntário do motorista;
- conversão por célula;
- impacto em tempo de aceite.

### Critérios de aceite

- Motorista vê overlay apenas quando há score suficiente.
- Passageiro nunca vê esse overlay.
- Zero chamada externa paga para renderizar.
- Fallback sem dados não mostra erro.

## LEA-80 + LEA-93 - Smart push e orquestração de notificações

### Objetivo

Separar notificações transacionais obrigatórias de notificações inteligentes/comportamentais, preparando ML sem liberar automação irresponsável.

### Decisão de produto proposta

Fase 1: orquestrador transacional.

Fase 2: smart push assistido.

Fase 3: smart push automático apenas depois de volume real e aprovação operacional.

### Tipos de notificação

1. **Transacional**
   - pagamento;
   - corrida;
   - documento;
   - chat/suporte;
   - saque;
   - segurança.

2. **Operacional**
   - demanda alta para motorista;
   - campanha ativa;
   - pendência de cadastro;
   - incentivo de retorno.

3. **Comportamental/ML**
   - rotina provável de uso;
   - destino recorrente;
   - horário habitual;
   - sugestão de ficar online.

### Contrato de recomendação ML

```json
{
  "recommendationId": "rec_123",
  "userId": "user_abc",
  "userType": "driver",
  "kind": "smart_push",
  "reason": "high_demand_nearby",
  "score": 0.84,
  "window": {
    "startAt": "2026-06-04T18:00:00.000Z",
    "endAt": "2026-06-04T19:00:00.000Z"
  },
  "messageTemplate": "driver_high_demand_nearby",
  "requiresHumanApproval": true
}
```

### Guardrails

- Opt-in/opt-out por usuário.
- Quiet hours.
- Cooldown por template e usuário.
- Deduplicação por evento.
- Separação entre push e notificação persistida.
- Nunca disparar ML durante corrida ativa se atrapalhar a operação.
- Para safety, nunca usar copy alarmista sem revisão.

### Métricas

- queued;
- sent;
- delivered;
- opened;
- actioned;
- suppressed;
- failed;
- opt-out;
- conversão por template.

### Critérios de aceite

- Existe matriz evento -> público -> canal -> prioridade.
- Toda notificação crítica é idempotente.
- Dashboard mostra falha/sucesso por tipo.
- ML só sugere; orquestrador decide.

## Ordem recomendada de desenho e entrega

1. `LEA-94`: resolver build iOS/push porque é P0 e afeta comunicação operacional.
2. `LEA-79`: finalizar contrato visual de tarifa dinâmica, pois já está perto e mexe diretamente no pagamento.
3. `LEA-78`: destino do motorista em beta controlado, com baixo risco para passageiro.
4. `LEA-84`: heatmap H3 assistido para motorista, sem promessa de corrida.
5. `LEA-93`: orquestrador de notificações transacionais.
6. `LEA-80`: smart push/ML apenas em preview/assistido.
7. `LEA-77`: Leaf Delas, mas só depois de política/copy/elegibilidade estarem fechadas com cuidado.

## Release strategy sugerida

### Próxima submissão iOS

Obrigatório:

- plist correto e validação de push iOS;
- correções de recibo/valor financeiro se couberem sem risco;
- App Links/Universal Links validados.

Opcional seguro:

- badge de tarifa dinâmica polido;
- destino do motorista atrás de flag desligada ou beta.

Evitar nessa mesma submissão:

- Leaf Delas aberto para todos;
- ML/smart push automático;
- mudanças grandes em pagamento/split.

## Checklist de spec antes de implementação

Para cada feature:

- Figma ou wireframes dos estados principais.
- Contrato de payload documentado.
- Feature flags definidas.
- Métricas e eventos definidos.
- Fallback e empty state definidos.
- Testes mínimos listados.
- Critério de desligamento operacional.
- Riscos de App Review avaliados.
