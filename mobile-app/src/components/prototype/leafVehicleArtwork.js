// Shared vector source for the native marker and its design review. No raster,
// filters or external images: the small map glyph stays crisp at every density.
const PAINTS = Object.freeze({
  black: ['#778389', '#354047', '#172126', '#0D151A'],
  white: ['#FFFFFF', '#E8EDF0', '#AFBCC4', '#637680'],
  silver: ['#EFF3F5', '#AAB8C0', '#657781', '#35464F'],
  gray: ['#A5AFB5', '#65737C', '#33424C', '#1D2B34'],
  red: ['#D99391', '#984944', '#632C2C', '#381C22'],
  blue: ['#A2BCCD', '#557B96', '#29465C', '#1C2C3B'],
  green: ['#A1B4A4', '#54745F', '#2B4836', '#1E3025'],
  yellow: ['#F4DB9D', '#C8A859', '#8C713B', '#4F422A'],
});

const BODY = 'M22 15C22 10 25.5 8 32 8S42 10 42 15L44 43C44.5 51 41.5 55 32 55S19.5 51 20 43Z';

export function resolveVehicleArtworkPose(screenHeading = 0) {
  const numeric = Number(screenHeading);
  // Only the shading changes in 5° steps; the map rotates the vehicle smoothly.
  // This avoids rebuilding the SVG on every animation frame.
  const heading = Math.round(((Number.isFinite(numeric) ? numeric : 0) % 360 + 360) % 360 / 5) * 5;
  const radians = heading * Math.PI / 180;
  return {
    heading: heading % 360,
    side: Number((Math.cos(radians) * 1.15).toFixed(2)),
    rise: Number((1.1 + Math.sin(radians) * 0.35).toFixed(2)),
    skew: Number((Math.cos(radians) * 2.2).toFixed(2)),
    lightX: Number((32 - Math.cos(radians) * 24 - Math.sin(radians) * 15).toFixed(2)),
    lightY: Number((32 + Math.sin(radians) * 24 - Math.cos(radians) * 15).toFixed(2)),
  };
}

export function createLeafVehicleSvg({ colorToken = 'black', screenHeading = 0, idPrefix = 'leaf-vehicle' } = {}) {
  const [highlight, paint, shade, edge] = PAINTS[colorToken] || PAINTS.black;
  const pose = resolveVehicleArtworkPose(screenHeading);
  const id = String(idPrefix).replace(/[^a-zA-Z0-9_-]/g, '') || 'leaf-vehicle';
  return `<svg xmlns="http://www.w3.org/2000/svg" width="42" height="42" viewBox="0 0 64 64">
  <defs>
    <linearGradient id="${id}-paint" gradientUnits="userSpaceOnUse" x1="${pose.lightX}" y1="${pose.lightY}" x2="${64 - pose.lightX}" y2="${64 - pose.lightY}">
      <stop offset="0" stop-color="${highlight}"/><stop offset=".44" stop-color="${paint}"/><stop offset="1" stop-color="${shade}"/>
    </linearGradient>
    <linearGradient id="${id}-glass" x1="0" y1="0" x2="1" y2="1">
      <stop offset="0" stop-color="#A5BBC7"/><stop offset=".32" stop-color="#506976"/><stop offset="1" stop-color="#1A2B35"/>
    </linearGradient>
    <linearGradient id="${id}-roof" x1="0" y1="0" x2="1" y2=".8">
      <stop offset="0" stop-color="${highlight}"/><stop offset=".5" stop-color="${paint}"/><stop offset="1" stop-color="${shade}"/>
    </linearGradient>
  </defs>
  <g fill="#15232D">
    <ellipse cx="33" cy="34.5" rx="17" ry="26" opacity=".035"/>
    <ellipse cx="33" cy="34.5" rx="15" ry="24" opacity=".055"/>
    <ellipse cx="33" cy="34.5" rx="12.8" ry="22" opacity=".10"/>
  </g>
  <g transform="translate(32 32) skewX(${pose.skew}) translate(-32 -32)">
    <g fill="#162127">
      <rect x="18" y="17" width="4" height="9" rx="1.6"/><rect x="42" y="17" width="4" height="9" rx="1.6"/>
      <rect x="17.5" y="42" width="4" height="9" rx="1.6"/><rect x="42.5" y="42" width="4" height="9" rx="1.6"/>
    </g>
    <path d="${BODY}" fill="${edge}" transform="translate(${pose.side} ${pose.rise})"/>
    <path d="${BODY}" fill="url(#${id}-paint)" stroke="${edge}" stroke-width=".55"/>
    <path d="M22.5 17L21.8 42Q21 50 25 52" fill="none" stroke="#FFFFFF" stroke-opacity=".24" stroke-width=".65"/>
    <path d="M41.5 17L42.2 43Q42.5 50 39 52" fill="none" stroke="${edge}" stroke-opacity=".6" stroke-width=".7"/>
    <path d="M23.8 21Q32 19.5 40.2 21L38.5 29Q32 27.7 25.5 29Z" fill="url(#${id}-glass)" stroke="${highlight}" stroke-width=".55"/>
    <path d="M25.8 22.2L31.5 21.7L27.9 27.5L26.4 27.7Z" fill="#FFFFFF" opacity=".26"/>
    <path d="M22.5 27.5L24.5 31L24 41.7L21.8 44Z M41.5 27.5L39.5 31L40 41.7L42.2 44Z" fill="#253842"/>
    <path d="M25.5 44Q32 45 38.5 44L40.4 48.6Q32 50.5 23.6 48.6Z" fill="url(#${id}-glass)" stroke="${highlight}" stroke-width=".45"/>
    <path d="M25.5 31Q32 29.8 38.5 31L38.8 41.5Q32 43 25.2 41.5Z" fill="url(#${id}-roof)" stroke="${highlight}" stroke-opacity=".28" stroke-width=".6"/>
    <path d="M26.5 32.2Q32 31.2 37 32" stroke="#FFFFFF" stroke-opacity=".30" stroke-width=".55" fill="none"/>
    <path d="M25.5 12L25 18.6M38.5 12L39 18.6" stroke="${highlight}" stroke-opacity=".32" stroke-width=".55"/>
    <path d="M24.2 10.8Q32 9 39.8 10.8" stroke="#FFFFFF" stroke-opacity=".32" stroke-width=".6" fill="none"/>
    <path d="M23 14L26.2 13.6M37.8 13.6L41 14" stroke="#FAF7E9" stroke-width="1.4" stroke-linecap="round"/>
    <path d="M27 11.5L37 11.5" stroke="${edge}" stroke-opacity=".65" stroke-width=".7" stroke-linecap="round"/>
    <path d="M20.9 24L17.3 25.1L17 26.6L21 26Z M43.1 24L46.7 25.1L47 26.6L43 26Z" fill="${shade}" stroke="${highlight}" stroke-width=".4"/>
    <path d="M22.6 50.7L26.1 51.8M37.9 51.8L41.4 50.7" stroke="#BC5654" stroke-width="1.2" stroke-linecap="round"/>
    <path d="M27 53L37 53" stroke="${edge}" stroke-opacity=".75" stroke-width=".7" stroke-linecap="round"/>
  </g>
</svg>`;
}
