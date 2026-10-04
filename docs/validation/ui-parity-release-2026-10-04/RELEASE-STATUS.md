# Leaf 1.0.6 — candidato de interface e funcionalidade

Data: 04/10/2026. Estado: **aceitação de release pendente**.

## Objetivo

Concluir as lacunas funcionais da nova superfície React Native, preservar a interface aprovada e preparar um candidato verificável para iOS e Android. A conclusão dos testes locais não autoriza declarar a versão validada integralmente em produção ou publicada nas lojas.

## Escopo concluído

- Conta consulta perfil, avaliação e total de viagens das fontes autenticadas existentes. O estado de carregamento não apresenta valores inventados. Falhas parciais permitem tentar novamente.
- Endereços salvos têm consulta, inclusão, edição, exclusão e migração explícita do armazenamento local para a API Leaf. A resposta offline informa que não houve sincronização. Mudanças de sessão bloqueiam respostas e caches de outro usuário.
- O seletor de endereço reutiliza busca e resolução existentes, sem alterar destino, orçamento ou pagamento da viagem.
- O backend aplica identidade do token Firebase, validação de coordenadas e campos, limite de registros, atualização transacional e bloqueio para conta excluída. Esses endpoints ainda precisam ser implantados e aceitos no ambiente integrado.
- O marcador de usuário não usa uma coordenada fictícia quando a localização real não está disponível.
- Versão sincronizada: **1.0.6; iOS 38; Android 132; runtime OTA 1.0.6; canal production**. Os perfis mobile de release agora usam `pilot_controlled`, alinhados ao backend. A configuração pública do perfil EAS selecionado prevalece sobre valores locais antigos nos builds nativos; um `LEAF_ENV_FILE` explícito continua isolado.
- A ponte de apresentação nativa para a tab bar SwiftUI/Liquid Glass continua no projeto. Navegação, conteúdo e regras continuam em React Native. O efeito nativo depende de iOS 26; os demais sistemas usam a apresentação compatível existente.
- O candidato está isolado em `codex/leaf-ui-rc-1.0.6`, no checkout `/Users/izaakdias/.codex/worktrees/leaf-ui-rc106/Leaf-new`. Commits de código: `92e5e742d`, `b4594e3f2`, `823ea4fc8` e `678173e41`. Os 203 arquivos congelados correspondem aos hashes de origem em `candidate-files.json`. A árvore principal e o checkout RC foram comparados arquivo por arquivo, sem divergências nesses 203 arquivos.

## Arquivos alterados

A rodada funcional anterior alterou **32 arquivos**, listados individualmente em [files-changed.json](/Users/izaakdias/Documents/Leaf-new/docs/validation/ui-parity-release-2026-10-04/files-changed.json). A configuração e proteção de assinatura alteraram **14 arquivos**, em [config-files-changed.json](/Users/izaakdias/Documents/Leaf-new/docs/validation/ui-parity-release-2026-10-04/config-files-changed.json); alguns arquivos aparecem nas duas rodadas. O candidato incorpora também a UI aprovada, totalizando 203 arquivos no manifesto de origem.

| Domínio | Arquivos principais |
|---|---|
| Conta | `AccountSummaryService.js`, `useAccountSummary.js`, `RobotaxiMenuScreen.js`, `LeafVisualElements.js`, `BookingHistoryService.js` |
| Endereços | `SavedPlacesService.js`, `LeafSavedPlacesScreen.js`, `LeafSavedPlacePickerScreen.js` |
| API autenticada | `account-routes.js`, `account-saved-places.js` |
| Navegação e mapa | `AppNavigator.js`, `surfaceManifest.json`, `RobotaxiHomeScreen.js` |
| Versão nativa | `AppConfig.js`, Android `build.gradle`, projeto e plists iOS |
| Validação | Testes de conta, endereços, sessão, menu, configurações, mapa e inventário de fluxos |

## Testes executados

Resultados do **checkout congelado**, após reutilizar as dependências locais já instaladas:

| Validação | Resultado |
|---|---|
| Mobile unitário completo | **173 suítes / 1.441 testes passaram** |
| Backend unitário completo | **276 suítes / 2.355 testes passaram** |
| Regressão focada de privacidade | **3 suítes / 24 testes passaram**; já incluídos no conjunto mobile |
| Preflight de release mobile | PASS |
| Governança | PASS, sem findings |
| Scan de segredos dos arquivos versionados | PASS |
| Guard de segredos hardcoded | PASS |
| `git diff --check` | PASS |
| Bundle Hermes iOS final | PASS, 2.317 módulos |
| Build AAB Android | PASS |
| Assinatura AAB | Verificada; SHA-256 do certificado coincide com a configuração de App Links existente |
| Archive iOS e exportação IPA | PASS; exportação automática offline com perfis locais existentes; configuração embarcada confere |
| Assinatura IPA | PASS em app e widget: `codesign --verify --deep --strict`, identidade e perfis correspondentes; Team ID `DTA8W5KA5D` |
| Perfil embarcado em IPA/AAB | PASS: `pilot_controlled`, runtime 1.0.6, URLs production e bypasses false |
| Sandbox canary por usuário | PASS para passageiro e motorista QA: `qa-test-users-sandbox-durable`, scope users, contexto correspondente, sem expiração |
| Navegação no simulador com sessão QA existente | PASS: Início → Conta → Atividade → Conta → Endereços → seletor |
| Validador de configuração local do backend | **FAIL**: ver pendências abaixo |

As primeiras execuções identificaram fixtures antigas de UI, dependências não vinculadas no checkout isolado e um timeout durante sobrecarga de compilação. As execuções finais acima passaram. O backend da árvore principal teve 2.371 testes; o checkout congelado preserva somente os quatro arquivos backend desta tarefa e tem 2.355. Alterações backend de outras tarefas não foram incorporadas ao candidato.

Logs resumidos e fluxo executado estão em `evidence/`. O inventário QA usa **definição estática de fluxos**: `DEFINED` não significa executado. O manifesto classifica 43 rotas atuais, 41 redirecionamentos e 56 rotas legadas; esses números não representam 140 telas novas aceitas.

## Evidências reais coletadas

- Conta carregou **nota 5,00; oito viagens; quatro meses de cadastro**, da sessão QA já existente.
- Atividade carregou **oito registros e R$ 122,94**, sem criar uma viagem nesta rodada.
- A Conta ocupa a superfície inteira. A transição entre as abas foi exercitada novamente com o bundle JS final.
- Endereços e seletor abriram corretamente. Esta navegação não comprova CRUD cloud, pois a API nova ainda não está implantada.
- Prints finais estão em `screenshots/`.

O simulador usa uma casca nativa previamente compilada com a ponte de material e o bundle JS final desta rodada. Isso comprova a navegação e os dados descritos; **não substitui instalação e aceitação do binário nativo 1.0.6 em aparelho físico**.

## Artefatos

Metadados, caminhos absolutos e hashes estão em [artifacts.json](/Users/izaakdias/Documents/Leaf-new/docs/validation/ui-parity-release-2026-10-04/artifacts.json).

- AAB: `/Users/izaakdias/Documents/Leaf-release-candidates/1.0.6/Leaf-1.0.6-132-candidate.aab`.
- IPA: `/Users/izaakdias/Documents/Leaf-release-candidates/1.0.6/Leaf-1.0.6-38-candidate.ipa`.
- Archive: `/Users/izaakdias/Documents/Leaf-release-candidates/1.0.6/Leaf-1.0.6-38.xcarchive`. App e widget têm versão/build correspondentes, runtime 1.0.6 e perfil de distribuição não depurável. A exportação manual foi rejeitada pelo Xcode por usar perfis gerenciados; a exportação automática com esses mesmos perfis passou. A assinatura do app e widget corresponde a **FREEDOM TECNOLOGIA E SERVICOS LTDA — Team ID DTA8W5KA5D**, já configurado no projeto Leaf. Os scripts agora rejeitam outro Team ID antes de build/export e verificam também a equipe da assinatura e dos perfis dentro do IPA. A assinatura local não substitui a validação da App Store. Os binários anteriores estão preservados em `pre-config/`.
- Nenhum artefato foi enviado às lojas. Nenhuma OTA foi publicada.

## Pendências de aceitação e riscos

1. **Viagem bilateral:** o alvo existente foi confirmado. Os usuários QA de passageiro e motorista recebem o perfil sandbox `qa-test-users-sandbox-durable` na API production; não é necessário criar staging ou mudar o Woovi global. A leitura anterior de `realSandbox.ready=false` verificava o ambiente global e não sustentava a conclusão de que o canary por usuário estava ausente. O comando canônico `npm --prefix mobile-app run qa:backend:pilot-canary` reutiliza essa configuração e passou. Ainda falta executar a viagem bilateral completa com o candidato final nos aparelhos: pagamento confirmado, chegada, embarque, navegação, término, recibo, avaliação e exceções. O canary de configuração não comprova essas ações nem uma transação de provedor.
2. **Endereços cloud:** implantar a API autenticada e validar criação, edição, exclusão, reinício, segundo dispositivo e troca de sessão. Até lá, o app mantém o fallback local honesto.
3. **Configuração backend local:** o validador aponta `CPF_REVIEW_HMAC_KEY` dedicada ausente/insuficiente, `REDIS_CRITICAL_DATASET_GENERATION` ausente e cohorts `PILOT_ALLOWED_PASSENGER_IDS` / `PILOT_ALLOWED_DRIVER_IDS` ausentes. Isso descreve os arquivos locais carregados pelo validador; não prova que a VPS tenha essas mesmas lacunas. As flags públicas confirmam cohort configurado com um passageiro e um motorista. Os demais itens exigem leitura da configuração efetiva após confirmar a identidade SSH. Nenhuma chave foi criada ou rotacionada.
4. **Aparelhos:** iPhone continua com 1.0.5/build 37. Essa instalação abriu com sucesso por `devicectl`, mas o candidato 1.0.6/38 ainda não foi instalado. O usuário relatou um aviso de desenvolvedor não confiável; o certificado exibido nesse diálogo não foi observado, portanto a causa não foi atribuída a uma equipe diferente. O espelhamento informou iPhone em uso. O novo IPA está comprovadamente assinado pelo Team Leaf. Android não aparece no ADB/USB. A validação física do candidato não foi concluída.
5. **Assinatura iOS:** existem perfis de distribuição para app e widget e um perfil de desenvolvimento para o app. Não foi encontrado perfil de desenvolvimento para o widget. A aceitação do pacote completo no iPhone precisa de distribuição de teste ou provisionamento completo; não será simulada removendo o widget e declarando paridade total.
6. **Cobertura UI restante:** notificações, idioma, tráfego e voz continuam indisponíveis nas configurações. Badges/gamificação e a aprovação final do onboarding foram adiados na revisão anterior. As demais rotas contam com contratos e definições QA, mas não foram todas percorridas nesta sessão com dados reais em ambos os papéis.
7. **Publicação:** distribuir o candidato de teste, fechar a matriz física/bilateral e revisar a configuração efetiva antes de deploy de produção e submissão. O preflight mobile não substitui essas etapas.

A configuração de release e o sandbox por usuário estão resolvidos. As pendências de execução, API ainda não implantada e cobertura acima continuam explícitas; **“1:1 integralmente validado e pronto para produção” ainda não está sustentado**.

## Acesso VPS — referência persistente

- Arquivo de acesso localizado: `/Users/izaakdias/Desktop/dump/contabo.txt`.
- Chave de login existente: `/Users/izaakdias/.ssh/leaf_contabo_20260412_ed25519`.
- O responsável já autorizou o uso desse acesso. Não pedir novamente o arquivo ou a localização da VPS.
- Nesta rodada a porta SSH respondeu, porém a identidade SSH apresentada divergiu de `known_hosts`. A autenticação não foi executada.
- Impressão digital ED25519 apresentada: `SHA256:Go/Zwa/PnjWiu7qChfmXfdKn44GmiYfyIeMCwtKOu54`. A confirmação pelo console Contabo foi solicitada e permanece pendente.
- Não remover a entrada antiga nem desativar a verificação para contornar essa divergência. Depois da confirmação, verificar serviço/modelo Face Compare e configuração efetiva em leitura antes de qualquer rollout.
- Flags públicas indicam configuração do Face Compare; isso não comprova saúde do processo/modelo. O probe HTTP local registrado em `evidence/face-health-probe.json` também não produziu essa prova.

Credenciais, senhas e conteúdo do arquivo de acesso não foram incluídos no relatório ou no Git.

## Rollback

- O patch [config-alignment.patch.gz](/Users/izaakdias/Documents/Leaf-new/docs/validation/ui-parity-release-2026-10-04/config-alignment.patch.gz) contém somente os 14 arquivos desta configuração e assinatura. `gzip -dc config-alignment.patch.gz | git apply --reverse --check` passou na árvore principal. `config-baseline-files.json` registra os hashes anteriores; nenhum rollback foi aplicado.
- O patch [parity-completion.patch.gz](/Users/izaakdias/Documents/Leaf-new/docs/validation/ui-parity-release-2026-10-04/parity-completion.patch.gz) descreve somente esta rodada. A verificação `gzip -dc parity-completion.patch.gz | git apply --reverse --check` passou ao concluir a rodada funcional anterior; nenhum rollback foi aplicado. Para desfazer as duas rodadas, reverter primeiro a configuração e depois a rodada funcional, validando cada patch antes de aplicá-lo. Os patches são armazenados comprimidos para preservar exatamente seu contexto e evitar que o conteúdo do diff seja interpretado como whitespace do documento.
- Os originais estão em `before-parity.tar.gz`, e os hashes anteriores em `baseline-files.json`. Reverter somente esse patch preserva as alterações anteriores do usuário, enquanto não houver mudanças posteriores nos mesmos trechos.
- O checkout RC pode ser descartado/arquivado sem alterar o checkout principal, mas deve permanecer disponível para revisão enquanto houver pendências.
- Como não houve publicação nem deploy, não existe mudança remota para desfazer. Após eventual publicação, uma correção exige novo build e incremento de versão de loja conforme o processo existente; não reutilizar o número de um build já enviado.

## Fora do escopo, preservado

Regras de Pix, split, taxa, pedágio, saldo, saque, estorno, KYC/liveness e elegibilidade. Alterações staged/unstaged de outras tarefas, dashboard, infraestrutura e código legado. Nenhuma dependência, chamada paga adicional de provedor, worker ou job foi introduzido. OpenCode e Maestri não foram abertos.
