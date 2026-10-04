package br.com.leaf.ride;

import android.media.AudioAttributes;
import android.os.Handler;
import android.os.Looper;
import android.speech.tts.TextToSpeech;
import android.speech.tts.Voice;
import com.facebook.react.bridge.Promise;
import com.facebook.react.bridge.ReactApplicationContext;
import com.facebook.react.bridge.ReactContextBaseJavaModule;
import com.facebook.react.bridge.ReactMethod;
import java.util.ArrayList;
import java.util.List;
import java.util.Locale;
import java.util.function.Consumer;

public final class LeafVoiceGuidanceModule extends ReactContextBaseJavaModule {
  private final Handler main = new Handler(Looper.getMainLooper());
  private final List<Consumer<Boolean>> waiting = new ArrayList<>();
  private TextToSpeech speech;
  private Boolean ready;
  private long generation = 0;
  private boolean disposed = false;

  public LeafVoiceGuidanceModule(ReactApplicationContext context) { super(context); }
  @Override public String getName() { return "LeafVoiceGuidance"; }

  private void prepare(Consumer<Boolean> action) {
    if (disposed) { action.accept(false); return; }
    if (ready != null) { action.accept(ready); return; }
    waiting.add(action);
    if (speech != null) return;
    speech = new TextToSpeech(getReactApplicationContext(), status -> main.post(() -> {
      ready = !disposed && status == TextToSpeech.SUCCESS;
      if (ready) speech.setAudioAttributes(new AudioAttributes.Builder()
        .setUsage(AudioAttributes.USAGE_ASSISTANCE_NAVIGATION_GUIDANCE)
        .setContentType(AudioAttributes.CONTENT_TYPE_SPEECH).build());
      List<Consumer<Boolean>> callbacks = new ArrayList<>(waiting);
      waiting.clear();
      for (Consumer<Boolean> callback : callbacks) callback.accept(ready);
    }));
  }

  private Voice offlineVoice(String languageTag) {
    if (speech == null || speech.getVoices() == null) return null;
    Locale locale = Locale.forLanguageTag(languageTag);
    for (Voice voice : speech.getVoices()) {
      if (!voice.isNetworkConnectionRequired()
        && voice.getLocale().getLanguage().equals(locale.getLanguage())
        && voice.getLocale().getCountry().equals(locale.getCountry())) return voice;
    }
    return null;
  }

  @ReactMethod public void isAvailable(String locale, Promise promise) {
    main.post(() -> prepare(ok -> promise.resolve(ok && offlineVoice(locale) != null)));
  }

  @ReactMethod public void speak(String text, String locale, String utteranceId, Promise promise) {
    main.post(() -> {
      final long request = ++generation;
      prepare(ok -> {
        if (request != generation || disposed) { promise.reject("VOICE_CANCELLED", "Orientação cancelada."); return; }
        Voice voice = ok ? offlineVoice(locale) : null;
        if (voice == null || text == null || text.trim().isEmpty()) {
          promise.reject("VOICE_UNAVAILABLE", "Instale uma voz offline em português do Brasil nos ajustes do dispositivo."); return;
        }
        speech.setVoice(voice);
        speech.setSpeechRate(1.0f);
        int result = speech.speak(text.substring(0, Math.min(text.length(), 400)), TextToSpeech.QUEUE_FLUSH, null, utteranceId);
        if (result == TextToSpeech.SUCCESS) promise.resolve(true);
        else promise.reject("VOICE_FAILED", "Não foi possível reproduzir a orientação.");
      });
    });
  }

  @ReactMethod public void stop(Promise promise) {
    main.post(() -> { generation++; if (speech != null) speech.stop(); promise.resolve(true); });
  }

  @Override public void invalidate() {
    main.post(() -> {
      disposed = true; generation++;
      for (Consumer<Boolean> action : new ArrayList<>(waiting)) action.accept(false);
      waiting.clear();
      if (speech != null) { speech.stop(); speech.shutdown(); speech = null; }
    });
    super.invalidate();
  }
}
