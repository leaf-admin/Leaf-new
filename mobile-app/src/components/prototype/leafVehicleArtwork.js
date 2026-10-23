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
  brown: ['#AC8B77', '#896955', '#684B3C', '#49342A'],
  beige: ['#E3D8C1', '#CBBCA0', '#AA997B', '#837257'],
  orange: ['#E3A073', '#CC8150', '#A66037', '#7D4629'],
  purple: ['#A59ABA', '#85759D', '#655580', '#493C61'],
  pink: ['#DFB2C5', '#C88FA9', '#A66D88', '#80516B'],
});

// Register additional bundled campaign artwork here. Unknown keys always fall
// back to the registered-color car; remote creatives use the existing upload.
export const VEHICLE_MARKER_SHAPES = Object.freeze({
  leaf_vehicle: createLeafVehicleSvg,
  leaf_moto: createLeafMotoSvg,
  halloween_pumpkin: createHalloweenPumpkinSvg,
});

export function resolveVehicleMarkerShapeKey(value) {
  const key = String(value || '').trim().toLowerCase();
  return Object.prototype.hasOwnProperty.call(VEHICLE_MARKER_SHAPES, key) ? key : '';
}

// Categoria Moto vira a moto vista de cima; o resto segue o carro.
export function resolveVehicleShapeKeyForCategory(...values) {
  return values.some((value) => /moto/i.test(String(value || ''))) ? 'leaf_moto' : '';
}

export function createLeafMapMarkerSvg({ shapeKey = '', ...options } = {}) {
  const key = resolveVehicleMarkerShapeKey(shapeKey) || 'leaf_vehicle';
  return VEHICLE_MARKER_SHAPES[key](options);
}

function createHalloweenPumpkinSvg({ screenHeading = 0, idPrefix = 'leaf-pumpkin' } = {}) {
  const pose = resolveVehicleArtworkPose(screenHeading);
  const id = String(idPrefix).replace(/[^a-zA-Z0-9_-]/g, '') || 'leaf-pumpkin';
  return `<svg xmlns="http://www.w3.org/2000/svg" width="42" height="42" viewBox="0 0 64 64">
  <defs><linearGradient id="${id}-pumpkin" gradientUnits="userSpaceOnUse" x1="${pose.lightX}" y1="${pose.lightY}" x2="${64 - pose.lightX}" y2="${64 - pose.lightY}"><stop offset="0" stop-color="#F8BD71"/><stop offset=".48" stop-color="#E7933E"/><stop offset="1" stop-color="#BD6027"/></linearGradient></defs>
  <ellipse cx="32.5" cy="35" rx="19.5" ry="19" fill="#15171B" opacity=".10"/>
  <path d="M29.5 18L30.5 10Q32 8 34.5 10L33 19Z" fill="#596B46"/>
  <path d="M32 18C19 12 12 23 14 37C15.5 49 23 53 32 50C41 53 48.5 49 50 37C52 23 45 12 32 18Z" fill="url(#${id}-pumpkin)" stroke="#AE602A" stroke-width=".65"/>
  <path d="M27 19C21 29 22 42 28 49M37 19C43 29 42 42 36 49M32 19L32 49" fill="none" stroke="#A45627" stroke-opacity=".24" stroke-width="1.3"/>
  <path d="M21.5 32L27.5 28.5L28 34.5ZM42.5 32L36.5 28.5L36 34.5ZM24 40Q32 46 40 40L36 44L32 43L28 44Z" fill="#704425"/>
  </svg>`;
}

// Orthographic, symmetrical compact SUV (T-Cross/Kwid proportions, about
// 2.2x longer than wide). Heading only changes light and the ground shadow,
// never the geometry: rotating a small map marker must not stretch or shear
// the vehicle. No filters: depth comes from layered gradients only.
const BODY = 'M24.4 9C27 7.8 37 7.8 39.6 9C42.2 10.2 43.5 13 43.6 16.4C43.7 19.2 42.9 21.2 42.8 24L42.8 42.4C42.9 45.2 43.7 46.8 43.6 49.4C43.5 52.8 42.4 54.6 39.8 55.3C37 56 27 56 24.2 55.3C21.6 54.6 20.5 52.8 20.4 49.4C20.3 46.8 21.1 45.2 21.2 42.4L21.2 24C21.1 21.2 20.3 19.2 20.4 16.4C20.5 13 21.8 10.2 24.4 9Z';
const WHEELS = [[13.2, 6.6], [44.6, 6.6]];

function isDarkPaint(hex) {
  const value = parseInt(hex.slice(1), 16);
  const luminance = (0.299 * (value >> 16) + 0.587 * ((value >> 8) & 255) + 0.114 * (value & 255)) / 255;
  return luminance < 0.42;
}

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
  const dark = isDarkPaint(paint);
  // The shadow falls away from the light, so it stays put on screen while the
  // marker rotates.
  const dx = 32 - pose.lightX;
  const dy = 32 - pose.lightY;
  const reach = Math.hypot(dx, dy) || 1;
  const shadowX = Number((dx / reach * 2.2).toFixed(2));
  const shadowY = Number((dy / reach * 2.2).toFixed(2));
  const tyres = WHEELS.map(([y, h]) => `<rect x="20.2" y="${y}" width="2.4" height="${h}" rx="1.1" fill="#15171A"/><rect x="41.4" y="${y}" width="2.4" height="${h}" rx="1.1" fill="#15171A"/>`).join('');
  return `<svg xmlns="http://www.w3.org/2000/svg" width="42" height="42" viewBox="0 0 64 64">
  <defs>
    <linearGradient id="${id}-paint" x1="0" y1="0" x2="1" y2="0">
      <stop offset="0" stop-color="${edge}"/><stop offset=".12" stop-color="${shade}"/><stop offset=".34" stop-color="${paint}"/><stop offset=".5" stop-color="${highlight}"/><stop offset=".7" stop-color="${paint}"/><stop offset=".9" stop-color="${shade}"/><stop offset="1" stop-color="${edge}"/>
    </linearGradient>
    <linearGradient id="${id}-length" x1="0" y1="0" x2="0" y2="1">
      <stop offset="0" stop-color="#FFFFFF" stop-opacity="${dark ? '.16' : '.32'}"/><stop offset=".3" stop-color="#FFFFFF" stop-opacity="0"/><stop offset=".75" stop-color="#000000" stop-opacity="0"/><stop offset="1" stop-color="#000000" stop-opacity="${dark ? '.25' : '.12'}"/>
    </linearGradient>
    <linearGradient id="${id}-rim" gradientUnits="userSpaceOnUse" x1="${pose.lightX}" y1="${pose.lightY}" x2="${64 - pose.lightX}" y2="${64 - pose.lightY}">
      <stop offset="0" stop-color="#FFFFFF" stop-opacity="${dark ? '.55' : '.9'}"/><stop offset=".5" stop-color="#FFFFFF" stop-opacity="0"/>
    </linearGradient>
    <linearGradient id="${id}-roof" x1="0" y1="0" x2="1" y2="0">
      <stop offset="0" stop-color="${shade}"/><stop offset=".2" stop-color="${paint}"/><stop offset=".42" stop-color="${highlight}"/><stop offset=".8" stop-color="${paint}"/><stop offset="1" stop-color="${shade}"/>
    </linearGradient>
    <linearGradient id="${id}-glass" x1="0" y1="0" x2="0" y2="1">
      <stop offset="0" stop-color="#4E5865"/><stop offset=".55" stop-color="#262C34"/><stop offset="1" stop-color="#14181D"/>
    </linearGradient>
    <linearGradient id="${id}-glare" x1="0" y1="0" x2="1" y2="1">
      <stop offset="0" stop-color="#FFFFFF" stop-opacity=".34"/><stop offset="1" stop-color="#FFFFFF" stop-opacity="0"/>
    </linearGradient>
    <radialGradient id="${id}-soft" cx=".5" cy=".5" r=".5">
      <stop offset="0" stop-color="#0A0E09" stop-opacity=".42"/><stop offset=".55" stop-color="#0A0E09" stop-opacity=".18"/><stop offset="1" stop-color="#0A0E09" stop-opacity="0"/>
    </radialGradient>
    <radialGradient id="${id}-head" cx=".5" cy=".5" r=".5">
      <stop offset="0" stop-color="#FFFBE8" stop-opacity=".75"/><stop offset="1" stop-color="#FFFBE8" stop-opacity="0"/>
    </radialGradient>
    <radialGradient id="${id}-tail" cx=".5" cy=".5" r=".5">
      <stop offset="0" stop-color="#FF3B30" stop-opacity=".55"/><stop offset="1" stop-color="#FF3B30" stop-opacity="0"/>
    </radialGradient>
    <linearGradient id="${id}-led" x1="0" y1="0" x2="0" y2="1">
      <stop offset="0" stop-color="#FF6A5E"/><stop offset="1" stop-color="#B3140C"/>
    </linearGradient>
  </defs>
  <ellipse cx="${32 + shadowX}" cy="${32.5 + shadowY}" rx="15.5" ry="26" fill="url(#${id}-soft)"/>
  <path d="${BODY}" fill="#0A0E09" fill-opacity=".38" transform="translate(${shadowX} ${shadowY})"/>
  ${tyres}
  <path d="${BODY}" fill="none" stroke="#FFFFFF" stroke-opacity="${dark ? '.85' : '.6'}" stroke-width="2.6" stroke-linejoin="round"/>
  <path d="${BODY}" fill="url(#${id}-paint)" stroke="#1E2227" stroke-opacity="${dark ? '.55' : '.7'}" stroke-width="1.1" stroke-linejoin="round"/>
  <path d="${BODY}" fill="url(#${id}-length)"/>
  <path d="${BODY}" fill="none" stroke="url(#${id}-rim)" stroke-width=".9"/>
  <path d="M27.6 11Q27.3 15.4 26.5 19.8M36.4 11Q36.7 15.4 37.5 19.8" stroke="${shade}" stroke-opacity=".7" stroke-width=".45" fill="none" stroke-linecap="round"/>
  <path d="M21.2 21.4Q18.6 21 18.2 22.9Q18.3 23.9 21.2 23.7ZM42.8 21.4Q45.4 21 45.8 22.9Q45.7 23.9 42.8 23.7Z" fill="${shade}" stroke="${edge}" stroke-width=".35"/>
  <path d="M19 23L20.8 23M43.2 23L45 23" stroke="#1A1E24" stroke-width=".7" stroke-linecap="round"/>
  <path d="M23.7 20.6Q32 18 40.3 20.6L38.7 27Q32 25.9 25.3 27ZM25.2 48.2Q32 49 38.8 48.2L39.6 51.8Q32 52.9 24.4 51.8ZM22.5 22.6L24.4 27.4L24.4 47.2L22.4 49.6ZM41.5 22.6L39.6 27.4L39.6 47.2L41.6 49.6Z" fill="url(#${id}-glass)"/>
  <path d="M25.2 20.4Q28.4 19.4 31.2 19.2L28.2 26.3Q26.6 26.5 25.7 26.7Z" fill="url(#${id}-glare)"/>
  <path d="M25.3 27Q32 25.9 38.7 27L38.8 47.4Q32 48.2 25.2 47.4Z" fill="url(#${id}-roof)"/>
  <ellipse cx="30" cy="31" rx="3.2" ry="1.6" fill="#FFFFFF" fill-opacity="${dark ? '0' : '.35'}"/>
  <path d="M26.2 28.2L26.2 46.4M37.8 28.2L37.8 46.4" stroke="#1D2025" stroke-opacity=".75" stroke-width="1" stroke-linecap="round"/>
  <path d="M22.6 34L24.4 34M39.6 34L41.4 34M22.6 41.2L24.4 41.2M39.6 41.2L41.4 41.2" stroke="${shade}" stroke-width="1.2"/>
  <ellipse cx="25.6" cy="9.5" rx="4" ry="2" fill="url(#${id}-head)"/>
  <ellipse cx="38.4" cy="9.5" rx="4" ry="2" fill="url(#${id}-head)"/>
  <path d="M23.2 11Q24.4 9.6 27.8 9.5M40.8 11Q39.6 9.6 36.2 9.5" stroke="#FFFFFF" stroke-width="1.15" stroke-linecap="round" fill="none"/>
  <ellipse cx="32" cy="55" rx="10.6" ry="2.2" fill="url(#${id}-tail)"/>
  <path d="M22.8 53.3Q32 55.1 41.2 53.3" stroke="url(#${id}-led)" stroke-width="1.15" stroke-linecap="round" fill="none"/>
</svg>`;
}

// Moto vista de cima (mesma luz e sombra do carro): pneus, tanque na cor do veículo, piloto de
// capacete e guidão. Estreita e longa como uma moto real, para não parecer um carro pequeno.
function createLeafMotoSvg({ colorToken = 'black', screenHeading = 0, idPrefix = 'leaf-moto' } = {}) {
  const [highlight, paint, shade, edge] = PAINTS[colorToken] || PAINTS.black;
  const pose = resolveVehicleArtworkPose(screenHeading);
  const id = String(idPrefix).replace(/[^a-zA-Z0-9_-]/g, '') || 'leaf-moto';
  const dx = 32 - pose.lightX;
  const dy = 32 - pose.lightY;
  const reach = Math.hypot(dx, dy) || 1;
  const sx = Number((dx / reach * 1.4).toFixed(2));
  const sy = Number((dy / reach * 1.4).toFixed(2));
  return `<svg xmlns="http://www.w3.org/2000/svg" width="42" height="42" viewBox="0 0 64 64">
  <defs>
    <linearGradient id="${id}-paint" x1="0" y1="0" x2="1" y2="0">
      <stop offset="0" stop-color="${edge}"/><stop offset=".25" stop-color="${shade}"/><stop offset=".5" stop-color="${highlight}"/><stop offset=".75" stop-color="${shade}"/><stop offset="1" stop-color="${edge}"/>
    </linearGradient>
    <radialGradient id="${id}-helmet" gradientUnits="userSpaceOnUse" cx="${(32 + (pose.lightX - 32) * 0.12).toFixed(2)}" cy="${(31 + (pose.lightY - 32) * 0.12).toFixed(2)}" r="5.6">
      <stop offset="0" stop-color="#F4F6F8"/><stop offset=".55" stop-color="#C9CED4"/><stop offset="1" stop-color="#7E858E"/>
    </radialGradient>
    <radialGradient id="${id}-soft" cx=".5" cy=".5" r=".5">
      <stop offset="0" stop-color="#0A0E09" stop-opacity=".3"/><stop offset="1" stop-color="#0A0E09" stop-opacity="0"/>
    </radialGradient>
    <radialGradient id="${id}-head" cx=".5" cy=".5" r=".5">
      <stop offset="0" stop-color="#FFFBE8" stop-opacity=".8"/><stop offset="1" stop-color="#FFFBE8" stop-opacity="0"/>
    </radialGradient>
  </defs>
  <ellipse cx="${32 + sx}" cy="${33 + sy}" rx="9" ry="24" fill="url(#${id}-soft)"/>
  <rect x="29.6" y="8.5" width="4.8" height="11" rx="2.4" fill="#16181B"/>
  <rect x="29.4" y="44" width="5.2" height="12" rx="2.6" fill="#16181B"/>
  <path d="M28.4 18Q32 15.6 35.6 18L36.6 30Q32 32 27.4 30Z" fill="url(#${id}-paint)" stroke="${edge}" stroke-width=".4"/>
  <path d="M27.6 33Q32 31.4 36.4 33L35.8 47Q32 48.4 28.2 47Z" fill="#2A2D32" stroke="#16181B" stroke-width=".4"/>
  <path d="M21.5 20.4Q32 17.6 42.5 20.4" stroke="#2A2D32" stroke-width="1.6" stroke-linecap="round" fill="none"/>
  <circle cx="21.4" cy="20.4" r="1.2" fill="#16181B"/><circle cx="42.6" cy="20.4" r="1.2" fill="#16181B"/>
  <path d="M26.2 27Q22.6 23.4 22.8 21.2M37.8 27Q41.4 23.4 41.2 21.2" stroke="${shade}" stroke-width="2.2" stroke-linecap="round" fill="none"/>
  <ellipse cx="32" cy="34" rx="6.6" ry="5" fill="${paint}" fill-opacity=".9"/>
  <circle cx="32" cy="31" r="5.4" fill="url(#${id}-helmet)" stroke="#5D646C" stroke-width=".4"/>
  <path d="M28.6 28.2Q32 26.4 35.4 28.2" stroke="#1C2026" stroke-width="1.3" stroke-linecap="round" fill="none"/>
  <ellipse cx="32" cy="8.6" rx="3.6" ry="1.8" fill="url(#${id}-head)"/>
  <circle cx="32" cy="10" r=".9" fill="#FFFFFF"/>
  <path d="M30.4 55.6L33.6 55.6" stroke="#E0362C" stroke-width="1.2" stroke-linecap="round"/>
</svg>`;
}
