# P0 — Equalização integral de UI/UX no modelo Robotaxi

## Decisão

Todas as superfícies alcançáveis do app devem usar a linguagem visual e os contratos de
interação do modelo Robotaxi atual. Uma tela funcional, porém visualmente legado, não é
considerada aprovada. Este trabalho é **P0** para o fechamento de UI/UX e antecede o aceite
final em Release.

Esta decisão não autoriza alteração de regra de negócio, preço, Pix, saldo, saque, KYC,
segurança ou disponibilidade de recursos. A migração preserva os contratos funcionais e
mantém o backend como fonte de verdade.

## Fonte canônica de design

A precedência para implementação e revisão é:

1. `mobile-app/docs/DESIGN_SYSTEM_ROBOTAXI_ROLLOUT_V2.md` — direção visual atual para
   passageiro e motorista;
2. `mobile-app/docs/UI_UX_LIFECYCLE_CARD_MAP_MATRIX_2026-07-09.md` — hierarquia de decisão,
   conteúdo, mapa, movimento e critérios por estado;
3. `mobile-app/src/components/design-system/robotaxiPrototypeTokens.js` — tokens de código;
4. `mobile-app/src/components/prototype/LeafRideUI.js`, `PrototypeUI.js`,
   `PrototypeMenuSurface.js`, `PrototypeDismissibleSheet.js` e `PrototypeScreenTransition.js`
   — componentes compartilhados existentes.

`DESIGN_SYSTEM_PASSAGEIRO_ROBOTAXI_V1.md` permanece como histórico de origem e contrato
funcional. Onde houver divergência estética, a direção premium clara do V2 e os tokens
atuais prevalecem sobre a referência dark/dourada da V1.

## Contrato obrigatório

- superfície clara e calma, verde Leaf como acento funcional e tokens compartilhados;
- grid de espaçamento 4/8/12/16/20/24/32, raios e tipografia consistentes;
- mapa persistente nas jornadas espaciais; superfícies não espaciais usam o mesmo shell,
  hierarquia e componentes, sem mapa decorativo;
- uma decisão primária por estado e no máximo um CTA preenchido;
- detalhes por divulgação progressiva, sem cards pesados ou duplicação de informação;
- loading, vazio, erro, sucesso, indisponibilidade e retorno explícitos;
- alvos de toque com pelo menos 44 pt, rótulos acessíveis, contraste e Dynamic Type sem
  corte nas escalas suportadas;
- safe areas, teclado, rotação suportada e redução de movimento sem perda de conteúdo;
- nenhuma tela legado, flicker, ferramenta de desenvolvimento ou dado visual inventado na
  evidência de aceite.

## Inventário P0

Status: `MIGRATED`, `IN_REVALIDATION`, `PARTIAL`, `LEGACY_ACTIVE`, `REDIRECT_ONLY`, `PENDING_AUDIT`.

| Domínio | Superfícies principais | Estado inicial | Condição de fechamento |
| --- | --- | --- | --- |
| Autenticação e escolha de perfil | telefone, OTP, recuperação, perfil, dados | MIGRATED | Release principal/compacta e teclado aprovados |
| Onboarding do passageiro | dados pessoais e entrada no app | MIGRATED | Shell editorial atual sem sobreposição |
| Onboarding/ativação do motorista | termos, CNH, CRLV, veículo, fila/status | MIGRATED | Etapas densas, documentos e compacto aprovados |
| Home passageiro e destino | home, busca, resultados, categoria, cotação | MIGRATED | Release principal/compacta percorreu busca até tarifa |
| Pagamento passageiro | Pix, loading, expiração, falha e sucesso | IN_REVALIDATION | Variante Robotaxi Debug aprovada; Release atual ainda precisa ser refeita |
| Ciclo passageiro | busca, aceite, chegada, viagem, interrupção | IN_REVALIDATION | Cards compacto/expandido aprovados em Debug; Release atual ainda precisa ser refeita |
| Pós-corrida passageiro | recibo, avaliação, histórico, reclamação | IN_REVALIDATION | Avaliação equalizada; recibo real e Release consolidada ainda precisam ser refeitos |
| Home e ciclo motorista | offline/online, oferta, retirada, viagem | IN_REVALIDATION | Oferta e estados ativos aprovados em Debug; Release atual ainda precisa ser refeita |
| Financeiro motorista | ganhos, saldo, extrato, repasse e saque | MIGRATED | Ganhos aprovado; saldo/saque antigos gated e não alcançáveis |
| Conta compartilhada | menu, perfil, configurações e privacidade | MIGRATED | Um único conjunto de superfícies Robotaxi alcançáveis |
| Comunicação e segurança | chat, suporte, ticket, compartilhar, emergência | MIGRATED | Erros, retorno, contexto e CTA seguro aprovados |
| Veículos e documentos | lista, inclusão, edição e documentos | MIGRATED | Lista, ativação, documentos e estados compactos aprovados |
| Histórico e detalhes | corridas, detalhes e recibos antigos | MIGRATED | Rotas atuais apontam para Histórico/Recibo Robotaxi |
| Legal, permissões e indisponibilidade | termos, privacidade, permissões, feature gate | MIGRATED | Legal pública, privacidade e indisponibilidade aprovadas |
| Aliases de navegação antigos | Profile, Settings, Chat, Receipt, Payment e similares | REDIRECT_ONLY | Ramo Robotaxi registra superfícies atuais; aliases compartilhados restantes são apenas MapScreen/TabRoot |

## Ordem de execução P0

1. Mapear toda entrada de navegação e produzir a matriz `rota -> componente -> modelo`.
2. Eliminar primeiro os saltos visíveis do fluxo novo para superfícies antigas: ganhos,
   saldo, saque, histórico/detalhes e aliases compartilhados.
3. Equalizar conta, comunicação, onboarding, documentos, veículos, legal e permissões.
4. Validar cada domínio em Debug; corrigir antes de produzir evidência.
5. Gerar uma Release consolidada e registrar principal, compacto, teclado, acessibilidade,
   rotação e redução de movimento.
6. Só encerrar o P0 quando nenhuma jornada alcançável abrir uma superfície fora do contrato.

## Evidência mínima por superfície

- rota e componente efetivamente renderizado;
- captura Release estabilizada no tamanho principal;
- captura compacta para telas densas;
- estado padrão e ao menos loading/erro/vazio aplicável;
- árvore de acessibilidade ou teste equivalente;
- retorno sem perda de estado;
- teste automatizado de rota/componente para impedir regressão a alias legado.

## Auditoria inicial de rotas

| Entrada | Componente efetivo | Classificação | Evidência/ação |
| --- | --- | --- | --- |
| Home motorista → Ganhos | `EarningsReportScreen` | MIGRATED | Release Pro Max e 17e em `qa-artifacts/ui-ux-simulator-2026-07-11/p0-route-audit/release/driver/` |
| `leafapp://driver/earnings` | `EarningsReportScreen` | MIGRATED | Abriu a mesma superfície atual nos dois tamanhos |
| `leafapp://driver/balance` | nenhuma nova rota | REDIRECT_ONLY | Permaneceu em Ganhos; não expôs `DriverBalanceScreen` |
| `DriverBalance` / `WooviDriverBalance` | `PilotFeatureUnavailableScreen` | REDIRECT_ONLY | Gate atual não registra `DriverBalanceScreen` nessas entradas |
| `WithdrawMoney` | `PilotFeatureUnavailableScreen` com flag padrão desligada | REDIRECT_ONLY | `WithdrawMoney` legado só é registrado se saque for explicitamente habilitado |
| Menu → Privacidade | `PrivacyPolicyScreen` | MIGRATED | Jornada real menu → privacidade aprovada em Release Pro |
| `LegalScreen` | `LegalScreen` | MIGRATED | `leafapp://legal` público aprovado em Release sem harness |
| Menu motorista | `RobotaxiMenuScreen` | MIGRATED | Release Pro Max limpa; hierarquia e retorno aprovados |
| Perfil motorista | `RobotaxiProfileScreen` | MIGRATED | Release anterior aprovada; acentuação incluída na Release consolidada |
| Configurações motorista | `RobotaxiSettingsScreen` | MIGRATED | Release anterior aprovada; acentuação incluída na Release consolidada |
| Documentos motorista | `RobotaxiDriverDocumentsScreen` | MIGRATED | Liberação operacional e aprovação documental separadas semanticamente |
| Veículos motorista | `RobotaxiVehiclesScreen` | MIGRATED | Release Pro Max limpa; estado pendente e próximo passo claros |
| Waitlist motorista | `RobotaxiDriverWaitlistScreen` | MIGRATED | Compacto aprovado; backend ausente bloqueia entrada e oferece retry |
| Menu passageiro | `RobotaxiMenuScreen` | MIGRATED | Release Pro limpa; hierarquia e retorno aprovados |
| Perfil passageiro | `RobotaxiProfileScreen` | MIGRATED | Modelo atual e acentuação incluídos na Release consolidada |
| Configurações passageiro | `RobotaxiSettingsScreen` | MIGRATED | Modelo atual e acentuação incluídos na Release consolidada |
| Histórico passageiro | `RobotaxiTripHistoryScreen` | MIGRATED | Release compacta confirma origem e destino canônicos sem fallback falso |

A auditoria Release mostrou que Ganhos já segue a direção Robotaxi, apesar do nome do
arquivo fora da pasta `prototype`. Foi encontrado e corrigido um P0 de navegação: a tela
possuía `handleBackPress`, mas não renderizava o controle de retorno. O botão padrão
`PrototypeMenuCloseButton` agora aparece no cabeçalho, tem alvo de 44 pt e fallback para
`RobotaxiPrototype`. A validação Debug compacta está em
`p0-route-audit/debug/driver/earnings-close-button-iphone-17e.png`; ela não é evidência de
aceite por conter LogBox. A captura limpa será refeita na Release consolidada.

`LegalScreen` ainda usava cabeçalho, tabs, cores e safe area do modelo anterior. O shell
foi migrado para os tokens atuais, ganhou tabs com semântica acessível e retorno seguro. O
botão antigo de ajuda apontava para `HelpScreen`, rota ausente no ramo Robotaxi, e foi
removido. O conteúdo legal não foi alterado. A tela não possui deep link e não é chamada
por nenhuma jornada privada atual; a validação visual deve ocorrer pela entrada pública
real ou por harness restrito ao simulador, nunca por uma captura de outra rota.

A auditoria Release do bloco motorista está em
`qa-artifacts/ui-ux-simulator-2026-07-11/p0-route-audit/release/driver/`. Menu, perfil,
configurações, veículos e waitlist já usam o modelo Robotaxi. Perfil e configurações
perdiam acentos em rótulos importantes; as cópias foram corrigidas e validadas em Debug
compacto. Em Documentos, CNH/CRLV podiam aparecer como pendentes ao mesmo tempo em que a
liberação operacional estava ativa. As fontes agora são apresentadas separadamente:
aprovação documental, liberação do backend e sincronização. O estado divergente não pede
novo upload; orienta atualização. Badges deixaram de ser sempre vermelhos e passaram a
usar tons semânticos de sucesso, atenção e revisão.

No bloco passageiro, Menu, Perfil, Configurações e Histórico foram capturados em Release
no diretório `p0-route-audit/release/passenger/`. O histórico exibia “Destino
indisponível” apesar de o runtime conter `drop: "Leblon, Rio de Janeiro, RJ"`; o componente
não reconhecia o alias `drop` nem o separador ASCII `->`. O mapeamento agora aceita os
aliases canônicos, estruturas aninhadas e os separadores `→`/`->`. A correção foi
confirmada em Debug compacto com origem, destino e valor reais.

Privacidade foi percorrida pela entrada real do menu, sem deep link artificial. A execução
Maestro passou e gerou `p0-route-audit/release/passenger/privacy.png`. A tela usa o modelo
Robotaxi, apresenta uma hierarquia única de tópicos, retorno visível e a exclusão de conta
como detalhe alcançável sem competir com um CTA preenchido. O teste precisou abrir o menu
após o navegador estabilizar; enviar deep link durante o bootstrap era ignorado e não foi
aceito como evidência do produto.

A Release consolidada arm64 terminou com `BUILD SUCCEEDED` e foi instalada nos três
simuladores. As capturas limpas em `p0-route-audit/release-consolidated/` confirmam o
controle de retorno de Ganhos e a correção de origem/destino no Histórico compacto. A
build é autônoma, sem Metro, e atende todos os simuladores Apple Silicon usados na trilha.

Dynamic Type foi validado no iPhone 17e em `accessibility-extra-extra-large`. O shell de
menu limita crescimento a `1.35` sem desligar a escala do sistema; todos os itens e o
rodapé permanecem legíveis e alcançáveis. Contraste aumentado e redução de movimento
também foram executados e restaurados após a coleta. A orientação horizontal é `N/A` por
contrato: `app.config.js` registra somente `UIInterfaceOrientationPortrait` para iPhone e
iPad.

As jornadas restantes em Release estão em `remaining/release/`. Busca de destino,
resultados com teclado e cotação de R$ 13,42 passaram no iPhone 17 Pro e no 17e. Suporte,
Chat, compartilhamento, Legal pública, recibos, pagamento falho, nenhum motorista,
documentos e waitlist também foram capturados. A auditoria encontrou e corrigiu três
estados enganosos: envio do Chat ativo durante erro, waitlist “Disponível” sem critérios
do backend e código técnico `no_drivers_available` exposto ao passageiro. CTAs sem
conectividade agora têm semântica e aparência desabilitadas.

O bloqueio do Pix foi encerrado ao reproduzir a sequência completa do lifecycle aprovado:
autenticação QA foi semeada antes e depois do primeiro launch, seguida pelo estado runtime.
Passageiro e motorista ficaram com socket conectado e autenticado; o motorista foi colocado
online com confirmação remota. A jornada normal de destino, cotação e disponibilidade abriu
uma cobrança Pix real em Release, sem deep link de pagamento nem recibo financeiro inventado.
As capturas principal e compacta estão em
`remaining/release/passenger/pix-pending.png` e `pix-pending-compact.png`. O estado de
expiração também foi observado no compacto, e o fail-safe sem socket permanece aprovado.

## Reabertura P0 — cards de lifecycle e hierarquia de ação

As evidências Release anteriores permanecem úteis como histórico funcional, mas deixaram de
representar o visual atual após a reabertura deste P0. O aceite vigente parte do card de
seleção de categoria e aplica literalmente o seguinte contrato aos estados posteriores:

- margem horizontal de 24 pt, raio 28 e padding horizontal de 18 pt;
- botão de 48 pt, raio 24, ícone de 16 pt, gap de 6 pt e fonte `SemiBold 13/17`;
- hierarquia tipográfica da categoria: título `SemiBold 15.5/20`, valor principal
  `SemiBold 17/22`, dado operacional `SemiBold 12/16` e apoio `Regular 11/15`;
- em ofertas, endereços e descrições permanecem `Regular`; peso forte fica restrito a
  título, valor, identidade e ação dominante;
- card flutuante com espaço transparente até a safe area, sem handle de bottom sheet;
- nenhuma tag, bullet, timeline ou campo contratual invisível usado para simular cobertura;
- uma ação operacional principal; ações secundárias aparecem individualmente apenas após
  expansão e a ação destrutiva fica por último;
- mapa sem cabeçalho redundante, com enquadramento calculado sobre a área realmente livre.

O contrato está isolado em `RobotaxiLifecycleUI.js`; componentes compartilhados e superfícies
legado não foram convertidos. Em Debug foram revalidados busca, oferta, passageiro e motorista
nos estados aceito/chegou/em viagem, incluindo os cards expandidos. A variante Pix do fluxo
Robotaxi mantém `Copiar código` como ação principal e move `Abrir banco` para `Mais opções`; o
comportamento padrão do modal compartilhado permanece inalterado.

Evidências atuais:

- `qa-artifacts/ui-ux-simulator-2026-07-11/lifecycle/debug-card-redesign/`;
- iPhone 17 Pro: compactos de passageiro/motorista, busca e oferta, mais expansões;
- iPhone 17e: Debug reinstalado e conectado ao Metro atual; a primeira captura antiga foi
  rejeitada por abrir uma instalação desatualizada.

O fechamento visual foi repetido na Release autônoma arm64 após a bateria Debug. A primeira
captura da oferta revelou truncamento no título e o enquadramento do motorista ainda distante;
os dois pontos foram corrigidos, retestados e recapturados. A evidência vigente está em
`qa-artifacts/ui-ux-simulator-2026-07-11/lifecycle/release-card-redesign/`, usando os arquivos
com sufixo `-final` para oferta e motorista em viagem. As evidências Release anteriores não
devem ser apresentadas como prova visual desta revisão.

Validação final: 114 suítes/892 testes mobile PASS; bateria focada pós-ajuste com 4 suítes/189
testes PASS; `qa:production-guards`, governança e guardas de segredo PASS. A Release terminou
com `BUILD SUCCEEDED`, configuração Expo válida e `CFBundleVersion 34`.

## Fora do aceite de simulador

Push real, GPS real, câmera de KYC, alternância de rede celular, háptica física,
comportamento térmico e background sob pressão permanecem para aparelho físico. A UI
associada a esses estados continua dentro do P0 e pode ser validada deterministicamente,
mas o comportamento do hardware não será inferido pelo simulador.
