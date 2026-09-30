//
// LockboxARViewManager.m
// Obj-C bridge for the Lockbox AR placement view.
//
#import <React/RCTViewManager.h>
#import <React/RCTBridgeModule.h>

@interface RCT_EXTERN_MODULE(LockboxARViewManager, RCTViewManager)

// Inside length of the box, in metres.
RCT_EXPORT_VIEW_PROPERTY(boxSize, NSNumber)

// A horizontal plane became available — the "Place box" control can enable.
RCT_EXPORT_VIEW_PROPERTY(onSurfaceFound, RCTDirectEventBlock)
// The box was anchored; carries its world position.
RCT_EXPORT_VIEW_PROPERTY(onPlaced, RCTDirectEventBlock)
// ARKit unsupported, or tracking failed. JS falls back to a non-AR flow.
RCT_EXPORT_VIEW_PROPERTY(onARError, RCTDirectEventBlock)
// The phone moved into / out of the placed box (from the camera's position).
RCT_EXPORT_VIEW_PROPERTY(onBoxProximity, RCTDirectEventBlock)
// The box became visible / hidden (hidden while ARKit re-finds the room).
RCT_EXPORT_VIEW_PROPERTY(onBoxVisible, RCTDirectEventBlock)

RCT_EXTERN_METHOD(isSupported:(RCTPromiseResolveBlock)resolve
                  rejecter:(RCTPromiseRejectBlock)reject)

RCT_EXTERN_METHOD(place:(nonnull NSNumber *)reactTag)
RCT_EXTERN_METHOD(reset:(nonnull NSNumber *)reactTag)
RCT_EXTERN_METHOD(pauseSession:(nonnull NSNumber *)reactTag)
RCT_EXTERN_METHOD(resumeSession:(nonnull NSNumber *)reactTag)

@end
