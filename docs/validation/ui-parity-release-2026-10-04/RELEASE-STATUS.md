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
- Versão sincronizada: **1.0.6; iOS 38; Android 132; runtime OTA 1.0.6; canal production**. O perfil mobile existente continua `ride_flow_validation`; o backend público informa `pilot_controlled`.
- A ponte de apresentação nativa para a tab bar SwiftUI/Liquid Glass continua no projeto. Navegação, conteúdo e regras continuam em React Native. O efeito nativo depende de iOS 26; os demais sistemas usam a apresentação compatível existente.
- O candidato está isolado em `codex/leaf-ui-rc-1.0.6`, no checkout `/Users/izaakdias/.codex/worktrees/leaf-ui-rc106/Leaf-new`. Commits de código: `92e5e742d` e `b4594e3f2`. Os 196 arquivos congelados correspondem aos hashes de origem em `candidate-files.json`.

## Arquivos alterados

O fechamento desta rodada alterou **32 arquivos de implementação/validação**, listados individualmente em [files-changed.json](/Users/izaakdias/Documents/Leaf-new/docs/validation/ui-parity-release-2026-10-04/files-changed.json), além deste diretório de evidências. O candidato incorpora também o trabalho de UI aprovado das rodadas anteriores, totalizando 196 arquivos no manifesto de origem.

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
| Mobile unitário completo | **171 suítes / 1.425 testes passaram** |
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
| Archive iOS e exportação IPA | PASS; exportação automática com perfis locais existentes |
| Assinatura IPA | PASS em app e widget: `codesign --verify --deep --strict`, identidade e perfis correspondentes |
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
- Archive: `/Users/izaakdias/Documents/Leaf-release-candidates/1.0.6/Leaf-1.0.6-38.xcarchive`. App e widget têm versão/build correspondentes, runtime 1.0.6 e perfil de distribuição não depurável. A exportação manual foi rejeitada pelo Xcode por usar perfis gerenciados; a exportação automática com esses mesmos perfis passou. A assinatura local não substitui a validação da App Store.
- Nenhum artefato foi enviado às lojas. Nenhuma OTA foi publicada.

## Pendências de aceitação e riscos

1. **Ambiente integrado:** o endpoint público atual usa Woovi production e informa `realSandbox.ready=false`. Os alvos staging consultados não resolvem em DNS. O runner QA existente rejeita esse alvo. Ainda falta uma viagem bilateral com pagamento confirmado, chegada, embarque, navegação, término, recibo, avaliação e exceções, usando o candidato final e um alvo QA aceito.
2. **Endereços cloud:** implantar a API autenticada e validar criação, edição, exclusão, reinício, segundo dispositivo e troca de sessão. Até lá, o app mantém o fallback local honesto.
3. **Configuração backend local:** o validador aponta `CPF_REVIEW_HMAC_KEY` dedicada ausente/insuficiente, `REDIS_CRITICAL_DATASET_GENERATION` ausente e cohorts `PILOT_ALLOWED_PASSENGER_IDS` / `PILOT_ALLOWED_DRIVER_IDS` ausentes. Isso descreve os arquivos locais carregados pelo validador; não prova que a VPS tenha essas mesmas lacunas. As flags públicas confirmam cohort configurado com um passageiro e um motorista. Os demais itens exigem leitura da configuração efetiva após confirmar a identidade SSH. Nenhuma chave foi criada ou rotacionada.
4. **Aparelhos:** iPhone está conectado, desbloqueado e com modo de desenvolvimento, mas continua com 1.0.5/build 37. Android não aparece no ADB. A validação física do candidato não foi concluída.
5. **Assinatura iOS:** existem perfis de distribuição para app e widget e um perfil de desenvolvimento para o app. Não foi encontrado perfil de desenvolvimento para o widget. A aceitação do pacote completo no iPhone precisa de distribuição de teste ou provisionamento completo; não será simulada removendo o widget e declarando paridade total.
6. **Cobertura UI restante:** notificações, idioma, tráfego e voz continuam indisponíveis nas configurações. Badges/gamificação e a aprovação final do onboarding foram adiados na revisão anterior. As demais rotas contam com contratos e definições QA, mas não foram todas percorridas nesta sessão com dados reais em ambos os papéis.
7. **Publicação:** distribuir o candidato de teste, fechar a matriz física/bilateral e revisar a configuração efetiva antes de deploy de produção e submissão. O preflight mobile não substitui essas etapas.

Por essas pendências, a afirmação **“1:1 integralmente validado e pronto para produção” ainda não está sustentada**.

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

- O patch [parity-completion.patch.gz](/Users/izaakdias/Documents/Leaf-new/docs/validation/ui-parity-release-2026-10-04/parity-completion.patch.gz) descreve somente esta rodada. A verificação `gzip -dc parity-completion.patch.gz | git apply --reverse --check` passou na árvore principal; nenhum rollback foi aplicado. Os patches são armazenados comprimidos para preservar exatamente seu contexto e evitar que o conteúdo do diff seja interpretado como whitespace do documento.
- Os originais estão em `before-parity.tar.gz`, e os hashes anteriores em `baseline-files.json`. Reverter somente esse patch preserva as alterações anteriores do usuário, enquanto não houver mudanças posteriores nos mesmos trechos.
- O checkout RC pode ser descartado/arquivado sem alterar o checkout principal, mas deve permanecer disponível para revisão enquanto houver pendências.
- Como não houve publicação nem deploy, não existe mudança remota para desfazer. Após eventual publicação, uma correção exige novo build e incremento de versão de loja conforme o processo existente; não reutilizar o número de um build já enviado.

## Fora do escopo, preservado

Regras de Pix, split, taxa, pedágio, saldo, saque, estorno, KYC/liveness e elegibilidade. Alterações staged/unstaged de outras tarefas, dashboard, infraestrutura e código legado. Nenhuma dependência, chamada paga adicional de provedor, worker ou job foi introduzido. OpenCode e Maestri não foram abertos.
