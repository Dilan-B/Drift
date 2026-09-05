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
  private var hasFoundSurface = false
  private var isPlaced = false

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

  private func runSession() {
    guard let view = sceneView else { return }
    let config = ARWorldTrackingConfiguration()
    config.planeDetection = [.horizontal]
    config.environmentTexturing = .automatic
    view.session.run(config, options: [.resetTracking, .removeExistingAnchors])
  }

  // ── Commands from JS ────────────────────────────────────────
  /// Drop the box wherever the centre of the screen is pointing.
  @objc func place() {
    guard let view = sceneView, !isPlaced else { return }
    let centre = CGPoint(x: view.bounds.midX, y: view.bounds.midY)

    guard let query = view.raycastQuery(from: centre,
                                        allowing: .existingPlaneGeometry,
                                        alignment: .horizontal),
          let hit = view.session.raycast(query).first else {
      onARError?(["message": "Point at a flat surface and try again."])
      return
    }

    let node = makeBoxNode(side: CGFloat(truncating: boxSize))
    node.simdTransform = hit.worldTransform
    view.scene.rootNode.addChildNode(node)
    boxNode = node
    isPlaced = true

    let t = hit.worldTransform.columns.3
    onPlaced?(["x": t.x, "y": t.y, "z": t.z])
  }

  @objc func reset() {
    boxNode?.removeFromParentNode()
    boxNode = nil
    isPlaced = false
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
  private func makeBoxNode(side: CGFloat) -> SCNNode {
    let root = SCNNode()
    let wallH = side * 0.45
    let t: CGFloat = 0.004   // wall thickness

    let glass = SCNMaterial()
    glass.diffuse.contents = UIColor(red: 0.24, green: 0.42, blue: 0.31, alpha: 0.35)
    glass.emission.contents = UIColor(red: 0.18, green: 0.42, blue: 0.29, alpha: 0.12)
    glass.isDoubleSided = true
    glass.lightingModel = .physicallyBased

    let floorMat = SCNMaterial()
    floorMat.diffuse.contents = UIColor(red: 0.24, green: 0.42, blue: 0.31, alpha: 0.22)
    floorMat.isDoubleSided = true

    let floor = SCNBox(width: side, height: t, length: side, chamferRadius: 0.002)
    floor.materials = [floorMat]
    let floorNode = SCNNode(geometry: floor)
    floorNode.position = SCNVector3(0, Float(t / 2), 0)
    root.addChildNode(floorNode)

    // Walls, placed by rotating the same panel around the floor.
    let offsets: [(CGFloat, CGFloat)] = [(0, side / 2), (0, -side / 2), (side / 2, 0), (-side / 2, 0)]
    for (i, off) in offsets.enumerated() {
      let horizontal = i < 2
      let wall = SCNBox(width: horizontal ? side : t,
                        height: wallH,
                        length: horizontal ? t : side,
                        chamferRadius: 0.001)
      wall.materials = [glass]
      let n = SCNNode(geometry: wall)
      n.position = SCNVector3(Float(off.0), Float(wallH / 2), Float(off.1))
      root.addChildNode(n)
    }

    // A brighter rim so the opening reads clearly against a busy carpet or desk.
    let rim = SCNBox(width: side, height: 0.0025, length: side, chamferRadius: 0.001)
    let rimMat = SCNMaterial()
    rimMat.diffuse.contents = UIColor(red: 0.42, green: 0.72, blue: 0.53, alpha: 0.9)
    rimMat.emission.contents = UIColor(red: 0.42, green: 0.72, blue: 0.53, alpha: 0.35)
    rim.materials = [rimMat]
    let rimNode = SCNNode(geometry: rim)
    rimNode.position = SCNVector3(0, Float(wallH), 0)
    root.addChildNode(rimNode)

    root.opacity = 0
    root.runAction(.fadeIn(duration: 0.35))
    return root
  }

  // ── ARSCNViewDelegate ───────────────────────────────────────
  func renderer(_ renderer: SCNSceneRenderer, didAdd node: SCNNode, for anchor: ARAnchor) {
    guard anchor is ARPlaneAnchor, !hasFoundSurface else { return }
    hasFoundSurface = true
    DispatchQueue.main.async { self.onSurfaceFound?(["found": true]) }
  }

  func session(_ session: ARSession, didFailWithError error: Error) {
    DispatchQueue.main.async {
      self.onARError?(["message": error.localizedDescription])
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
