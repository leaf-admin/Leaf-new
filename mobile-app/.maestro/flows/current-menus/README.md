# CURRENT menu runners

Estes runners visitam somente o menu e as superfícies CURRENT, sempre começando em
`leafapp://robotaxi/home` e abrindo as subseções pela interface.

Pré-condições:

- app instalado e sessão já autenticada;
- um simulador dedicado ao passageiro e outro dedicado ao motorista;
- nenhum runner troca papel, prepara estado ou executa mutações;
- respostas remotas indisponíveis são aceitas somente pela respectiva tela de erro honesta.

Execução individual, a partir de `mobile-app`:

```bash
maestro test .maestro/flows/current-menus/01-passenger-dedicated-device.yaml --device "$PASSENGER_DEVICE_ID"
maestro test .maestro/flows/current-menus/02-driver-dedicated-device.yaml --device "$DRIVER_DEVICE_ID"
```

Não execute a pasta inteira em um único device: cada arquivo exige que a sessão daquele
simulador já corresponda ao papel indicado. O smoke padrão `npm run test:e2e` permanece
restrito a `.maestro/flows/current`.
