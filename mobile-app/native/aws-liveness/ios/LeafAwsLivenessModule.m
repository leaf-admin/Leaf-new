#import <React/RCTBridgeModule.h>

@interface RCT_EXTERN_MODULE(LeafAwsLiveness, NSObject)

RCT_EXTERN_METHOD(start:(NSDictionary *)options
                  resolver:(RCTPromiseResolveBlock)resolve
                  rejecter:(RCTPromiseRejectBlock)reject)

@end
