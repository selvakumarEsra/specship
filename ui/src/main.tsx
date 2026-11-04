import React from 'react';
import ReactDOM from 'react-dom/client';
import '@fontsource-variable/geist';
import '@fontsource-variable/geist-mono';
import './styles/tokens.css';
import './styles/app.css';
import './styles/fonts.css';
import { App } from './App';
import { applyDensity, getDensity } from './prefs';
import { applyTheme } from './theme';

applyTheme();
applyDensity(getDensity());

ReactDOM.createRoot(document.getElementById('root')!).render(
  <React.StrictMode>
    <App />
  </React.StrictMode>,
);
