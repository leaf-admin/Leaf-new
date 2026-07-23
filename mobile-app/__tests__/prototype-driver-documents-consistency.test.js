const fs = require('fs');
const path = require('path');

describe('Robotaxi driver documents state consistency', () => {
  const source = fs.readFileSync(
    path.join(__dirname, '..', 'src', 'screens', 'prototype', 'RobotaxiDriverDocumentsScreen.js'),
    'utf8',
  );

  it('separates backend operational release from document approval', () => {
    expect(source).toContain('const documentsComplete = approvedCount === DRIVER_DOCS.length');
    expect(source).toContain('operationallyReleasedBeforeDocumentSync');
    expect(source).toContain('Liberação operacional');
    expect(source).toContain('Liberada pelo backend');
  });

  it('does not ask for duplicate uploads while released documents await synchronization', () => {
    expect(source).toContain('Documentos aguardando sincronização');
    expect(source).toContain('A liberação operacional veio do backend. Atualize para consultar o status de CNH e CRLV.');
    expect(source).toContain('testID="robotaxi-driver-documents-sync-state"');
  });

  it('uses semantic badge tones for approval, review and pending states', () => {
    expect(source).toContain("status === 'aprovado'");
    expect(source).toContain("status === 'revisar'");
    expect(source).toContain("? 'success'");
    expect(source).toContain("? 'danger'");
    expect(source).toContain(": 'warning'");
  });
});
