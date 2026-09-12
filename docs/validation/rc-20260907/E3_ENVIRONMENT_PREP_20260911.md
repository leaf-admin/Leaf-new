# Preparação do ambiente E3 bilateral — 12/09/2026

## Objetivo

Deixar a preparação local do E3 reproduzível sem ligar os defaults do helper de
debug, sem publicar artefatos e sem criar cobrança, corrida ou mutação remota.
O helper canônico está em
[`mobile-app/scripts/qa/e3-controlled-env.sh`](../../mobile-app/scripts/qa/e3-controlled-env.sh).

## Fotografia desta preparação

- Branch: `codex/uiux-integration-validation`.
- HEAD: `c5cf21fd4`.
- Metro aquecido em `http://127.0.0.1:8097/status`.
- Node, Java 17, ADB, Android SDK, AAPT, Maestro 2.5.1 e o AVD
  `Leaf_API_35_Driver` disponíveis.
- O device físico `iPhone de Izaak` (iPhone 15 Pro Max, iOS 26.6,
  `00008130-000C70510A93803A`) foi reencontrado como `available (paired)` pelo
  `devicectl`; o Leaf `br.com.leaf.ride` versão `1.0.4 (35)` está instalado e
  foi lançado com sucesso. Após o reinício controlado usado para destravar o
  Espelhamento do iPhone, o device está novamente `unavailable` até ser
  desbloqueado uma vez no aparelho.
- O iPhone canônico de QA listado para simulador é
  `Leaf iPhone 17 Dedicated` (`6BC9EC30-C939-4598-A85D-A9E071E90CE5`). Ele foi
  iniciado, recebeu o build local E3 `1.0.4 (35)` e o app foi instalado e
  lançado.
- Simuladores fora do perfil canônico não foram usados nem alterados.
- O ADB está funcional, porém sem nenhum aparelho conectado; o físico Android
  canônico `irsgaiscr4j7cenv` ainda precisa ser conectado.
- O host tinha 6,5 GB livres; após a limpeza de artefatos regeneráveis passou a
  ter 32 GB livres. A compilação incremental do simulador consumiu caches
  regeneráveis e deixou aproximadamente 18 GB livres; o gate mínimo de 15 GB
  continua satisfeito.
- Há dois devices no único runtime iOS 26.5: `Leaf iPhone 17 Dedicated`
  (9,1 GB, mantido para o E3, bootado nesta sessão) e `Serafy QA iPhone 17`
  (3,5 GB, pertencente a outro projeto, mantido e desligado). Não há devices
  `unavailable` órfãos no runtime do simulador.

### Limpeza de artefatos regeneráveis — 11/09/2026

Foram removidos apenas diretórios ignorados pelo Git ou caches de build
regeneráveis: `mobile-app/ios/build` (14 GB),
`mobile-app/android/app/build` (3,1 GB), `mobile-app/android/build`,
`mobile-app/android/.gradle`, `mobile-app/dist`, `leaf-dashboard-js/.next`,
DerivedData antigo do FitTracker (3,7 GB) e o ModuleCache global do Xcode
(2,5 GB). O DerivedData do Leaf, os artefatos de evidência e os simuladores
foram preservados.

### Verificação do iPhone físico via `devicectl`

- Pareamento, Developer Mode, DDI e túnel foram validados quando o device
  estava `available (paired)`; `device info apps` encontrou o Leaf instalado e
  `device process launch` retornou sucesso (PID observado durante a sessão).
- O JSON do lançamento está em `/tmp/leaf-devicectl-iphone-launch-retry.json`;
  o reinício controlado está em `/tmp/leaf-devicectl-iphone-reboot.json`.
- O Espelhamento do iPhone continua exigindo que a tela esteja bloqueada. O
  `devicectl` não oferece comando para bloquear a tela; depois do reinício, o
  CoreDevice aguarda um desbloqueio físico único para voltar a `available`.
- O build local produzido em
  `mobile-app/ios/build/Build/Products/Release-iphonesimulator/Leaf.app` é
  explicitamente de simulador e não foi instalado no aparelho físico. O
  aparelho continua usando o build assinado já presente (`1.0.4 (35)`).

Depois de desbloquear o iPhone uma vez, relançar o app e bloqueá-lo novamente,
o Espelhamento pode ser conectado para operar o papel de motorista. Um único
iPhone continua não sendo evidência bilateral sem o segundo runtime.

### Verificação do runtime do passageiro

- O simulador dedicado foi bootado e recebeu o build local Release `1.0.4
  (35)`, compilado com o helper E3 e com atualizações OTA desativadas para a
  sessão local.
- A localização simulada foi fixada em `-22.97104,-43.18349`. Com o app real
  em execução, a busca por `Leblon, Rio de Janeiro` produziu a rota dentro da
  área e uma cotação de `R$ 16,88`; o estado final informou `Sem motorista
  disponível`, portanto nenhuma corrida, cobrança ou mutação foi criada.
- O log de build está em `/tmp/leaf-xcodebuild-e3-simulator-final.log`. O
  primeiro passe exigiu apenas materializar o `SmithyCodegenCLI` host; o build
  final terminou com `** BUILD SUCCEEDED **`.

## Flags efetivas do perfil E3

O helper força, em cada sessão, `pilot_controlled`, autenticação Firebase real,
OTP QA desligado, fallback OTP desligado, ferramentas de teste desligadas e
bypass de pagamento desligado. O backend/provider continua sendo a autoridade
do sandbox por usuário.

O endpoint global `/health/runtime-flags` respondeu saudável, mas reportou o
ambiente operacional Woovi como `production` e `realSandbox.ready=false`. Isso é
esperado para o endpoint global e não autoriza cobrança. Antes de abrir o Pix, o
E3 precisa consultar o perfil sandbox escopado ao usuário/telefone da coorte em
uma sessão operacional confiável; essa consulta não foi enviada nesta
preparação para não transmitir identificadores a um destino externo sem um
gate explícito.

## Pré-condições restantes

1. Manter pelo menos 15 GB livres (OK: aproximadamente 18 GB após a
   compilação local).
2. No caminho iPhone, desbloquear o aparelho físico uma vez, fazer
   `devicectl list devices` mostrar `available`, relançar o Leaf e bloquear a
   tela para conectar o Espelhamento.
3. No caminho iPhone, manter o simulador dedicado como segundo runtime
   autorizado e confirmar papéis distintos; o build local do simulador não é
   um build instalável no device físico.
4. No caminho Android, conectar e autorizar o físico `irsgaiscr4j7cenv`.
5. Iniciar o AVD `Leaf_API_35_Driver`, instalar o mesmo APK/versionCode no
   motorista e deixar os dois apps em `MainActivity`.
6. Reexecutar `verify-host-readiness.sh`,
   `prepare-real-smoke-env.sh` e `verify-android-role-runtimes.sh` com o helper
   E3 carregado.
7. Confirmar no endpoint por usuário que o pagamento é `sandbox`, com
   `contextMatched=true` e sem expiração.
8. Só então executar o L2 completo e coletar o pacote de evidências do mesmo
   `rideId` (cotação, Pix, charge, booking, holding, ledger, recibo, dashboard,
   eventos, logs e dispositivos).

O modo `PREPARE_DRIVER=true` permanece uma decisão operacional: ele coloca o
motorista online no Redis remoto. Esta preparação mantém `false` e não fez essa
mutação.

## Comandos da próxima sessão

```bash
cd /Users/izaakdias/Documents/Leaf-new
source mobile-app/scripts/qa/e3-controlled-env.sh

# Gate local; deve reportar HOST_READY antes de tocar nos devices.
QA_PLATFORM=android REQUIRE_METRO_READY=true \
  bash mobile-app/scripts/qa/verify-host-readiness.sh

# Pré-voo completo; para antes do app se o físico, espaço, geofence ou sandbox
# não estiverem comprovados.
bash mobile-app/scripts/qa/prepare-real-smoke-env.sh
```

Depois do preflight passar, usar somente os wrappers gerados no diretório de
artefatos daquela execução. O relatório final deve ser produzido por
`build-smoke-evidence-report.cjs` e `qa:asserts`, com `same-ride-reconciliation`
PASS. Nenhum fixture, bot de dispatch ou dois simuladores substitui o E3
bilateral.

Para o caminho iPhone, a sequência de instalação/lançamento após o device e o
artefato estarem prontos é:

```bash
xcrun devicectl list devices
xcrun devicectl device install app --device <device-udid> <Leaf.app-assinado>
xcrun devicectl device process launch --device <device-udid> br.com.leaf.ride
```

## Resultado

O ambiente local está parcialmente preparado: o build do simulador e a cotação
real do passageiro passaram; o Leaf físico foi localizado, validado e lançado
via `devicectl`. O E3 bilateral ainda não começou porque o iPhone físico está
aguardando desbloqueio após o reinício e o Espelhamento exige a tela bloqueada
para permitir a operação. Nenhuma cobrança, chamada de provider ou mutação de
produção foi criada nesta preparação.

## Atualização pós-execução — 12/09/2026

O snapshot acima é histórico da preparação. A execução bilateral foi concluída
em dois simuladores iOS com motorista e passageiro reais de QA, Pix Woovi
sandbox, deslocamento pela rota do backend, encerramento, crédito de ledger e
avaliações dos dois lados. O relatório completo e os artefatos estão em
[`E3_RUN_20260912.md`](E3_RUN_20260912.md). O device físico continua pendente
apenas do desbloqueio manual após o reboot; o endpoint HTTP legado do dashboard
continua listado como follow-up antes de produção.
