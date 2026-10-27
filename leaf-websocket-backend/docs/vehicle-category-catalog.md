# Vehicle Category Catalog (Future-Ready)

O backend já está pronto para consumir catálogo oficial de veículos para classificação de categoria.

## Status atual

- Fluxo atual em produção: categoria manual na aprovação do veículo (`manualCategory`/`carType`).
- Catálogo automático: opcional, desativado por padrão.

## Feature flag

- `ENABLE_VEHICLE_CATALOG_POLICY=true` ativa o uso do catálogo.
- O catálogo fica no Firestore, documento `operational_configs/vehicle_category_catalog` (o Realtime DB foi aposentado).

## Formato esperado no documento

Cada campo do documento é uma entrada do catálogo.

Chave:

`<brand_lower>|<model_lower>|<year>`

Exemplo:

`toyota|corolla|2022`

Valor:

```json
{
  "category": "elite",
  "enabled": true
}
```

## Precedência de categoria no backend

1. Catálogo oficial (se habilitado)
2. `vehicle.manualCategory`
3. `vehicle.carType` / `vehicle.category`
4. `users/{driverId}.carType`
5. fallback do Redis

## Próximo passo futuro

Quando você subir a tabela oficial:

1. Popular o documento `operational_configs/vehicle_category_catalog` no Firestore.
2. Habilitar `ENABLE_VEHICLE_CATALOG_POLICY=true`.
3. Validar com script `scripts/tests/test-driver-eligibility-rules.js`.
