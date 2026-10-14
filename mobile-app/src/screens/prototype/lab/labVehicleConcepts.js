// Development-only vehicle marker concepts for the motion lab. Top view, nose
// up, 64x64 viewBox drawn at 42pt like the current marker. Real-car
// proportions (length about 2.4x the width). Light comes from the top-left,
// so the ground shadow falls down-right. No SVG filters (react-native-svg
// support is uneven); depth comes from layered gradients only. Nothing here
// ships until a concept is approved and moved into leafVehicleArtwork.js.

const PAINTS = {
  // highlight, paint, shade, edge
  white: ['#FFFFFF', '#F1F2F3', '#CDD1D5', '#9097A0'],
  black: ['#6A6E74', '#3A3D42', '#202226', '#121316'],
  silver: ['#F0F1F2', '#C2C5C9', '#989CA2', '#686C72'],
  gray: ['#A6A9AE', '#7A7D83', '#575A60', '#383B40'],
  red: ['#D69089', '#B05A53', '#89403B', '#5F2B28'],
  green: ['#93AC9A', '#6A8273', '#4D6657', '#33463A'],
};

function shared(id, colorToken) {
  const [hi, paint, shade, edge] = PAINTS[colorToken] || PAINTS.black;
  const dark = colorToken === 'black' || colorToken === 'gray';
  return {
    edge,
    shade,
    dark,
    defs: `<defs>
    <linearGradient id="${id}-side" x1="0" y1="0" x2="1" y2="0">
      <stop offset="0" stop-color="${edge}"/><stop offset=".12" stop-color="${shade}"/><stop offset=".34" stop-color="${paint}"/><stop offset=".5" stop-color="${hi}"/><stop offset=".7" stop-color="${paint}"/><stop offset=".9" stop-color="${shade}"/><stop offset="1" stop-color="${edge}"/>
    </linearGradient>
    <linearGradient id="${id}-length" x1="0" y1="0" x2="0" y2="1">
      <stop offset="0" stop-color="#FFFFFF" stop-opacity="${dark ? '.16' : '.32'}"/><stop offset=".3" stop-color="#FFFFFF" stop-opacity="0"/><stop offset=".75" stop-color="#000000" stop-opacity="0"/><stop offset="1" stop-color="#000000" stop-opacity="${dark ? '.25' : '.12'}"/>
    </linearGradient>
    <linearGradient id="${id}-rim" x1="0" y1="0" x2="1" y2="1">
      <stop offset="0" stop-color="#FFFFFF" stop-opacity="${dark ? '.55' : '.9'}"/><stop offset=".45" stop-color="#FFFFFF" stop-opacity="0"/>
    </linearGradient>
    <linearGradient id="${id}-glass" x1="0" y1="0" x2="0" y2="1">
      <stop offset="0" stop-color="#4E5865"/><stop offset=".55" stop-color="#262C34"/><stop offset="1" stop-color="#14181D"/>
    </linearGradient>
    <linearGradient id="${id}-glare" x1="0" y1="0" x2="1" y2="1">
      <stop offset="0" stop-color="#FFFFFF" stop-opacity=".34"/><stop offset="1" stop-color="#FFFFFF" stop-opacity="0"/>
    </linearGradient>
    <linearGradient id="${id}-roof" x1="0" y1="0" x2="1" y2="0">
      <stop offset="0" stop-color="${shade}"/><stop offset=".2" stop-color="${paint}"/><stop offset=".42" stop-color="${hi}"/><stop offset=".8" stop-color="${paint}"/><stop offset="1" stop-color="${shade}"/>
    </linearGradient>
    <radialGradient id="${id}-soft" cx=".5" cy=".5" r=".5">
      <stop offset="0" stop-color="#0A0E09" stop-opacity=".3"/><stop offset=".55" stop-color="#0A0E09" stop-opacity=".12"/><stop offset="1" stop-color="#0A0E09" stop-opacity="0"/>
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
  </defs>`,
  };
}

// Shared layers around a body silhouette: ground shadow, tyres peeking out of
// the arches, paint, length falloff and a top-left rim light.
function hull(id, s, body, wheels) {
  const tyres = wheels.map(([y1, y2]) => `
  <rect x="20.2" y="${y1}" width="2.4" height="${y2 - y1}" rx="1.1" fill="#15171A"/>
  <rect x="41.4" y="${y1}" width="2.4" height="${y2 - y1}" rx="1.1" fill="#15171A"/>`).join('');
  return `
  <ellipse cx="33.4" cy="34.2" rx="16.5" ry="29" fill="url(#${id}-soft)"/>
  <path d="${body}" fill="#0A0E09" fill-opacity=".3" transform="translate(.9 1.5)"/>${tyres}
  <path d="${body}" fill="url(#${id}-side)"/>
  <path d="${body}" fill="url(#${id}-length)"/>
  <path d="${body}" fill="none" stroke="url(#${id}-rim)" stroke-width=".9"/>
  <path d="${body}" fill="none" stroke="${s.edge}" stroke-opacity=".8" stroke-width=".4"/>`;
}

function mirrors(s, y) {
  return `
  <path d="M21.2 ${y}Q18.6 ${y - 0.4} 18.2 ${y + 1.5}Q18.3 ${y + 2.5} 21.2 ${y + 2.3}Z" fill="${s.shade}" stroke="${s.edge}" stroke-width=".35"/>
  <path d="M42.8 ${y}Q45.4 ${y - 0.4} 45.8 ${y + 1.5}Q45.7 ${y + 2.5} 42.8 ${y + 2.3}Z" fill="${s.shade}" stroke="${s.edge}" stroke-width=".35"/>
  <path d="M19 ${y + 1.6}L20.8 ${y + 1.6}" stroke="#1A1E24" stroke-width=".7" stroke-linecap="round"/>
  <path d="M43.2 ${y + 1.6}L45 ${y + 1.6}" stroke="#1A1E24" stroke-width=".7" stroke-linecap="round"/>`;
}

function lights(id, frontY, rearY, rearSpan = 7.2) {
  return `
  <ellipse cx="25.6" cy="${frontY - 0.6}" rx="4" ry="2" fill="url(#${id}-head)"/>
  <ellipse cx="38.4" cy="${frontY - 0.6}" rx="4" ry="2" fill="url(#${id}-head)"/>
  <path d="M23.2 ${frontY + 0.9}Q24.4 ${frontY - 0.5} 27.8 ${frontY - 0.6}" stroke="#FFFFFF" stroke-width="1.15" stroke-linecap="round" fill="none"/>
  <path d="M40.8 ${frontY + 0.9}Q39.6 ${frontY - 0.5} 36.2 ${frontY - 0.6}" stroke="#FFFFFF" stroke-width="1.15" stroke-linecap="round" fill="none"/>
  <path d="M24.4 ${frontY + 0.9}L26.4 ${frontY + 0.2}" stroke="#9FD4FF" stroke-opacity=".55" stroke-width=".5" stroke-linecap="round"/>
  <path d="M39.6 ${frontY + 0.9}L37.6 ${frontY + 0.2}" stroke="#9FD4FF" stroke-opacity=".55" stroke-width=".5" stroke-linecap="round"/>
  <ellipse cx="32" cy="${rearY + 0.8}" rx="${rearSpan + 3}" ry="2.2" fill="url(#${id}-tail)"/>
  <path d="M${32 - rearSpan - 1.6} ${rearY - 0.9}Q32 ${rearY + 0.9} ${32 + rearSpan + 1.6} ${rearY - 0.9}" stroke="url(#${id}-led)" stroke-width="1.15" stroke-linecap="round" fill="none"/>`;
}

// A: sedan (Onix/HB20 sedan): short hood, cabin, separate trunk.
export function sedanSvg({ colorToken = 'white', id = 'sedan' } = {}) {
  const s = shared(id, colorToken);
  const body = 'M24.3 8.2C27 6.9 37 6.9 39.7 8.2C42 9.4 43.2 12 43.3 15.6C43.4 18.4 42.7 20.4 42.6 23.4L42.6 40.6C42.7 43.6 43.4 45.6 43.3 48.8C43.1 52.8 42.1 55.4 39.6 56.4C37 57.5 27 57.5 24.4 56.4C21.9 55.4 20.9 52.8 20.7 48.8C20.6 45.6 21.3 43.6 21.4 40.6L21.4 23.4C21.3 20.4 20.6 18.4 20.7 15.6C20.8 12 22 9.4 24.3 8.2Z';
  return `<svg xmlns="http://www.w3.org/2000/svg" width="42" height="42" viewBox="0 0 64 64">${s.defs}${hull(id, s, body, [[12.6, 19], [44.6, 51]])}
  <path d="M27.6 10.2Q27.2 15 26.4 20.4M36.4 10.2Q36.8 15 37.6 20.4" stroke="${s.shade}" stroke-opacity=".7" stroke-width=".45" fill="none" stroke-linecap="round"/>
  <path d="M28 10.4Q27.7 15 26.9 20.2M36 10.4Q36.3 15 37.1 20.2" stroke="#FFFFFF" stroke-opacity=".35" stroke-width=".35" fill="none" stroke-linecap="round"/>
  ${mirrors(s, 22.2)}
  <path d="M23.9 21.6Q32 18.9 40.1 21.6L38.5 28.3Q32 27.2 25.5 28.3Z" fill="url(#${id}-glass)" stroke="${s.edge}" stroke-width=".3"/>
  <path d="M25.4 21.4Q28.6 20.4 31.4 20.2L28.4 27.5Q26.8 27.7 25.9 27.9Z" fill="url(#${id}-glare)"/>
  <path d="M25.5 28.3Q32 27.2 38.5 28.3L38.6 40.6Q32 41.5 25.4 40.6Z" fill="url(#${id}-roof)"/>
  <ellipse cx="30" cy="31.5" rx="3.2" ry="1.6" fill="#FFFFFF" fill-opacity="${s.dark ? '0' : '.35'}"/>
  <path d="M22.7 23.6L24.6 28.6L24.6 40.2L22.6 42.6Z" fill="url(#${id}-glass)"/>
  <path d="M41.3 23.6L39.4 28.6L39.4 40.2L41.4 42.6Z" fill="url(#${id}-glass)"/>
  <path d="M22.8 34.2L24.6 34.2M39.4 34.2L41.2 34.2" stroke="${s.shade}" stroke-width="1.3"/>
  <path d="M23.4 25.8L23.4 32.8" stroke="#FFFFFF" stroke-opacity=".22" stroke-width=".45" stroke-linecap="round"/>
  <path d="M25.4 41.3Q32 42.2 38.6 41.3L39.8 45.6Q32 46.9 24.2 45.6Z" fill="url(#${id}-glass)" stroke="${s.edge}" stroke-width=".3"/>
  <path d="M30.4 40.5Q31.6 39.6 33.6 40.5L33 41.1Q32 40.9 31 41.1Z" fill="${s.shade}"/>
  <path d="M25.6 46.8Q32 47.9 38.4 46.8" stroke="${s.shade}" stroke-opacity=".7" stroke-width=".4" fill="none"/>
  ${lights(id, 9.3, 55.3)}
</svg>`;
}

// B: Leaf minimal: one continuous glass canopy, flat paint, best at small size.
export function canopySvg({ colorToken = 'white', id = 'canopy' } = {}) {
  const s = shared(id, colorToken);
  const body = 'M32 7C38.6 7 42.6 8.8 42.9 14C43 16.6 42.5 18.8 42.4 21.6L42.4 41.6C42.5 44.4 43 46 43 48.6C43 53.8 40.8 56.8 32 56.8S21 53.8 21 48.6C21 46 21.5 44.4 21.6 41.6L21.6 21.6C21.5 18.8 21 16.6 21.1 14C21.4 8.8 25.4 7 32 7Z';
  return `<svg xmlns="http://www.w3.org/2000/svg" width="42" height="42" viewBox="0 0 64 64">${s.defs}${hull(id, s, body, [[12.4, 18.8], [44.4, 50.8]])}
  ${mirrors(s, 21.4)}
  <path d="M32 19.4C37 19.4 40.3 20.4 40.3 22.6L39.7 44.4C39.5 46.8 36.6 47.8 32 47.8S24.5 46.8 24.3 44.4L23.7 22.6C23.7 20.4 27 19.4 32 19.4Z" fill="url(#${id}-glass)" stroke="${s.edge}" stroke-width=".35"/>
  <path d="M25.2 22.2C26.6 20.8 29.4 20.4 31.6 20.4L27.2 33.4C26 33.6 25.3 33.8 24.9 34Z" fill="url(#${id}-glare)"/>
  <path d="M24.6 28.4L39.4 28.4" stroke="#FFFFFF" stroke-opacity=".08" stroke-width=".5"/>
  <path d="M27 21.2Q32 20.4 37 21.2" stroke="#FFFFFF" stroke-opacity=".3" stroke-width=".6" fill="none" stroke-linecap="round"/>
  <path d="M27.8 11Q32 10.2 36.2 11" stroke="#FFFFFF" stroke-opacity="${s.dark ? '.2' : '.5'}" stroke-width=".6" fill="none" stroke-linecap="round"/>
  <path d="M26.2 50.4Q32 51.3 37.8 50.4" stroke="${s.shade}" stroke-opacity=".8" stroke-width=".45" fill="none"/>
  ${lights(id, 9.2, 55.3, 8.2)}
</svg>`;
}

// C: hatch/SUV (Kwid/T-Cross): shorter rear overhang, roof rails.
export function hatchSvg({ colorToken = 'white', id = 'hatch' } = {}) {
  const s = shared(id, colorToken);
  const body = 'M24.4 9C27 7.8 37 7.8 39.6 9C42.2 10.2 43.5 13 43.6 16.4C43.7 19.2 42.9 21.2 42.8 24L42.8 42.4C42.9 45.2 43.7 46.8 43.6 49.4C43.5 52.8 42.4 54.6 39.8 55.3C37 56 27 56 24.2 55.3C21.6 54.6 20.5 52.8 20.4 49.4C20.3 46.8 21.1 45.2 21.2 42.4L21.2 24C21.1 21.2 20.3 19.2 20.4 16.4C20.5 13 21.8 10.2 24.4 9Z';
  return `<svg xmlns="http://www.w3.org/2000/svg" width="42" height="42" viewBox="0 0 64 64">${s.defs}${hull(id, s, body, [[13.2, 19.8], [44.6, 51.2]])}
  <path d="M27.6 11Q27.3 15.4 26.5 19.8M36.4 11Q36.7 15.4 37.5 19.8" stroke="${s.shade}" stroke-opacity=".7" stroke-width=".45" fill="none" stroke-linecap="round"/>
  ${mirrors(s, 21.4)}
  <path d="M23.7 20.6Q32 18 40.3 20.6L38.7 27Q32 25.9 25.3 27Z" fill="url(#${id}-glass)" stroke="${s.edge}" stroke-width=".3"/>
  <path d="M25.2 20.4Q28.4 19.4 31.2 19.2L28.2 26.3Q26.6 26.5 25.7 26.7Z" fill="url(#${id}-glare)"/>
  <path d="M25.3 27Q32 25.9 38.7 27L38.8 47.4Q32 48.2 25.2 47.4Z" fill="url(#${id}-roof)"/>
  <ellipse cx="30" cy="31" rx="3.2" ry="1.6" fill="#FFFFFF" fill-opacity="${s.dark ? '0' : '.35'}"/>
  <path d="M26.2 28.2L26.2 46.4M37.8 28.2L37.8 46.4" stroke="#1D2025" stroke-opacity=".75" stroke-width="1" stroke-linecap="round"/>
  <path d="M26.5 28.6L26.5 46" stroke="#FFFFFF" stroke-opacity=".35" stroke-width=".3" stroke-linecap="round"/>
  <path d="M22.5 22.6L24.4 27.4L24.4 47.2L22.4 49.6Z" fill="url(#${id}-glass)"/>
  <path d="M41.5 22.6L39.6 27.4L39.6 47.2L41.6 49.6Z" fill="url(#${id}-glass)"/>
  <path d="M22.6 34L24.4 34M39.6 34L41.4 34M22.6 41.2L24.4 41.2M39.6 41.2L41.4 41.2" stroke="${s.shade}" stroke-width="1.2"/>
  <path d="M25.2 48.2Q32 49 38.8 48.2L39.6 51.8Q32 52.9 24.4 51.8Z" fill="url(#${id}-glass)" stroke="${s.edge}" stroke-width=".3"/>
  ${lights(id, 10.1, 54.2, 7.6)}
</svg>`;
}

export const VEHICLE_CONCEPTS = [
  { key: 'sedan', label: 'A · Sedã', build: sedanSvg },
  { key: 'canopy', label: 'B · Minimal', build: canopySvg },
  { key: 'hatch', label: 'C · Hatch/SUV', build: hatchSvg },
];
