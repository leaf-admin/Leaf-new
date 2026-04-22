import React from 'react';
import { fireEvent, render, waitFor } from '@testing-library/react-native';
import * as DocumentPicker from 'expo-document-picker';

import DocumentStep from '../src/components/auth/steps/DocumentStep';
import driverDocumentExtractionService from '../src/services/DriverDocumentExtractionService';

jest.mock('expo-document-picker', () => ({
  getDocumentAsync: jest.fn(),
}));

jest.mock('../src/services/DriverDocumentExtractionService', () => ({
  __esModule: true,
  default: {
    extractCNHFromPDF: jest.fn(),
    extractVehicleFromPDF: jest.fn(),
  },
}));

describe('DocumentStep (driver KYC docs)', () => {
  const baseProps = {
    onSubmitted: jest.fn(),
    onBack: jest.fn(),
    initialData: {
      user: { uid: 'driver-test-1' },
      profileSelection: { userType: 'driver' },
    },
  };

  beforeEach(() => {
    jest.clearAllMocks();
  });

  test('shows friendly error when CNH extraction fails due network', async () => {
    DocumentPicker.getDocumentAsync.mockResolvedValueOnce({
      canceled: false,
      assets: [
        {
          uri: 'file:///tmp/cnh.pdf',
          name: 'CNH-e.pdf',
          size: 120000,
          mimeType: 'application/pdf',
        },
      ],
    });

    driverDocumentExtractionService.extractCNHFromPDF.mockResolvedValueOnce({
      success: false,
      message: 'Network request failed',
    });

    const { getByText, findByText } = render(<DocumentStep {...baseProps} />);
    fireEvent.press(getByText('Toque para enviar o PDF da CNH'));

    expect(
      await findByText('Sem conexao com a internet. Verifique sua rede e tente novamente.')
    ).toBeTruthy();
    expect(baseProps.onSubmitted).not.toHaveBeenCalled();
  });

  test('auto-advances when CNH extraction returns mandatory identity fields', async () => {
    DocumentPicker.getDocumentAsync.mockResolvedValueOnce({
      canceled: false,
      assets: [
        {
          uri: 'file:///tmp/cnh.pdf',
          name: 'CNH-e.pdf',
          size: 120000,
          mimeType: 'application/pdf',
        },
      ],
    });

    driverDocumentExtractionService.extractCNHFromPDF.mockResolvedValueOnce({
      success: true,
      model: 'gpt-5.4-mini',
      data: {
        cpf: '12345678901',
        dataNascimento: '01/01/1990',
        nomeMae: 'Maria da Silva',
        genero: 'F',
      },
    });

    const onSubmitted = jest.fn();
    const { getByText } = render(<DocumentStep {...baseProps} onSubmitted={onSubmitted} />);
    fireEvent.press(getByText('Toque para enviar o PDF da CNH'));

    await waitFor(() => {
      expect(onSubmitted).toHaveBeenCalledTimes(1);
    });

    const payload = onSubmitted.mock.calls[0][0];
    expect(payload.cpf).toBe('123.456.789-01');
    expect(payload.birthDate).toBe('01/01/1990');
    expect(payload.motherName).toBe('Maria da Silva');
    expect(payload.gender).toBe('F');
    expect(payload.cnhPdfMeta?.name).toBe('CNH-e.pdf');
  });

  test('accepts vehicle PDF extraction as an optional onboarding artifact for the driver', async () => {
    DocumentPicker.getDocumentAsync.mockResolvedValueOnce({
      canceled: false,
      assets: [
        {
          uri: 'file:///tmp/vehicle.pdf',
          name: 'CRLV-e.pdf',
          size: 98000,
          mimeType: 'application/pdf',
        },
      ],
    });

    driverDocumentExtractionService.extractVehicleFromPDF.mockResolvedValueOnce({
      success: true,
      model: 'gpt-5.4-mini',
      data: {
        plate: 'ABC1D23',
        renavam: '12345678901',
      },
    });

    const { getByText } = render(
      <DocumentStep
        {...baseProps}
        initialData={{
          ...baseProps.initialData,
          documentData: {
            cpf: '123.456.789-01',
            birthDate: '01/01/1990',
            motherName: 'Maria da Silva',
            gender: 'F',
          },
        }}
      />,
    );

    fireEvent.press(getByText('Enviar agora ou deixar para o cadastro do 1º veículo'));
    await waitFor(() => {
      expect(driverDocumentExtractionService.extractVehicleFromPDF).toHaveBeenCalledTimes(1);
    });
    expect(getByText('CRLV-e.pdf')).toBeTruthy();
  });
});
