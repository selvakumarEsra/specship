import React from 'react';
import ReactDOM from 'react-dom/client';
import '@fontsource-variable/geist';
import '@fontsource-variable/geist-mono';
import './styles/app.css';
import './styles/fonts.css';
import { App } from './App';
import { applyDensity, getDensity } from './prefs';
import { applyTheme, getThemePref, watchSystemTheme } from './theme';

applyTheme(getThemePref());
watchSystemTheme();
applyDensity(getDensity());

ReactDOM.createRoot(document.getElementById('root')!).render(
  <React.StrictMode>
    <App />
  </React.StrictMode>,
);
