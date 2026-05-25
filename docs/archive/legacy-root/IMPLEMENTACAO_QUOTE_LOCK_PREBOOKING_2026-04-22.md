# Implementação: Quote Lock no Pré-Booking (sem exibir horário)

Data: 2026-04-22

## Objetivo

Evitar recalcular preço da mesma rota toda vez que o usuário reabrir a tela/app no fluxo de pré-booking, mantendo o valor estável por uma janela curta de validade.

Decisão de produto aplicada:
- não exibir "válido até HH:MM" na interface.

## Escopo da mudança

Arquivo principal:
- `mobile-app/src/screens/prototype/prototypeRideRuntime.js`

Foi adicionado um `quoteLock` persistido na sessão do runtime com:
- fingerprint de rota (origem/destino normalizados),
- distância estimada,
- duração estimada,
- ETA textual,
- coordenadas da polyline usada no preview,
- timestamps de criação e expiração.

## Regras funcionais

1. Quando o passageiro está em `idle` e sem `activeBooking`, o preview tenta usar lock ativo da rota atual.
2. Se o lock existir, não estiver expirado e a rota for a mesma:
   - reaproveita distância/duração/ETA/polyline do lock,
   - evita novo recálculo de preço no pré-booking.
3. Se lock não existir, estiver expirado ou a rota mudar:
   - executa cálculo normal,
   - grava novo lock para aquela rota.
4. Ao limpar preview de destino (`clearDestinationPreview`), o lock é limpo.
5. Na restauração de sessão, lock expirado é descartado automaticamente.
6. Em estados diferentes de `idle`, lock é descartado na sanitização da sessão.

## Persistência e reabertura do app

O `quoteLock` foi incluído no snapshot persistido do runtime.  
Com isso, ao reabrir o app dentro da janela de validade e mantendo a mesma rota, o preço permanece estável sem precisar mostrar contador/horário na UI.

## Configuração

Variáveis suportadas (com defaults):

- `EXPO_PUBLIC_QUOTE_VALIDITY_MS` (default: `120000`)
- `EXPO_PUBLIC_QUOTE_LOCK_COORDINATE_PRECISION` (default: `3`)
- `EXPO_PUBLIC_QUOTE_LOCK_MAX_ROUTE_POINTS` (default: `180`)

## Impacto esperado

- Redução de recálculos desnecessários no pré-booking.
- Menos oscilação de preço percebida em reabertura rápida do app.
- Menor pressão de chamadas em cenários de usuário repetindo consulta da mesma rota em janela curta.

## Validação executada

- Checagem de sintaxe do arquivo alterado:
  - `node --check mobile-app/src/screens/prototype/prototypeRideRuntime.js`

Observação:
- Não houve inclusão de indicador visual de validade na UI, conforme requisito.
