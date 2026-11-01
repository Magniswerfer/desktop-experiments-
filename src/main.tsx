import { StrictMode, useEffect, useState } from 'react';
import { createRoot } from 'react-dom/client';
import { App } from './App';
import { connectDesk } from './library/deskBridge';
import { useLibStore } from './library/model/store';
import { LibraryApp } from './library/ui/LibraryApp';
import './styles.css';

// Two entry points into one prototype:
//   #library (default) — the Library full screen, with a simulated context switcher
//   #desk              — the Lodestone desk, with the Library as a window whose
//                        context follows the focused window and Assembly
const route = () => (location.hash === '#desk' ? 'desk' : 'library');

function Root() {
  const [r, setR] = useState(route);
  useEffect(() => {
    const on = () => setR(route());
    window.addEventListener('hashchange', on);
    return () => window.removeEventListener('hashchange', on);
  }, []);
  useEffect(() => {
    document.title = r === 'desk' ? 'Lodestone' : 'Library — Lodestone';
    if (r === 'desk') return connectDesk();
    useLibStore.getState().setCtx({ source: 'simulated' });
  }, [r]);
  return r === 'desk' ? <App /> : <div className="lib-root"><LibraryApp /></div>;
}

createRoot(document.getElementById('root')!).render(
  <StrictMode>
    <Root />
  </StrictMode>,
);
