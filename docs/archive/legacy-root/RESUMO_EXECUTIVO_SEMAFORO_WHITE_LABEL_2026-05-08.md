# Resumo Executivo (Semaforo): White Label Exicube -> Leaf Atual

Data de referencia: 2026-05-08  
Objetivo: responder "o que ganhamos ate agora" em estrutura, arquitetura e formato de negocio.

---

## 1) Snapshot objetivo (antes vs agora)

- Base original (T7): `/Volumes/T7 Shield/1. leaf/main 2/Sourcecode`
  - `exicubeapps` v4.6.0
  - ~444 arquivos
  - stack central: `mobile-app`, `web-app`, `functions`, `common`
- Primeiro commit Leaf: 2025-04-05 (`b8fa0bf`) com 448 arquivos
- Estado atual: 2026-05-07 (`c021a10`) com 3230 arquivos e 225 commits
- Delta acumulado: 3404 arquivos alterados no historico (`+813115` / `-59736`)

---

## 2) Semaforo executivo (decisao)

| Pilar | Status | Leitura executiva |
|---|---|---|
| Estrutura de produto/plataforma | Verde (Consolidado) | A Leaf deixou de ser app white label e virou plataforma propria multi-modulo. |
| Arquitetura de runtime critico | Amarelo (Em transicao) | Evolucao grande (commands, events, workers, observabilidade), com legado ainda convivendo por compatibilidade. |
| Formato de negocio (monetizacao/operacao) | Amarelo (Em transicao) | Ja existe motor de monetizacao proprio (pricing, assinatura, referral, promo), mas parte da experiencia/comunicacao ainda esta desalinhada. |
| Risco operacional de legado | Vermelho (Risco) | Superficie legada ainda relevante e precisa de plano de corte definitivo por fase. |

---

## 3) O que ja esta consolidado (ganho real)

### 3.1 Estrutura

- Monorepo ativo com workspaces focados no core atual:
  - `leaf-websocket-backend`
  - `leaf-dashboard-js`
  - `mobile-app`
- Dashboard legado removido do caminho oficial de produto.
- Criacao de trilha operacional e de QA (scripts, runbooks, evidencias, auditorias).

### 3.2 Arquitetura

- Backend dedicado de alta complexidade funcional (nao dependente apenas de Firebase Functions).
- Padroes de robustez aplicados no runtime:
  - idempotencia
  - circuit breaker
  - workers/listeners
  - telemetria e observabilidade
- Cobertura de testes saiu de praticamente inexistente para base extensa (unit, integration, e2e/smoke).

### 3.3 Negocio

- Regras de negocio proprias no core:
  - precificacao dinamica operacional
  - lifecycle financeiro de corrida com separacao de componentes
  - assinatura/retencao
  - promocao e referral
- Capacidade de medir custo por corrida no runtime (finops operacional).

---

## 4) O que esta em transicao (precisa fechar)

### 4.1 Legado convivendo com o novo

Relatorio de superficie legada (gerado em 2026-05-08) mostra:

- 48 flags de legado
- 85 acessos diretos a RTDB
- 4 rotas explicitamente legacy
- 22 pontos de fallback/log de legado

Leitura: o caminho novo existe e funciona, mas ainda coexistimos com trilhas antigas para compatibilidade.

### 4.2 Narrativa de monetizacao ainda mista

- Partes da UX e de alguns endpoints ainda falam em assinatura semanal.
- Core financeiro ja opera com logica diaria por onda/estado.

Leitura: o motor de negocio evoluiu, mas a comunicacao e alguns contratos de superficie ainda nao estao 100% unificados.

---

## 5) Riscos de negocio (se nada mudar)

### 5.1 Risco de margem/percepcao

Sem unificacao de regra comercial na ponta (app/dashboard/backoffice), a percepcao de preco/taxa pode ficar confusa.

### 5.2 Risco de manutencao e velocidade

Legado + novo em paralelo aumenta custo de mudanca, tempo de QA e chance de regressao.

### 5.3 Risco de governanca

Sem "fonte unica da verdade" de plano/taxa/beneficio, decisoes comerciais perdem previsibilidade.

---

## 6) Conclusao executiva (direta)

A Leaf **ja ganhou** autonomia tecnica e de negocio sobre o white label.

Hoje, a classificacao mais honesta para decisao:

- **Estrutura:** consolidada
- **Arquitetura:** forte, mas ainda em transicao por legado
- **Modelo de negocio:** promissor e funcional, ainda pedindo unificacao final de regras e comunicacao

Em resumo: **nao estamos mais "adaptando white label"; estamos operando uma plataforma propria em fase de consolidacao final.**

---

## 7) Proxima acao recomendada (30 dias)

1. Definir "single source of truth" comercial (plano, taxa, isencao, retencao).  
2. Publicar matriz oficial de contrato por canal (`app`, `dashboard`, `backend`).  
3. Executar plano de corte de legado em 3 ondas (flags, rotas, RTDB fallback), com metricas de risco por onda.  

