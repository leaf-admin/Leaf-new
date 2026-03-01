import { test, expect } from '@playwright/test';

test.describe('Autenticação e Alternância de Papéis', () => {

    test('Deve logar como passageiro e alternar para modo motorista', async ({ page }) => {
        // Timeout global para o teste considerando que o Expo Web pode demorar no cold start
        test.setTimeout(120000);

        await page.goto('/');

        // Aguarda o React renderizar o input de telefone
        const phoneInput = page.getByPlaceholder('(99) 99999-9999').first();
        await expect(phoneInput).toBeVisible({ timeout: 60000 });

        // Insere telefone de dev
        await phoneInput.fill('11999999999');

        // Tenta desativar o foco/blur para acionar o checkPhone() do React Native
        await phoneInput.blur();

        // Aguarda o botão Entrar (Senha ativa) ou o campo de Nome (Cadastro novo) aparecerem
        // O mock checkPhone() demora um pouco
        await page.waitForTimeout(2000);

        const passwordInput = page.getByPlaceholder('Senha').first();
        const isExistingUser = await passwordInput.isVisible();

        if (isExistingUser) {
            await passwordInput.fill('senha123');
            await page.getByText('Entrar').first().click();
        } else {
            await page.getByPlaceholder('Nome completo').first().fill('Playwright Tester');
            await page.getByPlaceholder('CPF').first().fill('12345678901');
            await page.getByText('Cadastrar').first().click();
        }

        // Aguarda Dashboard (Painel de passageiro) ou o AuthLoading
        await expect(page.getByText('Para onde', { exact: false }).first()).toBeVisible({ timeout: 30000 });

        // Clica no Toggle "Passageiro" para virar "Motorista"
        await page.getByText('Passageiro').first().click();

        // Simula o alerta do React Native Web (Navegadores tratam Alert.alert como dialog)
        page.on('dialog', dialog => dialog.accept());

        // Se o Playwright lidar com um modal DOM customizado ao invés de dialog:
        const modalBtn = page.getByText('OK');
        if (await modalBtn.isVisible()) {
            await modalBtn.click();
        }

        // Verifica se a tela de motorista carregou e se o Toggle alterou para Motorista
        await expect(page.getByText('Motorista').first()).toBeVisible({ timeout: 15000 });
        await expect(page.getByText('Ficar Online', { exact: false }).first()).toBeVisible({ timeout: 15000 });
    });

});
