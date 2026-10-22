# Playbook de Marketing Leaf: Motoristas e Passageiros (Rio de Janeiro)

Versão 1.0 · 22/10/2026 · Abertura pública planejada: domingo, 01/11/2026
Dono sugerido: marketing Leaf · Revisão obrigatória: produto e jurídico (ver seção 0)

Este documento define posicionamento, mensagens, calendário, peças e orçamento para o lançamento no Rio de Janeiro. Ele é um plano de trabalho. Nenhuma peça deve ir ao ar antes de passar pela checklist da seção 12.

---

## 0. Pendências que bloqueiam a publicação

Estes itens aparecem hoje na landing page (`landing-page/index.html`) ou no briefing, e não podem ser usados em anúncio, post ou vídeo até serem resolvidos. Foram identificados durante a leitura do material existente.

| # | Pendência | Onde aparece | Ação |
|---|---|---|---|
| 1 | Modelo de taxa do motorista está divergente entre fontes. Briefing: R$ 0,99 nas primeiras 25 corridas e R$ 1,49 depois. Landing: diária operacional de R$ 0,00 no lançamento e faixas de R$ 4,90 a R$ 14,90 para o futuro. Memória de produto: taxa fixa de R$ 1. | Briefing; `index.html`, seção "Para motoristas" | Produto e financeiro definem um único modelo por escrito. Até lá, as peças usam o marcador `[TAXA]`. Mudança de take-rate ou taxa exige aprovação explícita (AGENTS.md, regras de negócio). |
| 2 | Depoimentos com nome, cidade e nota (João Oliveira, Ana Carvalho, Rodrigo Freitas, Marcos Costa com nota 4.97). Não há comprovação de origem. | `index.html`, seções de depoimento e mockup | Remover. Só usar depoimento real, com autorização escrita de uso de imagem e nome. |
| 3 | Mockup e depoimentos usam São Paulo ("Vila Madalena → Congonhas", "São Paulo, SP"). O piloto é no Rio. | `index.html` | Trocar por rotas e referências do Rio, sem endereço real de passageiro. |
| 4 | Landing cita beta em Duque de Caxias com lançamento em 01/12/2025 e menciona apps tradicionais. Está desatualizada em relação ao piloto (abertura para passageiros e motoristas aprovados já em outubro) e à data pública de 01/11/2026. | `cidades.html`, `index.html` | Atualizar com a cobertura real liberada pelo produto. |
| 5 | Comparações numéricas: "até 45% de cada corrida", "sem cobrar 20 a 40%", "apps tradicionais ~R$ 23 ≈ 55%", "96% repassado". | `index.html` | Só usar com metodologia documentada, data, rota, horário e fonte. Ver seção 4.3. |
| 6 | Recursos de confiança sem prova de entrega: "motoristas com avaliação mínima 4.8", "antecedentes verificados", "suporte humano 24h", "botão de emergência que alerta as autoridades", "rastreamento compartilhável com um clique". | `index.html`, `categorias-passageiro.html` | Produto confirma por escrito o que está ativo no dia 01/11. Só anunciar o que estiver em produção. |
| 7 | Superlativos: "o primeiro e único app", "a melhor", "sem pegadinha" sem lista de regras. | `index.html` | Remover superlativos sem prova. "Sem pegadinha" só vale com a lista de cobranças visível antes do Pix. |
| 8 | Enquadramento regulatório do transporte por aplicativo no Rio (Lei 13.640/2018 e regulamentação municipal). | Não definido | Jurídico confirma a frase que pode ser usada sobre regularidade antes de qualquer peça para motoristas. |
| 9 | Cupom ou bônus de lançamento, programa de indicação e Black Friday (27/11) mexem em saldo ou taxa. | Não definido | Dependem de aprovação explícita. Sem regulamento publicado, não existem. |

Regra geral: se uma peça depender de um item acima, ela não é publicada e a peça de reserva (seção 6) entra no lugar.

---

## 1. Posicionamento e mensagens-chave

### 1.1 Posicionamento

Para quem pede e para quem dirige corridas no Rio, a Leaf é o app em que o preço aparece antes do pedido, o motorista fica com a maior parte do valor e o pagamento é feito por Pix antes da corrida começar.

Frase de referência interna (não é slogan): "Preço claro para quem viaja. Taxa justa para quem dirige."

### 1.2 Mensagem-mãe

- Tagline já usada: "O app que respeita quem dirige. E quem paga." Pode ser mantida.
- Alternativas para teste A/B (apenas após as pendências 1 a 7):
  - "Uma viagem por vez."
  - "Pix antes. Corrida depois."
  - "Quem dirige fica com a maior parte. Você vê tudo antes de confirmar."

### 1.3 Pilares de mensagem

| Pilar | Mensagem curta | Prova necessária |
|---|---|---|
| Preço sem pegadinha | Você vê o valor final, incluindo adicional noturno, pedágio e qualquer ajuste de demanda, antes de confirmar. | Tela de preço com detalhamento. Texto das regras publicado. |
| Motorista fica com mais | Uma parte maior de cada corrida vai para quem dirige. | Modelo de taxa aprovado (pendência 1) e exemplo com cálculo. |
| Pix antecipado | O pagamento é confirmado antes do carro sair. Motorista não corre risco de receber nada. | Fluxo real: corrida só inicia após Pix confirmado (regra de negócio). |
| Pedágio explícito | Pedágio aparece como linha própria no recibo, sem misturar com a tarifa. | Recibo real com a linha de pedágio. |
| Motorista verificado | Antes de dirigir, o motorista passa por checagem de documentos, veículo e verificação facial. | Lista exata das etapas, conforme o que está ativo. Não usar "antecedentes" sem confirmação do produto. |
| Segurança visível | Compartilhe a rota em tempo real com quem quiser, com um toque. | Funcionalidade ativa no app e testada. |

### 1.4 Mensagens por público

Motorista:
- "Você trabalha na rua. Veja no app quanto fica com cada corrida, antes de aceitar."
- "Pix confirmado antes de você sair. Sem esperar fechamento de semana."
- "Taxa baixa e explícita. Nada de desconto escondido no repasse."

Passageiro:
- "Você vê o preço antes de confirmar. Pix antes do carro andar."
- "Mesma corrida, sem surpresa no fim."
- "Pedágio no recibo, separado. Adicional noturno explicado antes do pedido."
- "Compartilhe sua viagem com quem você quiser, em um toque."

### 1.5 Provas que a marca deve construir

Ordem de prioridade: (1) recibo real com linha de pedágio e taxa, (2) calculadora pública com a regra, (3) depoimentos reais com autorização, (4) números agregados do piloto (corridas, tempo médio de resposta do suporte) publicados mensalmente, (5) página "Como calculamos" com exemplo.

---

## 2. Personas

Personas são hipóteses até que existam dez entrevistas com motoristas e dez com passageiros do piloto. Revise este bloco após as entrevistas.

### 2.1 Motoristas

**M1. Rodrigo, 41, Baixada Fluminense, há 5 anos em apps.** Dirige pelo menos seis dias por semana, principalmente em horário de pico. Sente que a plataforma fica com uma fatia grande de cada corrida. Desconfia de promessa. Decide por conta: quanto eu fico com essa corrida?
- Gatilho: cálculo claro na tela e recebimento confirmado.
- Objeção: "Vai durar? Qual o custo escondido?"
- Canal: grupos de motoristas, pontos de encontro, indicação de colegas.

**M2. Thiago, 26, Zona Oeste, dirige dois ou três dias por semana.** Usa o carro para complementar a renda. Sensível a custo fixo e a mensalidade.
- Gatilho: sem mensalidade, cadastro simples, orientação de como começar.
- Objeção: "Preciso de carro bom? Vou ter problema com a verificação?"
- Canal: Instagram, TikTok, indicação de amigos.

**M3. Denise, 34, Niterói, motorista com carro próprio e rotina organizada.** Quer previsibilidade de pagamento e suporte que responda.
- Gatilho: Pix antecipado e suporte humano.
- Objeção: "Quanto tempo leva para ser aprovada?"
- Canal: associações, grupos profissionais, e-mail (com consentimento).

### 2.2 Passageiros

**P1. Juliana, 29, trabalha no Centro e mora na Zona Sul ou Zona Norte.** Usa app três vezes por semana. Quer preço previsível e chegada sem surpresa.
- Gatilho: preço visível antes de confirmar, tempo estimado.
- Canal: Instagram Reels, busca na loja de apps, indicação.

**P2. Marcos, 45, responsável por familiares que saem à noite.** Quer saber por onde o carro passa e poder avisar alguém.
- Gatilho: compartilhamento de rota, verificação do motorista, suporte.
- Canal: Facebook e Instagram (público adulto), conteúdo de segurança.

**P3. Paulo, 52, não usa cartão de crédito para compras de transporte.** Paga tudo em Pix e desconfia de cobrança "depois".
- Gatilho: Pix na hora, sem cartão, comprovante automático.
- Canal: grupos de bairro, associações de moradores, panfleto e QR.

**P4. Lucas, 19, estudante universitário.** Pede corrida para voltar da faculdade tarde. Sensível a preço e a segurança.
- Gatilho: preço no adicional noturno explicado, compartilhamento de rota.
- Canal: TikTok, Reels, universidades e cursinhos.

---

## 3. Tom de voz

### 3.1 Princípios

- Direto. Frase curta. Uma ideia por linha.
- Honesto. Diz o que a Leaf faz e o que ainda não faz.
- Próximo. "Você" para passageiro e para motorista. Português do Brasil, sem gíria forçada e sem humor que ridicularize alguém.
- Calmo. Nada de caixa-alta de urgência, contagem falsa ou "últimas vagas".
- Respeitoso com o motorista. Motorista é profissional, não "parceiro" de slogan vazio nem "colaborador".

### 3.2 Como falar e como não falar

| Evite | Use |
|---|---|
| "Ganhe muito dinheiro dirigindo" | "Veja quanto fica com cada corrida antes de aceitar." |
| "Sem calote!" | "Pagamento confirmado antes da corrida começar." |
| "Motorista nunca perde" | "Pix confirmado antes de sair. Recebimento registrado no histórico." |
| "A melhor e mais barata" | "Preço mostrado antes do pedido. Sem taxa escondida." |
| "100% seguro" | "Verificação de identidade, documentos e rosto antes de dirigir, e compartilhamento de rota com um toque." |
| "Pague menos que na Uber" | "Veja a tarifa, o adicional e o pedágio antes de confirmar." |
| "Chega em 3 minutos" | "Tempo estimado mostrado no app, atualizado em tempo real." |

---

## 4. O que não dizer e regras legais

Esta seção é obrigatória para quem escreve, revisa ou aprova peça. Ela não substitui parecer jurídico. Cada item marcado como "validar com jurídico" precisa de aprovação escrita.

### 4.1 Promessas de ganho (não fazer)

- Não usar valores de renda por dia, semana ou mês ("ganhe até R$ X", "renda garantida", "R$ X por hora").
- Não usar depoimento que cite faturamento sem contexto (horas trabalhadas, dias, região, período). Mesmo com contexto, só usar se for real e autorizado.
- Para mostrar potencial, use uma calculadora pública com entradas do próprio usuário (corridas por dia, valor médio) e o aviso: "Estimativa. Ganho depende de demanda, horário, região e tempo dedicado."
- Não prometer aprovação no cadastro. Dizer "faça o cadastro. A aprovação depende da verificação."

Base: Código de Defesa do Consumidor (CDC), art. 37, §1º (publicidade enganosa inclui informação capaz de induzir a erro sobre características do serviço e preço).

### 4.2 Preço, taxa, adicional e pedágio

- Toda cobrança que o passageiro paga ou que o motorista recebe menos precisa aparecer antes de o Pix ser confirmado, com nome e valor. Base: CDC, art. 6º, III e art. 31.
- Adicional noturno, tarifa dinâmica e pedágio devem ser explicados com a regra exata. Não dizer "sem taxas" se houver qualquer uma delas.
- Pedágio é repasse e aparece como linha própria no recibo.
- Ajuste de preço por demanda: mostrar o motivo e o valor antes do pedido.
- Não usar "grátis", "sem custo" ou "R$ 0" sem prazo, condição e regulamento publicado. A frase "diária R$ 0 no lançamento" só pode ser usada com data de término comunicada.
- Não publicar o exemplo de taxa `[TAXA]` antes da aprovação (pendência 1).

### 4.3 Comparação com concorrentes

- Não citar marca concorrente nominalmente em peça (Uber, 99, inDrive ou outra). Não usar logotipo, cor de marca ou elemento visual de terceiros.
- Comparação com "apps tradicionais" só pode ser feita se for verdadeira, comprovável e não depreciativa. Base: Código Brasileiro de Autorregulamentação Publicitária (CONAR), capítulo sobre publicidade comparativa, e concorrência desleal (Lei 9.279/1996, art. 195, que trata de denegrir concorrente).
- Para qualquer número comparativo, documentar: rota, data, horário, valor cobrado, valor repassado, método de cálculo e fonte. Guardar o documento com a peça.
- Números como "45%", "20 a 40%", "55%" e "96%" ficam fora de peças até essa documentação existir. Se usados, precisam de rótulo "exemplo ilustrativo" e cálculo visível.
- Não atacar a categoria ("todo app rouba o motorista"). Falar da Leaf e da regra da Leaf.

### 4.4 Segurança e verificação

- Não dizer "100% seguro", "zero risco", "motorista sem antecedentes" ou "nunca acontece nada". Verificação reduz risco; não elimina.
- Descrever só as etapas que existem no produto, com o nome exato.
- Sinais de segurança (compartilhamento de rota, botão de emergência, suporte) só entram quando o produto confirmar que estão ativos e testados.
- Não usar incidente real, ocorrência policial ou caso de vítima em peça de marketing.

### 4.5 Motorista como trabalhador

- Não chamar o motorista de funcionário, colaborador ou empregado.
- Não afirmar em publicidade que a relação é "sem vínculo" ou que "não há subordinação". É tema jurídico. Validar com jurídico qualquer frase sobre vínculo, direitos ou benefícios.
- Não prometer seguro, férias, 13º ou benefício que a Leaf não oferece por escrito.

### 4.6 LGPD (Lei 13.709/2018)

- Base legal por finalidade: execução de contrato (art. 7º, V) para operação; consentimento (art. 7º, I e art. 8º) para mensagens de marketing por WhatsApp, SMS ou e-mail; legítimo interesse (art. 7º, IX) só com avaliação documentada e opt-out fácil. Recomendação: consentimento para todo marketing direto.
- Dado biométrico e imagem de verificação facial são dados sensíveis (art. 5º, II e art. 11). Nunca usar selfie, documento, foto de CNH ou captura de tela de verificação em peça, em teste de anúncio ou em apresentação externa.
- Não importar lista de contatos do celular, não raspar grupos de WhatsApp e não enviar disparo em massa a contatos sem consentimento.
- Todo link de cadastro ou indicação precisa de opt-in e opt-out. Cada mensagem tem como sair.
- Pixels e cookies: banner com opção de recusar não essencial. Configuração padrão: recusado.
- Não segmentar anúncio para menores de 18 anos como público de cadastro de motorista. Para passageiro, não segmentar menores.
- Não expor endereço real de passageiro, placa, nome completo de motorista sem autorização ou rota identificável em vídeo ou print.
- Pedidos de titular (acesso, correção, exclusão) passam pelo canal oficial de privacidade. Peça de marketing não é canal de atendimento.

### 4.7 Imagem de pessoas e locais

- Toda pessoa que aparece em foto ou vídeo (motorista, passageiro, equipe) assina termo de autorização de uso de imagem para aquele uso, com prazo e canais. Base: Constituição, art. 5º, X e Código Civil, art. 20.
- Placa de veículo borrada em qualquer material.
- Evitar estereótipo de bairro, comunidade ou pessoa. Filmar com respeito ao local e às pessoas.
- Não usar imagem de rua ou de terceiros sem ser pessoa de cena contratada ou autorizada.

### 4.8 Ofertas, cupons e sorteios

- Cupom precisa de regulamento: valor, validade, quantidade, elegibilidade, forma de uso e o que é excluído.
- Sorteio ou promoção com prêmio: validar com jurídico a Lei 5.768/1971 e as normas do Ministério da Fazenda aplicáveis antes de qualquer ação. Não lançar sorteio sem parecer.
- Desconto que altera taxa, saldo ou repasse depende de aprovação explícita (AGENTS.md).

### 4.9 Creators e influenciadores

- Todo post pago ou com benefício é identificado de forma clara no início da legenda e na tela, com "Publicidade" ou "Parceria paga". Base: CDC, art. 36 (identificação da publicidade) e CONAR.
- Creator recebe briefing com a lista de "pode dizer" e "não pode dizer" desta seção.
- Creator que testa o app deve dizer o que aconteceu na corrida dele. Nada de roteiro com número de ganho.
- Contrato com cláusula de retirada de post se a informação mudar ou se houver erro de preço.

### 4.10 Telemarketing e contato humano

- Ligação ativa de marketing segue o Decreto 11.034/2022 (código de conduta de teleatendimento): horário permitido, identificação e opção de não receber.
- Nunca ligar para número que pediu para não receber.

### 4.11 Lista de termos proibidos sem revisão

Sem revisão do jurídico, não usar: "garantido", "renda fixa", "sem risco", "100%", "o melhor", "o único", "o primeiro", "zero taxa" (sem regra), "sem calote", "nunca", "sempre" (quando não for verdade demonstrável), "ganhe R$", "fique rico", "motorista verificado 100%".

---

## 5. Calendário

Datas de referência: hoje é quinta, 22/10/2026. Abertura pública é domingo, 01/11/2026. O piloto já atende passageiros e motoristas aprovados desde outubro; a comunicação de 01/11 é de abertura pública, não de primeira vez.

### 5.1 Pré-lançamento (22/10 a 31/10)

| Data | Ação | Dono |
|---|---|---|
| 22 a 23/10 | Fechar as pendências da seção 0 (taxa, depoimentos, comparações, recursos confirmados). | Produto, financeiro, jurídico |
| 23 a 24/10 | Definir a cobertura de bairros liberada e as áreas que não serão comunicadas. | Produto |
| 24 a 27/10 | Produzir peças base: logo, carrosséis, três vídeos verticais, calculadora pública, página de "Como calculamos". | Marketing |
| 24 a 27/10 | Assinar termos de imagem de quem aparecer nas peças. | Marketing, jurídico |
| 26 a 28/10 | Gerar QR codes com UTM por canal (panfleto, adesivo, parceria). Testar em dois celulares. | Marketing |
| 26 a 29/10 | Abrir lista de espera para motoristas com consentimento. Responder todas as dúvidas em até 24 h. | Operação, marketing |
| 27 a 30/10 | Convidar motoristas em grupos e pontos de encontro (com permissão do administrador). Início de panfletagem. | Marketing, operação |
| 29/10 | Teaser: "Chega dia 1º. Preço antes do pedido. Pix antes do carro andar." | Marketing |
| 30/10 | Stories com contagem regressiva e pergunta "O que você quer ver no 1º de novembro?" | Marketing |
| 31/10 | Vídeo principal publicado no agendamento. Revisão final de todas as peças. | Marketing |

### 5.2 Lançamento (01/11 a 07/11)

| Data | Ação |
|---|---|
| Dom 01/11 | Post de abertura no feed, reel principal, carrossel "Como funciona", stories ao vivo com a equipe. Anúncio de aviso no app (com consentimento de notificação). |
| Seg 02/11 | Reel de motorista ("Quanto fica com cada corrida") com calculadora. Post de dúvidas frequentes. |
| Ter 03/11 | Pedágio e adicional noturno explicados. |
| Qua 04/11 | Ativação em pontos de encontro de motoristas do Rio (presença de equipe). |
| Qui 05/11 | Segurança: verificação e compartilhamento de rota. |
| Sex 06/11 | "Pergunte ao time" ao vivo. |
| Sáb 07/11 | Primeira seleção de depoimentos reais (com autorização). Relatório de semana 1. |

Rotina diária na semana 1: um post no feed (ou carrossel), três stories, um comentário respondido em até 2 horas no horário comercial e acompanhamento diário de métricas.

### 5.3 Semanas 2 a 4

| Período | Foco | Peças principais |
|---|---|---|
| 08/11 a 14/11 | Motorista: começar a dirigir na Leaf | Vídeo "Dia 1 de motorista", passo a passo do cadastro, perguntas frequentes sobre verificação, post de Pix confirmado. |
| 15/11 a 21/11 | Passageiro: bairros e rotina | Rotas do Rio (sem endereço), parcerias locais, "Pix antes" em formato curto, reels de rotina noturna. Em 20/11 (feriado nacional da Consciência Negra), conteúdo institucional cuidadoso ou nenhuma peça comercial. |
| 22/11 a 30/11 | Prova e revisão | Primeiros números agregados do piloto (sem dados pessoais), balanço de 30 dias, "o que mudou por causa de vocês". Sexta 27/11 (Black Friday): sem campanha de desconto que altere taxa; se houver promoção, só com regulamento aprovado. |

Revisão de 30 dias: segunda 30/11. Reunião de 60 minutos com produto, operação e marketing para decidir o que escalar, o que parar e o que mudar na mensagem.

---

## 6. Pilares de conteúdo

| Pilar | Proporção | O que é | Exemplo |
|---|---|---|---|
| Conta aberta | 25% | Como o preço é formado, o que aparece e onde vai o dinheiro. | "Quanto fica com a corrida de R$ 42?" |
| Quem dirige | 20% | Motoristas reais, com autorização, falando de rotina e de cadastro. | "Meu primeiro mês na Leaf." |
| Segurança sem drama | 20% | Verificação, rota compartilhada, suporte. Tom calmo, sem alarme. | "Como a verificação funciona." |
| Pix antes | 15% | Como o pagamento antecipado funciona e por que ele protege os dois lados. | "Por que o pagamento acontece antes do carro sair." |
| Rio de verdade | 10% | Rotas, cultura e rotina da cidade. Sem estereótipo. | "Três rotas que quem mora aqui conhece." |
| Bastidor e comunidade | 10% | Respostas do time, mudanças do app, feedback dos usuários. | "Você pediu, a gente mudou." |

Regra: pelo menos um post por semana deve responder uma dúvida real recebida no suporte.

---

## 7. 20 ideias de posts para Instagram (feed, carrossel e stories)

Formatos: feed em 1080x1350 (4:5) ou carrossel em 1080x1350; stories em 1080x1920. Hashtags sugeridas no fim da seção. Todo post precisa das provas indicadas antes de publicar.

**1. Carrossel: "Quanto fica com uma corrida de R$ 42?"** (Conta aberta)
- Slides: valor da corrida, taxa `[TAXA]`, valor repassado, tabela com linhas, aviso "Exemplo ilustrativo; valores podem variar".
- Legenda: "Corrida de R$ 42,00. Taxa da Leaf: [TAXA]. Motorista recebe R$ [VALOR]. Este é um exemplo com cálculo visível. Na tela do app você vê o valor antes de confirmar. Ver regra completa no link da bio."
- Prova: regra de taxa aprovada.

**2. Post único: "Pix antes do carro andar. Por quê?"** (Pix antes)
- Arte: "Pagamento confirmado" + ícone de carro parado.
- Legenda: "Antes de o motorista sair, o Pix é confirmado. Isso protege quem dirige e dá tranquilidade para quem pede. Sem cartão, sem dinheiro na mão, sem 'deixa pagar depois'."
- Prova: fluxo real de pagamento.

**3. Carrossel: "O que aparece antes de você confirmar a corrida"** (Preço sem pegadinha)
- Slides: tarifa, adicional noturno (quando houver), pedágio (quando houver), ajuste de demanda com motivo, total.
- Legenda: "Nada aparece no fim. Tudo aparece antes. Veja a lista completa de cobranças na próxima página."
- Prova: tela real do app.

**4. Reel de 25 s: "Adicional noturno sem susto"** (Preço sem pegadinha)
- Legenda: "Adicional noturno existe quando a regra existe. Na Leaf, ele aparece com o valor e o horário antes do pedido. Sem surpresa às 23h."
- Prova: regra publicada.

**5. Post: "Pedágio no recibo, em linha separada"** (Conta aberta)
- Arte: recibo com linha de pedágio destacada.
- Legenda: "Pedágio é repasse, não lucro. Por isso aparece separado no recibo, com o valor exato."
- Prova: recibo real.

**6. Carrossel: "Como verificamos quem dirige"** (Segurança sem drama)
- Slides: documentos, veículo, verificação facial, aprovação, o que acontece depois.
- Legenda: "Antes de dirigir na Leaf, o motorista passa por estas etapas. Não é garantia absoluta, é uma barreira real. Veja cada passo nos slides."
- Prova: lista de etapas confirmada pelo produto e pelo jurídico.

**7. Stories com enquete: "Você já foi cobrado a mais no cartão?"** (Pix antes)
- Opções: sim / não / prefiro Pix.
- Uso: coletar dor real; não usar resultado como dado de terceiros.

**8. Post: "Compartilhe sua viagem em um toque"** (Segurança sem drama)
- Arte: tela de compartilhamento de rota.
- Legenda: "Quer que alguém acompanhe sua viagem? Compartilhe a rota em tempo real com quem você escolher. Um toque."
- Prova: funcionalidade ativa e testada.

**9. Carrossel: "5 coisas que você pode checar no app"** (Segurança sem drama)
- Itens: nome e foto do motorista, placa do veículo, rota, valor antes do Pix, botão de compartilhamento.
- Legenda: "Antes de entrar no carro, confira estes cinco pontos. Se algo não bater, avise o suporte."
- Prova: cada item existe no produto.

**10. Post: "Três rotas que quem mora no Rio conhece"** (Rio de verdade)
- Arte: mapa estilizado sem endereço, só nomes de bairros cobertos pelo piloto.
- Legenda: "Trânsito, atalho e horário de pico. Quem vive a cidade sabe. Estas são as rotas mais pedidas no piloto." (Usar só dados reais.)
- Prova: dados de rota agregados, sem endereço de passageiro.

**11. Post para motorista: "Quanto você fica com cada corrida?"** (Conta aberta)
- Arte: CTA para a calculadora.
- Legenda: "Antes de aceitar, saiba quanto sobra. Use a calculadora da Leaf com seus números. Estimativa, não promessa: o resultado depende de demanda, horário e tempo dedicado."
- Prova: calculadora pública publicada.

**12. Reel de motorista (com autorização): "Meu primeiro mês na Leaf"** (Quem dirige)
- Legenda: "[Nome], motorista da Leaf há [X] semanas. Conta o que mudou e o que ainda não é perfeito. Relato pessoal, não representa média."
- Prova: termo de imagem assinado; relato real; nenhum número de ganho sem contexto.

**13. Reel de contagem regressiva: "1º de novembro"** (Lançamento)
- Legenda: "Domingo, 1º de novembro. Preço antes do pedido. Pix antes do carro andar. Quem dirige fica com a maior parte. Baixe o app e fique por dentro."

**14. Stories de caixa de perguntas: "Pergunte ao time"** (Bastidor)
- Texto: "Manda sua dúvida sobre preço, pagamento ou segurança. A gente responde ao vivo na sexta."
- Uso: alimenta o conteúdo de pilar "Bastidor" e a FAQ.

**15. Post: "Como o suporte responde"** (Bastidor e comunidade)
- Arte: fluxo do suporte e tempo médio de resposta real.
- Legenda: "Suporte com pessoa de verdade, não robô de formulário. Tempo médio de resposta no piloto: [X] minutos. Atualizamos este número todo mês."
- Prova: horário de suporte e métrica real confirmados. Não usar "24h" se não for verdade.

**16. Post: "Por que a Leaf não cobra mensalidade"** (Quem dirige)
- Legenda: "Mensalidade obriga a trabalhar para pagar a plataforma antes de ganhar. Na Leaf, [descrever apenas o que for aprovado]. Sem compra de créditos."
- Prova: modelo de cobrança aprovado. Se o modelo tiver diária ou taxa por faixa, descrever com a regra e a data de ativação.

**17. Carrossel: "Três formas de pagar, uma regra"** (Pix antes)
- Slides: Pix é a única forma atual (confirmar antes), comprovante automático, histórico no app.
- Legenda: "Hoje a Leaf aceita Pix. Pagamento confirmado antes da corrida começar. Comprovante automático no histórico."
- Prova: formas de pagamento reais. Não prometer formas futuras.

**18. Post: "Erros comuns ao pedir corrida (e como evitar)"** (Conta aberta)
- Itens: destino errado, ponto de embarque, não conferir o valor, esquecer o pedágio.
- Legenda: "Cinco minutos de atenção evitam dor de cabeça. Confira o ponto de embarque e o valor antes de confirmar."

**19. Carrossel: "Glossário sem jargão"** (Conta aberta)
- Termos: tarifa, adicional noturno, ajuste de demanda, pedágio, repasse, recibo.
- Legenda: "Palavras que aparecem no app e o que cada uma significa. Sem letra miúda."
- Prova: definições idênticas às do app e dos termos.

**20. Post de balanço: "30 dias de Leaf no Rio"** (Bastidor e comunidade)
- Legenda: "Em 30 dias, [número] corridas no Rio, [número] motoristas ativos e [número] mudanças feitas a partir do que vocês disseram. Obrigado. Próximo passo: [X]."
- Prova: números reais e agregados, sem dados pessoais. Publicar só após revisão.

Hashtags sugeridas (usar no máximo 8 por post): #Leaf #LeafApp #Rio #RioDeJaneiro #Mobilidade #Motorista #Pix #Transporte #SegurançaNoTrânsito. Não usar hashtag de concorrente.

---

## 8. Roteiros de vídeo curto (15 a 45 s, vertical 9:16)

Cada roteiro tem cena a cena com tempo, visual, áudio e texto na tela. Legenda queimada no vídeo é obrigatória. Música só com licença comercial da biblioteca da plataforma.

### V1. "Pix antes do carro andar" (30 s · passageiro)

| Tempo | Visual | Áudio (voz) | Texto na tela |
|---|---|---|---|
| 0–3 s | Passageiro em frente a um prédio, celular na mão | "Você já pagou e o carro nem chegou?" | "Pix antes. Corrida depois." |
| 3–10 s | Tela do app com o valor final | "Na Leaf, o valor aparece antes de você confirmar." | "Valor final antes do pedido" |
| 10–18 s | Tela de pagamento Pix, confirmação | "Você paga por Pix. A confirmação vem antes do motorista sair." | "Pix confirmado = corrida liberada" |
| 18–25 s | Motorista chegando, passageiro entrando | "Sem cartão, sem dinheiro na mão." | "Sem cartão. Sem dinheiro." |
| 25–30 s | Logo Leaf, fundo verde escuro #003002 | "Leaf. Preço claro e Pix antes." | "Baixe grátis. Link na bio." |

### V2. "Quanto fica com a corrida?" (45 s · motorista)

| Tempo | Visual | Áudio | Texto |
|---|---|---|---|
| 0–4 s | Motorista com volante, cidade ao fundo (com autorização) | "Você sabe quanto fica com cada corrida?" | "Quanto fica com cada corrida?" |
| 4–12 s | Tela da corrida: valor, taxa, valor repassado | "Na Leaf, você vê o valor e a taxa antes de aceitar." | "Taxa: [TAXA]" |
| 12–24 s | Exemplo ilustrativo em animação | "Corrida de R$ 42. Você recebe R$ [VALOR]. Exemplo com cálculo visível." | "Exemplo ilustrativo" |
| 24–34 s | Tela de Pix confirmado e histórico | "O pagamento é confirmado antes de você sair. E o recebimento aparece no histórico." | "Pix confirmado antes de sair" |
| 34–41 s | Motorista sorrindo, carro limpo | "Use a calculadora com a sua rotina." | "Calculadora no app" |
| 41–45 s | Logo e CTA | "Baixe e veja seus números." | "Cadastro com verificação. Aprovação depende da checagem." |

### V3. "Adicional noturno sem susto" (20 s · passageiro)

| Tempo | Visual | Áudio | Texto |
|---|---|---|---|
| 0–3 s | Rua à noite, passageiro esperando | "Pediu corrida às 23h e o valor mudou?" | "23h. Valor mudou?" |
| 3–10 s | Tela do app mostrando adicional noturno com horário | "Na Leaf, o adicional aparece com o horário e o valor antes de confirmar." | "Adicional explicado antes" |
| 10–17 s | Recibo com linha do adicional | "No recibo, cada linha tem nome e valor." | "Recibo com cada linha" |
| 17–20 s | Logo | "Sem surpresa." | "Sem surpresa." |

### V4. "Pedágio no recibo" (20 s · passageiro e motorista)

| Tempo | Visual | Áudio | Texto |
|---|---|---|---|
| 0–4 s | Recibo em close | "Pedágio é pago por você e vai para a praça, não para a Leaf." | "Pedágio não é lucro" |
| 4–12 s | Recibo com linha de pedágio destacada | "Ele aparece em linha separada, com o valor exato." | "Linha separada" |
| 12–20 s | Logo | "Transparência no recibo, sempre." | "Recibo explícito" |

Atenção: confirmar com o produto a forma exata de cobrança do pedágio antes de gravar a frase "vai para a praça".

### V5. "Como verificamos quem dirige" (30 s · passageiro)

| Tempo | Visual | Áudio | Texto |
|---|---|---|---|
| 0–4 s | Passageiro desconfiado olhando o carro | "Quem está dirigindo é quem o app diz?" | "Quem está dirigindo?" |
| 4–14 s | Checklist animado: documento, veículo, verificação facial | "Antes de dirigir na Leaf, o motorista passa por checagem de documentos, do veículo e verificação facial." | "Documentos + veículo + rosto" |
| 14–22 s | Tela de perfil do motorista com nome e placa (placa borrada se necessário) | "Você vê o nome e o veículo antes de entrar." | "Nome e veículo no app" |
| 22–30 s | Logo | "Verificação não é promessa. É etapa obrigatória." | "Etapa obrigatória, não promessa." |

Atenção: a frase "não é promessa" exige que a verificação esteja ativa e documentada. Revisar com produto.

### V6. "Compartilhe sua viagem" (15 s · passageiro)

| Tempo | Visual | Áudio | Texto |
|---|---|---|---|
| 0–3 s | Pessoa voltando à noite | "Vai avisar alguém que você está indo?" | "Avisa quem você ama" |
| 3–10 s | Toque em "Compartilhar viagem" | "Um toque e alguém acompanha sua rota em tempo real." | "Um toque" |
| 10–15 s | Logo | "Leaf. Segurança visível." | "Compartilhe com quem quiser" |

### V7. "Rio em três rotas" (30 s · passageiro)

| Tempo | Visual | Áudio | Texto |
|---|---|---|---|
| 0–4 s | Vista da Zona Sul com trânsito | "Três rotas que todo carioca conhece." | "Três rotas do Rio" |
| 4–24 s | Três cenas curtas: trajeto com ponto de partida e chegada genéricos, sem endereço | "Rota um: trânsito de volta do trabalho. Rota dois: a chegada cedo. Rota três: a volta da noite." | Nome de cada rota na tela |
| 24–30 s | Logo | "Mostre o caminho. A Leaf mostra o preço." | "Preço antes do pedido" |

Atenção: usar só rotas agregadas e aprovadas. Não mostrar casa, escola ou trabalho identificáveis.

### V8. "Dia 1 de motorista" (45 s · motorista)

| Tempo | Visual | Áudio | Texto |
|---|---|---|---|
| 0–5 s | Motorista de camisa, celular na mão, pergunta | "Quer dirigir pelo app, mas não sabe por onde começar?" | "Dia 1 na Leaf" |
| 5–15 s | Cadastro: documentos, veículo | "Cadastro simples: documentos, veículo, verificação." | "Cadastro em 4 passos" |
| 15–28 s | Tela de aprovação com status | "A aprovação depende da checagem. Você acompanha no app." | "Aprovação depende da checagem" |
| 28–38 s | Primeira corrida, Pix confirmado | "Pix confirmado antes de sair. Recebimento no histórico." | "Pix antes de sair" |
| 38–45 s | Logo e CTA | "Faça seu cadastro e veja o passo a passo." | "Link na bio" |

### V9. "Contagem regressiva 1º de novembro" (15 s · geral)

| Tempo | Visual | Áudio | Texto |
|---|---|---|---|
| 0–4 s | Número 3 grande sobre verde escuro | "Três dias." | "3" |
| 4–10 s | Animação de carro e tela de preço | "Preço antes do pedido. Pix antes do carro andar." | "Preço antes. Pix antes." |
| 10–15 s | Logo e data | "Domingo, 1º de novembro." | "Domingo, 1º/11" |

Ajustar o número de dias conforme a data de publicação.

### V10. "Três erros comuns ao pedir corrida" (25 s · passageiro)

| Tempo | Visual | Áudio | Texto |
|---|---|---|---|
| 0–3 s | Pessoa olhando o celular | "Três erros que custam tempo e dinheiro." | "3 erros" |
| 3–12 s | Erro 1: ponto de embarque errado; erro 2: não conferir o valor | "Confira o ponto de embarque e o valor final." | "Confira antes de confirmar" |
| 12–20 s | Erro 3: esquecer o pedágio no cálculo | "O pedágio aparece no valor. Veja antes." | "Pedágio no valor" |
| 20–25 s | Logo | "Leaf. Tudo na tela antes." | "Tudo antes." |

---

## 9. Roteiros para TikTok e YouTube Shorts

Formato: 9:16, 25 a 40 s, legenda queimada, gancho nos primeiros 2 segundos. Estrutura: gancho, problema, prova, CTA.

### 9.1 Roteiro modelo "Eu descobri isso no app" (35 s)

- 0–2 s (gancho): texto grande "Você sabe o que aparece antes de confirmar uma corrida?"
- 2–8 s (problema): cena de passageiro surpreso com um valor no fim de uma corrida.
- 8–20 s (prova): tela real mostrando cada cobrança antes do Pix.
- 20–30 s (prova): recibo com pedágio separado e Pix confirmado.
- 30–35 s (CTA): "Link na bio. Compare com o seu app."

Atenção: "compare com o seu app" é permitido só se não citar marca e não depreciar concorrente.

### 9.2 Roteiro "Motorista responde" (40 s)

- Pergunta real de um comentário (ex.: "Quanto sobra da corrida?").
- Resposta com tela real e número explicado com regra.
- Fecha com "Mande sua pergunta nos comentários."
- Formato fácil de reproduzir por motoristas com autorização.

### 9.3 Títulos e descrição para Shorts

- Título: "Preço antes do pedido. Pix antes do carro andar." (até 70 caracteres).
- Descrição: uma frase com o pilar, o link e "Publicidade" quando houver pagamento.
- Tags: leaf app, rio de janeiro, motorista de app, pix, segurança, transporte.

---

## 10. Peças off-line

### 10.1 Adesivo de carro (motorista)

- Material: vinil recortado, 15 x 15 cm, com logo e QR code.
- Local: vidro traseiro lateral ou para-choque traseiro. Não pode obstruir a visão do condutor (Código de Trânsito Brasileiro).
- Conteúdo: logo, "Dirijo com a Leaf", QR code para o cadastro com UTM "adesivo".
- Versão alternativa com mais espaço: 20 x 10 cm para o para-choque.
- Quantidade inicial: 300 unidades.
- Antes de imprimir: revisar a frase e checar que não há promessa de ganho.

### 10.2 Panfleto para pontos de motoristas e comércio

- Formato: A5 (148 x 210 mm), frente e verso, papel 300 g, sangria de 3 mm.
- Frente: "Preço antes do pedido. Pix antes do carro andar." + logo.
- Verso: "Como começar" em 4 passos, QR code para cadastro, QR code para calculadora, contato do suporte.
- Quantidade inicial: 1.000 unidades.
- Distribuição: somente com permissão do responsável pelo local (posto, ponto de encontro, comércio).

### 10.3 QR code

- Tamanho mínimo impresso: 3 x 3 cm. Em adesivo: 4 x 4 cm ou mais.
- Margem em branco (zona de silêncio) de pelo menos 4 módulos ao redor.
- Contraste alto (preto sobre branco ou verde escuro #003002 sobre branco). Nunca sobre fundo com textura.
- Um QR por canal, com parâmetro UTM (ex.: `utm_source=panfleto&utm_medium=offline&utm_campaign=lancamento_rio`). Não colocar dado pessoal no link.
- Testar em dois celulares e em iPhone e Android antes da impressão.

### 10.4 Cartaz de comércio parceiro

- A3 ou A4, verde escuro #003002 e texto branco.
- Texto: "Peça pela Leaf. Preço antes. Pix antes." + QR de cadastro para passageiro.
- Sem promessa de desconto sem regulamento.

---

## 11. Estratégia de aquisição

### 11.1 Motoristas

Funil: interesse, cadastro, documentos, verificação, aprovação, primeira corrida concluída. Medir a taxa de conclusão em cada etapa.

Canais, por ordem de prioridade:

1. **Grupos de motoristas (Facebook, WhatsApp, Telegram).** Entrar só com permissão do administrador. Postagem identificada como da Leaf. Nada de disparo em massa para contatos.
2. **Pontos de encontro de motoristas e postos de combustível.** Ação presencial com panfleto, QR e conversa de 2 minutos. Sempre com permissão do responsável pelo local. Não usar nome de posto ou marca de terceiro nos materiais.
3. **Associações e sindicatos de motoristas de aplicativo do Rio.** Apresentação de 20 minutos: "Como ver quanto sobra na corrida". Material para os associados.
4. **Indicação de motoristas que já dirigem.** Pode começar com depoimento e relato, sem bônus. Programa de bônus por indicação depende de aprovação explícita (pendência 9).
5. **Mídia paga em Meta e TikTok** com público de 25 a 55 anos, região do piloto, interesse em mobilidade e trabalho com carro. Sem segmentação por dado sensível ou por condição de saúde.
6. **Creators de motorista** com briefing e marcação de publicidade (seção 4.9).
7. **Mídia local:** rádio comunitária, jornal de bairro, grupos de bairro (com permissão).
8. **Evento de café com motorista** em um ponto fixo, uma vez por semana no primeiro mês. Equipe de cadastro no local.

O que não fazer: anúncio com "ganhe R$ X", lista comprada de motoristas, mensagem em massa para contato do WhatsApp, ação em local sem permissão.

### 11.2 Passageiros

Funil: visualização, instalação, cadastro, primeiro Pix confirmado, primeira corrida concluída, segunda corrida em 30 dias.

Canais:

1. **Bairros do piloto.** Usar apenas a cobertura liberada pelo produto. Não comunicar áreas que ficarão fora do piloto. Mensagem local: "Chega no seu bairro. Preço antes do pedido."
2. **Parcerias locais.** Padarias, farmácias, academias, cursinhos, escolas de idiomas e coworkings, com QR de cadastro no balcão. Sem desconto até o regulamento estar aprovado.
3. **Universidades e cursinhos** com ação de conteúdo sobre transporte à noite e segurança. Sem caixa de presente ou sorteio sem aprovação.
4. **Associações de moradores e grupos de bairro** com conteúdo institucional e panfleto, com permissão.
5. **Mídia paga em Instagram, Facebook e TikTok** com segmentação por região do piloto e interesse em mobilidade. Sem público de menores de 18.
6. **Busca e loja de apps (ASO).** Título, subtítulo e capturas de tela com as mensagens da seção 1. Screenshot só com a interface real.
7. **Conteúdo orgânico** (seção 7 e 8), com resposta ativa aos comentários.

O que não fazer: sorteio sem regulamento, cupom com valor que altere a taxa sem aprovação, mensagem de texto para número sem consentimento, anúncio que cite concorrente.

---

## 12. Métricas

### 12.1 Definições

| Métrica | Fórmula | Observação |
|---|---|---|
| CAC motorista | Custo total de aquisição de motoristas no período / motoristas ativados no período | "Ativado" = aprovado e com primeira corrida concluída. Incluir mídia, produção, ação de rua e brindes. |
| CAC passageiro | Custo total de aquisição de passageiros / passageiros com primeira corrida paga | Não contar cadastro sem Pix confirmado. |
| Taxa de ativação motorista | Motoristas com primeira corrida concluída em 7 dias / cadastros iniciados | Medir cada etapa do funil de cadastro. |
| Taxa de ativação passageiro | Passageiros com primeira corrida paga em 72 horas / cadastros | |
| Retenção D7 | Usuários que fazem corrida entre o 7º e o 9º dia / usuários da coorte inicial | Separar motorista e passageiro. |
| Retenção D30 | Usuários que fazem corrida entre o 30º e o 32º dia / coorte inicial | |
| Frequência motorista | Corridas por motorista ativo por semana | Mostrar mediana, não só média. |
| Pix confirmado antes da corrida | Corridas iniciadas com Pix confirmado / corridas pedidas | Deve ser 100% para corridas iniciadas. Qualquer exceção é incidente. |
| NPS | Percentual de notas 9 e 10 menos percentual de notas 0 a 6 | Pesquisa curta após a corrida, separada para motorista e passageiro, com consentimento. |
| Custo por instalação e custo por clique | Gasto / instalações ou cliques | Acompanhar por canal e criativo. |
| Tempo médio de resposta do suporte | Tempo entre a abertura e a primeira resposta humana | Publicar mensalmente. |

Metas iniciais são hipóteses para revisar após duas semanas de linha de base. Não publicar meta como resultado.

### 12.2 Hipóteses de partida

- CAC motorista abaixo de R$ [X] (definir após o primeiro mês de dados).
- Ativação do motorista de pelo menos [X]% em 7 dias.
- Retenção D30 de passageiro de pelo menos [X]%.
- NPS acima de 30 para passageiros e acima de 40 para motoristas na primeira revisão.

Os valores entre colchetes são definidos pela operação após as duas primeiras semanas. Não há base de dados para fixar agora.

### 12.3 Rastreamento

- UTM em todo link de campanha. Padrão: `utm_source`, `utm_medium`, `utm_campaign`, `utm_content`.
- Eventos no app: cadastro iniciado, documento enviado, verificação concluída, primeira corrida pedida, Pix confirmado, corrida concluída.
- Painel semanal com: canal, custo, cadastro, ativação, retenção, NPS e tickets de suporte.
- Revisão semanal às segundas, 30 minutos.

---

## 13. Orçamento sugerido (30 dias, em reais)

Três faixas. Os valores não incluem tributos, taxas de plataforma de anúncio nem salários da equipe. Ferramentas pagas de marketing precisam de aprovação antes da contratação.

| Item | Enxuta | Média | Forte |
|---|---|---|---|
| Mídia paga (Meta, TikTok) | R$ 2.000 | R$ 6.000 | R$ 17.000 |
| Creators (com briefing e marcação de publicidade) | R$ 0 | R$ 0 | R$ 3.000 |
| Produção (freelancer de vídeo, arte, locução) | R$ 600 | R$ 2.000 | R$ 6.000 |
| Off-line (panfleto, adesivo, cartaz, QR) | R$ 800 | R$ 2.000 | R$ 4.000 |
| Eventos, ação de rua e parcerias | R$ 400 | R$ 1.200 | R$ 3.000 |
| Ferramentas (agendamento, medição) | R$ 0 | R$ 300 | R$ 500 |
| Reserva (10% a 15%) | R$ 200 | R$ 500 | R$ 1.500 |
| **Total** | **R$ 4.000** | **R$ 12.000** | **R$ 35.000** |

Como escolher:
- Enxuta: validar a mensagem e a operação de cadastro com poucos motoristas e passageiros. Escolha se o time for pequeno e o suporte ainda estiver aprendendo.
- Média: escala moderada no Rio com ação de rua semanal. Escolha quando a ativação de motorista estiver acima da meta por duas semanas.
- Forte: escala acelerada com creators e mídia em várias regiões do piloto. Só depois da revisão de 30 dias e com a taxa aprovada.

Regra de corte: se o CAC do canal ficar acima de duas vezes a meta por duas semanas seguidas, pausar o canal e revisar criativo e público antes de voltar a gastar.

---

## 14. Checklist de produção de peças

### 14.1 Antes de criar

- [ ] Mensagem aprovada na seção 1 e, para cada número, a fonte do dado.
- [ ] Pendências da seção 0 resolvidas ou a peça não entra.
- [ ] Nenhuma palavra da lista da seção 4.11 sem aprovação.
- [ ] Nenhuma marca concorrente citada.
- [ ] Público do anúncio sem menores de 18 anos e sem dado sensível.

### 14.2 Durante a produção

- [ ] Termo de autorização de uso de imagem assinado por cada pessoa que aparece.
- [ ] Placas, endereços e dados pessoais borrados ou ausentes.
- [ ] Tela do app real, na versão que estará no ar no dia da publicação.
- [ ] Música com licença comercial da biblioteca da plataforma ou licenciada.
- [ ] Legenda queimada no vídeo (texto legível em 1080 x 1920).
- [ ] Aviso "Exemplo ilustrativo" quando houver cálculo.
- [ ] Identificação "Publicidade" ou "Parceria paga" quando houver pagamento.
- [ ] Texto alternativo (alt text) em todas as imagens do feed.
- [ ] Link com UTM e QR code testados.

### 14.3 Antes de publicar

- [ ] Revisão de texto por marketing e por jurídico (peças com número, comparação, dado de motorista ou promoção).
- [ ] Revisão de produto para qualquer função citada.
- [ ] Arquivo final em MP4 H.264 e áudio AAC, com preview no celular.
- [ ] Agendamento com data, hora e canal definidos.
- [ ] Resposta à pergunta mais provável de cada post preparada para a equipe de suporte.
- [ ] Registro da peça e da aprovação em planilha de conteúdo.

### 14.4 Depois de publicar

- [ ] Comentários respondidos em até 2 horas no horário comercial.
- [ ] Métricas do dia 1, 3 e 7 registradas.
- [ ] Qualquer erro de preço ou informação: correção no mesmo canal em até 2 horas e registro no histórico.

---

## 15. Especificações de formato

### 15.1 Imagem

| Uso | Dimensão | Formato | Observação |
|---|---|---|---|
| Feed Instagram (post único) | 1080 x 1350 px (4:5) | JPG ou PNG | Margem interna de 60 px. Texto principal no centro. |
| Feed quadrado (alternativa) | 1080 x 1080 px | JPG ou PNG | Use se o 4:5 não couber no layout. |
| Carrossel Instagram | 1080 x 1350 px por slide | JPG ou PNG | Até 10 slides por carrossel recomendado. Manter a mesma margem. |
| Stories e capa de Reels | 1080 x 1920 px (9:16) | JPG ou PNG | Zona de segurança (seção 15.3). |
| Thumbnail de vídeo curto | 1080 x 1920 px | JPG | Texto grande, até 4 palavras. |
| Thumbnail de vídeo longo (YouTube) | 1280 x 720 px | JPG ou PNG | Use só se houver vídeo longo. Rosto com expressão clara. |
| Anúncio em Meta (feed) | 1080 x 1080 ou 1080 x 1350 px | JPG ou PNG | Mesmo critério do feed. |
| Anúncio em Meta (stories) | 1080 x 1920 px | JPG, PNG ou MP4 | Zona de segurança. |
| Capa de loja de apps (feature graphic) | 1024 x 500 px | PNG ou JPG | Conferir a política da loja antes de enviar. |
| Capturas de tela da loja | Proporção do aparelho | PNG ou JPG | Só telas reais. Sem texto que prometa ganho. |

### 15.2 Vídeo

| Uso | Proporção | Duração | Formato |
|---|---|---|---|
| Reels (Instagram) | 9:16 (1080 x 1920) | 15 a 45 s (ideal). Até 90 s. | MP4 H.264, 30 fps, AAC 48 kHz, 8 a 12 Mbps |
| Stories | 9:16 (1080 x 1920) | Segmentos de até 15 s por tela | MP4 H.264, 30 fps |
| TikTok | 9:16 (1080 x 1920) | 15 a 45 s (ideal). Até 10 min. | MP4 H.264, 30 fps |
| YouTube Shorts | 9:16 (1080 x 1920) | 15 a 45 s (ideal). Até 3 min. | MP4 H.264, 30 fps |
| Anúncio de vídeo em Meta | 9:16 ou 4:5 | 15 a 30 s | MP4 H.264, legenda queimada |
| Vídeo longo (YouTube) | 16:9 (1920 x 1080) | Opcional | MP4 H.264, 30 fps |

Regras gerais: legenda queimada em todos os vídeos, porque grande parte é assistida sem som. Volume de áudio entre -14 e -10 LUFS. Primeiro frame com a mensagem principal, para a capa.

### 15.3 Zonas de segurança (9:16)

Referências práticas. Confirmar no preview de cada plataforma antes de finalizar.

| Plataforma | Topo livre | Base livre | Lateral |
|---|---|---|---|
| Reels e Stories (Instagram) | 250 px | 340 px | 60 px |
| TikTok | 150 px | 250 px | 60 px |
| YouTube Shorts | 150 px | 250 px | 60 px |

Em todas as plataformas: nenhum texto ou logo dentro das áreas de base e topo. A legenda queimada fica no terço central da tela.

### 15.4 Impressos e adesivos

| Peça | Medida | Observação |
|---|---|---|
| Panfleto | A5 (148 x 210 mm) | Sangria 3 mm, papel 300 g, frente e verso. |
| Cartaz para comércio | A4 ou A3 | Impressão em alta resolução (300 dpi). |
| Adesivo de carro (versão padrão) | 15 x 15 cm | Vinil recortado. Não pode obstruir a visão do condutor. |
| Adesivo de para-choque | 20 x 10 cm | Vinil recortado. |
| QR code impresso | Mínimo 3 x 3 cm | Margem branca de 4 módulos. |

---

## 16. Riscos e próximos passos

| Risco | Impacto | Mitigação | Dono |
|---|---|---|---|
| Taxa divergente entre materiais | Peça com valor errado, risco de publicidade enganosa | Modelo único aprovado antes do primeiro post | Produto, financeiro |
| Depoimento sem origem | Publicidade enganosa; dano à marca | Remover e substituir por depoimento autorizado | Marketing, jurídico |
| Recurso anunciado que não funciona no dia 01/11 | Reclamação e exposição de marca | Lista de recursos confirmada por produto | Produto |
| Número comparativo sem método | Risco com CONAR e concorrentes | Documentação de método antes de qualquer número | Marketing, jurídico |
| Dado de motorista ou passageiro em peça | Violação da LGPD e de imagem | Checklist 14.2 e termos assinados | Marketing |
| Campanha de rua sem permissão | Problema com comércio e com local público | Permissão escrita por local | Operação |
| Pico de demanda de suporte no lançamento | Tempo de resposta alto, reclamação | Escala do suporte antes de 01/11 | Operação |

Próximos passos:
1. Produto e financeiro fecham o modelo de taxa e o confirmam por escrito (pendência 1).
2. Jurídico revisa as seções 4 e 14 e o enquadramento regulatório (pendência 8).
3. Marketing substitui os depoimentos e os números da landing (pendências 2 a 5).
4. Produto confirma a lista de recursos ativos (pendência 6).
5. Marketing produz as peças base e os três vídeos da semana 1 (seção 5.1).
6. Operação prepara a escala de suporte para a semana de lançamento.

Itens fora deste documento e que exigem decisão separada: programa de indicação com bônus, cupom de lançamento, sorteio, Black Friday com desconto, campanha em nome de parceiro comercial e qualquer ação de mídia acima da faixa forte.

---

## 17. Glossário de siglas

- CAC: custo de aquisição de cliente.
- ASO: otimização da página na loja de apps.
- CDC: Código de Defesa do Consumidor (Lei 8.078/1990).
- CONAR: Conselho Nacional de Autorregulamentação Publicitária.
- LGPD: Lei Geral de Proteção de Dados (Lei 13.709/2018).
- NPS: Net Promoter Score.
- UTM: parâmetros de rastreamento de campanha em links.
- LUFS: unidade de volume percebido de áudio.
- D7 e D30: retenção no sétimo e no trigésimo dia após a primeira corrida.
