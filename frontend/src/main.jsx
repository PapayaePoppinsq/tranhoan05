import { useEffect, useRef, useState } from 'react';
import { createRoot } from 'react-dom/client';
import { BrowserRouter, Link, NavLink, Route, Routes, useLocation } from 'react-router-dom';
import { ArrowUpRight, CalendarDays, CircleUserRound, Crosshair, Heart, MapPin, MessageCircle, Sparkles, Zap } from 'lucide-react';
import { api, today } from './api';
import { Brand, Alert, Dialog, Empty, ResultList } from './ui';
import { CourtMap } from './map';
import { Home, Saved } from './home';
import { Detail, Review, Payment, History } from './booking';
import { Account, Admin } from './account';
import { SiteProvider, useSite } from './state';
import './style.css';

function PositionDialog({ onClose }) {
  const { origin, setOrigin } = useSite();
  const [point, setPoint] = useState(origin), [busy, setBusy] = useState(false), [error, setError] = useState('');
  function locate() {
    if (!navigator.geolocation) return setError('Trình duyệt chưa hỗ trợ định vị. Hãy chọn một điểm trên bản đồ.');
    setBusy(true); setError('');
    navigator.geolocation.getCurrentPosition(({ coords }) => {
      setPoint({ lat:coords.latitude, lng:coords.longitude }); setBusy(false);
    }, () => { setError('Chưa lấy được vị trí. Hãy cấp quyền hoặc chọn một điểm trên bản đồ.'); setBusy(false); },
    { enableHighAccuracy:false, timeout:9000, maximumAge:120000 });
  }
  return <Dialog title="Điểm xuất phát" icon={<MapPin size={22}/>} onClose={onClose}>
    <p className="muted">Dùng vị trí hiện tại hoặc bấm lên bản đồ để tính khoảng cách tới sân.</p>
    <button className="button secondary" type="button" onClick={locate} disabled={busy}><Crosshair size={17}/>{busy ? 'Đang định vị…' : 'Dùng vị trí hiện tại'}</button>
    <Alert>{error}</Alert><CourtMap point={point} onPick={setPoint} className="compact-map"/>
    <div className="form-actions"><button className="button primary" disabled={!point} onClick={() => {setOrigin(point); onClose();}}>Dùng điểm này</button>
      {origin && <button className="button secondary" onClick={() => {setOrigin(null); onClose();}}>Xóa điểm xuất phát</button>}</div>
  </Dialog>;
}

function QuickDialog({ onClose }) {
  const { origin } = useSite();
  const todayValue = today();
  const [date, setDate] = useState(''), [budget, setBudget] = useState(''), [after, setAfter] = useState('');
  const [results, setResults] = useState(null), [busy, setBusy] = useState(false), [error, setError] = useState('');
  async function suggest(event) {
    event?.preventDefault(); setBusy(true); setError(''); setResults(null);
    try {
      const data = await api('/quick', { body:{ date:date || undefined, after:after || undefined,
        maxPrice:budget === '' ? undefined : Number(budget), origin:origin || undefined } });
      setResults(data.results);
    } catch (e) { setError(e.message); }
    finally { setBusy(false); }
  }
  useEffect(() => { suggest(); }, []);
  return <Dialog title="Đặt nhanh thông minh" icon={<Zap size={22}/>} onClose={onClose}>
    <p className="muted">Gợi ý khung trống dựa trên vị trí, ngân sách, sân đã lưu và lịch sử đặt của bạn.</p>
    <form onSubmit={suggest} className="quick-form"><label>Ngày chơi<input type="date" min={todayValue} max={today(30)} value={date} onChange={(e) => setDate(e.target.value)}/></label>
      <label>Sau giờ<input type="time" value={after} onChange={(e) => setAfter(e.target.value)}/></label>
      <label>Ngân sách (₫)<input min="0" max="10000000" type="number" value={budget} placeholder="Không giới hạn" onChange={(e) => setBudget(e.target.value)}/></label>
      <button className="button primary" disabled={busy}>{busy ? 'Đang tìm…' : 'Tìm giờ'}</button></form>
    <Alert>{error}</Alert>{results?.length ? <ResultList results={results} onChoose={onClose}/> :
      results && <p className="muted">Chưa tìm được giờ phù hợp. Hãy đổi ngày, giờ hoặc ngân sách.</p>}
  </Dialog>;
}

const examples = ['Tìm sân tối mai, sau 7 giờ, dưới 200 nghìn', 'Tìm sân ở Quyết Thắng chiều mai'];
function ChatDialog({ onClose }) {
  const { origin, config, setOverlay } = useSite();
  const [log, setLog] = useState([]), [input, setInput] = useState(''), [context, setContext] = useState(null);
  const [busy, setBusy] = useState(false), [mode, setMode] = useState(config?.chat || 'demo');
  const scroll = useRef(null);
  useEffect(() => { if (scroll.current) scroll.current.scrollTop = scroll.current.scrollHeight; }, [log,busy]);
  async function send(text) {
    if (!text.trim() || busy) return;
    setInput(''); setBusy(true);
    setLog((messages) => [...messages, { client:true, text }]);
    try {
      const history = log.slice(-4).map(({ client, text:content }) => ({ role:client ? 'user' : 'assistant', content }));
      const response = await api('/chat', {body:{message:text, context:context || undefined, origin:origin || undefined, history}});
      setContext(response.criteria); setMode(response.mode);
      setLog((messages) => [...messages, { text:response.reply, results:response.results }]);
    } catch (e) { setLog((messages) => [...messages, { text:e.message }]); }
    finally { setBusy(false); }
  }
  return <Dialog title="Trợ lý tìm sân" icon={<Sparkles size={22}/>} onClose={onClose} className="chat-dialog">
    <div className="chat-tools"><span>{mode === 'ai' ? 'Chatbot chữ' : mode === 'fallback' ? 'AI gián đoạn · đang dùng quy tắc' : 'Chế độ thử · tìm bằng quy tắc'}</span>
      <button className="text-button" onClick={() => setOverlay('position')}>Chọn vị trí</button>
      {log.length > 0 && <button className="text-button" disabled={busy} onClick={() => {setContext(null);setLog([]);}}>Hỏi mới</button>}</div>
    <div className="chat-log" ref={scroll} aria-live="polite"><p className="chat-bubble">Chào bạn! Cứ nói bạn muốn chơi lúc nào, ở đâu hoặc hỏi mình về một cụm sân nhé.</p>
      {log.map((message, index) => <div key={index} className={message.client ? 'chat-user' : 'chat-answer'}>
        <p className="chat-bubble">{message.text}</p>{message.results?.length ? <ResultList results={message.results} onChoose={onClose}/> : null}</div>)}
      {busy && <p className="chat-bubble">Mình đang xem yêu cầu của bạn…</p>}</div>
    {!log.length && <div className="sample-messages">{examples.map((entry) => <button key={entry} className="chip" onClick={() => send(entry)}>{entry}</button>)}</div>}
    <form onSubmit={(e) => {e.preventDefault();send(input);}} className="chat-form"><input aria-label="Nhập yêu cầu tìm sân" maxLength={500} value={input}
      placeholder="Ví dụ: Chơi tối mai, sau 7 giờ…" onChange={(e) => setInput(e.target.value)}/><button className="button primary" disabled={busy || !input.trim()}>Gửi</button></form>
  </Dialog>;
}

function Site() {
  const { overlay, setOverlay, origin, user, notice, setNotice } = useSite();
  const location = useLocation();
  const [backToChat, setBackToChat] = useState(false);
  useEffect(() => { window.scrollTo({ top:0 }); }, [location.pathname]);
  useEffect(() => {
    if (overlay === 'chat') setBackToChat(true);
    if (!overlay) setBackToChat(false);
  }, [overlay]);
  const close = () => setOverlay(null);
  const manage = user && ['admin','owner'].includes(user.role);
  return <><header className="site-header"><div className="shell nav-row"><Brand/>
    <nav aria-label="Điều hướng chính"><NavLink to="/" end>Tìm sân</NavLink><NavLink to="/lich-su"><CalendarDays size={16}/> Lịch sử</NavLink>
      <NavLink to="/da-luu"><Heart size={16}/> Sân đã lưu</NavLink>{manage && <NavLink to="/quan-tri">Quản trị</NavLink>}</nav>
    <div className="nav-actions"><button className="nav-location" aria-label="Chọn điểm xuất phát" onClick={() => setOverlay('position')}><MapPin size={18}/><span>{origin ? 'Đã chọn vị trí' : 'Thái Nguyên'}</span></button>
      <Link className="account-link" to="/tai-khoan"><CircleUserRound size={18}/><span>{user ? 'Tài khoản' : 'Đăng nhập'}</span></Link></div></div></header>
    <main id="noi-dung"><Routes>
      <Route path="/" element={<Home/>}/><Route path="/da-luu" element={<Saved/>}/><Route path="/san/:id" element={<Detail/>}/>
      <Route path="/xem-lai" element={<Review/>}/><Route path="/thanh-toan/:id" element={<Payment/>}/><Route path="/lich-su" element={<History/>}/>
      <Route path="/tai-khoan" element={<Account/>}/><Route path="/quan-tri" element={<Admin/>}/>
      <Route path="*" element={<div className="shell page"><Empty title="Không tìm thấy trang" action={<Link className="button primary" to="/">Về trang tìm sân</Link>}/></div>}/>
    </Routes></main>
    <footer className="site-footer"><div className="shell"><Brand/><span>Tìm và đặt sân pickleball tại Thái Nguyên.</span><Link to="/">Tìm sân <ArrowUpRight size={15}/></Link></div></footer>
    {location.pathname !== '/quan-tri' && <button className="floating-chat" onClick={() => setOverlay('chat')}><MessageCircle size={22}/><span>Trợ lý tìm sân</span></button>}
    {(overlay === 'chat' || overlay === 'position' && backToChat) && <ChatDialog onClose={close}/>}
    {overlay === 'position' && <PositionDialog onClose={backToChat ? () => setOverlay('chat') : close}/>}
    {overlay === 'quick' && <QuickDialog onClose={close}/>}
    {notice && <div className="notice" role="alert"><span>{notice}</span><button className="text-button" onClick={() => setNotice('')}>Đóng</button></div>}
  </>;
}

createRoot(document.getElementById('root')).render(<BrowserRouter><SiteProvider><Site/></SiteProvider></BrowserRouter>);
