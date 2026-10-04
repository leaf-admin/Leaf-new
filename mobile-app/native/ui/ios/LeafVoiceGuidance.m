#import <React/RCTBridgeModule.h>

@interface RCT_EXTERN_MODULE(LeafVoiceGuidance, NSObject)
RCT_EXTERN_METHOD(isAvailable:(NSString *)locale resolver:(RCTPromiseResolveBlock)resolve rejecter:(RCTPromiseRejectBlock)reject)
RCT_EXTERN_METHOD(speak:(NSString *)text locale:(NSString *)locale utteranceId:(NSString *)utteranceId resolver:(RCTPromiseResolveBlock)resolve rejecter:(RCTPromiseRejectBlock)reject)
RCT_EXTERN_METHOD(stop:(RCTPromiseResolveBlock)resolve rejecter:(RCTPromiseRejectBlock)reject)
@end
