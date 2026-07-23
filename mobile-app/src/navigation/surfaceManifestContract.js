import surfaceManifest from './surfaceManifest.json';

function splitPathAndQuery(path) {
  const normalized = String(path || '').replace(/^\/+/, '');
  const queryIndex = normalized.indexOf('?');
  if (queryIndex < 0) {
    return { pathname: normalized, query: '' };
  }
  return {
    pathname: normalized.slice(0, queryIndex),
    query: normalized.slice(queryIndex + 1),
  };
}

function matchTemplate(template, pathname) {
  const templateParts = String(template || '').split('/');
  const pathParts = String(pathname || '').split('/');
  if (templateParts.length !== pathParts.length) {
    return null;
  }

  const params = {};
  for (let index = 0; index < templateParts.length; index += 1) {
    const expected = templateParts[index];
    const actual = pathParts[index];
    if (expected.startsWith(':')) {
      params[expected.slice(1)] = actual;
    } else if (expected !== actual) {
      return null;
    }
  }
  return params;
}

function expandTemplate(template, params) {
  return String(template || '').replace(/:([A-Za-z0-9_]+)/g, (_match, key) => params[key] || '');
}

export function getManifestRouteCategory(routeName) {
  return Object.entries(surfaceManifest.routeCategories).find(([, routes]) =>
    routes.includes(routeName)
  )?.[0] || null;
}

export function normalizeManifestDeepLinkPath(path) {
  const { pathname, query } = splitPathAndQuery(path);
  const redirect = surfaceManifest.deepLinks.find(entry =>
    entry.category === 'compatibility_redirect' && matchTemplate(entry.path, pathname)
  );

  if (!redirect) {
    return path;
  }

  const params = matchTemplate(redirect.path, pathname) || {};
  const targetPath = expandTemplate(redirect.targetPath, params);
  return query ? `${targetPath}?${query}` : targetPath;
}

export default surfaceManifest;
