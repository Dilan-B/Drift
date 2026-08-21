//
// SleepGuardModule.m
// Obj-C bridge exposing SleepGuardModule (Swift) to React Native.
//
#import <React/RCTBridgeModule.h>

@interface RCT_EXTERN_MODULE(SleepGuardModule, NSObject)

RCT_EXTERN_METHOD(isNfcAvailable:(RCTPromiseResolveBlock)resolve
                  rejecter:(RCTPromiseRejectBlock)reject)

RCT_EXTERN_METHOD(scanTag:(RCTPromiseResolveBlock)resolve
                  rejecter:(RCTPromiseRejectBlock)reject)

RCT_EXTERN_METHOD(motionAuthStatus:(RCTPromiseResolveBlock)resolve
                  rejecter:(RCTPromiseRejectBlock)reject)

RCT_EXTERN_METHOD(requestMotionAuth:(RCTPromiseResolveBlock)resolve
                  rejecter:(RCTPromiseRejectBlock)reject)

RCT_EXTERN_METHOD(checkStillness:(nonnull NSNumber *)from
                  to:(nonnull NSNumber *)to
                  resolver:(RCTPromiseResolveBlock)resolve
                  rejecter:(RCTPromiseRejectBlock)reject)

@end
