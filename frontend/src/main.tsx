import { StrictMode } from 'react';
import { createRoot } from 'react-dom/client';
import { BrowserRouter } from 'react-router-dom';
import { AppProvider } from './context/AppContext';
import App from './App';
import './styles/tokens.css';
import './styles/themes.css';
import './styles/base.css';
import './styles/layout.css';
import './styles/components.css';
import './styles/screens.css';
import './styles/site.css';
import './styles/site-pages.css';
import './styles/account.css';
import './styles/auth.css';
import './styles/calculator.css';
import './styles/support.css';

createRoot(document.getElementById('root')!).render(
  <StrictMode>
    <BrowserRouter>
      <AppProvider>
        <App />
      </AppProvider>
    </BrowserRouter>
  </StrictMode>
);
