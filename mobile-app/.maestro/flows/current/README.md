# Current-product Maestro acceptance

Esta pasta é a única entrada do comando `npm run test:e2e`.

Regras:

- iniciar em `leafapp://robotaxi/home`;
- usar somente superfícies e `testID`s do produto atual;
- não referenciar fluxos com `LEGACY_COMPAT_ONLY`;
- não usar `robotaxi/destination`, `robotaxi/booking` ou `robotaxi/payment` como entrada;
- jornadas integradas de passageiro e motorista continuam sendo orquestradas pelos runners
  dedicados em simuladores distintos; esta entrada é o smoke canônico comum.

O inventário anterior permanece intacto e acessível somente pelos comandos explícitos
`test:e2e:legacy` e `test:e2e:legacy:debug`.
