//
// LockboxARView.swift
// Drift — the AR placement step for Lockbox.
//
// SCOPE, SO NOBODY EXTENDS THIS BY MISTAKE
// This view exists to place a box on a real surface and then get out of the
// way. It does NOT watch the phone. It cannot: the moment the phone is set down
// inside the box the camera is looking at cardboard, tracking dies, and ARKit
// has nothing to report. Enforcement is LockboxModule streaming CoreMotion.
//
// The box is a commitment ritual. Choosing a spot and watching a box land on it
// makes "put your phone away" a physical act rather than a checkbox, and that is
// the entire reason this file is worth its weight. Treat it as ceremony, and let
// the accelerometer do the policing.
//
// TEARDOWN MATTERS. ARKit runs the camera, the neural engine and 60fps
// rendering. Left running through a 90-minute session it would cook the phone
// inside a closed box. `pauseSession()` is called the moment
// the phone is in the box (the JS side calls it from autoStart), and the view
// is unmounted straight after. Between the drop and that moment the camera
// stays on only so the box can still be dragged, pinched and turned.
//
import Foundation
import UIKit
import ARKit
import SceneKit
import React

@objc(LockboxARView)
class LockboxARView: UIView, ARSCNViewDelegate, UIGestureRecognizerDelegate {

  // Events consumed by the JS component.
  @objc var onSurfaceFound: RCTDirectEventBlock?
  @objc var onPlaced: RCTDirectEventBlock?
  @objc var onARError: RCTDirectEventBlock?

  /// Inside LENGTH of the box, in metres. Roughly twice the box a phone ships
  /// in (~165 × 85 × 35mm): big enough to find again at a glance and to set a
  /// phone into without aiming, small enough to still read as a phone's box.
  @objc var boxSize: NSNumber = 0.24

  private var sceneView: ARSCNView?
  private var coaching: ARCoachingOverlayView?
  private var boxNode: SCNNode?
  /// The ghost that follows the surface before anything is committed. Without
  /// it the user is aiming at nothing and has to tap to find out where the box
  /// would have gone, which is a guess, not a placement.
  private var previewNode: SCNNode?
  private var hasFoundSurface = false
  private var isPlaced = false
  private var isTargeting = false
  /// Screen centre, cached on the main thread. The render loop cannot read
  /// `bounds` safely, and it needs this value 60 times a second.
  private var cachedCentre: CGPoint = .zero

  /// Smoothed ghost pose. Raycast hits jitter by a centimetre or two frame to
  /// frame; following them raw makes the box shiver and, on a fresh estimated
  /// plane, jump in depth. Easing toward the hit hides both.
  private var ghostPos: simd_float3?
  private var ghostYaw: Float = 0

  /// The placed box is pinned to an ARAnchor rather than to a world position.
  /// When the camera is paused (phone set down) and resumed (phone picked up),
  /// ARKit relocalizes and moves anchors with the room. A bare world position
  /// stays put in a coordinate system that has shifted, which is how the box
  /// ended up floating near the phone instead of on the desk.
  private var boxAnchor: ARAnchor?
  private var boxYaw: Float = 0
  private var boxScale: Float = 1
  private var isDragging = false

  // Gesture state for adjusting a placed box.
  private var pinchStartScale: Float = 1
  private var rotateStartYaw: Float = 0
  /// Raycast hits closer than this to the camera are the user's own hand,
  /// lap or the phone's case edge, never the surface they're aiming at.
  private static let minHitDistance: Float = 0.25
  private static let minScale: Float = 0.6
  private static let maxScale: Float = 2.0

  override init(frame: CGRect) {
    super.init(frame: frame)
    setUp()
  }

  required init?(coder: NSCoder) {
    super.init(coder: coder)
    setUp()
  }

  private func setUp() {
    guard ARWorldTrackingConfiguration.isSupported else {
      // Reported rather than crashed: the JS side falls back to a plain
      // "set your phone down" flow on devices without ARKit.
      DispatchQueue.main.async {
        self.onARError?(["message": "ARKit is not supported on this device."])
      }
      return
    }

    let view = ARSCNView(frame: bounds)
    view.autoresizingMask = [.flexibleWidth, .flexibleHeight]
    // ARSCNViewDelegate already inherits ARSessionObserver, so didFailWithError
    // arrives through this one assignment. Setting session.delegate as well
    // would need full ARSessionDelegate conformance for no extra callbacks.
    view.delegate = self
    view.automaticallyUpdatesLighting = true
    view.antialiasingMode = .multisampling4X
    view.scene = SCNScene()
    addSubview(view)
    sceneView = view

    // Drag, pinch and twist a placed box. Simultaneous, so a two-finger
    // pinch-and-turn works the way it does in Photos or Maps.
    let pan = UIPanGestureRecognizer(target: self, action: #selector(handlePan(_:)))
    pan.maximumNumberOfTouches = 1
    let pinch = UIPinchGestureRecognizer(target: self, action: #selector(handlePinch(_:)))
    let rotate = UIRotationGestureRecognizer(target: self, action: #selector(handleRotate(_:)))
    for g in [pan, pinch, rotate] as [UIGestureRecognizer] {
      g.delegate = self
      view.addGestureRecognizer(g)
    }

    // Apple's own "move your phone to find a surface" choreography. Writing our
    // own would be worse and would need localising into every language Apple
    // already ships this in.
    let overlay = ARCoachingOverlayView(frame: bounds)
    overlay.autoresizingMask = [.flexibleWidth, .flexibleHeight]
    overlay.session = view.session
    overlay.goal = .horizontalPlane
    overlay.activatesAutomatically = true
    addSubview(overlay)
    coaching = overlay

    runSession()
  }

  override func layoutSubviews() {
    super.layoutSubviews()
    cachedCentre = CGPoint(x: bounds.midX, y: bounds.midY)
  }

  private func makeConfig() -> ARWorldTrackingConfiguration {
    let config = ARWorldTrackingConfiguration()
    config.planeDetection = [.horizontal]
    config.environmentTexturing = .automatic
    // On LiDAR phones, scene depth makes raycasts land at the real distance
    // immediately instead of on a guessed plane that settles seconds later —
    // the "box won't sit at the right depth" problem.
    if ARWorldTrackingConfiguration.supportsFrameSemantics(.sceneDepth) {
      config.frameSemantics.insert(.sceneDepth)
    }
    return config
  }

  private func runSession() {
    guard let view = sceneView else { return }
    view.session.run(makeConfig(), options: [.resetTracking, .removeExistingAnchors])

    ghostPos = nil
    if previewNode == nil {
      let ghost = makeBoxNode(preview: true)
      ghost.isHidden = true
      view.scene.rootNode.addChildNode(ghost)
      previewNode = ghost
    }
  }

  // ── Commands from JS ────────────────────────────────────────
  /// Drop the box wherever the ghost is standing.
  @objc func place() {
    guard let view = sceneView, !isPlaced else { return }
    // Commit exactly where the ghost is standing. Re-raycasting here would let
    // the box land somewhere the user never saw it — a hand tremor between
    // aiming and tapping is enough.
    guard let ghost = previewNode, !ghost.isHidden else {
      onARError?(["message": "Point at a flat surface and try again."])
      return
    }

    let node = makeBoxNode(preview: false)
    boxYaw = ghost.simdEulerAngles.y
    boxScale = 1
    node.simdPosition = ghost.simdPosition
    node.simdEulerAngles = simd_float3(0, boxYaw, 0)
    view.scene.rootNode.addChildNode(node)
    boxNode = node
    pin(at: ghost.simdPosition)

    // A short drop onto the surface, so it reads as landing rather than
    // appearing. Only the inner geometry moves; the node's own position is
    // the true placement.
    if let body = node.childNode(withName: "body", recursively: false) {
      body.position.y = 0.04
      let fall = SCNAction.moveBy(x: 0, y: -0.04, z: 0, duration: 0.28)
      fall.timingMode = .easeIn
      body.runAction(fall)
    }

    ghost.removeFromParentNode()
    previewNode = nil
    isPlaced = true
    isTargeting = false

    // Once the box is down, the coaching overlay must not slide back over it
    // every time tracking wobbles — that read as "it broke".
    coaching?.activatesAutomatically = false
    coaching?.setActive(false, animated: true)

    let t = node.simdPosition
    onPlaced?(["x": t.x, "y": t.y, "z": t.z])
  }

  @objc func reset() {
    if let a = boxAnchor { sceneView?.session.remove(anchor: a) }
    boxAnchor = nil
    boxNode?.removeFromParentNode()
    boxNode = nil
    previewNode?.removeFromParentNode()
    previewNode = nil
    isPlaced = false
    isTargeting = false
    hasFoundSurface = false
    coaching?.activatesAutomatically = true
    runSession()
  }

  /// Stop the camera and the renderer. Called before the session proper starts —
  /// see the teardown note at the top of this file.
  @objc func pauseSession() {
    sceneView?.session.pause()
  }

  /// Camera back on after a pause, WITHOUT resetting: anchors survive and ARKit
  /// relocalizes against the room it already mapped, so the placed box comes
  /// back where it was. Used when the phone is picked up again before the
  /// session has started.
  @objc func resumeSession() {
    guard let view = sceneView else { return }
    view.session.run(makeConfig(), options: [])
  }

  private func pin(at pos: simd_float3) {
    guard let view = sceneView else { return }
    if let old = boxAnchor { view.session.remove(anchor: old) }
    var t = matrix_identity_float4x4
    t.columns.3 = simd_float4(pos.x, pos.y, pos.z, 1)
    let a = ARAnchor(name: "drift.lockbox", transform: t)
    view.session.add(anchor: a)
    boxAnchor = a
  }

  // ── Gestures (placed box only) ──────────────────────────────
  func gestureRecognizer(_ g: UIGestureRecognizer,
                         shouldRecognizeSimultaneouslyWith other: UIGestureRecognizer) -> Bool {
    return true
  }

  /// Dragging only grabs the box when the finger starts on (or near) it. It
  /// used to follow any swipe anywhere on screen, so brushing the glass while
  /// setting the phone down teleported the box.
  @objc private func handlePan(_ g: UIPanGestureRecognizer) {
    guard isPlaced, let view = sceneView, let node = boxNode else { return }
    let p = g.location(in: view)
    switch g.state {
    case .began:
      let c = view.projectPoint(node.presentation.worldPosition)
      isDragging = hypot(CGFloat(c.x) - p.x, CGFloat(c.y) - p.y) < 140
    case .changed:
      guard isDragging, let hit = raycast(from: p) else { return }
      let t = hit.worldTransform.columns.3
      node.simdPosition = simd_float3(t.x, t.y, t.z)
    default:
      if isDragging { pin(at: node.simdPosition) }
      isDragging = false
    }
  }

  @objc private func handlePinch(_ g: UIPinchGestureRecognizer) {
    guard isPlaced, let node = boxNode else { return }
    if g.state == .began { pinchStartScale = boxScale }
    boxScale = min(Self.maxScale, max(Self.minScale, pinchStartScale * Float(g.scale)))
    node.simdScale = simd_float3(repeating: boxScale)
  }

  @objc private func handleRotate(_ g: UIRotationGestureRecognizer) {
    guard isPlaced, let node = boxNode else { return }
    if g.state == .began { rotateStartYaw = boxYaw }
    // Screen rotation is clockwise-positive; world yaw is counter-clockwise.
    boxYaw = rotateStartYaw - Float(g.rotation)
    node.simdEulerAngles = simd_float3(0, boxYaw, 0)
  }

  /// Real surface geometry first, estimated plane as a fallback. Estimated
  /// planes are what made depth wrong: they are a guess ARKit revises for
  /// several seconds, and the box rode every revision.
  ///
  /// Hits within arm's reach of the lens are thrown away. With scene depth on,
  /// the estimated plane happily lands on a hand or a knee just below the
  /// phone, which put the box where the phone was rather than on the desk.
  private func raycast(from point: CGPoint) -> ARRaycastResult? {
    guard let view = sceneView else { return nil }
    let cam = view.session.currentFrame?.camera.transform.columns.3
    for target in [ARRaycastQuery.Target.existingPlaneGeometry, .estimatedPlane] {
      guard let q = view.raycastQuery(from: point, allowing: target, alignment: .horizontal) else { continue }
      for hit in view.session.raycast(q) {
        if let c = cam {
          let h = hit.worldTransform.columns.3
          if simd_distance(simd_float3(c.x, c.y, c.z), simd_float3(h.x, h.y, h.z)) < Self.minHitDistance { continue }
        }
        return hit
      }
    }
    return nil
  }

  // ── Geometry ────────────────────────────────────────────────
  /// A glass box about twice a phone's retail box: translucent blue faces, bright hairline edges and
  /// a lock floating above the lid, turned to always face the viewer.
  ///
  /// Every face is drawn (lid included) with its own opacity — lid strongest,
  /// floor faintest — which is what gives a flat-shaded box its volume without
  /// relying on the room's lighting. Edges are unlit so the silhouette survives
  /// any light at all.
  ///
  /// `preview` is the un-committed ghost: fainter, and gently breathing so it
  /// reads as "this is where it would go" rather than "this is placed".
  private func makeBoxNode(preview: Bool) -> SCNNode {
    let root = SCNNode()
    let body = SCNNode()
    body.name = "body"
    root.addChildNode(body)

    let length = CGFloat(truncating: boxSize)   // along local Z — away from the viewer
    let width  = length * 0.52                  // along local X
    let height = length * 0.30
    let e: CGFloat = 0.0022                     // edge thickness
    let a: CGFloat = preview ? 0.55 : 1.0

    let blue = UIColor(red: 0.30, green: 0.46, blue: 1.00, alpha: 1)
    let edge = UIColor(red: 0.78, green: 0.85, blue: 1.00, alpha: 0.95 * a)

    func glass(_ alpha: CGFloat) -> SCNMaterial {
      let m = SCNMaterial()
      m.lightingModel = .constant
      m.diffuse.contents = blue.withAlphaComponent(alpha * a)
      m.isDoubleSided = true
      m.writesToDepthBuffer = false   // glass: never hide the faces behind it
      m.blendMode = .alpha
      return m
    }

    // SCNBox material order: front, right, back, left, top, bottom.
    let shell = SCNBox(width: width, height: height, length: length, chamferRadius: 0.004)
    shell.materials = [glass(0.36), glass(0.30), glass(0.36), glass(0.30), glass(0.46), glass(0.18)]
    let shellNode = SCNNode(geometry: shell)
    shellNode.position = SCNVector3(0, Float(height / 2), 0)
    shellNode.renderingOrder = 10
    body.addChildNode(shellNode)

    let edgeMat = SCNMaterial()
    edgeMat.lightingModel = .constant
    edgeMat.diffuse.contents = edge
    edgeMat.emission.contents = edge

    func beam(_ w: CGFloat, _ h: CGFloat, _ l: CGFloat, _ x: CGFloat, _ y: CGFloat, _ z: CGFloat) {
      let g = SCNBox(width: w, height: h, length: l, chamferRadius: e / 2)
      g.materials = [edgeMat]
      let n = SCNNode(geometry: g)
      n.position = SCNVector3(Float(x), Float(y), Float(z))
      n.renderingOrder = 11
      body.addChildNode(n)
    }
    let hx = width / 2, hz = length / 2
    for y in [CGFloat(0), height] {
      beam(width + e, e, e, 0, y,  hz)
      beam(width + e, e, e, 0, y, -hz)
      beam(e, e, length + e,  hx, y, 0)
      beam(e, e, length + e, -hx, y, 0)
    }
    for (cx, cz) in [(hx, hz), (hx, -hz), (-hx, hz), (-hx, -hz)] {
      beam(e, height, e, cx, height / 2, cz)
    }

    // Lock, floating just above the lid and always turned toward the camera.
    if let img = Self.lockImage() {
      let side = width * 0.42
      let plane = SCNPlane(width: side, height: side)
      let m = SCNMaterial()
      m.lightingModel = .constant
      m.diffuse.contents = img
      m.isDoubleSided = true
      m.writesToDepthBuffer = false
      plane.materials = [m]
      let lock = SCNNode(geometry: plane)
      lock.position = SCNVector3(0, Float(height + side * 0.75), 0)
      lock.opacity = a
      lock.renderingOrder = 12
      let bb = SCNBillboardConstraint()
      bb.freeAxes = .Y
      lock.constraints = [bb]
      body.addChildNode(lock)
    }

    // A soft contact shadow, so the box sits ON the desk instead of hovering.
    let shadow = SCNPlane(width: width * 1.5, height: length * 1.3)
    let sm = SCNMaterial()
    sm.lightingModel = .constant
    sm.diffuse.contents = Self.shadowImage()
    sm.writesToDepthBuffer = false
    sm.transparency = 0.55 * a
    shadow.materials = [sm]
    let shadowNode = SCNNode(geometry: shadow)
    shadowNode.eulerAngles.x = -.pi / 2
    shadowNode.position = SCNVector3(0, 0.0008, 0)
    shadowNode.renderingOrder = 5
    root.addChildNode(shadowNode)

    if preview {
      root.opacity = 1
      root.runAction(.repeatForever(.sequence([
        .fadeOpacity(to: 0.6, duration: 0.9),
        .fadeOpacity(to: 1.0, duration: 0.9),
      ])))
    } else {
      root.opacity = 0
      root.runAction(.fadeIn(duration: 0.25))
    }
    return root
  }

  private static var cachedLock: UIImage?
  /// White SF Symbol lock on a transparent square, drawn once.
  private static func lockImage() -> UIImage? {
    if let c = cachedLock { return c }
    let cfg = UIImage.SymbolConfiguration(pointSize: 160, weight: .semibold)
    guard let sym = UIImage(systemName: "lock.fill", withConfiguration: cfg)?
            .withTintColor(.white, renderingMode: .alwaysOriginal) else { return nil }
    let size = CGSize(width: 256, height: 256)
    let img = UIGraphicsImageRenderer(size: size).image { _ in
      let s = sym.size
      let k = min(200 / s.width, 200 / s.height)
      let w = s.width * k, h = s.height * k
      sym.draw(in: CGRect(x: (size.width - w) / 2, y: (size.height - h) / 2, width: w, height: h))
    }
    cachedLock = img
    return img
  }

  private static var cachedShadow: UIImage?
  /// Radial black-to-clear falloff for the contact shadow.
  private static func shadowImage() -> UIImage {
    if let c = cachedShadow { return c }
    let size = CGSize(width: 128, height: 128)
    let img = UIGraphicsImageRenderer(size: size).image { ctx in
      let colors = [UIColor.black.withAlphaComponent(0.7).cgColor, UIColor.clear.cgColor] as CFArray
      if let g = CGGradient(colorsSpace: CGColorSpaceCreateDeviceRGB(), colors: colors, locations: [0, 1]) {
        let c = CGPoint(x: 64, y: 64)
        ctx.cgContext.drawRadialGradient(g, startCenter: c, startRadius: 0, endCenter: c, endRadius: 64, options: [])
      }
    }
    cachedShadow = img
    return img
  }

  // ── ARSCNViewDelegate ───────────────────────────────────────
  /// Runs every frame. Raycasts from the centre of the screen and walks the
  /// ghost box to whatever surface is under it, so the box is visible and
  /// aimable before it is committed.
  ///
  /// Only the hit's POSITION is used. Its rotation is whatever ARKit picked for
  /// the plane, which is why the box used to sit at an angle while the camera
  /// was pointed straight at it. Instead the box is squared up to the camera:
  /// its long side runs straight away from the viewer.
  func renderer(_ renderer: SCNSceneRenderer, updateAtTime time: TimeInterval) {
    if isPlaced {
      // Follow the anchor as ARKit refines it (and after a relocalization).
      guard !isDragging, let node = boxNode, let id = boxAnchor?.identifier,
            let a = sceneView?.session.currentFrame?.anchors.first(where: { $0.identifier == id })
      else { return }
      let t = a.transform.columns.3
      node.simdPosition = simd_float3(t.x, t.y, t.z)
      return
    }
    guard let view = sceneView, let ghost = previewNode else { return }

    guard let hit = raycast(from: cachedCentre) else {
      if isTargeting {
        isTargeting = false
        ghost.isHidden = true
        ghostPos = nil
        DispatchQueue.main.async { self.onSurfaceFound?(["found": false]) }
      }
      return
    }

    let t = hit.worldTransform.columns.3
    let target = simd_float3(t.x, t.y, t.z)

    var yaw = ghostYaw
    if let cam = view.session.currentFrame?.camera.transform {
      let f = -simd_float3(cam.columns.2.x, cam.columns.2.y, cam.columns.2.z)
      if f.x * f.x + f.z * f.z > 1e-4 { yaw = atan2(-f.x, -f.z) }
    }

    if let p = ghostPos {
      ghostPos = simd_mix(p, target, simd_float3(repeating: 0.25))
      var dy = yaw - ghostYaw
      while dy >  .pi { dy -= 2 * .pi }
      while dy < -.pi { dy += 2 * .pi }
      ghostYaw += dy * 0.25
    } else {
      ghostPos = target
      ghostYaw = yaw
    }

    ghost.simdPosition = ghostPos!
    ghost.simdEulerAngles = simd_float3(0, ghostYaw, 0)
    ghost.isHidden = false

    if !isTargeting {
      isTargeting = true
      hasFoundSurface = true
      // Only on the transition — this method runs 60 times a second and the
      // bridge is not a place to send 60 events per second.
      DispatchQueue.main.async { self.onSurfaceFound?(["found": true]) }
    }
  }

  func renderer(_ renderer: SCNSceneRenderer, didAdd node: SCNNode, for anchor: ARAnchor) {
    guard anchor is ARPlaneAnchor, !hasFoundSurface else { return }
    hasFoundSurface = true
    DispatchQueue.main.async { self.onSurfaceFound?(["found": true]) }
  }

  func session(_ session: ARSession, didFailWithError error: Error) {
    // worldTrackingFailed is ARKit losing its bearings — a dark room, a sudden
    // pan, a featureless wall — and it recovers from a restart. Reporting it to
    // JS would throw an alert in the middle of normal use, which is what made
    // "couldn't map the room" appear while placement was working fine.
    if let arError = error as? ARError, arError.code == .worldTrackingFailed {
      if isPlaced {
        // The box is down and the phone is on its way into it; the camera
        // seeing nothing is expected. Never interrupt that with an alert.
        NSLog("[Drift.Lockbox] tracking lost after placement — ignoring")
        return
      }
      NSLog("[Drift.Lockbox] tracking lost — restarting session")
      DispatchQueue.main.async { self.runSession() }
      return
    }
    if isPlaced { return }
    DispatchQueue.main.async {
      self.onARError?(["message": error.localizedDescription])
    }
  }

  /// Surfaces the honest reason placement is unavailable, so the button stays
  /// disabled with an explanation rather than silently doing nothing.
  func session(_ session: ARSession, cameraDidChangeTrackingState camera: ARCamera) {
    switch camera.trackingState {
    case .limited(.insufficientFeatures), .limited(.excessiveMotion):
      if isTargeting {
        isTargeting = false
        previewNode?.isHidden = true
        ghostPos = nil
        DispatchQueue.main.async { self.onSurfaceFound?(["found": false]) }
      }
    default:
      break
    }
  }

  override func removeFromSuperview() {
    sceneView?.session.pause()
    super.removeFromSuperview()
  }
}

// ── View manager ──────────────────────────────────────────────
@objc(LockboxARViewManager)
class LockboxARViewManager: RCTViewManager {

  override static func requiresMainQueueSetup() -> Bool { return true }

  override func view() -> UIView! { return LockboxARView() }

  /// Whether this device can run the AR step at all. JS checks it before
  /// mounting the view, so an unsupported device never sees a black rectangle.
  @objc func isSupported(_ resolve: RCTPromiseResolveBlock,
                         rejecter reject: RCTPromiseRejectBlock) {
    resolve(ARWorldTrackingConfiguration.isSupported)
  }

  private func lockboxView(_ tag: NSNumber) -> LockboxARView? {
    return bridge?.uiManager?.view(forReactTag: tag) as? LockboxARView
  }

  @objc func place(_ tag: NSNumber) {
    DispatchQueue.main.async { self.lockboxView(tag)?.place() }
  }

  @objc func reset(_ tag: NSNumber) {
    DispatchQueue.main.async { self.lockboxView(tag)?.reset() }
  }

  @objc func pauseSession(_ tag: NSNumber) {
    DispatchQueue.main.async { self.lockboxView(tag)?.pauseSession() }
  }

  @objc func resumeSession(_ tag: NSNumber) {
    DispatchQueue.main.async { self.lockboxView(tag)?.resumeSession() }
  }
}
