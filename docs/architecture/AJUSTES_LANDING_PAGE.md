# 🎨 AJUSTES POSSÍVEIS NA LANDING PAGE

## 📁 **ARQUIVOS PRINCIPAIS PARA EDITAR**

### 1. **Hero Section** (`web-app/src/components/Hero.js`)
- **Linha 49-50**: Título principal
- **Linha 54-58**: Subtítulo
- **Linha 60-84**: Botão CTA

### 2. **Section - Tipos de Carro** (`web-app/src/components/Section.js`)
- **Linha 93**: Imagem do carro
- **Linha 94**: Nome do carro
- **Linha 99-104**: Preços e informações

### 3. **Section - Benefícios** (`web-app/src/components/Section.js`)
- **Linha 45-58**: Itens da seção 1
- **Linha 59-72**: Itens da seção 2

### 4. **Download Section** (`web-app/src/components/Download.js`)
- **Linha 22-24**: Título e descrição
- **Linha 28-34**: Links das lojas

### 5. **Header** (`web-app/src/components/Header/Header.js`)
- **Linha 70-72**: Logo

### 6. **Footer** (`web-app/src/components/Footer/HomeFooter.js`)
- **Linha 38-92**: Links do footer

### 7. **Cores** (`web-app/src/components/Theme/WebTheme.js`)
- Personalizar cores do tema

### 8. **Traduções** (`web-app/public/locales/`)
- Português: `pt.json`
- Inglês: `en.json`
- Adicione mais idiomas conforme necessário

---

## 🎨 **IMAGENS PARA PERSONALIZAR**

### Localização: `web-app/src/assets/img/`

1. **Logo**
   - `logo138x75white.png` - Logo branco (header inicial)
   - `logo138x75black.png` - Logo preto (após scroll)

2. **Hero**
   - `background.jpg` - Imagem de fundo do hero

3. **Section**
   - `back.png` - Imagem de fundo da seção de benefícios

4. **Download**
   - `handsonmobile.jpg` - Mão segurando celular

5. **Badges das Lojas**
   - `appstore.png` - Badge App Store
   - `playstore.png` - Badge Google Play Store

6. **Imagens dos Carros**
   - Configuradas no Firebase/Backend
   - Campo `image` em cada tipo de carro

---

## 🔧 **COMO FAZER AJUSTES**

### 1. **Alterar Textos**
```javascript
// Em Hero.js, linha 51
{t('book_your_title')} // Tradução
```

### 2. **Alterar Cores**
```javascript
// Em WebTheme.js
export const colors = {
  CAR_BOX_ODD: '#cor1',
  CAR_BOX_EVEN: '#cor2',
  // ...
}
```

### 3. **Alterar Imagens**
- Substitua os arquivos em `web-app/src/assets/img/`
- Mantenha o mesmo nome e formato

### 4. **Alterar Layout**
- Edite os componentes React
- Use Material-UI Grid para layout
- React atualiza automaticamente no navegador

---

## 🚀 **SERVIDOR RODANDO EM**
http://localhost:3000

**O que você quer ajustar?**


