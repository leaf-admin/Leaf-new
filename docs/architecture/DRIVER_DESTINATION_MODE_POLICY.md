# Driver Destination Mode Policy

## Objetivo

Permitir que motoristas indiquem um destino de caminho algumas vezes ao dia e recebam preferência por corridas que os aproximem desse destino, sem transformar a regra em bloqueio absoluto nem aumentar chamadas pagas de Maps/Routes.

## Política Atual

- Feature flag: `ENABLE_DRIVER_DESTINATION_MODE`.
- Quota base: `DRIVER_DESTINATION_DAILY_BASE_QUOTA`, padrão `2`.
- Quota máxima: `DRIVER_DESTINATION_DAILY_MAX_QUOTA`, padrão `4`.
- Bônus por experiência: `DRIVER_DESTINATION_EXTRA_EVERY_TRIPS`, padrão `100` corridas concluídas por destino extra diário.
- Duração por ativação: `DRIVER_DESTINATION_DURATION_MINUTES`, padrão `90`.
- Progresso mínimo: `DRIVER_DESTINATION_MIN_PROGRESS_KM`, padrão `1`.
- Raio de chegada ao alvo: `DRIVER_DESTINATION_ARRIVAL_RADIUS_KM`, padrão `3`.

## Regras De Consumo

- O uso é consumido quando um novo destino ativo é aceito pelo backend.
- Reenviar o mesmo destino ativo não consome outro uso.
- Ficar offline limpa o destino ativo sem consumir quota.
- Se a quota diária acabar, o backend rejeita a ativação com `DRIVER_DESTINATION_DAILY_QUOTA_EXCEEDED`.
- Se a feature estiver desligada, o backend rejeita a ativação com `DRIVER_DESTINATION_MODE_DISABLED`.

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
