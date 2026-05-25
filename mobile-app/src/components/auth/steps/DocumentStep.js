import React, { useMemo, useState } from 'react';
import {
  ActivityIndicator,
  StyleSheet,
  Text,
  TextInput,
  TouchableOpacity,
  View
} from 'react-native';
import { Ionicons } from '@expo/vector-icons';
import * as DocumentPicker from 'expo-document-picker';
import { fonts } from '../../../theme/runtimeTokens';
import ContinueButton from '../common/ContinueButton';
import onboardingTheme from '../common/onboardingTheme';
import driverDocumentExtractionService from '../../../services/DriverDocumentExtractionService';
import { toUserFriendlyMessage } from '../../../utils/friendlyErrorMessages';

const { color, radius, spacing } = onboardingTheme;

const EMAIL_REGEX = /\S+@\S+\.\S+/;
const CPF_REGEX = /^(?:\d{3}\.\d{3}\.\d{3}-\d{2}|\d{11})$/;

function normalizeCpf(value) {
  const digits = String(value || '').replace(/\D/g, '');
  if (digits.length !== 11) {
    return String(value || '').trim();
  }

  return `${digits.slice(0, 3)}.${digits.slice(3, 6)}.${digits.slice(6, 9)}-${digits.slice(9)}`;
}

function normalizeLabelText(value) {
  return String(value || '')
    .replace(/\s+/g, ' ')
    .trim();
}

function normalizeGenderValue(value) {
  const normalized = String(value || '')
    .normalize('NFD')
    .replace(/[\u0300-\u036f]/g, '')
    .trim()
    .toUpperCase();

  if (!normalized) return '';
  if (['F', 'FEMININO', 'FEMALE', 'MULHER'].includes(normalized)) return 'F';
  if (['M', 'MASCULINO', 'MALE', 'HOMEM'].includes(normalized)) return 'M';
  if (['X', 'OUTRO', 'OTHER', 'N', 'NB', 'NAO BINARIO', 'NAO-BINARIO', 'NON BINARY'].includes(normalized)) {
    return 'X';
  }
  return '';
}

function formatGenderLabel(value) {
  if (value === 'F') return 'Feminino';
  if (value === 'M') return 'Masculino';
  if (value === 'X') return 'Outro / não informado';
  return '';
}

function resolveCnhIdentityData(cnhExtraction = null) {
  const extractedData = cnhExtraction?.data || {};
  return {
    birthDate: normalizeLabelText(
      extractedData?.dataNascimento || extractedData?.birthDate || extractedData?.dateOfBirth || ''
    ),
    motherName: normalizeLabelText(
      extractedData?.nomeMae ||
        extractedData?.nome_da_mae ||
        extractedData?.nomeDaMae ||
        extractedData?.mae ||
        extractedData?.motherName ||
        extractedData?.filiacaoMae ||
        extractedData?.filiacao?.mae ||
        ''
    ),
    gender: normalizeGenderValue(
      extractedData?.genero || extractedData?.sexo || extractedData?.gender || extractedData?.sex || ''
    )
  };
}

function buildPdfMeta(asset = {}) {
  if (!asset?.uri) return null;
  return {
    name: asset?.name || `documento-${Date.now()}.pdf`,
    size: Number(asset?.size || 0),
    mimeType: asset?.mimeType || asset?.type || 'application/pdf',
    uri: asset?.uri,
    updatedAt: new Date().toISOString()
  };
}

function formatExtractionLabel(result) {
  if (!result?.success) return 'Falha na extração';
  if (result?.usedFallback) return 'Extraído com OCR de fallback';
  return `Extraído com ${result?.model || 'IA'}`;
}

const DocumentStep = ({ onSubmitted, onBack, initialData = {} }) => {
  const isDriver = initialData?.profileSelection?.userType === 'driver';
  const userId = initialData?.user?.uid || null;
  const initialCnhIdentity = resolveCnhIdentityData(initialData?.documentData?.cnhExtraction || null);

  const [documentData, setDocumentData] = useState({
    email: initialData?.documentData?.email || initialData?.email || '',
    cpf: initialData?.documentData?.cpf || initialData?.cpf || '',
    birthDate: initialData?.documentData?.birthDate || initialCnhIdentity.birthDate || '',
    motherName: initialData?.documentData?.motherName || initialData?.documentData?.nomeMae || initialCnhIdentity.motherName || '',
    gender: initialData?.documentData?.gender || initialData?.documentData?.genero || initialCnhIdentity.gender || '',
    cnhExtraction: initialData?.documentData?.cnhExtraction || null,
    vehicleExtraction: initialData?.documentData?.vehicleExtraction || null,
    cnhPdfMeta: initialData?.documentData?.cnhPdfMeta || null,
    vehiclePdfMeta: initialData?.documentData?.vehiclePdfMeta || null
  });

  const [isExtracting, setIsExtracting] = useState({
    cnh: false,
    vehicle: false
  });
  const [errors, setErrors] = useState({});

  const isFormValid = useMemo(() => {
    if (!isDriver) {
      return EMAIL_REGEX.test(documentData.email.trim());
    }

    return (
      Boolean(documentData.cnhExtraction?.success) &&
      CPF_REGEX.test(documentData.cpf) &&
      Boolean(documentData.birthDate) &&
      Boolean(documentData.motherName) &&
      Boolean(documentData.gender)
    );
  }, [documentData, isDriver]);

  const updateField = (field, value) => {
    setDocumentData(previous => ({ ...previous, [field]: value }));
    if (errors[field]) {
      setErrors(previous => ({ ...previous, [field]: '' }));
    }
  };

  const validateFields = () => {
    const nextErrors = {};

    if (!isDriver) {
      if (!documentData.email.trim()) {
        nextErrors.email = 'E-mail é obrigatório';
      } else if (!EMAIL_REGEX.test(documentData.email.trim())) {
        nextErrors.email = 'E-mail inválido';
      }
      setErrors(nextErrors);
      return Object.keys(nextErrors).length === 0;
    }

    if (!documentData.cnhExtraction?.success) {
      nextErrors.cnhPdf = 'Envie o PDF da CNH Digital para continuar.';
    }

    if (!documentData.cpf.trim()) {
      nextErrors.cpf = 'CPF não identificado na CNH. Tente reenviar o PDF.';
    } else if (!CPF_REGEX.test(documentData.cpf)) {
      nextErrors.cpf = 'CPF extraído inválido. Reenvie a CNH.';
    }

    if (!documentData.birthDate) {
      nextErrors.birthDate = 'Data de nascimento não identificada na CNH. Reenvie o PDF.';
    }

    if (!documentData.motherName) {
      nextErrors.motherName = 'Nome da mãe não identificado na CNH. Reenvie o PDF.';
    }

    if (!documentData.gender) {
      nextErrors.gender = 'Gênero não identificado na CNH. Reenvie o PDF.';
    }

    setErrors(nextErrors);
    return Object.keys(nextErrors).length === 0;
  };

  const pickAndExtractPDF = async type => {
    const fieldErrorKey = type === 'cnh' ? 'cnhPdf' : 'vehiclePdf';
    if (errors[fieldErrorKey]) {
      setErrors(previous => ({ ...previous, [fieldErrorKey]: '' }));
    }

    try {
      const pickerResult = await DocumentPicker.getDocumentAsync({
        type: 'application/pdf',
        copyToCacheDirectory: true,
        multiple: false
      });

      if (pickerResult.canceled || !pickerResult.assets?.length) {
        return;
      }

      const selectedAsset = pickerResult.assets[0];
      const pdfMeta = buildPdfMeta(selectedAsset);
      setIsExtracting(previous => ({ ...previous, [type]: true }));

      const extraction =
        type === 'cnh'
          ? await driverDocumentExtractionService.extractCNHFromPDF({
              pdfAsset: selectedAsset,
              userId
            })
          : await driverDocumentExtractionService.extractVehicleFromPDF({
              pdfAsset: selectedAsset,
              userId
            });

      if (!extraction?.success || !extraction?.data) {
        throw new Error(extraction?.message || 'Falha ao extrair dados do PDF');
      }

      setDocumentData(previous => {
        if (type === 'cnh') {
          const normalizedCpf = normalizeCpf(extraction?.data?.cpf || previous.cpf);
          const identityData = resolveCnhIdentityData(extraction);
          return {
            ...previous,
            cpf: normalizedCpf,
            birthDate: identityData.birthDate || previous.birthDate,
            motherName: identityData.motherName || previous.motherName,
            gender: identityData.gender || previous.gender,
            cnhExtraction: extraction,
            cnhPdfMeta: pdfMeta
          };
        }

        return {
          ...previous,
          vehicleExtraction: extraction,
          vehiclePdfMeta: pdfMeta
        };
      });

      if (type === 'cnh') {
        setErrors(previous => ({
          ...previous,
          cnhPdf: '',
          cpf: '',
          birthDate: '',
          motherName: '',
          gender: ''
        }));
      }

      if (isDriver && type === 'cnh') {
        const extractedCpf = normalizeCpf(extraction?.data?.cpf || documentData.cpf);
        const identityData = resolveCnhIdentityData(extraction);
        if (
          CPF_REGEX.test(String(extractedCpf || '').trim()) &&
          identityData.birthDate &&
          identityData.motherName &&
          identityData.gender
        ) {
          onSubmitted({
            cpf: extractedCpf,
            birthDate: identityData.birthDate,
            motherName: identityData.motherName,
            gender: identityData.gender,
            cnhExtraction: extraction,
            cnhPdfMeta: pdfMeta,
            vehicleExtraction: documentData.vehicleExtraction || null,
            vehiclePdfMeta: documentData.vehiclePdfMeta || null
          });
          return;
        }
      }
    } catch (error) {
      setErrors(previous => ({
        ...previous,
        [fieldErrorKey]:
          toUserFriendlyMessage(error, {
            context: 'document_upload',
            fallbackMessage: 'Nao foi possivel processar o PDF enviado. Tente novamente.'
          }) || 'Nao foi possivel processar o PDF enviado. Tente novamente.'
      }));
    } finally {
      setIsExtracting(previous => ({ ...previous, [type]: false }));
    }
  };

  const handleSubmit = () => {
    if (!validateFields()) {
      return;
    }

    if (!isDriver) {
      onSubmitted({
        email: documentData.email.trim().toLowerCase()
      });
      return;
    }

    onSubmitted({
      cpf: documentData.cpf,
      birthDate: documentData.birthDate,
      motherName: documentData.motherName,
      gender: documentData.gender,
      cnhExtraction: documentData.cnhExtraction,
      cnhPdfMeta: documentData.cnhPdfMeta,
      vehicleExtraction: documentData.vehicleExtraction,
      vehiclePdfMeta: documentData.vehiclePdfMeta
    });
  };

  const renderUploadCard = ({ title, description, onPress, loading, result, error, fileMeta, icon, optional = false }) => (
    <View style={styles.uploadContainer}>
      <Text style={styles.label}>
        {title}
        {optional ? <Text style={styles.optionalTag}> (opcional)</Text> : null}
      </Text>
      <TouchableOpacity
        activeOpacity={0.88}
        style={[styles.uploadButton, error && styles.inputError]}
        onPress={onPress}
        disabled={loading}
      >
        <View style={styles.uploadIconWrap}>
          <Ionicons name={icon} size={18} color={color.textPrimary} />
        </View>
        <View style={styles.uploadTextWrap}>
          <Text style={styles.uploadTitle}>{loading ? 'Processando PDF...' : description}</Text>
          {fileMeta?.name ? <Text style={styles.uploadFile}>{fileMeta.name}</Text> : null}
          {result ? <Text style={styles.uploadMeta}>{formatExtractionLabel(result)}</Text> : null}
          {loading ? (
            <View style={styles.uploadProgress}>
              <View style={styles.uploadProgressFill} />
            </View>
          ) : null}
        </View>
        {loading ? <ActivityIndicator size="small" color={color.textPrimary} /> : <Ionicons name="chevron-forward" size={18} color={color.textMuted} />}
      </TouchableOpacity>
      {error ? <Text style={styles.errorText}>{error}</Text> : null}
    </View>
  );

  return (
    <View style={styles.container}>
      <View style={styles.header}>
        <TouchableOpacity style={styles.backButton} onPress={onBack}>
          <Ionicons name="chevron-back" size={22} color={color.textPrimary} />
        </TouchableOpacity>
      </View>

      <Text style={styles.title}>{isDriver ? 'Validar sua CNH' : 'Cadastro de passageiro'}</Text>

      <Text style={styles.subtitle}>
        {isDriver
          ? 'Envie a CNH Digital em PDF. A Leaf lê os dados automaticamente e libera os próximos passos.'
          : 'Informe seu e-mail para recibos e recuperação de conta.'}
      </Text>

      <View style={styles.card}>
        {!isDriver ? (
          <View style={styles.fieldContainer}>
            <Text style={styles.label}>E-mail *</Text>
            <TextInput
              style={[styles.input, errors.email && styles.inputError]}
              value={documentData.email}
              onChangeText={value => updateField('email', value)}
              placeholder="seu@email.com"
              placeholderTextColor={color.textMuted}
              keyboardType="email-address"
              autoCapitalize="none"
              autoCorrect={false}
            />
            {errors.email ? <Text style={styles.errorText}>{errors.email}</Text> : null}
          </View>
        ) : (
          <>
            {renderUploadCard({
              title: 'CNH Digital (PDF) *',
              description: 'Toque para enviar o PDF da CNH',
              onPress: () => pickAndExtractPDF('cnh'),
              loading: isExtracting.cnh,
              result: documentData.cnhExtraction,
              error: errors.cnhPdf,
              fileMeta: documentData.cnhPdfMeta,
              icon: 'document-text-outline'
            })}

            <View style={styles.identityGrid}>
              <View style={[styles.fieldContainer, styles.identityField]}>
                <Text style={styles.label}>CPF</Text>
                <TextInput
                  style={[styles.input, styles.readOnlyInput, errors.cpf && styles.inputError]}
                  value={documentData.cpf}
                  editable={false}
                  placeholder="Após ler CNH"
                  placeholderTextColor={color.textMuted}
                />
                {errors.cpf ? <Text style={styles.errorText}>{errors.cpf}</Text> : null}
              </View>

              <View style={[styles.fieldContainer, styles.identityField]}>
                <Text style={styles.label}>Nascimento</Text>
                <TextInput
                  style={[styles.input, styles.readOnlyInput, errors.birthDate && styles.inputError]}
                  value={documentData.birthDate}
                  editable={false}
                  placeholder="Após ler CNH"
                  placeholderTextColor={color.textMuted}
                />
                {errors.birthDate ? <Text style={styles.errorText}>{errors.birthDate}</Text> : null}
              </View>

              <View style={[styles.fieldContainer, styles.identityField]}>
                <Text style={styles.label}>Nome da mãe</Text>
                <TextInput
                  style={[styles.input, styles.readOnlyInput, errors.motherName && styles.inputError]}
                  value={documentData.motherName}
                  editable={false}
                  placeholder="Após ler CNH"
                  placeholderTextColor={color.textMuted}
                />
                {errors.motherName ? <Text style={styles.errorText}>{errors.motherName}</Text> : null}
              </View>

              <View style={[styles.fieldContainer, styles.identityField]}>
                <Text style={styles.label}>Gênero</Text>
                <TextInput
                  style={[styles.input, styles.readOnlyInput, errors.gender && styles.inputError]}
                  value={formatGenderLabel(documentData.gender)}
                  editable={false}
                  placeholder="Após ler CNH"
                  placeholderTextColor={color.textMuted}
                />
                {errors.gender ? <Text style={styles.errorText}>{errors.gender}</Text> : null}
              </View>
            </View>

            {renderUploadCard({
              title: 'Documento do Veículo (PDF)',
              description: 'Enviar agora ou deixar para o cadastro do 1º veículo',
              onPress: () => pickAndExtractPDF('vehicle'),
              loading: isExtracting.vehicle,
              result: documentData.vehicleExtraction,
              error: errors.vehiclePdf,
              fileMeta: documentData.vehiclePdfMeta,
              icon: 'car-sport-outline',
              optional: true
            })}
          </>
        )}
      </View>

      <ContinueButton onPress={handleSubmit} disabled={!isFormValid || isExtracting.cnh || isExtracting.vehicle} text="Continuar" />
    </View>
  );
};

const styles = StyleSheet.create({
  container: {
    flex: 1,
    paddingHorizontal: spacing.lg,
    paddingTop: spacing.xl,
    paddingBottom: spacing.xs
  },
  header: {
    flexDirection: 'row',
    alignItems: 'center',
    minHeight: 44,
    marginBottom: spacing.md
  },
  backButton: {
    width: 38,
    height: 38,
    borderRadius: 19,
    borderWidth: 1,
    borderColor: color.border,
    backgroundColor: color.panelSoft,
    alignItems: 'center',
    justifyContent: 'center'
  },
  title: {
    fontSize: 32,
    lineHeight: 36,
    color: color.textPrimary,
    fontFamily: fonts.Bold,
    letterSpacing: 0
  },
  subtitle: {
    fontSize: 15,
    lineHeight: 21,
    color: color.textSecondary,
    fontFamily: fonts.Regular,
    marginTop: spacing.sm,
    marginBottom: spacing.lg
  },
  card: {
    borderRadius: radius.xl,
    borderWidth: 1,
    borderColor: color.glassStroke,
    backgroundColor: color.panel,
    shadowColor: color.accent,
    ...onboardingTheme.elevation.soft,
    padding: spacing.sm
  },
  fieldContainer: {
    marginBottom: spacing.xs
  },
  label: {
    fontSize: 12,
    color: color.textPrimary,
    fontFamily: fonts.SemiBold,
    marginBottom: 4
  },
  optionalTag: {
    color: color.textMuted,
    fontFamily: fonts.Medium
  },
  input: {
    borderWidth: 1,
    borderColor: color.border,
    borderRadius: radius.md,
    paddingHorizontal: 12,
    paddingVertical: 8,
    fontSize: 13,
    lineHeight: 17,
    fontFamily: fonts.Medium,
    color: color.textPrimary,
    backgroundColor: color.surfaceMuted
  },
  readOnlyInput: {
    opacity: 0.95
  },
  uploadContainer: {
    marginBottom: spacing.xs
  },
  uploadButton: {
    borderWidth: 1,
    borderColor: color.border,
    borderRadius: radius.md,
    backgroundColor: color.surfaceMuted,
    paddingVertical: 12,
    paddingHorizontal: 12,
    flexDirection: 'row',
    alignItems: 'flex-start'
  },
  uploadIconWrap: {
    width: 38,
    height: 38,
    borderRadius: 15,
    backgroundColor: color.accentSoft,
    alignItems: 'center',
    justifyContent: 'center',
    marginRight: 10
  },
  uploadTextWrap: {
    flex: 1
  },
  uploadTitle: {
    fontSize: 14,
    lineHeight: 18,
    color: color.textPrimary,
    fontFamily: fonts.SemiBold
  },
  uploadFile: {
    marginTop: 2,
    fontSize: 10,
    lineHeight: 13,
    color: color.textSecondary,
    fontFamily: fonts.Regular
  },
  uploadMeta: {
    marginTop: 2,
    fontSize: 10,
    lineHeight: 13,
    color: color.textMuted,
    fontFamily: fonts.Medium
  },
  uploadProgress: {
    height: 6,
    borderRadius: 999,
    overflow: 'hidden',
    backgroundColor: 'rgba(17,23,25,0.08)',
    marginTop: 8
  },
  uploadProgressFill: {
    width: '72%',
    height: '100%',
    borderRadius: 999,
    backgroundColor: color.accent
  },
  inputError: {
    borderColor: color.error
  },
  errorText: {
    marginTop: 4,
    color: color.error,
    fontSize: 12,
    lineHeight: 16,
    fontFamily: fonts.Medium
  },
  identityGrid: {
    flexDirection: 'row',
    flexWrap: 'wrap',
    columnGap: spacing.xs
  },
  identityField: {
    flexBasis: '48%',
    flexGrow: 1
  }
});

export default DocumentStep;
