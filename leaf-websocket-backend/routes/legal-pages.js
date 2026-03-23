const express = require('express');

const router = express.Router();

const brandColor = '#111111';
const mutedColor = '#555555';
const backgroundColor = '#f7f7f8';

function getBaseUrl(req) {
  const forwardedProto = req.headers['x-forwarded-proto'];
  const protocol = forwardedProto || req.protocol || 'https';
  return `${protocol}://${req.get('host')}`;
}

function renderPage({ title, subtitle, sections, req }) {
  const content = sections
    .map((section) => `
      <section>
        <h2>${section.title}</h2>
        ${section.paragraphs.map((paragraph) => `<p>${paragraph}</p>`).join('\n')}
      </section>
    `)
    .join('\n');

  return `<!doctype html>
<html lang="pt-BR">
<head>
  <meta charset="utf-8" />
  <meta name="viewport" content="width=device-width, initial-scale=1" />
  <title>${title} | Leaf</title>
  <style>
    :root { color-scheme: light; }
    * { box-sizing: border-box; }
    body {
      margin: 0;
      font-family: -apple-system, BlinkMacSystemFont, "Segoe UI", Roboto, Helvetica, Arial, sans-serif;
      background: ${backgroundColor};
      color: ${brandColor};
      line-height: 1.5;
    }
    main {
      max-width: 860px;
      margin: 0 auto;
      padding: 32px 20px 48px;
    }
    h1 {
      margin: 0 0 8px;
      font-size: 30px;
      line-height: 1.15;
    }
    .subtitle {
      margin: 0 0 28px;
      color: ${mutedColor};
      font-size: 15px;
    }
    section {
      background: #fff;
      border: 1px solid #e7e8ea;
      border-radius: 14px;
      padding: 18px;
      margin-bottom: 14px;
      box-shadow: 0 8px 18px rgba(0,0,0,0.05);
    }
    h2 {
      margin: 0 0 10px;
      font-size: 19px;
    }
    p {
      margin: 0 0 10px;
      color: #202225;
      font-size: 15px;
    }
    p:last-child { margin-bottom: 0; }
    footer {
      margin-top: 24px;
      color: ${mutedColor};
      font-size: 13px;
    }
    a {
      color: #0b57d0;
      text-decoration: none;
    }
    a:hover {
      text-decoration: underline;
    }
  </style>
</head>
<body>
  <main>
    <h1>${title}</h1>
    <p class="subtitle">${subtitle}</p>
    ${content}
    <footer>
      Leaf Tecnologia e Mobilidade. Última atualização: ${new Date().toLocaleDateString('pt-BR')}.<br />
      Contato: <a href="mailto:suporte@leaf.app.br">suporte@leaf.app.br</a><br />
      Base pública: <a href="${getBaseUrl(req)}">${getBaseUrl(req)}</a>
    </footer>
  </main>
</body>
</html>`;
}

router.get('/privacy-policy', (req, res) => {
  res.type('html').send(
    renderPage({
      title: 'Política de Privacidade',
      subtitle: 'Como coletamos, tratamos, armazenamos e protegemos os dados pessoais na plataforma Leaf.',
      req,
      sections: [
        {
          title: '1. Dados coletados',
          paragraphs: [
            'Coletamos dados de cadastro (como nome, telefone, e-mail e CPF quando aplicável), dados de localização durante o uso e dados transacionais necessários para operação de corridas e suporte.',
            'No caso de motoristas, coletamos dados adicionais de validação documental e conformidade regulatória.'
          ]
        },
        {
          title: '2. Finalidades de uso',
          paragraphs: [
            'Utilizamos os dados para autenticação, segurança da plataforma, despacho de corridas, prevenção a fraudes, suporte, cumprimento de obrigações legais e melhoria contínua do serviço.',
            'Não comercializamos dados pessoais.'
          ]
        },
        {
          title: '3. Compartilhamento e retenção',
          paragraphs: [
            'Compartilhamos dados apenas com operadores e fornecedores essenciais à prestação do serviço, respeitando bases legais e controles contratuais adequados.',
            'A retenção ocorre pelo prazo necessário ao cumprimento da finalidade e exigências legais aplicáveis.'
          ]
        },
        {
          title: '4. Direitos do titular',
          paragraphs: [
            'Você pode solicitar acesso, correção, portabilidade, eliminação e revisão de tratamento conforme LGPD.',
            'Solicitações podem ser feitas pelo aplicativo ou por e-mail de suporte.'
          ]
        },
        {
          title: '5. Segurança e contato',
          paragraphs: [
            'Adotamos controles técnicos e organizacionais para mitigar acesso indevido, uso indevido e vazamentos de dados.',
            'Em caso de dúvidas, contate suporte@leaf.app.br.'
          ]
        }
      ]
    })
  );
});

router.get('/terms-of-service', (req, res) => {
  res.type('html').send(
    renderPage({
      title: 'Termos de Serviço',
      subtitle: 'Condições de uso da plataforma Leaf para passageiros e motoristas.',
      req,
      sections: [
        {
          title: '1. Aceite e elegibilidade',
          paragraphs: [
            'Ao usar o aplicativo, você concorda com estes termos e com a política de privacidade.',
            'O uso da plataforma depende de cadastro válido e cumprimento das regras operacionais.'
          ]
        },
        {
          title: '2. Uso da plataforma',
          paragraphs: [
            'O usuário deve fornecer informações verdadeiras, manter a conta segura e utilizar o serviço de forma lícita.',
            'A Leaf pode limitar, suspender ou encerrar contas em caso de fraude, abuso ou violação contratual.'
          ]
        },
        {
          title: '3. Pagamentos e cobrança',
          paragraphs: [
            'As corridas seguem regras de precificação exibidas no app. No momento, o meio eletrônico principal é PIX.',
            'Taxas, políticas de cancelamento e ajustes operacionais podem variar conforme cidade e disponibilidade.'
          ]
        },
        {
          title: '4. Segurança e responsabilidade',
          paragraphs: [
            'Passageiros e motoristas devem seguir as regras de segurança, legislação de trânsito e condutas da comunidade Leaf.',
            'A Leaf poderá revisar eventos e tomar medidas para proteger a operação e os usuários.'
          ]
        },
        {
          title: '5. Alterações e suporte',
          paragraphs: [
            'Podemos atualizar estes termos periodicamente. Alterações relevantes serão comunicadas no aplicativo.',
            'Dúvidas podem ser enviadas para suporte@leaf.app.br.'
          ]
        }
      ]
    })
  );
});

router.get('/account-deletion', (req, res) => {
  const baseUrl = getBaseUrl(req);
  const appDeleteEndpoint = `${baseUrl}/api/account/delete`;

  res.type('html').send(
    renderPage({
      title: 'Exclusão de Conta',
      subtitle: 'Instruções para exclusão da conta e dados pessoais conforme LGPD.',
      req,
      sections: [
        {
          title: '1. Exclusão pelo aplicativo',
          paragraphs: [
            'No aplicativo Leaf, acesse a seção de privacidade e selecione a opção de exclusão de dados/conta.',
            'A solicitação exige autenticação ativa da conta.'
          ]
        },
        {
          title: '2. Exclusão via suporte',
          paragraphs: [
            'Você também pode solicitar exclusão pelo e-mail suporte@leaf.app.br, informando o telefone da conta e o motivo da solicitação.',
            'A equipe poderá solicitar confirmação adicional para segurança.'
          ]
        },
        {
          title: '3. Endpoint oficial',
          paragraphs: [
            `Endpoint de backend utilizado pela aplicação: ${appDeleteEndpoint}.`,
            'Após a solicitação, a conta é desabilitada e o processo de remoção de dados segue a política de retenção legal.'
          ]
        }
      ]
    })
  );
});

router.get('/api/legal/links', (req, res) => {
  const baseUrl = getBaseUrl(req);
  res.json({
    privacyPolicyUrl: `${baseUrl}/privacy-policy`,
    termsOfServiceUrl: `${baseUrl}/terms-of-service`,
    accountDeletionUrl: `${baseUrl}/account-deletion`
  });
});

module.exports = router;
