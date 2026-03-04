const ReceiptService = require('./services/receipt-service');
const fs = require('fs');
const path = require('path');

async function runTest() {
    const service = new ReceiptService();

    // Mock ride data
    const mockRideId = 'TEST-555';
    const mockRideData = {
        tripStartTime: new Date(Date.now() - 3600000).toISOString(),
        endTime: new Date().toISOString(),
        pickup: { add: 'Av Paulista, 1000 - Bela Vista, SP', lat: -23.561, lng: -46.655 },
        dropoff: { add: 'R. Funchal, 200 - Vila Olimpia, SP', lat: -23.593, lng: -46.685 },
        estimateDistance: 8500,
        customer_name: 'Usuário Teste Silva',
        driver_name: 'Motorista Leaf',
        carType: 'LeafX',
        vehicleMake: 'Toyota',
        vehicleModel: 'Corolla',
        vehicle_plate: 'ABC-1234',
        finalPrice: 35.50,
        payment_mode: 'pix',
        payment_status: 'completed',
        txnId: 'PIX-123456789'
    };

    console.log('1. Gerando estrutura do recibo json...');
    const receipt = await service.generateReceipt(mockRideId, mockRideData);
    console.log('Recibo gerado:', receipt.receiptId);

    console.log('2. Gerando PDF buffer...');
    const pdfBuffer = await service.generatePDFReceipt(receipt);

    console.log(`Buffer recebido: ${pdfBuffer.length} bytes`);

    const outputPath = path.join(__dirname, 'test-receipt.pdf');
    fs.writeFileSync(outputPath, pdfBuffer);

    console.log(`3. PDF salvo com sucesso em: ${outputPath}`);
}

runTest().catch(console.error);
