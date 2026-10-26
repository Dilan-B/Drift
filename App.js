import React, { useEffect, useState } from 'react';
import { initI18n, useLanguage } from './i18n';

// The app module is required only AFTER the saved language has loaded: option
// lists and labels evaluated at module scope call tr() as they load, so they
// must see the right language the first time. A language change reloads the
// JS bundle (i18n/index.js), which re-runs this; the key below is the fallback
// remount for environments without that native hook (Expo Go).
let DriftApp = null;

export default function App() {
  const [ready, setReady] = useState(false);
  const lang = useLanguage();
  useEffect(() => {
    initI18n().finally(() => {
      DriftApp = require('./Drift').default;
      setReady(true);
    });
  }, []);
  if (!ready) return null;
  return <DriftApp key={lang} />;
}
