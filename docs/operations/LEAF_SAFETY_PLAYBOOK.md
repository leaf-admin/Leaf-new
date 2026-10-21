# Playbook de safety: segurança de conta

Como a Leaf trata sinais de fraude ou risco na conta de motorista: salto impossível de
localização, GPS simulado, reprovação na comparação facial do KYC e incidentes abertos pelos
usuários. Vale para o bot de Segurança, para os heads e para o Izaak.

## Regra de ouro

- O backend **registra e avisa**. Nenhum sinal automático bloqueia conta, cancela corrida,
  muda saldo ou dispara KYC.
- Bloquear, suspender, pedir nova verificação ou liberar é decisão do Izaak, uma por vez.
- Nunca durante corrida: nada de KYC, liveness ou contato que atrapalhe o motorista com
  passageiro no carro. Exceção só no fluxo aprovado de incidente de segurança (passageiro
  em risco), que vai direto ao Izaak.
- Bot nunca fala com o motorista sobre suspeita de fraude. Quem fala é o Izaak ou o suporte,
  com o texto aprovado por ele.

## Sinais automáticos

Todos ficam 30 dias no Redis e geram o evento `safety.signal` para o bot de Segurança
(`BOT_EVENTS_SEGURANCA_URL` e `_SECRET`). Corridas e usuários de teste (sandbox) são gravados
para auditoria, mas não avisam.

| Tipo | Quando | Onde nasce | Repetição |
| --- | --- | --- | --- |
| `location_jump` | Dois pontos seguidos da mesma corrida com ≥ 0,5 km e velocidade > 180 km/h, pelo horário de captura no aparelho. Ponto com precisão pior que 200 m não conta. | `trip-location-persistence-service` (worker de localização) | 1 por corrida por hora |
| `mock_location` | O Android marcou a posição da corrida como simulada (app de GPS falso). | `register-socket-update-location-handler` | 1 por motorista por hora |
| `kyc_biometric_rejected` | A comparação da selfie com a CNH reprovou e a evidência foi guardada. | `kyc-failed-biometric-evidence-service` | 1 por evidência |

Ajustes por ambiente: `SAFETY_JUMP_MIN_KM`, `SAFETY_JUMP_MAX_KMH`, `SAFETY_JUMP_MAX_ACCURACY_M`.

O evento leva só id do sinal, tipo, corrida, motivo curto e pontuação. O detalhe sai de:

- `GET /api/ops/safety/signals?limit=50`: últimos sinais.
- `GET /api/ops/safety/signals/:signalId`: o sinal, os detalhes e o histórico de sinais do
  mesmo motorista nos últimos 30 dias.

### O que costuma ser falso positivo

- **Salto:** túnel ou garagem seguido de reconexão; GPS ruim no início da corrida; troca de
  aparelho no meio da corrida. Um salto isolado, sem outro sinal, quase sempre é isso.
- **GPS simulado:** app de QA (contas de teste já não avisam); motorista com app de "melhorar
  GPS" instalado. Repetição em corridas diferentes é o que pesa.
- **KYC reprovado:** foto escura, ângulo ruim, CNH antiga com aparência muito diferente.

## Como o bot de Segurança investiga

1. Busca o sinal pela API e o histórico do motorista.
2. Cruza com o que já existe: outros sinais em 30 dias, incidentes (`/api/ops/incidents`),
   chamados, disputas e estornos da mesma corrida.
3. Classifica pela tabela abaixo e grava a entrega para o CTO com a ficha de triagem.
4. Publica no `#seguranca` só o que for N1 ou N2 com reincidência. Sinal isolado e explicável
   fica no resumo diário.

| Nível | Exemplos | Para quem | Prazo |
| --- | --- | --- | --- |
| N1 | Incidente de segurança aberto pelo passageiro; GPS simulado + salto na mesma corrida; 3+ sinais do mesmo motorista em 7 dias | Izaak (com `--urgente`) e CTO | Imediato |
| N2 | GPS simulado repetido em corridas diferentes; KYC reprovado de motorista já ativo; salto com valor de corrida alto | CTO, que leva ao Izaak com parecer | No mesmo dia |
| N3 | Sinal isolado com explicação provável | Resumo diário | Sem prazo |

O parecer ao Izaak segue o formato dos heads (veredito obrigatório): o que aconteceu, evidência
(ids, nunca dados pessoais no Discord), hipótese mais provável, o que mais pesaria, e uma
recomendação entre **ignorar**, **observar**, **pedir nova verificação depois da corrida** ou
**suspender para revisão**. A decisão é sempre do Izaak.

## KYC hoje

- **Comparação facial** (serviço próprio da Leaf, sem custo por chamada): aprova a partir de
  0,61, manda para revisão entre 0,40 e 0,61, reprova abaixo de 0,40.
- **Novas tentativas:** até 2, só em erro técnico (timeout, serviço fora). Rosto que não confere
  não é tentado de novo automaticamente.
- **Liveness da AWS:** desligado em produção (`KYC_AWS_LIVENESS_ENABLED=false`), com o bypass
  ativo. Se for ligado, o limitador de custo segura o gasto.
- **Fila manual:** a faixa de revisão e as reprovações vão para a fila de revisão do backoffice,
  com a evidência guardada por 30 dias e acesso auditado.

### Automação da revisão manual (pendente de decisão)

Proposta em três camadas, nenhuma ativa:

1. **Triagem pelo bot:** o bot de Segurança monta o dossiê de cada item da fila (pontuação,
   histórico, sinais) e sugere a decisão. Não muda nada. Pode ser ligada sem regra nova.
2. **Nova tentativa guiada:** na faixa de revisão, pedir ao motorista uma nova selfie, fora de
   corrida, antes de ir para a fila. Muda o fluxo do app: precisa de aprovação.
3. **Aprovação automática na faixa alta da revisão:** só com o OK explícito do Izaak e o limite
   definido por ele. Mexe em regra de KYC.

## Incidentes abertos pelos usuários

`safety.incident_created` continua indo para o CTO e o Head de Atendimento, como no
[BOT_EVENTS_RUNBOOK](BOT_EVENTS_RUNBOOK.md). Passageiro ou motorista em risco é N1 e vai ao Izaak
na hora, mesmo de madrugada.

## Fora do escopo desta versão

- GPS simulado com o motorista online sem corrida (só a corrida ativa é observada).
- Envio do campo `mocked` pelo app: depende de atualização do app (OTA), feita à parte.
- Qualquer bloqueio automático.
