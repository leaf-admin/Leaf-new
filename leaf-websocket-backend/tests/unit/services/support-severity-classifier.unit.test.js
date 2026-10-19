const {
  classifySupportTicketSeverity
} = require('../../../services/support-severity-classifier');

describe('support-severity-classifier', () => {
  it('classifies safety and emergency language as N1', () => {
    expect(classifySupportTicketSeverity({
      subject: 'Emergência na corrida',
      description: 'O motorista me ameaçou e estou em risco de vida.',
      category: 'general',
      requestedPriority: 'N3'
    })).toMatchObject({
      priority: 'N1',
      severity: 'critical',
      prioritySource: 'classifier'
    });
  });

  it('classifies payment and refund problems as at least N2', () => {
    expect(classifySupportTicketSeverity({
      subject: 'Pix pago',
      description: 'Paguei e a corrida ficou travada, preciso de reembolso.',
      category: 'payment',
      requestedPriority: 'N3'
    })).toMatchObject({
      priority: 'N2',
      severity: 'elevated'
    });
  });

  it('does not trust app user priority inflation without matching severity evidence', () => {
    expect(classifySupportTicketSeverity({
      subject: 'Dúvida sobre perfil',
      description: 'Gostaria de trocar meu nome no cadastro.',
      category: 'account',
      requestedPriority: 'N1'
    })).toMatchObject({
      priority: 'N3',
      requestedPriority: 'N1',
      requestedPriorityTrusted: false
    });
  });

  it('preserves trusted operator priority when it is stricter than the classifier', () => {
    expect(classifySupportTicketSeverity({
      subject: 'Revisão manual',
      description: 'Operador marcou para acompanhamento prioritário.',
      category: 'general',
      requestedPriority: 'N1',
      requesterIsAgent: true
    })).toMatchObject({
      priority: 'N1',
      requestedPriorityTrusted: true,
      prioritySource: 'trusted_requested_priority'
    });
  });

  describe('resolution class (A-D)', () => {
    const classify = (subject, description, category = 'general', extra = {}) => (
      classifySupportTicketSeverity({ subject, description, category, ...extra })
    );

    it('lets the bot answer plain how-to and status questions', () => {
      expect(classify('Recibo', 'Como vejo o recibo da minha última corrida?')).toMatchObject({
        resolutionClass: 'A',
        resolutionOwner: 'bot',
        autoReplyAllowed: true
      });
      expect(classify('Saldo', 'Como faço o saque do meu saldo?', 'account')).toMatchObject({
        resolutionClass: 'A'
      });
    });

    it('sends reported app bugs to triage as B', () => {
      expect(classify('App', 'A tela de pagamento fica branca e não carrega', 'technical')).toMatchObject({
        resolutionClass: 'B',
        resolutionOwner: 'bot_ota_fix',
        autoReplyAllowed: false
      });
    });

    it('keeps money, safety, KYC disputes, legal and blocks with the owner', () => {
      const cases = [
        classify('Emergência', 'O motorista me ameaçou'),
        classify('Pix', 'Quero saber se o pix caiu', 'payment'),
        classify('Cobrança', 'Fui cobrado duas vezes, quero estorno'),
        classify('Saque', 'Meu saque não caiu na conta'),
        classify('Documento', 'Minha CNH foi recusada e está certa'),
        classify('Conta', 'Minha conta foi bloqueada sem motivo', 'account'),
        classify('LGPD', 'Vou acionar o Procon e um advogado')
      ];
      cases.forEach((result) => {
        expect(result).toMatchObject({
          resolutionClass: 'D',
          resolutionOwner: 'owner_decision',
          autoReplyAllowed: false
        });
      });
    });

    it('only trusted sources can raise the class, and never lower it', () => {
      expect(classify('Recibo', 'Onde vejo meu recibo?', 'general', {
        metadata: { resolutionClass: 'D' }
      }).resolutionClass).toBe('A');

      expect(classify('Recibo', 'Onde vejo meu recibo?', 'general', {
        metadata: { source: 'support_agent', resolutionClass: 'C' }
      })).toMatchObject({
        resolutionClass: 'C',
        resolutionOwner: 'bot_backend_fix'
      });

      expect(classify('Cobrança', 'Quero estorno', 'general', {
        metadata: { source: 'support_agent', resolutionClass: 'A' }
      }).resolutionClass).toBe('D');
    });
  });
});
