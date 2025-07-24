# Cadastro e Gerenciamento de Veículos - Documentação Técnica

## Sumário
- [Visão Geral](#visão-geral)
- [Campos Obrigatórios](#campos-obrigatórios)
- [Fluxo de Cadastro](#fluxo-de-cadastro)
- [Classificação Automática do Tipo](#classificação-automática-do-tipo)
- [Regras de Negócio](#regras-de-negócio)
- [Validações](#validações)
- [Mudanças Técnicas Realizadas](#mudanças-técnicas-realizadas)
- [Histórico de Alterações](#histórico-de-alterações)
- [Pontos para Evolução Futura](#pontos-para-evolução-futura)

---

## Visão Geral
O fluxo de cadastro de veículos foi totalmente redesenhado para garantir padronização, escalabilidade e facilidade de gestão. Agora, todos os veículos são salvos em uma coleção global `/vehicles` no Firebase Realtime Database, com classificação automática do tipo de acordo com regras de negócio claras.

---

## Campos Obrigatórios
- **Marca** (`vehicleMake`)
- **Modelo** (`vehicleModel`)
- **Ano de fabricação** (`year`)
- **Cor** (`color`)
- **Placa** (`vehicleNumber`)
- **Foto do carro** (`car_image` - Firebase Storage)
- **Documento CRLV** (`crlv_image` - Firebase Storage)
- **Tipo** (`carType` - definido automaticamente)
- **driver** (UID do motorista)
- Outros: `createdAt`, `approved`, `fleetadmin`, etc.

---

## Fluxo de Cadastro
1. **Usuário preenche:** marca, modelo, ano, cor, placa, foto do carro, documento CRLV.
2. **App classifica automaticamente** o tipo do veículo (Leaf Elite ou Leaf Plus) conforme regras abaixo.
3. **Tipo é exibido** na tela, não editável.
4. **Validação:** só permite salvar se todos os campos obrigatórios estiverem preenchidos e o veículo atender ao ano mínimo da categoria.
5. **Salvamento:** dados e imagens são enviados ao backend (Realtime Database + Storage).

---

## Classificação Automática do Tipo
- **Leaf Elite:**
  - Marca/modelo está na lista Elite (ver anexo no final deste arquivo)
  - Ano ≥ 2016
  - Cor: preto, chumbo, prata, cinza, azul marinho, marrom ou branco
  - Exceção: Volkswagen Virtus só Elite se ano ≥ 2025
- **Leaf Plus:**
  - Todos os demais modelos
  - Ano ≥ 2015
- Se não atender ao mínimo, exibe mensagem de erro e impede o cadastro.
- O tipo é exibido automaticamente na tela, não podendo ser editado pelo motorista.

---

## Regras de Negócio
- **Ar-condicionado e 4 portas:**
  - Não são perguntados no app, mas serão verificados manualmente na análise do CRLV.
- **Aprovação manual:**
  - Após o envio, o veículo fica “em análise” até a equipe validar os documentos e requisitos.
- **Só um veículo ativo por placa:**
  - (Preparado para implementar, se necessário)

---

## Validações
- Todos os campos obrigatórios devem ser preenchidos.
- Ano deve ser numérico e ter 4 dígitos.
- Cor deve ser preenchida.
- Imagens obrigatórias.
- O cadastro só é permitido se o veículo atender ao ano mínimo da categoria.
- Mensagens de erro claras são exibidas ao usuário em caso de não conformidade.

---

## Mudanças Técnicas Realizadas
- Refatoração das actions e reducers para usar a estrutura global `/vehicles`.
- Adição de campos obrigatórios e validação no frontend.
- Implementação da lógica de classificação automática do tipo.
- Upload de duas imagens (carro e CRLV) para o Storage.
- Exibição do tipo de veículo na tela de cadastro.
- Mensagens de erro e feedbacks claros para o usuário.
- Garantia de compatibilidade com o backend (Firebase).
- Remoção de campos desnecessários e simplificação do fluxo para o motorista.

---

## Histórico de Alterações (desde 2024-06-07)
- **Migração da estrutura de carros para veículos globais** (`/vehicles`)
- **Adição dos campos obrigatórios:** ano, cor, CRLV
- **Upload de CRLV:** campo e validação obrigatória
- **Classificação automática do tipo:** lógica baseada em marca/modelo/ano/cor
- **Exibição do tipo na tela:** não editável pelo usuário
- **Validação de ano mínimo:** 2015 para Plus, 2016 para Elite (exceto Virtus)
- **Mensagens de erro claras** para cada regra de negócio
- **Preparação para análise manual de ar-condicionado e portas**
- **Documentação detalhada do fluxo e regras**

---

## Pontos para Evolução Futura
- Implementar lógica para garantir apenas uma placa ativa por vez.
- Adicionar painel de aprovação/reprovação de veículos no admin.
- Exibir status do veículo (“em análise”, “aprovado”, “recusado”, etc) para o motorista.
- Adicionar logs de auditoria para alterações de status.
- Automatizar validação de ar-condicionado e portas via OCR do CRLV (futuro).

---

## Anexo: Lista de Modelos Leaf Elite
(Ver código fonte para lista completa de marca/modelo)

---

*Documentação gerada automaticamente em 2024-06-08.* 