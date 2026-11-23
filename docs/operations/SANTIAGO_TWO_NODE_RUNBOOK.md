# Santiago com dois nós e load balancer

Status: em preparação (21/10/2026). O nó B ainda não existe; este runbook é o plano
aprovado pelo Izaak e a ordem de ativação. Ele fecha os itens de borda e Redis do
`leaf-websocket-backend/docs/PRODUCTION_HA_GATE_2026-08-02.md`, que liberam
`LEAF_BROAD_LAUNCH_APPROVED=true`.

## Topologia

```
                 Vultr Load Balancer (Santiago)  ← DNS api/socket
                 TCP 80→8080, 443→8443, PROXY protocol, health HTTP :8080/health
                 backends pelos IPs da VPC
                     │                         │
          ┌──────────┴─────────┐     ┌─────────┴──────────┐
          │ Nó A (atual)       │     │ Nó B (novo)        │
          │ nginx → 2 gateways │     │ nginx → 2 gateways │
          │ Redis principal    │◄────│ Redis réplica      │
          │ Sentinel 1         │ WG  │ Sentinel 2         │
          │ workers únicos     │     │ (sem workers únicos)│
          └─────────┬──────────┘     └─────────┬──────────┘
                    │ WireGuard 10.77.0.0/24    │
                    └──────────┬───────────────┘
                     Contabo (França): Redis réplica (nunca promovida),
                     Sentinel 3, face compare, OCR, backups, standby frio
```

- **Borda:** o load balancer passa TCP com PROXY protocol para as portas 8080/8443 de
  cada nó. O nginx tira o IP real do cliente do PROXY header (`$leaf_client_addr`) e o
  manda como único valor em `X-Real-IP` e `X-Forwarded-For`. As portas 80/443 de hoje
  continuam atendendo direto, então a troca de DNS pode ser gradual e reversível.
- **Cada nginx só fala com os gateways do próprio nó.** Se os dois gateways de um nó
  caem, o health check do load balancer tira o nó inteiro.
- **Socket.IO:** o adapter Redis já entrega eventos entre gateways; isso continua
  valendo entre nós porque todos usam o mesmo Redis.
- **Redis e Sentinel pela malha WireGuard** (A 10.77.0.1, Contabo 10.77.0.2,
  B 10.77.0.3): um único espaço de endereços que os três alcançam. A VPC fica só para
  load balancer → nós.
- **Sentinel com quórum 2 de 3.** O Contabo vota mas tem `replica-priority 0`: nunca vira
  principal (latência da França).
- **Workers únicos** (`billing`, `pricing-baseline`, `ride-health-monitor`, perfil
  `primary`) ficam só no A. Se o A cair por muito tempo, o passo "A perdido" abaixo
  sobe esse perfil no B.

## O que criar na Vultr (Izaak)

1. **Servidor B:** região Santiago, mesmo plano do A (4 vCPU dedicadas, 8 GB, ~70 GB),
   Ubuntu 24.04 LTS, a mesma chave SSH do A, IPv6 opcional.
2. **VPC 2.0** em Santiago, ligada ao A e ao B. Anote o IP privado de cada nó.
3. **Load Balancer** em Santiago, ligado à VPC, ainda sem DNS:
   - Regras: TCP 80 → 8080 e TCP 443 → 8443 (não use HTTPS no load balancer: o TLS
     continua nos nós).
   - **PROXY protocol: ligado.**
   - Health check: HTTP, porta 8080, caminho `/health`, intervalo 10 s, 3 falhas para
     tirar e 3 sucessos para voltar.
   - Backends: A e B (pela VPC).
   - Sticky session: desligado (o app usa só WebSocket; cada conexão fica no nó onde
     abriu).

## Ativação (Claude, com o OK do Izaak em cada passo de produção)

1. **Preparar B:** hardening igual ao A (ufw: 22 de qualquer lugar; 8080/8443 só da VPC;
   WireGuard 51820/udp de A e Contabo), Docker, `/opt/leaf-app` com o código do `main`,
   `.env` e `firebase-credentials.json` copiados do A, certificado `api/socket` copiado do
   A, e `LEAF_WORKER_INSTANCE_ID` próprio.
2. **WireGuard:** B entra como 10.77.0.3, com peers A e Contabo.
3. **Redis B como réplica** do A pelo túnel (`REDIS_REPLICAOF=10.77.0.1 6379`, igual ao
   Contabo). Conferir chaves e lag.
4. **Gateways do B** sobem com a mesma imagem do GHCR, sem perfil `primary`.
5. **Borda:** `SANTIAGO_LB_BIND_IP=<IP VPC>` em cada nó; recriar o nginx de cada nó
   (fora de horário, sem corrida); health check verde no painel.
6. **Teste pelo load balancer sem DNS:** `curl --resolve api.leaf.app.br:443:<IP do LB>`
   e o gerador de tráfego (40 sockets + HTTP) apontado para o IP do load balancer.
7. **DNS:** `api` e `socket` passam a apontar para o IP do load balancer (Izaak). O A
   continua respondendo direto durante o TTL.
8. **Sentinel (PR separado):** 3 Sentinels, `REDIS_MODE=sentinel` nos gateways e
   workers, ensaio de failover do Redis (promover B, confirmar leitura e escrita,
   devolver).
9. **Ensaio de borda:** derrubar o nginx do A com o tráfego sintético e uma corrida de
   teste; confirmar que o load balancer tira o A e que tudo reconecta no B.
10. **Evidência:** registrar IDs e horários dos dois ensaios em
    `REDIS_HA_*` e `LEAF_EDGE_HA_*` e rodar `npm run config:validate`.

## Deploy com dois nós

`deploy-santiago-docker.sh` passa a rodar nó por nó (A, depois B). Em cada nó o
rolling já tira um gateway do nginx por vez; o load balancer continua mandando
tráfego para o nó, que segue atendendo com o outro gateway.

## A perdido

- **Com Sentinel:** o Redis do B é promovido sozinho em ~10–30 s; os gateways do B
  seguem; subir o perfil `primary` no B
  (`docker compose ... --profile primary up -d billing-worker pricing-baseline-worker ride-health-monitor-worker`).
- **Antes do Sentinel:** promover o Redis do B à mão (`REPLICAOF NO ONE`), apontar os
  gateways do B para o Redis local e subir o perfil `primary`.
- Quando o A voltar, ele entra como réplica (o Sentinel reconfigura) e só depois
  volta ao load balancer.

## Reverter

DNS de `api`/`socket` de volta para o IP do A (64.176.9.163). Os listeners 8080/8443
podem continuar; com `SANTIAGO_LB_BIND_IP` vazio eles ficam presos ao loopback.
