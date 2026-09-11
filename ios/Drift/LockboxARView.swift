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
// inside a closed box. `pauseSession()` is called the moment placement is
// confirmed, and the view is unmounted straight after.
//
import Foundation
import UIKit
import ARKit
import SceneKit
import React

@objc(LockboxARView)
class LockboxARView: UIView, ARSCNViewDelegate {

  // Events consumed by the JS component.
  @objc var onSurfaceFound: RCTDirectEventBlock?
  @objc var onPlaced: RCTDirectEventBlock?
  @objc var onARError: RCTDirectEventBlock?

  /// Inside edge of the box, in metres. A phone is ~160mm long, so 0.22 leaves
  /// room to set it down without fighting the walls.
  @objc var boxSize: NSNumber = 0.22

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
    view.scene = SCNScene()
    addSubview(view)
    sceneView = view

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

  private func runSession() {
    guard let view = sceneView else { return }
    let config = ARWorldTrackingConfiguration()
    config.planeDetection = [.horizontal]
    config.environmentTexturing = .automatic
    view.session.run(config, options: [.resetTracking, .removeExistingAnchors])

    if previewNode == nil {
      let ghost = makeBoxNode(side: CGFloat(truncating: boxSize), preview: true)
      ghost.isHidden = true
      view.scene.rootNode.addChildNode(ghost)
      previewNode = ghost
    }
  }

  // ── Commands from JS ────────────────────────────────────────
  /// Drop the box wherever the centre of the screen is pointing.
  @objc func place() {
    guard let view = sceneView, !isPlaced else { return }
    // Commit exactly where the ghost is standing. Re-raycasting here would let
    // the box land somewhere the user never saw it — a hand tremor between
    // aiming and tapping is enough.
    guard let ghost = previewNode, !ghost.isHidden else {
      onARError?(["message": "Point at a flat surface and try again."])
      return
    }

    let transform = ghost.simdTransform
    let node = makeBoxNode(side: CGFloat(truncating: boxSize), preview: false)
    node.simdTransform = transform
    view.scene.rootNode.addChildNode(node)
    boxNode = node

    ghost.removeFromParentNode()
    previewNode = nil
    isPlaced = true
    isTargeting = false

    let t = transform.columns.3
    onPlaced?(["x": t.x, "y": t.y, "z": t.z])
  }

  @objc func reset() {
    boxNode?.removeFromParentNode()
    boxNode = nil
    previewNode?.removeFromParentNode()
    previewNode = nil
    isPlaced = false
    isTargeting = false
    hasFoundSurface = false
    runSession()
  }

  /// Stop the camera and the renderer. Called before the session proper starts —
  /// see the teardown note at the top of this file.
  @objc func pauseSession() {
    sceneView?.session.pause()
  }

  // ── Geometry ────────────────────────────────────────────────
  /// A translucent open-topped box: four walls and a floor, no lid, so the phone
  /// is visibly going *into* something.
  /// `preview` is the un-committed ghost: fainter, and gently breathing so it
  /// reads as "this is where it would go" rather than "this is placed".
  /// An open-topped container built as a lit cage: translucent panels for mass,
  /// bright beams along every edge for structure.
  ///
  /// The edges are what make it read as a solid object rather than a decal.
  /// Flat panels alone give the eye nothing to parallax against, so the box
  /// looked painted onto the floor; corner posts and rails move against the
  /// background as you walk around it, which is the whole cue for depth.
  ///
  /// Two lighting models on purpose. Panels are .blinn so they actually shade
  /// — that shading IS the three-dimensionality — with enough emission that
  /// they never wash out in daylight. Beams are .constant and fully emissive,
  /// so the silhouette survives any lighting at all.
  private func makeBoxNode(side: CGFloat, preview: Bool) -> SCNNode {
    let root = SCNNode()
    let wallH = side * 0.5
    let t: CGFloat = 0.004        // panel thickness
    let e: CGFloat = 0.007        // edge beam thickness
    let a: CGFloat = preview ? 0.45 : 1.0
    let half = side / 2

    let bright = UIColor(red: 0.42, green: 1.00, blue: 0.60, alpha: 1.0 * a)
    let mid    = UIColor(red: 0.28, green: 0.86, blue: 0.50, alpha: 1.0)

    // Panels — shaded, so the four walls catch light differently and the box
    // has interior volume.
    let panel = SCNMaterial()
    panel.lightingModel = .blinn
    panel.diffuse.contents = mid.withAlphaComponent(0.20 * a)
    panel.emission.contents = UIColor(red: 0.16, green: 0.62, blue: 0.34, alpha: 0.30 * a)
    panel.specular.contents = UIColor.white.withAlphaComponent(0.5)
    panel.shininess = 0.55
    panel.isDoubleSided = true
    panel.blendMode = .add        // glass stacking rather than flat overlay

    let floorMat = SCNMaterial()
    floorMat.lightingModel = .blinn
    floorMat.diffuse.contents = mid.withAlphaComponent(0.26 * a)
    floorMat.emission.contents = UIColor(red: 0.14, green: 0.58, blue: 0.32, alpha: 0.34 * a)
    floorMat.isDoubleSided = true

    // Beams — unlit and fully emissive, so the cage is legible in any light.
    let beamMat = SCNMaterial()
    beamMat.lightingModel = .constant
    beamMat.diffuse.contents = bright
    beamMat.emission.contents = bright

    func add(_ geo: SCNGeometry, _ mat: SCNMaterial, _ x: CGFloat, _ y: CGFloat, _ z: CGFloat) {
      geo.materials = [mat]
      let n = SCNNode(geometry: geo)
      n.position = SCNVector3(Float(x), Float(y), Float(z))
      root.addChildNode(n)
    }

    // Floor
    add(SCNBox(width: side, height: t, length: side, chamferRadius: 0.002),
        floorMat, 0, t / 2, 0)

    // Four walls
    add(SCNBox(width: side, height: wallH, length: t, chamferRadius: 0.001), panel, 0, wallH / 2,  half)
    add(SCNBox(width: side, height: wallH, length: t, chamferRadius: 0.001), panel, 0, wallH / 2, -half)
    add(SCNBox(width: t, height: wallH, length: side, chamferRadius: 0.001), panel,  half, wallH / 2, 0)
    add(SCNBox(width: t, height: wallH, length: side, chamferRadius: 0.001), panel, -half, wallH / 2, 0)

    // Bottom rails and top rails
    for y in [CGFloat(0), wallH] {
      add(SCNBox(width: side + e, height: e, length: e, chamferRadius: e / 2), beamMat, 0, y,  half)
      add(SCNBox(width: side + e, height: e, length: e, chamferRadius: e / 2), beamMat, 0, y, -half)
      add(SCNBox(width: e, height: e, length: side + e, chamferRadius: e / 2), beamMat,  half, y, 0)
      add(SCNBox(width: e, height: e, length: side + e, chamferRadius: e / 2), beamMat, -half, y, 0)
    }

    // Corner posts — the strongest depth cue, since these are the edges that
    // swing most as the viewer moves.
    for (cx, cz) in [(half, half), (half, -half), (-half, half), (-half, -half)] {
      add(SCNBox(width: e, height: wallH, length: e, chamferRadius: e / 2),
          beamMat, cx, wallH / 2, cz)
    }

    // A soft pool on the surface under the box, so it sits in the scene rather
    // than hovering above it.
    let pool = SCNPlane(width: side * 1.5, height: side * 1.5)
    let poolMat = SCNMaterial()
    poolMat.lightingModel = .constant
    poolMat.diffuse.contents = UIColor(red: 0.30, green: 0.95, blue: 0.55, alpha: 0.13 * a)
    poolMat.blendMode = .add
    poolMat.writesToDepthBuffer = false
    pool.materials = [poolMat]
    let poolNode = SCNNode(geometry: pool)
    poolNode.eulerAngles.x = -.pi / 2
    poolNode.position = SCNVector3(0, 0.0012, 0)
    root.addChildNode(poolNode)

    if preview {
      root.opacity = 1
      root.runAction(.repeatForever(.sequence([
        .fadeOpacity(to: 0.55, duration: 0.9),
        .fadeOpacity(to: 1.0,  duration: 0.9),
      ])))
    } else {
      root.opacity = 0
      root.runAction(.fadeIn(duration: 0.35))
    }
    return root
  }

  // ── ARSCNViewDelegate ───────────────────────────────────────
  /// Runs every frame. Raycasts from the centre of the screen and walks the
  /// ghost box to whatever surface is under it, so the box is visible and
  /// aimable before it is committed.
  func renderer(_ renderer: SCNSceneRenderer, updateAtTime time: TimeInterval) {
    guard !isPlaced, let view = sceneView, let ghost = previewNode else { return }

    guard let query = view.raycastQuery(from: cachedCentre,
                                        allowing: .estimatedPlane,
                                        alignment: .horizontal),
          let hit = view.session.raycast(query).first else {
      if isTargeting {
        isTargeting = false
        ghost.isHidden = true
        DispatchQueue.main.async { self.onSurfaceFound?(["found": false]) }
      }
      return
    }

    ghost.simdTransform = hit.worldTransform
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
    if let arError = error as? ARError, arError.code == .worldTrackingFailed, !isPlaced {
      NSLog("[Drift.Lockbox] tracking lost — restarting session")
      DispatchQueue.main.async { self.runSession() }
      return
    }
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
}
