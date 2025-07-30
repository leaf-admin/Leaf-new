#!/usr/bin/env node

const puppeteer = require('puppeteer');
const fs = require('fs');
const path = require('path');

// Configurações das telas
const screens = {
  splash: {
    name: 'Splash Screen',
    html: `
      <!DOCTYPE html>
      <html>
      <head>
        <meta charset="UTF-8">
        <meta name="viewport" content="width=device-width, initial-scale=1.0">
        <title>Leaf - Splash</title>
        <style>
          * { margin: 0; padding: 0; box-sizing: border-box; }
          body {
            width: 375px;
            height: 812px;
            background: linear-gradient(135deg, #06113C 0%, #DDDEEE 100%);
            display: flex;
            flex-direction: column;
            align-items: center;
            justify-content: center;
            font-family: 'Inter', sans-serif;
            color: white;
          }
          .logo {
            width: 120px;
            height: 120px;
            background: #41D274;
            border-radius: 60px;
            display: flex;
            align-items: center;
            justify-content: center;
            font-size: 48px;
            margin-bottom: 40px;
          }
          .loading {
            font-size: 16px;
            margin-bottom: 20px;
          }
          .spinner {
            width: 24px;
            height: 24px;
            border: 2px solid rgba(255,255,255,0.3);
            border-top: 2px solid white;
            border-radius: 50%;
            animation: spin 1s linear infinite;
          }
          @keyframes spin {
            0% { transform: rotate(0deg); }
            100% { transform: rotate(360deg); }
          }
        </style>
      </head>
      <body>
        <div class="logo">🍃</div>
        <div class="loading">Loading...</div>
        <div class="spinner"></div>
      </body>
      </html>
    `
  },
  welcome: {
    name: 'Welcome Screen',
    html: `
      <!DOCTYPE html>
      <html>
      <head>
        <meta charset="UTF-8">
        <meta name="viewport" content="width=device-width, initial-scale=1.0">
        <title>Leaf - Welcome</title>
        <style>
          * { margin: 0; padding: 0; box-sizing: border-box; }
          body {
            width: 375px;
            height: 812px;
            background: white;
            display: flex;
            flex-direction: column;
            align-items: center;
            font-family: 'Inter', sans-serif;
            color: #06113C;
          }
          .logo {
            width: 80px;
            height: 80px;
            background: #41D274;
            border-radius: 40px;
            display: flex;
            align-items: center;
            justify-content: center;
            font-size: 32px;
            margin-top: 120px;
            margin-bottom: 40px;
          }
          .title {
            font-size: 24px;
            font-weight: bold;
            margin-bottom: 16px;
          }
          .subtitle {
            font-size: 16px;
            color: #666666;
            margin-bottom: 120px;
          }
          .button {
            background: #06113C;
            color: white;
            padding: 16px 24px;
            border-radius: 8px;
            font-size: 16px;
            font-weight: 600;
            border: none;
            cursor: pointer;
            width: 280px;
            height: 48px;
          }
        </style>
      </head>
      <body>
        <div class="logo">🍃</div>
        <div class="title">BEM VINDO A</div>
        <div class="subtitle">Sua jornada começa aqui</div>
        <button class="button">COMEÇAR</button>
      </body>
      </html>
    `
  },
  profileSelection: {
    name: 'Profile Selection',
    html: `
      <!DOCTYPE html>
      <html>
      <head>
        <meta charset="UTF-8">
        <meta name="viewport" content="width=device-width, initial-scale=1.0">
        <title>Leaf - Profile Selection</title>
        <style>
          * { margin: 0; padding: 0; box-sizing: border-box; }
          body {
            width: 375px;
            height: 812px;
            background: white;
            display: flex;
            flex-direction: column;
            align-items: center;
            font-family: 'Inter', sans-serif;
            color: #06113C;
            padding: 80px 16px 0;
          }
          .title {
            font-size: 24px;
            font-weight: bold;
            margin-bottom: 40px;
            text-align: center;
          }
          .card {
            width: 320px;
            height: 120px;
            background: white;
            border: 1px solid #E0E0E0;
            border-radius: 12px;
            display: flex;
            flex-direction: column;
            align-items: center;
            justify-content: center;
            margin-bottom: 24px;
            box-shadow: 0 2px 8px rgba(0,0,0,0.1);
          }
          .card-icon {
            font-size: 48px;
            margin-bottom: 8px;
          }
          .card-title {
            font-size: 18px;
            font-weight: 600;
            margin-bottom: 4px;
          }
          .card-subtitle {
            font-size: 14px;
            color: #666666;
          }
        </style>
      </head>
      <body>
        <div class="title">Escolha seu perfil:</div>
        <div class="card">
          <div class="card-icon">👤</div>
          <div class="card-title">PASSAGEIRO</div>
          <div class="card-subtitle">Solicitar corridas</div>
        </div>
        <div class="card">
          <div class="card-icon">🚗</div>
          <div class="card-title">MOTORISTA</div>
          <div class="card-subtitle">Aceitar corridas</div>
        </div>
      </body>
      </html>
    `
  },
  mapScreen: {
    name: 'Map Screen (Passenger)',
    html: `
      <!DOCTYPE html>
      <html>
      <head>
        <meta charset="UTF-8">
        <meta name="viewport" content="width=device-width, initial-scale=1.0">
        <title>Leaf - Map Screen</title>
        <style>
          * { margin: 0; padding: 0; box-sizing: border-box; }
          body {
            width: 375px;
            height: 812px;
            background: white;
            font-family: 'Inter', sans-serif;
            color: #06113C;
          }
          .search-bar {
            position: absolute;
            top: 60px;
            left: 50%;
            transform: translateX(-50%);
            width: 320px;
            height: 48px;
            background: #F5F5F5;
            border-radius: 24px;
            display: flex;
            align-items: center;
            padding: 0 16px;
            font-size: 16px;
            color: #666666;
          }
          .map {
            position: absolute;
            top: 120px;
            left: 0;
            width: 375px;
            height: 500px;
            background: #E8F5E8;
            display: flex;
            align-items: center;
            justify-content: center;
            font-size: 18px;
            color: #41D274;
          }
          .bottom-sheet {
            position: absolute;
            bottom: 0;
            left: 0;
            width: 375px;
            height: 200px;
            background: white;
            border-radius: 20px 20px 0 0;
            padding: 20px;
          }
          .car-types {
            display: flex;
            justify-content: space-between;
            margin-bottom: 20px;
          }
          .car-type {
            width: 100px;
            height: 80px;
            background: #F5F5F5;
            border-radius: 8px;
            display: flex;
            flex-direction: column;
            align-items: center;
            justify-content: center;
          }
          .car-icon {
            font-size: 24px;
            margin-bottom: 4px;
          }
          .car-label {
            font-size: 12px;
            font-weight: 600;
          }
          .car-price {
            font-size: 14px;
            color: #41D274;
            font-weight: 600;
          }
          .request-button {
            background: #06113C;
            color: white;
            padding: 16px 24px;
            border-radius: 8px;
            font-size: 16px;
            font-weight: 600;
            border: none;
            cursor: pointer;
            width: 320px;
            height: 48px;
          }
        </style>
      </head>
      <body>
        <div class="search-bar">🔍 Buscar destino...</div>
        <div class="map">🗺️ Google Maps</div>
        <div class="bottom-sheet">
          <div class="car-types">
            <div class="car-type">
              <div class="car-icon">🚗</div>
              <div class="car-label">UberX</div>
              <div class="car-price">R$ 15,90</div>
            </div>
            <div class="car-type">
              <div class="car-icon">🚙</div>
              <div class="car-label">Comfort</div>
              <div class="car-price">R$ 25,50</div>
            </div>
            <div class="car-type">
              <div class="car-icon">🚐</div>
              <div class="car-label">Van</div>
              <div class="car-price">R$ 35,00</div>
            </div>
          </div>
          <button class="request-button">SOLICITAR CORRIDA</button>
        </div>
      </body>
      </html>
    `
  },
  driverTrips: {
    name: 'Driver Trips Screen',
    html: `
      <!DOCTYPE html>
      <html>
      <head>
        <meta charset="UTF-8">
        <meta name="viewport" content="width=device-width, initial-scale=1.0">
        <title>Leaf - Driver Trips</title>
        <style>
          * { margin: 0; padding: 0; box-sizing: border-box; }
          body {
            width: 375px;
            height: 812px;
            background: white;
            font-family: 'Inter', sans-serif;
            color: #06113C;
            padding: 60px 16px 0;
          }
          .header {
            display: flex;
            align-items: center;
            margin-bottom: 20px;
          }
          .profile {
            width: 40px;
            height: 40px;
            background: #41D274;
            border-radius: 20px;
            display: flex;
            align-items: center;
            justify-content: center;
            font-size: 16px;
            margin-right: 16px;
          }
          .user-info h3 {
            font-size: 18px;
            font-weight: 600;
            margin-bottom: 4px;
          }
          .status {
            font-size: 14px;
            color: #41D274;
          }
          .stats-card {
            width: 320px;
            height: 100px;
            background: #F5F5F5;
            border-radius: 12px;
            display: flex;
            flex-direction: column;
            align-items: center;
            justify-content: center;
            margin: 0 auto 20px;
          }
          .today-earnings {
            font-size: 24px;
            font-weight: bold;
            margin-bottom: 8px;
          }
          .stats {
            font-size: 16px;
            color: #666666;
          }
          .map {
            width: 320px;
            height: 300px;
            background: #E8F5E8;
            border-radius: 12px;
            display: flex;
            align-items: center;
            justify-content: center;
            font-size: 18px;
            color: #41D274;
            margin: 0 auto 20px;
          }
          .actions {
            display: flex;
            justify-content: space-between;
            width: 320px;
            margin: 0 auto;
          }
          .btn-primary {
            background: #06113C;
            color: white;
            padding: 16px 24px;
            border-radius: 8px;
            font-size: 16px;
            font-weight: 600;
            border: none;
            cursor: pointer;
            width: 150px;
            height: 48px;
          }
          .btn-secondary {
            background: #DDDEEE;
            color: #06113C;
            padding: 16px 24px;
            border-radius: 8px;
            font-size: 16px;
            font-weight: 600;
            border: none;
            cursor: pointer;
            width: 150px;
            height: 48px;
          }
        </style>
      </head>
      <body>
        <div class="header">
          <div class="profile">👤</div>
          <div class="user-info">
            <h3>João Silva</h3>
            <div class="status">🚗 Online</div>
          </div>
        </div>
        <div class="stats-card">
          <div class="today-earnings">HOJE: R$ 245,00</div>
          <div class="stats">8 corridas | ⭐ 4.8</div>
        </div>
        <div class="map">🗺️ Área de cobertura</div>
        <div class="actions">
          <button class="btn-primary">ACEITAR CORRIDA</button>
          <button class="btn-secondary">RECUSAR</button>
        </div>
      </body>
      </html>
    `
  }
};

async function generateScreenshots() {
  console.log('🚀 Iniciando geração de screenshots...');
  
  const browser = await puppeteer.launch({
    headless: true,
    args: ['--no-sandbox', '--disable-setuid-sandbox']
  });

  const screenshotsDir = path.join(__dirname, 'screenshots');
  if (!fs.existsSync(screenshotsDir)) {
    fs.mkdirSync(screenshotsDir);
  }

  for (const [key, screen] of Object.entries(screens)) {
    console.log(`📱 Gerando screenshot: ${screen.name}`);
    
    const page = await browser.newPage();
    await page.setViewport({ width: 375, height: 812 });
    await page.setContent(screen.html);
    
    // Aguarda um pouco para garantir que tudo carregou
    await page.waitForTimeout(1000);
    
    const screenshotPath = path.join(screenshotsDir, `${key}.png`);
    await page.screenshot({
      path: screenshotPath,
      fullPage: false
    });
    
    await page.close();
    console.log(`✅ Screenshot salvo: ${screenshotPath}`);
  }

  await browser.close();
  console.log('🎉 Todos os screenshots foram gerados!');
  console.log(`📁 Pasta: ${screenshotsDir}`);
}

// Executa o script
generateScreenshots().catch(console.error); 