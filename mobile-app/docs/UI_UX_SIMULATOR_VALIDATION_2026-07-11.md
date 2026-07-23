# Validação UI/UX em simulador — 2026-07-11

## Objetivo

Fechar os itens de UI/UX verificáveis em simulador para passageiro e motorista, com
evidência reproduzível por estado, sem usar o simulador como prova de recursos que
dependem de hardware ou de comportamento real de distribuição.

## P0 de equalização integral

A equalização de **todas as superfícies alcançáveis** ao modelo Robotaxi atual é condição
de aceite desta trilha. Tela funcional com linguagem legado não recebe `PASS`. O inventário,
a precedência das diretrizes e o contrato de fechamento estão em
`mobile-app/docs/P0_UI_UX_ROBOTAXI_EQUALIZATION_2026-07-11.md`.

O Design System Robotaxi V2, a matriz de ciclo/card/mapa de 09/07, os tokens
`robotaxiPrototypeTokens` e os componentes compartilhados de `src/components/prototype`
formam a fonte canônica. A referência dark/dourada do documento V1 é histórica; a direção
premium clara do V2 e os tokens atuais prevalecem.

A auditoria completa confirmou Histórico, detalhes e aliases alcançáveis no modelo atual.
A tela de Ganhos já usava a linguagem Robotaxi e recebeu retorno visível; saldo e saque
antigos permanecem atrás de redirects/feature gates e não foram expostos pelas jornadas
Release auditadas.

## Baseline da execução

- Branch: `codex/p0-p1-no-regression-hardening`
- Commit inicial: `1bc4d03dc`
- App: Leaf `1.0.4` (`CFBundleVersion 34`)
- Xcode: `26.6` (`17F113`)
- CocoaPods: `1.16.2`
- Build de aceite: `Release-iphonesimulator`, autônoma, sem Metro
- Passageiro principal: iPhone 17 Pro, iOS 26.4, `195D2C57-87DC-4953-ABF1-4FD351ADBBEF`
- Motorista principal: iPhone 17 Pro Max, iOS 26.4, `2E44BC8E-9AA8-43BE-BD5E-D0B5A73E543C`
- Compacto: iPhone 17e, iOS 26.4, `DBA1645B-D7BD-485A-A771-F945993F78A4`

## Estratégia de build

- Debug/dev client é a build de descoberta e correção. Alterações JavaScript usam Fast
  Refresh; mudanças nativas exigem nova compilação.
- Screenshots de aceite não podem conter LogBox, dev menu ou mensagens do Metro.
- Release de simulador será gerada apenas nos checkpoints de evidência e no gate final.
- Debug e Release completos não serão mantidos simultaneamente enquanto houver pouco
  espaço em disco.

## Baseline automatizado

| Verificação | Resultado | Evidência |
| --- | --- | --- |
| Ambiente local | PASS | 16 checks OK, 0 alertas, 0 falhas |
| Guards de produção | PASS | perfis production/review sem issues |
| Testes unitários mobile | PASS | 114 suites, 891 testes na Release consolidada final |
| Build Release iOS simulator | PASS | `ios/build/Build/Products/Release-iphonesimulator/Leaf.app`; `BUILD SUCCEEDED`; bundle 1.0.4 (34) |
| Release consolidada P0 | PASS | arm64 autônoma instalada no Pro, Pro Max e 17e; `p0-route-audit/release-consolidated/` |
| Instalação nos três simuladores | PASS | bundle `br.com.leaf.ride` no Pro, Pro Max e 17e |
| Cotação com rota canônica | PASS | 28 testes direcionados + ciclo real pós-correção |
| Modal Pix/falha de pagamento | PASS | 16 testes direcionados; badge QA restrito a Debug |
| Mapa/home | PASS | 30 testes direcionados + 59 testes de fluxo/mapa; busca Release com mapa no Pro e 17e |

## Evidência de bootstrap

Diretório:

`mobile-app/qa-artifacts/ui-ux-simulator-2026-07-11/bootstrap/`

- `iphone-17-pro.png`: dev client recebendo o primeiro bundle.
- `iphone-17-pro-max.png`: dev client recebendo o primeiro bundle.
- `iphone-17-pro-ready.png`: home do passageiro carregada.
- `iphone-17-pro-max-ready.png`: primeira etapa de autenticação carregada.

As capturas `ready` provam inicialização e diferenças de sessão, mas não são evidência de
aceite visual porque o LogBox está visível na build Debug.

Capturas finais de bootstrap Release sem ferramentas de desenvolvimento:

`mobile-app/qa-artifacts/ui-ux-simulator-2026-07-11/release-bootstrap/`

O protocolo final usa `xcrun simctl io <UDID> screenshot --mask=ignored`. A opção
`--mask=ignored` evita que a máscara alfa da tela física produza PNG preto ou parcialmente
transparente.

## Ciclo real passageiro–motorista

Execução aprovada após correção da geometria da cotação:

`mobile-app/qa-artifacts/ui-ux-simulator-2026-07-11/lifecycle/release-real-after-geometry-fix/`

Marcos pareados:

1. `02-passenger-request-*`: busca do passageiro e oferta com líquido do motorista;
2. `03-driver-accept-*`: motorista a caminho e deslocamento ao embarque;
3. `04-driver-arrived-*`: motorista no ponto e confirmação de embarque;
4. `05-driver-start-*`: viagem ativa nas duas funções;
5. `06-driver-complete-*`: recibo bruto do passageiro e saldo líquido atualizado do motorista.

Valores observados no mesmo booking: passageiro `R$ 13,42`; motorista `R$ 11,93`
líquidos; taxa Leaf `R$ 1,49`; pedágio `R$ 0,00`. A execução criou, aceitou, iniciou e
concluiu a corrida no ambiente real de QA, sem mock visual.

## Estados determinísticos principal/compacto

Diretório:

`mobile-app/qa-artifacts/ui-ux-simulator-2026-07-11/states/release/`

Foram capturados em tamanho principal e compacto: busca, extensão Pix, interrupção
operacional, passageiro aceito/chegou/em viagem/recibo, home do motorista,
oferta/aceito/chegou/em viagem/recibo. Esses estados servem para geometria, corte e
hierarquia; quando a tela informa `Sem conexão` ou `Recibo pendente`, isso é parte do
estado seguro e não prova confirmação financeira final.

## Matriz de aceite

Status permitidos: `PENDING`, `PASS`, `FAIL`, `BLOCKED`, `N/A_DEVICE`.

### Passageiro

| Estado | Principal | Compacto | Movimento | Acessibilidade | Evidência | Status |
| --- | --- | --- | --- | --- | --- | --- |
| Autenticação: telefone | iPhone 17 Pro | iPhone 17e | transição aprovada | teclado e layout conferidos | `auth/release/passenger-phone/` | PASS visual |
| Autenticação: OTP/recuperação | iPhone 17 Pro | iPhone 17e | transição aprovada | teclado e layout conferidos | `auth/release/passenger-otp/` | PASS visual |
| Seleção de perfil/onboarding | iPhone 17 Pro | iPhone 17e | transição aprovada | sem sobreposição após correção | `auth/release/passenger-profile/`, `passenger-data/` | PASS visual |
| Home | iPhone 17 Pro | iPhone 17e | mapa/card | rótulos e toque conferidos | `release-bootstrap/` | PASS visual |
| Busca de destino | iPhone 17 Pro | iPhone 17e | teclado/sheet | foco/resultados | `remaining/release/passenger/destination-*` | PASS |
| Categoria/cotação | iPhone 17 Pro | iPhone 17e | card/viewport | preço/CTA | `remaining/release/passenger/quote*.png` | PASS |
| Pix pendente | iPhone 17 Pro | iPhone 17e | loading/expiração | QR, valor, cópia e bloqueio seguro sem socket | `remaining/release/passenger/pix-pending.png`, `pix-pending-compact.png`, `confirm-availability-result.png` | PASS |
| Procurando motorista | iPhone 17 Pro | iPhone 17e | raio/mapa | status/cancelar | ciclo real + `states/release/passenger-searching/iphone-17-pro-map-fixed.png`, `iphone-17e-map-fixed.png` | PASS visual |
| Sem motorista/pagamento falhou | iPhone 17 Pro | iPhone 17e | transição de erro | consequência/CTA | `remaining/release/passenger/failures/` | PASS |
| Motorista aceitou/chegou | iPhone 17 Pro | iPhone 17e | marcador/card | placa/segurança | ciclo real + `states/release/passenger-accepted/`, `passenger-arrived/` | PASS visual |
| Em viagem/interrupção | iPhone 17 Pro | iPhone 17e | câmera/ETA | suporte/segurança | ciclo real + `states/release/passenger-started/`, `passenger-operational/` | PASS visual |
| Conclusão/avaliação/recibo | iPhone 17 Pro | iPhone 17e | encerramento | total/ajuda | ciclo real final no Pro + `remaining/release/passenger/receipt-compact.png` | PASS |
| Suporte/chat/compartilhamento | iPhone 17 Pro | iPhone 17e | navegação | retorno/erros | `remaining/release/passenger/support*`, `chat*`, `share-trip.png` | PASS |
| Perfil/configurações/menu | iPhone 17 Pro | iPhone 17e | navegação | Dynamic Type XXL e contraste aumentado | `p0-route-audit/release-consolidated/passenger/menu.png`, `accessibility/` | PASS visual |

### Motorista

| Estado | Principal | Compacto | Movimento | Acessibilidade | Evidência | Status |
| --- | --- | --- | --- | --- | --- | --- |
| Onboarding/ativação/documentos | iPhone 17 Pro Max | iPhone 17e | transição aprovada | sem cortes nas etapas densas | `auth/release/driver-*` | PASS visual |
| Offline/online aguardando | iPhone 17 Pro Max | iPhone 17e | toggle/card | estado/CTA | `release-bootstrap/` + `states/release/driver-home/` | PASS visual |
| Nova oferta | iPhone 17 Pro Max | iPhone 17e | entrada única | ganho/retirada | ciclo real + `states/release/driver-offer/` | PASS visual |
| A caminho da retirada | iPhone 17 Pro Max | iPhone 17e | mapa/banner | navegação/ETA | ciclo real + `states/release/driver-accepted/` | PASS visual |
| No local/início elegível | iPhone 17 Pro Max | iPhone 17e | troca de rota | condição/CTA | ciclo real + `states/release/driver-arrived/` | PASS visual |
| Em viagem/interrupção | iPhone 17 Pro Max | iPhone 17e | câmera/ETA | suporte/ganho | ciclo real + `states/release/driver-started/` | PASS visual |
| Conclusão/avaliação/recibo | iPhone 17 Pro Max | iPhone 17e | encerramento | líquido/pedágio | ciclo real + `remaining/release/driver/receipt.png` | PASS |
| Saldo/ganhos/saque | iPhone 17 Pro Max | iPhone 17e | expansão | disponível/taxas | `p0-route-audit/release-consolidated/driver/earnings.png`; saldo/saque antigos gated | PASS superfície alcançável |
| Suporte/chat/perfil/configurações | iPhone 17 Pro Max | iPhone 17e | navegação | retorno/erros | superfícies compartilhadas Release + auditoria de conta | PASS |

## Critério de fechamento por estado

Um estado só muda para `PASS` quando:

1. estado e próximo passo são identificáveis em até cinco segundos;
2. existe no máximo um CTA preenchido;
3. não há corte, sobreposição indevida, flicker ou tela legada;
4. loading, erro, retorno e expansão preservam o estado;
5. preço, pagamento, identidade, placa, segurança e valores financeiros aparecem quando
   aplicáveis, sem dados inventados;
6. há captura estabilizada sem ferramentas de desenvolvimento visíveis;
7. o resultado foi conferido no tamanho principal e, para telas densas, no compacto;
8. movimento reduzido e conteúdo acessível foram verificados quando aplicáveis.

## Itens exclusivos de aparelho físico

Permanecem fora do aceite de simulador: push real, precisão real de GPS, câmera de KYC,
alternância Wi-Fi/4G, comportamento térmico, háptica física, background sob pressão do
sistema e performance de distribuição. Esses itens receberão `N/A_DEVICE` nesta matriz e
serão provados na bateria física posterior.

## Ocorrências da preparação

1. A primeira Release de simulador falhou no codegen Swift do AWS Cognito. A recuperação
   de `SmithyCodegenCLI` foi validada e as Releases posteriores terminaram com
   `BUILD SUCCEEDED`.
2. A tentativa de manter árvores completas de Release e Debug esgotou o volume. Foram
   removidos apenas `mobile-app/ios/build` incompleto e o DerivedData global específico do
   Leaf. Nenhum código ou artefato anterior de QA foi removido.
3. A captura Debug revelou LogBox sobre a UI. Isso é esperado para descoberta, mas impede
   seu uso como evidência final; capturas de aceite serão feitas em Release.
4. O primeiro ciclo real parou em `Tarifa indisponível`: a tela exigia geometria canônica,
   mas não repassava as coordenadas já renderizadas. A correção envia `routeCoordinates`,
   refaz a cotação quando a geometria chega e passou 28 testes; o ciclo completo passou na
   repetição.
5. O modal Pix mostrava `QA webhook_error` na Release de simulador. O badge diagnóstico
   agora só renderiza em `__DEV__`; a automação continua disponível.
6. A retomada fria de `passenger-searching` inicialmente mantinha o card, mas deixava o
   mapa vazio no iPhone 17e. Câmera, região, hidratação e modo simplificado foram descartados
   em Debug. A causa era a composição do `MapView` nativo atrás de uma rota transparente no
   iOS/Fabric. `RobotaxiPrototypeDriverSearch` agora compõe mapa e folha de busca na mesma
   rota focada. A Release final mostra mapa, raio e marcador no Pro e no 17e; a transição
   subsequente para `accepted` também foi reconferida no compacto.
7. A primeira compilação Debug falhou no `libtool` do `gRPC-Core` com `errno=28` por falta
   de espaço. Foram removidos somente DerivedData, caches e intermediários regeneráveis;
   após liberar espaço, Debug e Release terminaram com `BUILD SUCCEEDED`.
8. A auditoria P0 de rotas mostrou que `EarningsReportScreen`, embora fora da pasta
   `prototype`, já usa o modelo atual. A Release abriu a mesma superfície no Pro Max e no
   17e. Foi corrigida a ausência do controle visível de retorno; 22 testes direcionados
   passaram e a confirmação visual Debug compacta será promovida a evidência na próxima
   Release consolidada.
9. `LegalScreen` foi identificado como shell legado e migrou para tokens, safe area,
   hierarquia e tabs acessíveis do modelo atual. Seu botão de ajuda apontava para uma rota
   ausente no navegador Robotaxi. O caminho público `leafapp://legal` foi registrado e a
   Release abriu a superfície real, sem harness, em `remaining/release/legal/`.
10. A rodada Release de conta/operação do motorista confirmou Menu, Perfil,
    Configurações, Documentos, Veículos e Waitlist no modelo atual. Foram corrigidas
    acentuação de textos e a contradição visual entre documentos pendentes e liberação
    operacional: o backend continua soberano, mas o status documental e a sincronização
    agora aparecem como fontes distintas. Badges documentais receberam tons semânticos.
    Quatro suites/27 testes e depois duas suites/23 testes passaram; as correções visuais
    foram promovidas à Release consolidada e recapturadas no compacto.
11. A auditoria Release do passageiro confirmou Menu, Perfil, Configurações e Histórico
    no modelo atual. O histórico descartava o destino real porque não reconhecia o campo
    canônico `drop` nem rotas com `->`; a correção passou em três suites/46 testes e foi
    confirmada em Debug compacto mostrando Copacabana Palace → Leblon.
12. A jornada Menu → Privacidade passou em Maestro na Release do iPhone 17 Pro, com
    captura limpa em `p0-route-audit/release/passenger/privacy.png`. O `openLink` enviado
    durante o bootstrap era ignorado; a evidência aprovada abre o menu somente após o
    navegador estar estável e então toca a entrada real de Privacidade.
13. Dynamic Type XXL revelou inicialmente um rodapé sem limite de escala. O limite `1.35`
    foi aplicado sem desativar a preferência do sistema; uma inicialização fria confirmou
    que todos os itens permanecem legíveis e alcançáveis. Evidências: `accessibility/dynamic-type/`.
14. Contraste aumentado foi conferido em `accessibility/increased-contrast/` e restaurado
    ao final. Redução de movimento foi validada em vídeo em
    `accessibility/reduced-motion/passenger-menu-debug-trimmed.mp4`. O app declara somente
    orientação retrato para iPhone e iPad, portanto paisagem é `N/A` por contrato.
15. A Release consolidada foi otimizada para arm64, arquitetura dos três simuladores em
    uso, e terminou com `BUILD SUCCEEDED`. Ela foi instalada no Pro, Pro Max e 17e; Ganhos
    e Histórico foram recapturados limpos após as correções.
16. O primeiro gate completo após a correção de acentuação encontrou uma asserção antiga
    que ainda exigia “Corridas concluidas”. O teste foi alinhado à cópia aprovada; a
    repetição terminou com 114 suites e 888 testes aprovados. Guards de produção,
    governança, scan de segredos, secret guard e `git diff --check` também passaram.
17. Busca, teclado, resultados e cotação foram percorridos em Release no Pro e no 17e. A
    espera Maestro foi corrigida para exigir o `testID` do preço, evitando capturar o
    estado intermediário “Calculando tarifa”. A tarifa estabilizada foi R$ 13,42.
18. Chat indisponível deixava o botão de envio visualmente ativo; waitlist sem resposta do
    backend dizia “Disponível”; e nenhum motorista exibia `no_drivers_available`. Os três
    estados foram corrigidos, testados e recapturados em Release.
19. `Legal` e `PrivacyPolicy` receberam caminhos públicos oficiais (`legal` e `privacy`).
    `leafapp://legal` abriu a tela real em Release, sem harness. O conteúdo jurídico não
    foi alterado; a data textual de atualização permanece sujeita à revisão jurídica.
20. O diagnóstico do Pix foi fechado sem contorno. A sequência canônica do lifecycle
    semeia autenticação antes e depois do primeiro launch e só então grava o estado runtime;
    a tentativa anterior não havia reproduzido essa ordem completa. Com passageiro e
    motorista conectados/autenticados e motorista online por confirmação do socket, a
    jornada normal destino -> cotação -> disponibilidade abriu a cobrança Pix em Release.
    As evidências principal e compacta mostram valor, expiração, QR, código e ações; o
    estado de expiração também foi observado no compacto. Não houve deep link de pagamento.
