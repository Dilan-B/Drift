import WidgetKit
import SwiftUI

@main
struct DriftWidgetBundle: WidgetBundle {
  var body: some Widget {
    DriftBalanceWidget()
    if #available(iOS 16.1, *) {
      DriftInLiveActivityWidget()
    }
  }
}
