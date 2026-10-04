# Cadastro real em QA

## Preflight obrigatório do target

O app tem defaults para produção, e `.env.pilot.example` contém flags de
produto, não a URL do backend. O carregador não importa esse exemplo
automaticamente. Os Release QA atuais foram compilados com `api.leaf.app.br` e
perfil `full`; use-os apenas para smoke visual, nunca para cadastrar, pedir OTP,
criar corrida ou testar pagamento.

Use um arquivo local QA separado, fora do Git, com as URLs do backend e socket
de QA, `LEAF_QA_TARGET_API_ORIGIN`, `LEAF_QA_TARGET_WS_ORIGIN` e o perfil
`pilot_controlled`. Selecione o arquivo explicitamente: o loader não mescla
`.env`/`.env.production`, e os valores definidos nesse arquivo vencem valores
de mesmo nome já exportados no shell:

```bash
export LEAF_ENV_FILE="/caminho/seguro/leaf-mobile-qa.env"
npm run qa:preflight:real-e2e
```

O preflight não faz chamadas de rede. Ele bloqueia URL padrão de produção,
perfil incorreto, ausência de allowlist do target e bypass de OTP/pagamento ou
ferramentas de desenvolvimento. Use o mesmo `LEAF_ENV_FILE` ao compilar o
artefato e confira o target embutido antes de instalar. Não execute o fluxo
real até o preflight passar.

Os fluxos Android e iOS exigem telefone de uma conta QA autorizada e os seis
dígitos do OTP recebido naquela execução. Não há telefone, OTP fixo, bypass de
autenticação ou número de produção nos arquivos. Os fluxos não reenviam o OTP
automaticamente: se a etapa falhar, registre a evidência antes de uma nova
tentativa para evitar criar conta duplicada ou solicitar SMS repetido.

## Passageiro

Defina os valores no shell local seguro, sem registrá-los em scripts ou no Git:

```bash
export PASSENGER_PHONE='<telefone da conta QA>'
export PASSENGER_OTP_DIGIT_0='<dígito 0>'
export PASSENGER_OTP_DIGIT_1='<dígito 1>'
export PASSENGER_OTP_DIGIT_2='<dígito 2>'
export PASSENGER_OTP_DIGIT_3='<dígito 3>'
export PASSENGER_OTP_DIGIT_4='<dígito 4>'
export PASSENGER_OTP_DIGIT_5='<dígito 5>'
```

Receba o OTP no canal autorizado e rode o fluxo no Android de QA:

```bash
source scripts/source-local-build-env.sh
maestro test .maestro/flows/qa/e2e/20-passenger-signup-real-android.yaml \
  -e PASSENGER_PHONE="$PASSENGER_PHONE" \
  -e PASSENGER_OTP_DIGIT_0="$PASSENGER_OTP_DIGIT_0" \
  -e PASSENGER_OTP_DIGIT_1="$PASSENGER_OTP_DIGIT_1" \
  -e PASSENGER_OTP_DIGIT_2="$PASSENGER_OTP_DIGIT_2" \
  -e PASSENGER_OTP_DIGIT_3="$PASSENGER_OTP_DIGIT_3" \
  -e PASSENGER_OTP_DIGIT_4="$PASSENGER_OTP_DIGIT_4" \
  -e PASSENGER_OTP_DIGIT_5="$PASSENGER_OTP_DIGIT_5"
```

## Motorista Android

Defina `DRIVER_PHONE` e `DRIVER_OTP_DIGIT_0` até `DRIVER_OTP_DIGIT_5` da
mesma forma e use o fluxo de motorista:

```bash
source scripts/source-local-build-env.sh
maestro test .maestro/flows/qa/e2e/21-driver-signup-docs-real-android.yaml \
  -e DRIVER_PHONE="$DRIVER_PHONE" \
  -e DRIVER_OTP_DIGIT_0="$DRIVER_OTP_DIGIT_0" \
  -e DRIVER_OTP_DIGIT_1="$DRIVER_OTP_DIGIT_1" \
  -e DRIVER_OTP_DIGIT_2="$DRIVER_OTP_DIGIT_2" \
  -e DRIVER_OTP_DIGIT_3="$DRIVER_OTP_DIGIT_3" \
  -e DRIVER_OTP_DIGIT_4="$DRIVER_OTP_DIGIT_4" \
  -e DRIVER_OTP_DIGIT_5="$DRIVER_OTP_DIGIT_5"
```

O fluxo Android de motorista também precisa dos PDFs de teste CNH e CRLV
disponíveis no seletor de arquivos.

## iOS

Use uma conta QA inédita por papel, OTP recebido nessa tentativa e um simulador
iOS de QA selecionado explicitamente. O fluxo de passageiro termina na tela
inicial. O fluxo de motorista usa um PDF sintético de CNH com o nome `CNH.pdf`,
guardado em `Files > On My iPhone > Leaf Pilot QA`; ele termina na tela inicial
antes de iniciar ativação facial/KYC. Não use documento pessoal real.

```bash
export IOS_SIMULATOR_UDID='<UDID do simulador iOS de QA>'
source scripts/source-local-build-env.sh
maestro test .maestro/flows/qa/e2e/20-passenger-signup-real-ios.yaml \
  --device "$IOS_SIMULATOR_UDID" \
  -e PASSENGER_PHONE="$PASSENGER_PHONE" \
  -e PASSENGER_OTP_DIGIT_0="$PASSENGER_OTP_DIGIT_0" \
  -e PASSENGER_OTP_DIGIT_1="$PASSENGER_OTP_DIGIT_1" \
  -e PASSENGER_OTP_DIGIT_2="$PASSENGER_OTP_DIGIT_2" \
  -e PASSENGER_OTP_DIGIT_3="$PASSENGER_OTP_DIGIT_3" \
  -e PASSENGER_OTP_DIGIT_4="$PASSENGER_OTP_DIGIT_4" \
  -e PASSENGER_OTP_DIGIT_5="$PASSENGER_OTP_DIGIT_5"
```

Para motorista, use o mesmo `IOS_SIMULATOR_UDID`, os valores `DRIVER_PHONE` e
`DRIVER_OTP_DIGIT_0` até `DRIVER_OTP_DIGIT_5`, e o arquivo
`.maestro/flows/qa/e2e/21-driver-signup-real-ios.yaml`.

Esses fluxos criam estado de autenticação/onboarding e enviam documentos ao
ambiente configurado pelo app. Só rode com contas, números e documentos QA
autorizados; nunca use uma conta já cadastrada ou dados pessoais reais. A
definição estática do fluxo não é evidência de execução ou aprovação do cadastro.
