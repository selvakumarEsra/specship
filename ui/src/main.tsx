import React from 'react';
import ReactDOM from 'react-dom/client';
import '@fontsource-variable/geist';
import '@fontsource-variable/geist-mono';
import './styles/app.css';
import './styles/fonts.css';
import { App } from './App';
import { applyTheme, getThemePref, watchSystemTheme } from './theme';

applyTheme(getThemePref());
watchSystemTheme();

ReactDOM.createRoot(document.getElementById('root')!).render(
  <React.StrictMode>
    <App />
  </React.StrictMode>,
);
