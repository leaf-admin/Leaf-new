const MOCK_PROFILE_NAMES = new Set(['ana dias']);

export function sanitizePrototypeProfileText(value) {
  return String(value || '').trim();
}

export function isPrototypeMockProfileName(value) {
  const normalized = sanitizePrototypeProfileText(value).toLowerCase();
  return Boolean(normalized && MOCK_PROFILE_NAMES.has(normalized));
}

function firstText(...values) {
  for (const value of values) {
    const text = sanitizePrototypeProfileText(value);
    if (text) {
      return text;
    }
  }
  return '';
}

function joinNameParts(...values) {
  return values.map(sanitizePrototypeProfileText).filter(Boolean).join(' ').trim();
}

export function resolvePrototypeProfileName(profile = null) {
  if (!profile || typeof profile !== 'object') {
    return '';
  }

  const nestedProfile = profile.profile && typeof profile.profile === 'object'
    ? profile.profile
    : {};
  const directName = firstText(
    profile.name,
    profile.displayName,
    profile.fullName,
    nestedProfile.name,
    nestedProfile.displayName,
    nestedProfile.fullName,
  );

  const name = directName || joinNameParts(
    profile.firstName || nestedProfile.firstName,
    profile.lastName || nestedProfile.lastName,
  );

  return isPrototypeMockProfileName(name) ? '' : name;
}

export function resolvePrototypeProfileEmail(profile = null) {
  if (!profile || typeof profile !== 'object') {
    return '';
  }

  const nestedProfile = profile.profile && typeof profile.profile === 'object'
    ? profile.profile
    : {};
  return firstText(profile.email, nestedProfile.email);
}

export function resolvePrototypeProfilePhone(profile = null) {
  if (!profile || typeof profile !== 'object') {
    return '';
  }

  const nestedProfile = profile.profile && typeof profile.profile === 'object'
    ? profile.profile
    : {};
  return firstText(
    profile.phoneNumber,
    profile.mobile,
    profile.phone,
    nestedProfile.phoneNumber,
    nestedProfile.mobile,
    nestedProfile.phone,
  );
}
