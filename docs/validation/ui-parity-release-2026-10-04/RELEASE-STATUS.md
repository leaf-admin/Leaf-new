# Leaf 1.0.6 — candidato de interface e funcionalidade

Data: 04/10/2026. Estado: **aceitação de release pendente**.

Atualização de 05/10/2026: a API de endereços salvos foi integrada em `main` pela [PR #222](https://github.com/leaf-admin/Leaf-new/pull/222), com 67 testes focados e os seis gates da CI passando. O endpoint remoto ainda respondeu 404; implantação e validação física seguem pendentes de confirmação da identidade SSH e disponibilidade dos aparelhos. Ver [registro desta rodada](CLOSURE-RUN-2026-10-05.md).

Refinamento visual de 05/10/2026: o branch `codex/vehicle-marker-refinement` acrescenta o novo carro SVG e interpolação pelas curvas da rota. Esses arquivos JS ainda **não estão nos binários congelados abaixo**. O manifesto de 222 arquivos descreve o candidato anterior; a árvore principal evolui a partir dele nesta rodada. O checkout isolado está temporariamente nesse novo branch, enquanto `codex/leaf-ui-rc-1.0.6` preserva o estado anterior. Ver [escopo, prévia e validação do marcador](../vehicle-marker-2026-10-05/REPORT.md).

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
- Notificações consulta a permissão do sistema e registra push quando a permissão é ativada pelos ajustes. Trânsito e voz são configurações do motorista persistidas pela API autenticada. O piloto expõe português do Brasil. A voz nativa utiliza os passos de navegação existentes e funciona com o app em primeiro plano; não introduz chamadas pagas de rota. Detalhes e limites em [SETTINGS-CLOSURE.md](/Users/izaakdias/Documents/Leaf-new/docs/validation/ui-parity-release-2026-10-04/SETTINGS-CLOSURE.md).
- O candidato está preservado em `codex/leaf-ui-rc-1.0.6`. O checkout `/Users/izaakdias/.codex/worktrees/leaf-ui-rc106/Leaf-new` também abriga o branch de refinamento citado acima. Commits de código do candidato: `92e5e742d`, `b4594e3f2`, `823ea4fc8` e `678173e41`. A rodada de configurações/voz está nos commits `609fca2d3`, `d3f8e5f88` e `1097a27fc`. Os 222 arquivos de `candidate-files.json` coincidiram entre a árvore principal e o RC na verificação registrada em `CLOSURE-RUN-2026-10-05.md`, antes do novo refinamento do marcador.

## Arquivos alterados

A rodada funcional anterior alterou **32 arquivos**, listados individualmente em [files-changed.json](/Users/izaakdias/Documents/Leaf-new/docs/validation/ui-parity-release-2026-10-04/files-changed.json). A rodada de configurações/voz alterou **30 arquivos versionados e dois arquivos Android gerados**, em `settings-files-changed.json`. A configuração e proteção de assinatura anterior alterou **14 arquivos**, em [config-files-changed.json](/Users/izaakdias/Documents/Leaf-new/docs/validation/ui-parity-release-2026-10-04/config-files-changed.json); alguns arquivos aparecem nas duas rodadas. O candidato incorpora também a UI aprovada, totalizando 222 arquivos no manifesto de origem.

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
| Mobile unitário completo | **177 suítes / 1.467 testes passaram**, após configurações e voz |
| Backend unitário completo | **276 suítes / 2.355 testes passaram** |
| Regressão focada de privacidade | **3 suítes / 24 testes passaram**; já incluídos no conjunto mobile |
| Preflight de release mobile | PASS |
| Governança | PASS, sem findings |
| Scan de segredos dos arquivos versionados | PASS |
| Guard de segredos hardcoded | PASS |
| `git diff --check` | PASS |
| Bundle Hermes iOS final | PASS, 2.321 módulos |
| Build AAB Android | PASS |
| Assinatura AAB | Verificada; SHA-256 do certificado coincide com a configuração de App Links existente |
| Archive iOS e exportação IPA | PASS; exportação automática offline com perfis locais existentes; configuração embarcada confere |
| Assinatura IPA | PASS em app e widget: `codesign --verify --deep --strict`, identidade e perfis correspondentes; Team ID `DTA8W5KA5D` |
| Pacote iOS de teste completo | PASS; app e widget em `debugging`, Team `DTA8W5KA5D`, dois dispositivos nos perfis |
| Preferências em API real | PASS: GET → PATCH → GET → restauração → GET; HTTP 200, apenas conta QA |
| Ponte nativa de voz | PASS: iOS compilado/linkado e classe Android no DEX; áudio físico ainda pendente |
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
- APK físico de teste: `/Users/izaakdias/Documents/Leaf-release-candidates/1.0.6/Leaf-1.0.6-132-device.apk`, assinatura e configuração embarcada verificadas.
- Pacote físico de teste: `/Users/izaakdias/Documents/Leaf-release-candidates/1.0.6/Leaf-1.0.6-38-device.ipa`, com app e widget completos e Team Leaf. Os candidatos anteriores às configurações/voz estão em `pre-settings/`; hashes e commit atuais foram atualizados em `artifacts.json`.
- Nenhum artefato foi enviado às lojas. Nenhuma OTA foi publicada.

## Pendências de aceitação e riscos

1. **Viagem bilateral:** o alvo existente foi confirmado. Os usuários QA de passageiro e motorista recebem o perfil sandbox `qa-test-users-sandbox-durable` na API production; não é necessário criar staging ou mudar o Woovi global. A leitura anterior de `realSandbox.ready=false` verificava o ambiente global e não sustentava a conclusão de que o canary por usuário estava ausente. O comando canônico `npm --prefix mobile-app run qa:backend:pilot-canary` reutiliza essa configuração e passou. Ainda falta executar a viagem bilateral completa com o candidato final nos aparelhos: pagamento confirmado, chegada, embarque, navegação, término, recibo, avaliação e exceções. O canary de configuração não comprova essas ações nem uma transação de provedor.
2. **Endereços cloud:** a leitura autenticada real confirmou HTTP 404 em `/api/account/places`. Implantar a API autenticada e validar criação, edição, exclusão, reinício, segundo dispositivo e troca de sessão. Até lá, o app mantém o fallback local honesto.
3. **Configuração backend local:** o validador aponta `CPF_REVIEW_HMAC_KEY` dedicada ausente/insuficiente, `REDIS_CRITICAL_DATASET_GENERATION` ausente e cohorts `PILOT_ALLOWED_PASSENGER_IDS` / `PILOT_ALLOWED_DRIVER_IDS` ausentes. Isso descreve os arquivos locais carregados pelo validador; não prova que a VPS tenha essas mesmas lacunas. As flags públicas confirmam cohort configurado com um passageiro e um motorista. Os demais itens exigem leitura da configuração efetiva após confirmar a identidade SSH. Nenhuma chave foi criada ou rotacionada.
4. **Aparelhos:** iPhone continua com 1.0.5/build 37. Essa instalação abriu com sucesso por `devicectl`, mas o candidato 1.0.6/38 ainda não foi instalado. O usuário relatou um aviso de desenvolvedor não confiável; o certificado exibido nesse diálogo não foi observado, portanto a causa não foi atribuída a uma equipe diferente. O espelhamento informou iPhone em uso. O novo IPA está comprovadamente assinado pelo Team Leaf. Android não aparece no ADB/USB. A validação física do candidato não foi concluída.
5. **Assinatura iOS resolvida:** o pacote `Leaf-1.0.6-38-device.ipa` foi exportado com app e widget completos, ambos em desenvolvimento e com Team `DTA8W5KA5D`. O perfil do widget está disponível e os perfis contemplam dois dispositivos. A instalação foi tentada pelo identificador e pelo nome do iPhone e falhou com erro CoreDevice 1011. A leitura final informa `tunnelState: unavailable`; pareamento existente não equivale a conexão operacional. Falta reconectar o aparelho e aceitar o candidato completo, sem remover o widget.
6. **Cobertura UI:** as lacunas de configurações foram implementadas e passaram pela suíte completa. Português do Brasil é o único idioma exposto neste piloto. Voz funciona na navegação interna do motorista em primeiro plano e exige uma voz do dispositivo; no Android ela deve ser offline. A nova ponte exige o binário atualizado. Badges/gamificação e a aprovação final do onboarding continuam adiados. As demais rotas não foram todas percorridas com dados reais em ambos os papéis nesta rodada.
7. **Publicação:** distribuir o candidato de teste, fechar a matriz física/bilateral e revisar a configuração efetiva antes de deploy de produção e submissão. O preflight mobile não substitui essas etapas.

Configuração de release, sandbox por usuário, preferências e assinatura do pacote iOS completo estão resolvidos. Aceitação física/bilateral e implantação de endereços continuam pendentes; **“1:1 integralmente validado e pronto para produção” ainda não está sustentado**.

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

- Para a rodada de configurações/voz, `gzip -dc settings-completion.patch.gz | git apply --reverse --check` passou na árvore principal. O patch contém somente 32 arquivos desta rodada e deve ser revertido antes dos patches anteriores. Nenhum rollback foi aplicado.

- O patch [config-alignment.patch.gz](/Users/izaakdias/Documents/Leaf-new/docs/validation/ui-parity-release-2026-10-04/config-alignment.patch.gz) contém somente os 14 arquivos desta configuração e assinatura. `gzip -dc config-alignment.patch.gz | git apply --reverse --check` passou na árvore principal. `config-baseline-files.json` registra os hashes anteriores; nenhum rollback foi aplicado.
- O patch [parity-completion.patch.gz](/Users/izaakdias/Documents/Leaf-new/docs/validation/ui-parity-release-2026-10-04/parity-completion.patch.gz) descreve somente esta rodada. A verificação `gzip -dc parity-completion.patch.gz | git apply --reverse --check` passou ao concluir a rodada funcional anterior; nenhum rollback foi aplicado. Para desfazer as duas rodadas, reverter primeiro a configuração e depois a rodada funcional, validando cada patch antes de aplicá-lo. Os patches são armazenados comprimidos para preservar exatamente seu contexto e evitar que o conteúdo do diff seja interpretado como whitespace do documento.
- Os originais estão em `before-parity.tar.gz`, e os hashes anteriores em `baseline-files.json`. Reverter somente esse patch preserva as alterações anteriores do usuário, enquanto não houver mudanças posteriores nos mesmos trechos.
- O checkout RC pode ser descartado/arquivado sem alterar o checkout principal, mas deve permanecer disponível para revisão enquanto houver pendências.
- Como não houve publicação nem deploy, não existe mudança remota para desfazer. Após eventual publicação, uma correção exige novo build e incremento de versão de loja conforme o processo existente; não reutilizar o número de um build já enviado.

## Fora do escopo, preservado

Regras de Pix, split, taxa, pedágio, saldo, saque, estorno, KYC/liveness e elegibilidade. Alterações staged/unstaged de outras tarefas, dashboard, infraestrutura e código legado. Nenhuma dependência, chamada paga adicional de provedor, worker ou job foi introduzido. OpenCode e Maestri não foram abertos.
