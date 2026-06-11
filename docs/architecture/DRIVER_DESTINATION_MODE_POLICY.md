# Driver Destination Mode Policy

## Objetivo

Permitir que motoristas indiquem um destino de caminho algumas vezes ao dia e recebam preferência por corridas que os aproximem desse destino, sem transformar a regra em bloqueio absoluto nem aumentar chamadas pagas de Maps/Routes.

## Política Atual

- Feature flag: `ENABLE_DRIVER_DESTINATION_MODE`.
- Quota base: `DRIVER_DESTINATION_DAILY_BASE_QUOTA`, padrão `2`.
- Quota máxima operacional: `DRIVER_DESTINATION_DAILY_MAX_QUOTA`, padrão `12`.
- Bônus diário: `DRIVER_DESTINATION_BONUS_RIDE_WINDOW`, padrão `5` corridas concluídas no dia.
- Compatibilidade: `DRIVER_DESTINATION_EXTRA_EVERY_TRIPS` ainda é aceito como alias de `DRIVER_DESTINATION_BONUS_RIDE_WINDOW`.
- Duração por ativação: `DRIVER_DESTINATION_DURATION_MINUTES`, padrão `90`.
- Progresso mínimo: `DRIVER_DESTINATION_MIN_PROGRESS_KM`, padrão `1`.
- Raio de chegada ao alvo: `DRIVER_DESTINATION_ARRIVAL_RADIUS_KM`, padrão `3`.

## Regras De Consumo

- O motorista começa cada dia operacional com 2 tickets de destino.
- Ao concluir 5 corridas no dia, ganha 1 ticket extra.
- O ticket extra não acumula: enquanto ele não usar esse bônus, novas janelas de 5 corridas não geram outro ticket.
- Depois de usar o bônus, a próxima janela conta mais 5 corridas concluídas a partir daquele uso.
- O uso é consumido quando um novo destino ativo é aceito pelo backend.
- Reenviar o mesmo destino ativo não consome outro uso.
- Ficar offline limpa o destino ativo sem consumir quota.
- Se a quota diária acabar, o backend rejeita a ativação com `DRIVER_DESTINATION_DAILY_QUOTA_EXCEEDED`.
- Se a feature estiver desligada, o backend rejeita a ativação com `DRIVER_DESTINATION_MODE_DISABLED`.

## Contador Diário

- O backend registra corridas concluídas em Redis no hash `driver:{driverId}` com:
  - `destinationModeDailyCompletedTrips`
  - `destinationModeDailyCompletedTripsDay`
- Cada corrida concluída é deduplicada por `driver_destination_completed_rides:{driverId}:{day}` para evitar bônus duplicado por replay do evento.
- O uso diário fica em `driver_destination_usage:{driverId}:{day}` e guarda:
  - `used`
  - `bonusAnchorTrips`
  - `bonusConsumedAt`

## Matching

O destino do motorista atua como preferência de dispatch. Uma corrida é elegível quando:

- o destino da corrida entra no raio de chegada do destino do motorista; ou
- a corrida reduz a distância entre o ponto de embarque e o destino configurado em pelo menos o progresso mínimo.

A avaliação usa coordenadas e distância haversine. Não há chamada adicional a Google Routes/Places para aplicar essa preferência.

## Superfícies

- Socket `setDriverStatus`: aplica, consome quota e limpa destino ao ficar offline.
- `GET /api/app/runtime-config`: expõe a política global segura em `driverDestinationPolicy`.
- `GET /api/drivers/me/destination-policy`: expõe a política efetiva e usos do motorista autenticado.

## Rollback

Para desligar sem nova build:

```bash
ENABLE_DRIVER_DESTINATION_MODE=false
```

O app pode continuar mostrando a UI legada até receber runtime config/refresh, mas o backend falha fechado para novas ativações.
