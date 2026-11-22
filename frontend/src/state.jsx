import { createContext, useContext, useState } from 'react';
import { useLocation, useNavigate } from 'react-router-dom';
import { api, useApi } from './api';

const Context = createContext(null);
export const useSite = () => useContext(Context);

export function SiteProvider({ children }) {
  const [userRevision, bumpUser] = useState(0), [favoriteRevision, bumpFavorites] = useState(0);
  const session = useApi('/auth/me', userRevision);
  const config = useApi('/config');
  const favorite = useApi(session.value ? `/favorites` : null, `${userRevision}:${favoriteRevision}`);
  const [origin, setOrigin] = useState(null), [overlay, setOverlay] = useState(null), [notice, setNotice] = useState('');
  const location = useLocation(), navigate = useNavigate();
  async function saveVenue(id) {
    if (!session.value) {
      navigate(`/tai-khoan?${new URLSearchParams({ next: location.pathname + location.search, save: id })}`);
      return;
    }
    try {
      await api(`/favorites/${id}`, { method:'PUT', body:{ saved:!favorite.value?.includes(id) } });
      bumpFavorites((n) => n + 1);
    } catch (error) { setNotice(error.message); }
  }
  return <Context.Provider value={{ user:session.value, sessionLoading:session.loading, sessionError:session.error,
    config:config.value, origin, setOrigin, overlay, setOverlay, notice, setNotice, favorites:favorite.value ?? [],
    favoriteLoading:favorite.loading, saveVenue, refreshUser:() => bumpUser((n) => n + 1) }}>{children}</Context.Provider>;
}
