import AVFoundation
import React

@objc(LeafVoiceGuidance)
final class LeafVoiceGuidance: NSObject, AVSpeechSynthesizerDelegate {
  private let synthesizer = AVSpeechSynthesizer()
  private var currentUtterance: AVSpeechUtterance?
  private var previousAudio: (AVAudioSession.Category, AVAudioSession.Mode, AVAudioSession.CategoryOptions)?
  @objc static func requiresMainQueueSetup() -> Bool { true }
  @objc var methodQueue: DispatchQueue { DispatchQueue.main }

  override init() {
    super.init()
    synthesizer.delegate = self
  }

  @objc(isAvailable:resolver:rejecter:)
  func isAvailable(_ locale: String, resolver resolve: RCTPromiseResolveBlock, rejecter reject: RCTPromiseRejectBlock) {
    resolve(AVSpeechSynthesisVoice(language: locale) != nil)
  }

  @objc(speak:locale:utteranceId:resolver:rejecter:)
  func speak(_ text: String, locale: String, utteranceId: String, resolver resolve: RCTPromiseResolveBlock, rejecter reject: RCTPromiseRejectBlock) {
    guard !text.isEmpty, let voice = AVSpeechSynthesisVoice(language: locale) else {
      reject("VOICE_UNAVAILABLE", "A voz em português não está disponível.", nil)
      return
    }
    do {
      currentUtterance = nil
      synthesizer.stopSpeaking(at: .immediate)
      let audio = AVAudioSession.sharedInstance()
      if previousAudio == nil { previousAudio = (audio.category, audio.mode, audio.categoryOptions) }
      try audio.setCategory(.playback, mode: .voicePrompt, options: [.duckOthers])
      try audio.setActive(true)
      let utterance = AVSpeechUtterance(string: String(text.prefix(400)))
      utterance.voice = voice
      utterance.rate = AVSpeechUtteranceDefaultSpeechRate
      currentUtterance = utterance
      synthesizer.speak(utterance)
      resolve(true)
    } catch {
      restoreAudio()
      reject("VOICE_FAILED", "Não foi possível reproduzir a orientação.", error)
    }
  }

  @objc(stop:rejecter:)
  func stop(_ resolve: RCTPromiseResolveBlock, rejecter reject: RCTPromiseRejectBlock) {
    currentUtterance = nil
    synthesizer.stopSpeaking(at: .immediate)
    restoreAudio()
    resolve(true)
  }

  func speechSynthesizer(_ synthesizer: AVSpeechSynthesizer, didFinish utterance: AVSpeechUtterance) {
    finish(utterance)
  }

  func speechSynthesizer(_ synthesizer: AVSpeechSynthesizer, didCancel utterance: AVSpeechUtterance) {
    finish(utterance)
  }

  private func finish(_ utterance: AVSpeechUtterance) {
    guard currentUtterance === utterance else { return }
    currentUtterance = nil
    restoreAudio()
  }

  private func restoreAudio() {
    guard let previous = previousAudio else { return }
    previousAudio = nil
    let audio = AVAudioSession.sharedInstance()
    try? audio.setActive(false, options: .notifyOthersOnDeactivation)
    try? audio.setCategory(previous.0, mode: previous.1, options: previous.2)
  }
}
