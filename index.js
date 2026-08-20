import { registerRootComponent } from 'expo';

// Imported for its side effect, and deliberately before the app component.
//
// places.js defines the geofence background task at module scope. iOS can wake
// the app straight into that task with no UI, and the task must already be
// registered when the bundle finishes evaluating or the arrival event is
// dropped on the floor. Reaching it only through Drift.jsx's import graph made
// registration depend on a 4,000-line component module evaluating first, which
// is a lot of surface area for something that has to be true on every cold
// background wake.
import './places';

import App from './App';

registerRootComponent(App);
