import Skia from './leafSkia';

// Map backdrop for the glass lens. Skia cannot read the native Google Map's
// pixels, so the map is snapshotted once its camera settles and every glass
// surface refracts its slice of that image. Any camera movement drops the
// snapshot at once, so a stale map is never shown through the glass.
// The map must sit still this long before the lens appears. During driver
// navigation the camera moves every second, so the lens never flips on/off
// (that read as the banner blinking between black and grey).
const CAPTURE_DELAY_MS = 1500;

let state = { image: null, frame: null };
let generation = 0;
let timer = null;
const listeners = new Set();

function emit() {
  listeners.forEach((listener) => listener(state));
}

export function subscribeGlassBackdrop(listener) {
  listeners.add(listener);
  return () => listeners.delete(listener);
}

export function getGlassBackdrop() {
  return state;
}

export function isGlassBackdropSupported() {
  return Boolean(Skia);
}

export function invalidateGlassBackdrop() {
  generation += 1;
  if (timer) {
    clearTimeout(timer);
    timer = null;
  }
  if (state.image) {
    state = { image: null, frame: null };
    emit();
  }
}

/**
 * `capture` resolves to `{ base64, frame }`: a JPEG of the map and the map's
 * window frame in dp. Captures superseded by camera movement are discarded.
 */
export function scheduleGlassBackdropCapture(capture) {
  if (!Skia || listeners.size === 0) return;
  if (timer) clearTimeout(timer);
  const captureGeneration = ++generation;
  timer = setTimeout(async () => {
    timer = null;
    try {
      const result = await capture();
      if (captureGeneration !== generation || !result?.base64 || !result?.frame?.width) return;
      const image = Skia.Skia.Image.MakeImageFromEncoded(Skia.Skia.Data.fromBase64(result.base64));
      if (!image || captureGeneration !== generation) return;
      state = { image, frame: result.frame };
      emit();
    } catch (_error) {
      // Lens is decorative; the blur underneath stays.
    }
  }, CAPTURE_DELAY_MS);
}
