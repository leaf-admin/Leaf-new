// Shared vector source for the native marker and its design review. No raster,
// filters or external images: the small map glyph stays crisp at every density.
const PAINTS = Object.freeze({
  black: ['#64666A', '#414347', '#25272A', '#1B1D20'],
  white: ['#FFFFFF', '#F0F0F1', '#CDD0D3', '#9A9DA2'],
  silver: ['#E0E1E3', '#B6B8BC', '#96999E', '#6D7075'],
  gray: ['#999CA1', '#74777D', '#55585E', '#393C42'],
  red: ['#BF7A75', '#A75A55', '#88423F', '#683330'],
  blue: ['#8098AE', '#627F99', '#4A657E', '#364A5D'],
  green: ['#869C8D', '#6A8273', '#4F6859', '#3B4F42'],
  yellow: ['#D4BE84', '#BAA062', '#9B824C', '#79663D'],
});

// Orthographic, symmetrical silhouette. Heading only changes light, never the
// geometry: rotating a small map marker must not stretch or shear the vehicle.
const BODY = 'M22 16C22 12.5 25.5 11 32 11S42 12.5 42 16L44 24L44 44C44 50 41 53 32 53S20 50 20 44L20 24Z';

export function resolveVehicleArtworkPose(screenHeading = 0) {
  const numeric = Number(screenHeading);
  // Only the shading changes in 5° steps; the map rotates the vehicle smoothly.
  // This avoids rebuilding the SVG on every animation frame.
  const heading = Math.round(((Number.isFinite(numeric) ? numeric : 0) % 360 + 360) % 360 / 5) * 5;
  const radians = heading * Math.PI / 180;
  return {
    heading: heading % 360,
    lightX: Number((32 - Math.cos(radians) * 22 - Math.sin(radians) * 8).toFixed(2)),
    lightY: Number((32 + Math.sin(radians) * 22 - Math.cos(radians) * 8).toFixed(2)),
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
    <linearGradient id="${id}-glass" x1="0" y1="0" x2="0" y2="1">
      <stop offset="0" stop-color="#707780"/><stop offset="1" stop-color="#30353D"/>
    </linearGradient>
  </defs>
  <ellipse cx="32.4" cy="33.5" rx="14.5" ry="21.5" fill="#15171B" opacity=".09"/>
  <path d="M19.8 25.5L17.9 26.1L17.9 28L20 27.7M44.2 25.5L46.1 26.1L46.1 28L44 27.7" fill="${edge}"/>
  <path d="${BODY}" fill="${edge}" transform="translate(0 .65)"/>
  <path d="${BODY}" fill="url(#${id}-paint)" stroke="${edge}" stroke-width=".45"/>
  <path d="M23.5 24Q32 22.5 40.5 24L38.8 30Q32 29 25.2 30Z" fill="url(#${id}-glass)"/>
  <path d="M22.7 30L24.3 32L24.3 40.5L22.4 42.2Z M41.3 30L39.7 32L39.7 40.5L41.6 42.2Z" fill="#282D33"/>
  <path d="M25.5 43L38.5 43L40.3 47Q32 48.2 23.7 47Z" fill="url(#${id}-glass)"/>
  <path d="M25.5 31.4Q32 30.4 38.5 31.4" fill="none" stroke="#FFFFFF" stroke-opacity=".14" stroke-width=".55"/>
  <path d="M23.4 16.2L26.1 15.7M37.9 15.7L40.6 16.2" stroke="#E4E5E7" stroke-opacity=".65" stroke-width=".85" stroke-linecap="round"/>
</svg>`;
}
