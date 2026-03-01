import { test, expect } from '@playwright/test';

test.describe('Fluxo do Passageiro', () => {

    test('Deve solicitar uma corrida Web', async ({ page }) => {
        test.setTimeout(120000);

        await page.goto('/');

        const phoneInput = page.getByPlaceholder('(99) 99999-9999').first();
        if (await phoneInput.isVisible({ timeout: 15000 })) {
            await phoneInput.fill('11999999999');
            await phoneInput.blur();
            await page.waitForTimeout(2000);
            await page.getByPlaceholder('Senha').first().fill('senha123');
            await page.getByText('Entrar').first().click();
        }

        // Aguarda renderizar o botão destino
        const destBtn = page.getByText('Para onde', { exact: false }).first();
        await expect(destBtn).toBeVisible({ timeout: 30000 });
        await destBtn.click();

        // Tenta digitar destino
        const inputDestino = page.getByPlaceholder('Para onde vamos?', { exact: false }).first();
        if (await inputDestino.isVisible()) {
            await inputDestino.fill('Avenida Paulista');
        } else {
            // Fallback se o placeholder for outro
            await page.keyboard.type('Avenida Paulista');
        }

        // Clica na sugestão
        await expect(page.getByText('Avenida Paulista', { exact: false }).first()).toBeVisible({ timeout: 10000 });
        await page.getByText('Avenida Paulista', { exact: false }).first().click();

        // Clica no botão de Agendar/Confirmar
        await expect(page.getByText('Solicitar', { exact: false }).first()).toBeVisible({ timeout: 15000 });
        await page.getByText('Solicitar', { exact: false }).first().click();

        // Garante que pulou a tela do Woovi e caiu direito no radar do WebSocket
        await expect(page.getByText('Buscando motoristas', { exact: false }).first()).toBeVisible({ timeout: 20000 });
    });

});
