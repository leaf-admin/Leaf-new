const SUPER_ADMIN_ALIASES = new Set(["super_admin", "superadmin", "super-admin"]);

export function normalizeRole(role) {
  const normalized = String(role || "").trim().toLowerCase();
  if (SUPER_ADMIN_ALIASES.has(normalized)) return "super-admin";
  return normalized;
}

export function hasAnyRole(user, allowedRoles = []) {
  const normalizedAllowed = allowedRoles.map(normalizeRole).filter(Boolean);
  if (normalizedAllowed.length === 0) return true;
  return normalizedAllowed.includes(normalizeRole(user?.role));
}

export function permissionsFor(user) {
  return Array.isArray(user?.permissions)
    ? user.permissions.map((permission) => String(permission || "").trim()).filter(Boolean)
    : [];
}

export function hasAnyPermission(user, requiredPermissions = []) {
  if (!Array.isArray(requiredPermissions) || requiredPermissions.length === 0) return true;
  const permissions = new Set(permissionsFor(user));
  return requiredPermissions.some((permission) => permissions.has(permission));
}

export function canAccessItem(item, user) {
  const role = normalizeRole(user?.role);
  const blockedRoles = Array.isArray(item?.blockedRoles) ? item.blockedRoles.map(normalizeRole) : [];
  if (role && blockedRoles.includes(role)) return false;
  return hasAnyRole(user, item?.allowedRoles) && hasAnyPermission(user, item?.requiredPermissions);
}

export function getLaunchFlags(runtimeFlags) {
  return runtimeFlags?.launch && typeof runtimeFlags.launch === "object" ? runtimeFlags.launch : {};
}

export function isLaunchFeatureEnabled(runtimeFlags, key) {
  const flags = getLaunchFlags(runtimeFlags);
  return flags[key] !== false;
}

export function isAdminMutationEnabled(runtimeFlags) {
  return isLaunchFeatureEnabled(runtimeFlags, "adminMutationsEnabled");
}

export function runtimeFeatureMessage(runtimeFlags, key, label) {
  const flags = getLaunchFlags(runtimeFlags);
  if (flags[key] !== false) return "";
  const profile = flags.launchProfile || "perfil atual";
  return `${label} está desativado no perfil de lançamento ${profile}. A tela foi mantida em modo bloqueado.`;
}

export function mutationBlockedMessage(runtimeFlags) {
  const flags = getLaunchFlags(runtimeFlags);
  if (flags.adminMutationsEnabled !== false) return "";
  const profile = flags.launchProfile || "perfil atual";
  return `Mutações administrativas estão desativadas no perfil de lançamento ${profile}. Ações ficam somente leitura.`;
}

export function roleBlockedMessage(user, allowedRoles = []) {
  if (hasAnyRole(user, allowedRoles)) return "";
  return "Seu perfil não tem permissão para executar esta ação neste painel.";
}
