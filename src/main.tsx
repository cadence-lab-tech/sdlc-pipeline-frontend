import {StrictMode} from 'react';
import {createRoot} from 'react-dom/client';

// Порядок значим: слои каскада идут reset → база компонентов → тема.
import '@astryxdesign/core/reset.css';
import '@astryxdesign/core/astryx.css';
import '@astryxdesign/theme-neutral/theme.css';

import {App} from './App';

createRoot(document.getElementById('root')!).render(
  <StrictMode>
    <App />
  </StrictMode>,
);
