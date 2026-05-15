const fs = require('fs');
const path = require('path');
const { chromium } = require('playwright');

const repoRoot = path.resolve(__dirname, '..');
const outputDir = path.join(repoRoot, 'reports', 'onboarding-cadastro-screenshots');
const asset = (...parts) => path.join(repoRoot, ...parts);

function dataUri(filePath, mimeType) {
  return `data:${mimeType};base64,${fs.readFileSync(filePath).toString('base64')}`;
}

const assets = {
  background: dataUri(asset('mobile-app', 'assets', 'images', 'onboarding-city-bg-auth.png'), 'image/png'),
  poppinsRegular: dataUri(asset('mobile-app', 'assets', 'fonts', 'Poppins-Regular.ttf'), 'font/ttf'),
  poppinsMedium: dataUri(asset('mobile-app', 'assets', 'fonts', 'Poppins-Medium.ttf'), 'font/ttf'),
  poppinsSemiBold: dataUri(asset('mobile-app', 'assets', 'fonts', 'Poppins-SemiBold.ttf'), 'font/ttf'),
  poppinsBold: dataUri(asset('mobile-app', 'assets', 'fonts', 'Poppins-Bold.ttf'), 'font/ttf'),
};

const colors = {
  background: '#ECEFF2',
  surface: '#FFFFFF',
  surfaceMuted: 'rgba(255,255,255,0.78)',
  panel: 'rgba(255,255,255,0.76)',
  panelSoft: 'rgba(255,255,255,0.64)',
  border: 'rgba(15,23,34,0.10)',
  borderStrong: 'rgba(15,23,34,0.18)',
  glassStroke: 'rgba(255,255,255,0.86)',
  textPrimary: '#0F1722',
  textSecondary: '#4D5868',
  textMuted: '#8D99A8',
  accent: '#0F1722',
  accentSoft: '#E7ECF1',
  accentText: '#FFFFFF',
  error: '#B53A3A',
};

function baseCss() {
  return `
    @font-face { font-family: Poppins; font-weight: 400; src: url("${assets.poppinsRegular}") format("truetype"); }
    @font-face { font-family: Poppins; font-weight: 500; src: url("${assets.poppinsMedium}") format("truetype"); }
    @font-face { font-family: Poppins; font-weight: 600; src: url("${assets.poppinsSemiBold}") format("truetype"); }
    @font-face { font-family: Poppins; font-weight: 700; src: url("${assets.poppinsBold}") format("truetype"); }
    * { box-sizing: border-box; }
    html, body { margin: 0; width: 390px; height: 844px; overflow: hidden; }
    body {
      font-family: Poppins, Arial, sans-serif;
      color: ${colors.textPrimary};
      background: ${colors.background};
      -webkit-font-smoothing: antialiased;
    }
    .phone {
      position: relative;
      width: 390px;
      height: 844px;
      background-image:
        linear-gradient(rgba(214,224,236,0.34), rgba(214,224,236,0.34)),
        url("${assets.background}");
      background-size: cover;
      background-position: center;
      display: flex;
      align-items: center;
      justify-content: center;
      padding: 14px;
    }
    .phone::after {
      content: "";
      position: absolute;
      inset: 0;
      background: rgba(255,255,255,0.04);
      pointer-events: none;
    }
    .frame {
      position: relative;
      z-index: 1;
      width: 100%;
      max-width: 362px;
      max-height: 86%;
      min-height: 360px;
      border-radius: 34px;
      border: 1px solid rgba(255,255,255,0.86);
      background: rgba(255,255,255,0.76);
      box-shadow: 0 16px 28px rgba(14,21,34,0.24);
      overflow: hidden;
      display: flex;
    }
    .content {
      width: 100%;
      padding: 20px;
      display: flex;
      flex-direction: column;
      gap: 12px;
    }
    .content.compact { padding: 16px 20px; gap: 10px; }
    .centered { justify-content: center; }
    .header { margin-top: 4px; margin-bottom: 4px; }
    .header.center { text-align: center; }
    .rowHeader {
      display: flex;
      align-items: center;
      gap: 8px;
      margin-bottom: 2px;
    }
    .back {
      width: 32px;
      height: 32px;
      border-radius: 16px;
      border: 0;
      background: transparent;
      color: ${colors.textPrimary};
      font-size: 23px;
      line-height: 29px;
      padding: 0;
      font-family: Arial, sans-serif;
    }
    h1 {
      margin: 0;
      font-size: 22px;
      line-height: 28px;
      letter-spacing: 0;
      font-weight: 700;
    }
    .phoneTitle {
      text-align: center;
      font-size: 20px;
      line-height: 26px;
      font-weight: 600;
      margin-bottom: 8px;
    }
    .subtitle {
      margin: 8px 0 0;
      color: ${colors.textSecondary};
      font-size: 13px;
      line-height: 19px;
      font-weight: 400;
    }
    .subtitle.center {
      text-align: center;
      font-size: 14px;
      line-height: 20px;
    }
    .card, .softBlock {
      border: 1px solid ${colors.glassStroke};
      border-radius: 24px;
      background: ${colors.panelSoft};
      box-shadow: 0 12px 20px rgba(14,21,34,0.16);
      padding: 12px;
    }
    .softBlock { box-shadow: none; }
    .field { margin-bottom: 10px; }
    .field:last-child { margin-bottom: 0; }
    .label {
      display: block;
      color: ${colors.textPrimary};
      font-size: 13px;
      line-height: 18px;
      font-weight: 600;
      margin-bottom: 6px;
    }
    .input, .readonly, .selectButton {
      min-height: 46px;
      width: 100%;
      border: 1px solid ${colors.border};
      border-radius: 18px;
      background: ${colors.surfaceMuted};
      color: ${colors.textPrimary};
      padding: 11px 12px;
      font-size: 14px;
      line-height: 20px;
      font-weight: 500;
      display: flex;
      align-items: center;
      justify-content: space-between;
      letter-spacing: 0;
    }
    .readonly {
      color: ${colors.textSecondary};
      background: rgba(255,255,255,0.55);
    }
    .placeholder { color: ${colors.textMuted}; }
    .phoneInput {
      min-height: 58px;
      border-radius: 999px;
      background: rgba(255,255,255,0.84);
      border: 1px solid rgba(255,255,255,0.92);
      box-shadow: 0 12px 20px rgba(14,21,34,0.12);
      display: grid;
      grid-template-columns: 70px 1fr;
      align-items: center;
      overflow: hidden;
    }
    .country {
      height: 58px;
      display: flex;
      align-items: center;
      justify-content: center;
      border-right: 1px solid rgba(15,23,34,0.08);
      font-size: 16px;
      font-weight: 600;
    }
    .phoneNumber {
      padding: 0 16px;
      color: ${colors.textPrimary};
      font-size: 15px;
      line-height: 20px;
      font-weight: 500;
    }
    .button {
      min-height: 46px;
      border-radius: 18px;
      background: ${colors.accent};
      border: 1px solid ${colors.borderStrong};
      color: ${colors.accentText};
      display: flex;
      align-items: center;
      justify-content: center;
      font-size: 15px;
      line-height: 20px;
      font-weight: 600;
      box-shadow: 0 8px 14px rgba(14,21,34,0.14);
      margin-top: 4px;
      margin-bottom: 4px;
      width: 100%;
    }
    .button.disabled {
      background: ${colors.accentSoft};
      color: ${colors.textMuted};
      border-color: ${colors.border};
      box-shadow: 0 8px 14px rgba(14,21,34,0.06);
    }
    .link {
      color: ${colors.textSecondary};
      font-size: 13px;
      line-height: 18px;
      font-weight: 600;
      text-align: center;
      text-decoration: underline;
    }
    .hint {
      color: ${colors.textSecondary};
      font-size: 13px;
      line-height: 18px;
      font-weight: 600;
      text-align: center;
      margin: 0;
    }
    .otpGrid {
      display: grid;
      grid-template-columns: repeat(6, 1fr);
      gap: 6px;
      margin-bottom: 12px;
    }
    .otpDigit {
      height: 44px;
      max-width: 40px;
      border: 1px solid ${colors.borderStrong};
      border-radius: 12px;
      background: ${colors.surface};
      display: flex;
      align-items: center;
      justify-content: center;
      font-size: 16px;
      line-height: 20px;
      font-weight: 700;
    }
    .resend {
      display: flex;
      justify-content: center;
      gap: 4px;
      color: ${colors.textSecondary};
      font-size: 13px;
      line-height: 18px;
      font-weight: 500;
    }
    .resend strong {
      color: ${colors.textMuted};
      font-weight: 500;
    }
    .selected {
      background: ${colors.accent};
      border-color: ${colors.accent};
      color: ${colors.accentText};
    }
    .dropdownList {
      border: 1px solid ${colors.border};
      border-radius: 18px;
      overflow: hidden;
      margin-top: 6px;
      background: ${colors.surface};
    }
    .option {
      min-height: 54px;
      display: grid;
      grid-template-columns: 26px 1fr;
      gap: 8px;
      align-items: center;
      padding: 8px 12px;
      border-bottom: 1px solid ${colors.border};
    }
    .option:last-child { border-bottom: 0; }
    .option.selected {
      color: ${colors.accentText};
      background: ${colors.accent};
    }
    .optionIcon {
      font-size: 18px;
      line-height: 18px;
      width: 22px;
      text-align: center;
    }
    .optionTitle {
      font-size: 14px;
      line-height: 18px;
      font-weight: 600;
    }
    .optionDesc {
      margin-top: 1px;
      color: ${colors.textSecondary};
      font-size: 11px;
      line-height: 15px;
      font-weight: 400;
    }
    .option.selected .optionDesc { color: rgba(255,255,255,0.88); }
    .helper {
      color: ${colors.textSecondary};
      font-size: 12px;
      line-height: 16px;
      margin: 0;
      font-weight: 500;
    }
    .legalRow {
      display: flex;
      justify-content: space-between;
      gap: 12px;
      margin: 2px 0;
    }
    .legalRow span {
      color: ${colors.accent};
      font-size: 12px;
      line-height: 16px;
      font-weight: 500;
      text-decoration: underline;
      white-space: nowrap;
    }
    .checkRow {
      display: grid;
      grid-template-columns: 18px 1fr;
      gap: 8px;
      align-items: start;
      margin-bottom: 9px;
    }
    .checkRow:last-child { margin-bottom: 0; }
    .checkbox {
      width: 18px;
      height: 18px;
      border-radius: 5px;
      border: 1px solid ${colors.accent};
      background: ${colors.accent};
      color: ${colors.accentText};
      display: flex;
      align-items: center;
      justify-content: center;
      font-size: 13px;
      line-height: 13px;
      margin-top: 2px;
      font-weight: 700;
    }
    .checkLabel {
      color: ${colors.textPrimary};
      font-size: 13px;
      line-height: 18px;
      font-weight: 500;
    }
    .upload {
      border: 1px solid ${colors.glassStroke};
      border-radius: 18px;
      background: rgba(255,255,255,0.66);
      padding: 12px;
      display: grid;
      grid-template-columns: 32px 1fr;
      gap: 10px;
      align-items: center;
      margin-bottom: 10px;
    }
    .uploadIcon {
      width: 32px;
      height: 32px;
      border-radius: 16px;
      background: ${colors.accentSoft};
      display: flex;
      align-items: center;
      justify-content: center;
      color: ${colors.textPrimary};
      font-size: 16px;
      font-weight: 700;
    }
    .uploadTitle {
      font-size: 13px;
      line-height: 18px;
      font-weight: 600;
    }
    .uploadDesc {
      margin-top: 2px;
      color: ${colors.textSecondary};
      font-size: 11px;
      line-height: 15px;
      font-weight: 400;
    }
    .successChip {
      display: inline-flex;
      align-items: center;
      width: fit-content;
      margin-top: 6px;
      padding: 3px 8px;
      border-radius: 999px;
      background: rgba(26,51,14,0.09);
      color: #1A330E;
      font-size: 11px;
      line-height: 14px;
      font-weight: 600;
    }
    .twoCol {
      display: grid;
      grid-template-columns: 1fr 1fr;
      gap: 8px;
    }
    .footerBack {
      align-self: center;
      color: ${colors.textSecondary};
      font-size: 13px;
      line-height: 18px;
      font-weight: 500;
      margin-top: -2px;
    }
  `;
}

function layout(inner, className = '') {
  return `<!doctype html>
  <html lang="pt-BR">
  <head>
    <meta charset="utf-8" />
    <meta name="viewport" content="width=device-width, initial-scale=1" />
    <style>${baseCss()}</style>
  </head>
  <body>
    <main class="phone">
      <section class="frame">
        <div class="content ${className}">
          ${inner}
        </div>
      </section>
    </main>
  </body>
  </html>`;
}

function rowHeader(title) {
  return `<div class="rowHeader"><div class="back">‹</div><h1>${title}</h1></div>`;
}

function button(label, disabled = false) {
  return `<div class="button${disabled ? ' disabled' : ''}">${label}</div>`;
}

function phoneScreen() {
  return layout(`
    <div class="header center">
      <div class="phoneTitle">Bem-vindo(a) à Leaf</div>
      <p class="subtitle center">Digite seu número de telefone para continuar</p>
    </div>
    <div class="phoneInput">
      <div class="country">+55</div>
      <div class="phoneNumber">(11) 98888-7777</div>
    </div>
    <div style="margin-top:auto">
      ${button('Continuar')}
      <p class="hint">Acesso principal por OTP: informe seu telefone e toque em Continuar.</p>
      <div class="link" style="margin-top:8px">Ja tenho senha</div>
    </div>
  `, 'centered');
}

function otpScreen() {
  return layout(`
    <div class="header">
      <h1>Verificação</h1>
      <p class="subtitle">Digite o código de 6 dígitos enviado para +55 11 98888-7777</p>
    </div>
    <div class="card">
      <div class="otpGrid">
        ${['4', '8', '1', '2', '0', '6'].map((digit) => `<div class="otpDigit">${digit}</div>`).join('')}
      </div>
      ${button('Verificar')}
    </div>
    <div class="resend"><span>Não recebeu o código?</span><strong>Reenviar em 24s</strong></div>
    <div class="footerBack">Voltar</div>
  `);
}

function profileSelectionScreen(selectedRole) {
  const passengerSelected = selectedRole === 'customer';
  const driverSelected = selectedRole === 'driver';
  const selectedTitle = passengerSelected ? 'Quero viajar' : 'Quero dirigir';

  return layout(`
    <div class="header center">
      <h1>Escolha seu perfil</h1>
      <p class="subtitle center">Você pode alternar entre passageiro e motorista no app depois.</p>
    </div>
    <div class="card">
      <div class="selectButton selected"><span>${selectedTitle}</span><span>⌄</span></div>
      <div class="dropdownList">
        <div class="option${passengerSelected ? ' selected' : ''}">
          <div class="optionIcon">▱</div>
          <div>
            <div class="optionTitle">Quero viajar</div>
            <div class="optionDesc">Solicite viagens com experiência premium</div>
          </div>
        </div>
        <div class="option${driverSelected ? ' selected' : ''}">
          <div class="optionIcon">⌁</div>
          <div>
            <div class="optionTitle">Quero dirigir</div>
            <div class="optionDesc">Dirija com a Leaf e receba por corrida</div>
          </div>
        </div>
      </div>
    </div>
    ${button('Continuar')}
    <div class="footerBack">Voltar</div>
  `);
}

function passengerDataScreen() {
  return layout(`
    ${rowHeader('Seus dados')}
    <p class="subtitle">Seu login continua sendo por telefone. E-mail e senha abaixo são opcionais para recibos e acesso mais rápido.</p>
    <div class="card">
      <div class="field">
        <span class="label">Nome completo *</span>
        <div class="input">Ana Passageira</div>
      </div>
      <div class="field">
        <span class="label">E-mail (opcional)</span>
        <div class="input">ana@exemplo.com</div>
      </div>
      <div class="twoCol">
        <div class="field">
          <span class="label">Senha (opcional)</span>
          <div class="input">••••••••</div>
        </div>
        <div class="field">
          <span class="label">Confirmar senha</span>
          <div class="input">••••••••</div>
        </div>
      </div>
      <p class="helper">Login sempre por telefone. Definir senha agora acelera os próximos acessos.</p>
      <div class="legalRow"><span>Ler Termos de Uso</span><span>Ler Política de Privacidade</span></div>
      <div class="softBlock">
        <div class="checkRow"><div class="checkbox">✓</div><div class="checkLabel">Aceito os Termos de Uso *</div></div>
        <div class="checkRow"><div class="checkbox">✓</div><div class="checkLabel">Aceito a Política de Privacidade *</div></div>
      </div>
    </div>
    ${button('Continuar')}
  `, 'compact');
}

function driverCnhPendingScreen() {
  return layout(`
    ${rowHeader('Validação da CNH')}
    <p class="subtitle">Envie a CNH Digital em PDF para seguir para os consentimentos. O documento do veículo pode ser enviado depois.</p>
    <div class="card">
      <div class="upload">
        <div class="uploadIcon">PDF</div>
        <div>
          <div class="uploadTitle">CNH Digital (PDF) *</div>
          <div class="uploadDesc">Toque para enviar o PDF da CNH</div>
        </div>
      </div>
      <div class="field">
        <span class="label">CPF (extraído automaticamente)</span>
        <div class="readonly">Será preenchido após ler a CNH</div>
      </div>
      <div class="field">
        <span class="label">Data de nascimento (extraída automaticamente)</span>
        <div class="readonly">Será preenchida após ler a CNH</div>
      </div>
      <div class="field">
        <span class="label">Nome da mãe (extraído automaticamente)</span>
        <div class="readonly">Será preenchido após ler a CNH</div>
      </div>
    </div>
    ${button('Continuar', true)}
  `, 'compact');
}

function driverCnhExtractedScreen() {
  return layout(`
    ${rowHeader('Validação da CNH')}
    <p class="subtitle">Envie a CNH Digital em PDF para seguir para os consentimentos. O documento do veículo pode ser enviado depois.</p>
    <div class="card">
      <div class="upload">
        <div class="uploadIcon">PDF</div>
        <div>
          <div class="uploadTitle">CNH Digital (PDF) *</div>
          <div class="uploadDesc">cnh-digital-maria.pdf</div>
          <div class="successChip">Dados extraídos</div>
        </div>
      </div>
      <div class="twoCol">
        <div class="field">
          <span class="label">CPF</span>
          <div class="readonly">123.456.789-09</div>
        </div>
        <div class="field">
          <span class="label">Nascimento</span>
          <div class="readonly">12/04/1990</div>
        </div>
      </div>
      <div class="field">
        <span class="label">Nome da mãe</span>
        <div class="readonly">Claudia Souza</div>
      </div>
      <div class="field">
        <span class="label">Gênero</span>
        <div class="readonly">Feminino</div>
      </div>
      <div class="upload">
        <div class="uploadIcon">CAR</div>
        <div>
          <div class="uploadTitle">Documento do Veículo (PDF)</div>
          <div class="uploadDesc">Enviar agora ou deixar para o cadastro do 1º veículo</div>
        </div>
      </div>
    </div>
    ${button('Continuar')}
  `, 'compact');
}

function driverConsentsScreen() {
  return layout(`
    ${rowHeader('Finalizar cadastro')}
    <p class="subtitle">Revise e confirme os consentimentos obrigatórios para ativação do motorista.</p>
    <div class="legalRow"><span>Ler Termos de Uso</span><span>Ler Política de Privacidade</span></div>
    <div class="card">
      <div class="checkRow"><div class="checkbox">✓</div><div class="checkLabel">Aceito os Termos de Uso *</div></div>
      <div class="checkRow"><div class="checkbox">✓</div><div class="checkLabel">Aceito a Política de Privacidade *</div></div>
      <div class="checkRow"><div class="checkbox">✓</div><div class="checkLabel">Autorizo checagem de antecedentes criminais e validação regulatória *</div></div>
      <div class="checkRow"><div class="checkbox">✓</div><div class="checkLabel">Aceito receber comunicações promocionais (opcional)</div></div>
    </div>
    ${button('Concluir')}
  `);
}

function driverEmailScreen() {
  return layout(`
    ${rowHeader('Contato por e-mail')}
    <p class="subtitle">Adicione seu e-mail para recibos de saque, notificações do sistema e informe de rendimentos. Você pode pular e preencher depois.</p>
    <div class="card">
      <div class="field">
        <span class="label">E-mail (opcional por agora)</span>
        <div class="input">maria.motorista@exemplo.com</div>
      </div>
    </div>
    ${button('Finalizar cadastro')}
    <div class="footerBack">Preencher depois</div>
  `);
}

const screenshots = [
  {
    flow: 'passenger',
    file: '01-telefone.png',
    title: 'Telefone',
    html: phoneScreen,
  },
  {
    flow: 'passenger',
    file: '02-otp.png',
    title: 'OTP',
    html: otpScreen,
  },
  {
    flow: 'passenger',
    file: '03-escolha-perfil-passageiro.png',
    title: 'Escolha de perfil - passageiro',
    html: () => profileSelectionScreen('customer'),
  },
  {
    flow: 'passenger',
    file: '04-dados-passageiro.png',
    title: 'Dados do passageiro',
    html: passengerDataScreen,
  },
  {
    flow: 'driver',
    file: '01-telefone.png',
    title: 'Telefone',
    html: phoneScreen,
  },
  {
    flow: 'driver',
    file: '02-otp.png',
    title: 'OTP',
    html: otpScreen,
  },
  {
    flow: 'driver',
    file: '03-escolha-perfil-motorista.png',
    title: 'Escolha de perfil - motorista',
    html: () => profileSelectionScreen('driver'),
  },
  {
    flow: 'driver',
    file: '04-cnh-pendente.png',
    title: 'CNH antes do upload',
    html: driverCnhPendingScreen,
  },
  {
    flow: 'driver',
    file: '05-cnh-extraida.png',
    title: 'CNH extraída',
    html: driverCnhExtractedScreen,
  },
  {
    flow: 'driver',
    file: '06-consentimentos-motorista.png',
    title: 'Consentimentos do motorista',
    html: driverConsentsScreen,
  },
  {
    flow: 'driver',
    file: '07-email-motorista.png',
    title: 'Contato por e-mail do motorista',
    html: driverEmailScreen,
  },
];

function htmlEscape(value) {
  return String(value)
    .replaceAll('&', '&amp;')
    .replaceAll('<', '&lt;')
    .replaceAll('>', '&gt;')
    .replaceAll('"', '&quot;');
}

function writeIndex(manifest) {
  const sections = ['passenger', 'driver'].map((flow) => {
    const title = flow === 'passenger' ? 'Passageiro' : 'Motorista';
    const items = manifest
      .filter((item) => item.flow === flow)
      .map((item) => `
        <figure>
          <img src="${flow}/${htmlEscape(item.file)}" alt="${htmlEscape(item.title)}" />
          <figcaption>${htmlEscape(item.file)}<br><span>${htmlEscape(item.title)}</span></figcaption>
        </figure>
      `)
      .join('');

    return `<section><h2>${title}</h2><div class="grid">${items}</div></section>`;
  }).join('');

  const html = `<!doctype html>
  <html lang="pt-BR">
  <head>
    <meta charset="utf-8" />
    <title>Leaf - Prints mockados de cadastro</title>
    <style>
      body { margin: 0; padding: 32px; background: #F3F6F8; color: #0F1722; font-family: Arial, sans-serif; }
      h1 { margin: 0 0 8px; font-size: 24px; }
      p { margin: 0 0 24px; color: #4D5868; }
      h2 { margin: 28px 0 16px; font-size: 18px; }
      .grid { display: grid; grid-template-columns: repeat(auto-fill, minmax(195px, 1fr)); gap: 18px; }
      figure { margin: 0; background: white; border: 1px solid rgba(15,23,34,0.10); border-radius: 12px; padding: 10px; box-shadow: 0 10px 24px rgba(14,21,34,0.08); }
      img { width: 100%; border-radius: 10px; display: block; }
      figcaption { margin-top: 8px; font-size: 12px; line-height: 16px; color: #0F1722; }
      figcaption span { color: #4D5868; }
    </style>
  </head>
  <body>
    <h1>Leaf - Prints mockados de cadastro</h1>
    <p>Renderizados em viewport 390x844 com copy e ordem baseadas em mobile-app/src/components/auth/AuthFlow.js.</p>
    ${sections}
  </body>
  </html>`;

  fs.writeFileSync(path.join(outputDir, 'index.html'), html);
}

function writeReadme(manifest) {
  const lines = [
    '# Prints mockados do onboarding de cadastro',
    '',
    'Gerados em viewport 390x844, usando o asset de fundo e fontes do app.',
    '',
    'Fonte de verdade usada para a ordem/copy: `mobile-app/src/components/auth/AuthFlow.js` e componentes em `mobile-app/src/components/auth/steps/`.',
    '',
    '## Passageiro',
    ...manifest
      .filter((item) => item.flow === 'passenger')
      .map((item) => `- \`passenger/${item.file}\` - ${item.title}`),
    '',
    '## Motorista',
    ...manifest
      .filter((item) => item.flow === 'driver')
      .map((item) => `- \`driver/${item.file}\` - ${item.title}`),
    '',
    'Observação: o fluxo de passageiro finaliza no step "Seus dados"; o fluxo de motorista pula o nome manual, extrai dados da CNH e segue para consentimentos e e-mail opcional.',
    '',
  ];
  fs.writeFileSync(path.join(outputDir, 'README.md'), `${lines.join('\n')}`);
}

async function launchBrowser() {
  try {
    return await chromium.launch({ headless: true });
  } catch (error) {
    return await chromium.launch({ headless: true, channel: 'chrome' });
  }
}

async function main() {
  fs.rmSync(outputDir, { recursive: true, force: true });
  fs.mkdirSync(path.join(outputDir, 'passenger'), { recursive: true });
  fs.mkdirSync(path.join(outputDir, 'driver'), { recursive: true });

  const browser = await launchBrowser();
  const page = await browser.newPage({
    viewport: { width: 390, height: 844 },
    deviceScaleFactor: 2,
    isMobile: true,
  });

  const manifest = [];
  for (const screen of screenshots) {
    const html = screen.html();
    await page.setContent(html, { waitUntil: 'networkidle' });
    await page.evaluate(() => document.fonts && document.fonts.ready);
    const outPath = path.join(outputDir, screen.flow, screen.file);
    await page.screenshot({ path: outPath, fullPage: false });
    manifest.push({
      flow: screen.flow,
      file: screen.file,
      title: screen.title,
      path: path.relative(outputDir, outPath),
    });
  }

  await browser.close();

  fs.writeFileSync(path.join(outputDir, 'manifest.json'), JSON.stringify(manifest, null, 2));
  writeIndex(manifest);
  writeReadme(manifest);

  console.log(`Generated ${manifest.length} screenshots in ${outputDir}`);
}

main().catch((error) => {
  console.error(error);
  process.exit(1);
});
