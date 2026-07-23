import Logger from './Logger';
import auth from '@react-native-firebase/auth';
import mobileProfileService from '../services/MobileProfileService';
import { resolveCityLabel } from '../config/onboardingConfig';

function normalizeUserType(userType) {
  if (userType === 'passenger') {
    return 'customer';
  }
  return userType === 'driver' ? 'driver' : 'customer';
}

function splitFullName(fullName) {
  const clean = String(fullName || '').trim();
  if (!clean) {
    return { firstName: '', lastName: '' };
  }

  const parts = clean.split(/\s+/).filter(Boolean);
  if (parts.length === 1) {
    return {
      firstName: parts[0],
      lastName: ''
    };
  }

  return {
    firstName: parts[0],
    lastName: parts.slice(1).join(' ')
  };
}

function normalizeBirthDate(value) {
  const raw = String(value || '').trim();
  if (!raw) return '';

  const ddmmyyyyMatch = raw.match(/^(\d{2})[\/\-](\d{2})[\/\-](\d{4})$/);
  if (ddmmyyyyMatch) {
    const [, dd, mm, yyyy] = ddmmyyyyMatch;
    return `${yyyy}-${mm}-${dd}`;
  }

  const yyyymmddMatch = raw.match(/^(\d{4})[\/\-](\d{2})[\/\-](\d{2})$/);
  if (yyyymmddMatch) {
    const [, yyyy, mm, dd] = yyyymmddMatch;
    return `${yyyy}-${mm}-${dd}`;
  }

  const parsed = new Date(raw);
  if (Number.isNaN(parsed.getTime())) return '';
  return parsed.toISOString().slice(0, 10);
}

function normalizeMotherName(value) {
  return String(value || '')
    .replace(/\s+/g, ' ')
    .trim()
    .toUpperCase();
}

function normalizeGenderCode(value) {
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

function normalizeGenderLabel(value) {
  if (value === 'F') return 'feminino';
  if (value === 'M') return 'masculino';
  if (value === 'X') return 'outro';
  return '';
}

function resolveCnhIdentity(documentData = {}, userData = {}) {
  const cnhData = documentData?.cnhExtraction?.data || {};

  const birthDate = normalizeBirthDate(
    documentData?.birthDate ||
      cnhData?.dataNascimento ||
      cnhData?.birthDate ||
      cnhData?.dateOfBirth ||
      userData?.birthDate ||
      userData?.dateOfBirth ||
      userData?.dob ||
      userData?.dataNascimento ||
      ''
  );

  const motherName = normalizeMotherName(
    documentData?.motherName ||
      documentData?.nomeMae ||
      cnhData?.nomeMae ||
      cnhData?.nome_da_mae ||
      cnhData?.nomeDaMae ||
      cnhData?.mae ||
      cnhData?.motherName ||
      cnhData?.filiacaoMae ||
      cnhData?.filiacao?.mae ||
      userData?.motherName ||
      userData?.nomeMae ||
      userData?.nomeDaMae ||
      ''
  );

  const genderCode = normalizeGenderCode(
    documentData?.gender ||
      documentData?.genero ||
      cnhData?.genero ||
      cnhData?.sexo ||
      cnhData?.gender ||
      cnhData?.sex ||
      userData?.gender ||
      userData?.genero ||
      ''
  );

  return {
    birthDate,
    motherName,
    genderCode,
    genderLabel: normalizeGenderLabel(genderCode)
  };
}

/**
 * Serviço para gerenciar dados do usuário no backend moderno
 */
export class UserDatabaseService {
  static buildProfilePayload(userData = {}, options = {}) {
    const normalizedUserType = normalizeUserType(userData?.profileSelection?.userType || userData?.usertype || userData?.userType);
    const fullName =
      userData?.profileData?.fullName ||
      [userData?.profileData?.firstName, userData?.profileData?.lastName].filter(Boolean).join(' ').trim();
    const { firstName, lastName } = splitFullName(fullName);

    const phoneNumber =
      userData?.phoneNumber && userData.phoneNumber !== '+55'
        ? userData.phoneNumber
        : options?.fallbackPhone || '+55';

    const documentData = userData?.documentData || {};
    const documentEmail = documentData?.email || userData?.email || '';
    const cnhExtraction = documentData?.cnhExtraction || null;
    const extractedCpf = cnhExtraction?.data?.cpf || '';
    const cnhIdentity = resolveCnhIdentity(documentData, userData);
    const credentials = userData?.credentials || {};

    const now = new Date().toISOString();

    return {
      uid: options?.uid || userData?.user?.uid || userData?.uid || null,
      mobile: phoneNumber,
      phoneNumber,
      email: documentEmail,
      name: fullName || [firstName, lastName].filter(Boolean).join(' ').trim(),
      firstName,
      lastName,
      cpf: documentData?.cpf || extractedCpf || '',
      city: documentData?.city || '',
      cityLabel: resolveCityLabel(documentData?.city || ''),
      usertype: normalizedUserType,
      userType: normalizedUserType,
      phoneValidated: userData?.phoneValidated !== false,
      paymentMethod: 'pix',
      onboardingVersion: 2,
      onboardingCompleted: true,
      profileComplete: true,
      createdAt: now,
      updatedAt: now,
      acceptTerms: Boolean(credentials.acceptTerms),
      acceptPrivacy: Boolean(credentials.acceptPrivacy),
      consentBackgroundCheck: Boolean(credentials.consentBackgroundCheck),
      marketingOptIn: Boolean(credentials.marketingOptIn),
      acceptMarketing: Boolean(credentials.marketingOptIn),
      ...(cnhIdentity.birthDate
        ? {
            birthDate: cnhIdentity.birthDate,
            dateOfBirth: cnhIdentity.birthDate,
            dob: cnhIdentity.birthDate
          }
        : {}),
      ...(cnhIdentity.motherName
        ? {
            motherName: cnhIdentity.motherName,
            nomeMae: cnhIdentity.motherName
          }
        : {}),
      ...(cnhIdentity.genderCode
        ? {
            gender: cnhIdentity.genderCode,
            genero: cnhIdentity.genderCode,
            genderLabel: cnhIdentity.genderLabel
          }
        : {}),
    };
  }

  /**
   * Cria/atualiza o perfil do usuário na fonte moderna de perfil
   * @param {Object} userData - Dados completos do usuário
   * @returns {Promise<{success: boolean, profile: Object|null}>}
   */
  static async saveUserProfile(userData) {
    try {
      const currentUser = auth().currentUser;
      const resolvedUid = currentUser?.uid || userData?.user?.uid || userData?.uid;

      if (!resolvedUid) {
        Logger.error('❌ Usuário não autenticado e sem UID para salvar perfil');
        return { success: false, profile: null };
      }

      Logger.log('💾 Salvando perfil do usuário no backend moderno:', resolvedUid);

      const existingProfile = (await mobileProfileService.getCurrentProfile({ suppressErrors: true })) || {};

      const payload = this.buildProfilePayload(userData, {
        uid: resolvedUid,
        fallbackPhone: currentUser?.phoneNumber || existingProfile?.mobile || ''
      });

      const savedProfile = await mobileProfileService.upsertCurrentProfile(payload);

      if (!savedProfile) {
        Logger.error('❌ Falha ao persistir perfil no backend moderno');
        return { success: false, profile: null };
      }

      Logger.log('✅ Perfil do usuário salvo com sucesso no backend moderno');
      return { success: true, profile: savedProfile };
    } catch (error) {
      Logger.error('❌ Erro ao salvar perfil do usuário:', error);
      return { success: false, profile: null, error };
    }
  }

  /**
   * Verifica se o usuário já existe na fonte moderna
   * @param {string} uid - UID do usuário
   * @returns {Promise<boolean>} - Se o usuário existe
   */
  static async userExists(uid) {
    try {
      const currentUid = auth().currentUser?.uid;
      if (currentUid && currentUid !== uid) {
        return false;
      }
      const profile = await mobileProfileService.getCurrentProfile({ suppressErrors: true });
      return Boolean(profile?.uid && profile.uid === uid);
    } catch (error) {
      Logger.error('❌ Erro ao verificar se usuário existe:', error);
      return false;
    }
  }

  /**
   * Obtém dados do usuário da fonte moderna
   * @param {string} uid - UID do usuário
   * @returns {Promise<Object|null>} - Dados do usuário
   */
  static async getUserProfile(uid) {
    try {
      const currentUid = auth().currentUser?.uid;
      if (currentUid && currentUid !== uid) {
        return null;
      }
      return await mobileProfileService.getCurrentProfile({ suppressErrors: true });
    } catch (error) {
      Logger.error('❌ Erro ao obter perfil do usuário:', error);
      return null;
    }
  }
}

export default UserDatabaseService;
