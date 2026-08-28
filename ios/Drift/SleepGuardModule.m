//
// SleepGuardModule.m
// Obj-C bridge exposing SleepGuardModule (Swift) to React Native.
//
#import <React/RCTBridgeModule.h>

@interface RCT_EXTERN_MODULE(SleepGuardModule, NSObject)

RCT_EXTERN_METHOD(isNfcAvailable:(RCTPromiseResolveBlock)resolve
                  rejecter:(RCTPromiseRejectBlock)reject)

// prompt/success are the only two strings iOS lets us put on the NFC sheet.
// expect is a tag UID to require ("" accepts any), so a mismatch fails on the
// sheet rather than in an alert after it closes.
RCT_EXTERN_METHOD(scanTag:(NSString *)prompt
                  success:(NSString *)success
                  expect:(NSString *)expect
                  resolver:(RCTPromiseResolveBlock)resolve
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
