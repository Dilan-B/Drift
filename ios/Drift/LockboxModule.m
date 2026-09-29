//
// LockboxModule.m
// Obj-C bridge exposing LockboxModule (Swift) to React Native.
//
// Note the superclass: RCTEventEmitter, not NSObject. Lockbox pushes state
// changes up to JS rather than being polled, so the module has to be an
// emitter or supportedEvents/sendEvent are never wired.
//
#import <React/RCTBridgeModule.h>
#import <React/RCTEventEmitter.h>

@interface RCT_EXTERN_MODULE(LockboxModule, RCTEventEmitter)

RCT_EXTERN_METHOD(isAvailable:(RCTPromiseResolveBlock)resolve
                  rejecter:(RCTPromiseRejectBlock)reject)

// sensitivity scales the movement threshold; 1.0 is the default.
RCT_EXTERN_METHOD(startMonitoring:(nonnull NSNumber *)sensitivity
                  resolver:(RCTPromiseResolveBlock)resolve
                  rejecter:(RCTPromiseRejectBlock)reject)

RCT_EXTERN_METHOD(stopMonitoring:(RCTPromiseResolveBlock)resolve
                  rejecter:(RCTPromiseRejectBlock)reject)

RCT_EXTERN_METHOD(currentMagnitude:(RCTPromiseResolveBlock)resolve
                  rejecter:(RCTPromiseRejectBlock)reject)

// Screen-off enforcement: record the accelerometer while suspended, judge later.
RCT_EXTERN_METHOD(startRecording:(nonnull NSNumber *)seconds
                  resolver:(RCTPromiseResolveBlock)resolve
                  rejecter:(RCTPromiseRejectBlock)reject)

RCT_EXTERN_METHOD(checkRecorded:(nonnull NSNumber *)fromMs
                  to:(nonnull NSNumber *)toMs
                  grace:(nonnull NSNumber *)grace
                  resolver:(RCTPromiseResolveBlock)resolve
                  rejecter:(RCTPromiseRejectBlock)reject)

@end
