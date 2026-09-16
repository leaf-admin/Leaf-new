# Perfil físico canônico de QA

## Device autorizado nesta rodada

- Nome: `Leaf iPhone 17 Dedicated`
- UDID: `6BC9EC30-C939-4598-A85D-A9E071E90CE5`
- Regra: não usar nem encerrar simuladores compartilhados de outros projetos.
- Se houver somente este device disponível, executar passageiro e motorista em rodadas sequenciais e manter o resultado separado; não apresentar isso como execução bilateral.

Para a rodada Android de 2026-09-03, o par autorizado foi reduzido a passageiro no físico USB-C `irsgaiscr4j7cenv` (`24117RN76L`) e motorista no AVD `emulator-5554` (`Leaf_API_35_Driver`), com iOS e AVD passageiro desligados. O par só pode iniciar cenário depois de ambos estarem em `device`, com `MainActivity` e superfície de papel reconhecida em foreground.

## Escolha

Para os testes físicos pareados de passageiro/motorista, o perfil canônico de motorista é:

- Escopo: `sandbox`
- UID: `DV4cwZvql3T3pI3lnKYQwQVALKZ2`
- Nome operacional: `Leaf Motorista Teste`
- Dashboard: `/drivers/DV4cwZvql3T3pI3lnKYQwQVALKZ2/documents?kycScope=sandbox`

Esse perfil é o `QA_DRIVER_CURRENT_UID` reconhecido pelo seed do app, tem perfil de motorista aprovado, `canGoOnline` habilitado e já foi usado na autenticação física do iPhone. Ele é o perfil a ser usado nos aparelhos durante esta rodada.

## Não misturar com os registros nominais

Os registros `e2e_driver_*` encontrados no escopo operacional são duplicatas de dados de teste do titular da CNH. Eles não são o vínculo de autenticação física desta rodada: não possuem a selfie/caso KYC do teste e alguns não têm arquivo documental visualizável.

Não apagar ou mesclar esses registros sem uma decisão explícita de limpeza de dados. A seleção do UID sandbox acima elimina a ambiguidade operacional sem alterar histórico ou evidência.

## Critérios para considerar o perfil apto

Antes de cada rodada, confirmar no dashboard e no app:

1. runtime `sandbox` autoritativo;
2. status de motorista aprovado;
3. CNH/CRLV e veículo aprovados;
4. `canGoOnline` permitido pelo estado canônico;
5. autenticação concluída no aparelho físico.

O motivo interno de uma falha KYC fica restrito ao dashboard; o motorista recebe somente a mensagem operacional genérica.
