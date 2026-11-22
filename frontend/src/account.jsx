import { useState } from 'react';
import { Link, useNavigate, useSearchParams } from 'react-router-dom';
import { Camera, CircleUserRound, MapPin, Plus, Settings2 } from 'lucide-react';
import { api, bookingStatus, longDate, money, useApi } from './api';
import { Alert, Empty, Loading } from './ui';
import { CourtMap } from './map';
import { useSite } from './state';

export function Account() {
  const site = useSite();
  const [params] = useSearchParams();
  const nav = useNavigate();
  const [register, setRegister] = useState(false), [busy, setBusy] = useState(false), [error, setError] = useState('');
  const next = params.get('next');
  const safeNext = next && /^\/(?:$|[^/\\\u0000-\u0020])/.test(next) ? new URL(next, window.location.origin) : null;
  const destination = safeNext?.origin === window.location.origin && !safeNext.pathname.startsWith('//') ?
    `${safeNext.pathname}${safeNext.search}${safeNext.hash}` : null;
  async function submit(event) {
    event.preventDefault();setBusy(true);setError('');
    const body = Object.fromEntries(new FormData(event.currentTarget));
    if (register && body.password !== body.confirm) {setError('Hai mật khẩu chưa khớp.');setBusy(false);return;}
    try {
      delete body.confirm;
      await api(register ? '/auth/register' : '/auth/login',{body});
      const save = Number(params.get('save'));
      if (Number.isInteger(save) && save > 0) {
        try {await api(`/favorites/${save}`,{method:'PUT',body:{saved:true}});}
        catch (e) {site.setNotice(e.message);}
      }
      site.refreshUser();
      if (destination) nav(destination,{replace:true});
    } catch (e) {setError(e.message);}
    finally {setBusy(false);}
  }
  if (site.sessionLoading) return <div className="shell page narrow"><Loading/></div>;
  if (site.user) return <Profile key={site.user.id} user={site.user}/>;
  return <div className="shell page sign-in"><section className="panel auth"><span className="feature-icon"><CircleUserRound size={27}/></span>
    <h1>{register ? 'Tạo tài khoản' : 'Đăng nhập'}</h1><p className="muted">{register ? 'Tạo tài khoản để đặt và lưu sân.' : 'Xem sân đã lưu và theo dõi các đơn đặt.'}</p>
    <div className="auth-tabs"><button aria-pressed={!register} type="button" onClick={() => {setRegister(false);setError('');}}>Đăng nhập</button>
      <button aria-pressed={register} type="button" onClick={() => {setRegister(true);setError('');}}>Đăng ký</button></div>
    <Alert>{error || site.sessionError}</Alert><form className="stack-form" onSubmit={submit} key={String(register)}>
      {register ? <><label>Họ và tên<input name="name" autoComplete="name" required minLength={2} maxLength={100}/></label>
        <label>Số điện thoại<input name="phone" type="tel" autoComplete="tel" required maxLength={24}/></label>
        <label>Email<input name="email" type="email" placeholder="ban@gmail.com" autoComplete="email" required maxLength={120}/></label></> :
        <label>Họ tên hoặc số điện thoại<input name="login" autoComplete="username" required maxLength={100}/></label>}
      <label>Mật khẩu<input name="password" type="password" required minLength={register ? 8 : 1} maxLength={128}
        autoComplete={register ? 'new-password' : 'current-password'}/></label>
      {register && <label>Nhập lại mật khẩu<input name="confirm" type="password" required minLength={8} maxLength={128} autoComplete="new-password"/></label>}
      <button className="button primary wide" disabled={busy}>{busy ? 'Đang xử lý…' : register ? 'Đăng ký' : 'Đăng nhập'}</button>
    </form></section></div>;
}

function Profile({ user }) {
  const site = useSite();
  const [message, setMessage] = useState(''), [error, setError] = useState(''), [busy, setBusy] = useState(false);
  async function action(event, logout = false) {
    event.preventDefault();setBusy(true);setError('');setMessage('');
    try {
      if (logout) {await api('/auth/logout',{body:{}});site.refreshUser();}
      else {
        await api('/auth/profile',{method:'PUT',body:Object.fromEntries(new FormData(event.currentTarget))});
        setMessage('Đã lưu thông tin.');
      }
    } catch (e) {setError(e.message);}
    finally {setBusy(false);}
  }
  return <div className="shell page narrow"><h1>Tài khoản</h1><section className="panel checkout"><Alert>{error}</Alert>
    {message && <p className="info-box" role="status">{message}</p>}
    <form className="stack-form" onSubmit={action}><label>Họ và tên<input name="name" defaultValue={user.name} required minLength={2}/></label>
      <label>Email<input name="email" type="email" defaultValue={user.email} required/></label>
      <label>Số điện thoại<input value={user.phone} readOnly/></label><button className="button primary" disabled={busy}>Lưu thông tin</button></form>
    <div className="form-actions">{['admin','owner'].includes(user.role) && <Link to="/quan-tri" className="button secondary"><Settings2 size={17}/> Quản trị</Link>}
      <button className="button secondary" disabled={busy} onClick={(e) => action(e,true)}>Đăng xuất</button></div>
  </section></div>;
}

const blank = { name:'', area:'', address:'', lat:null, lng:null, open:'06:00', close:'22:30',
  price:100000, image:'', featured:false, verified:false, active:true, ownerPhone:'' };
export function Admin() {
  const { user, sessionLoading, sessionError } = useSite();
  const [revision, reload] = useState(0), [editing, setEditing] = useState(null), [tab, setTab] = useState('venues');
  const admin = user?.role === 'admin';
  const allowed = admin || user?.role === 'owner';
  const venues = useApi(allowed ? '/manage/venues' : null,revision);
  const orders = useApi(allowed && tab === 'bookings' ? '/manage/bookings' : null,revision);
  const selected = venues.value?.find((venue) => venue.id === editing);
  const list = venues.value ?? [];
  if (sessionError) return <div className="shell page"><Alert>{sessionError}</Alert></div>;
  if (sessionLoading) return <div className="shell page"><Loading/></div>;
  if (!allowed) return <div className="shell page"><Empty title="Trang quản trị dành cho chủ sân và quản trị viên"
    action={<Link to="/tai-khoan?next=%2Fquan-tri" className="button primary">{user ? 'Tài khoản' : 'Đăng nhập'}</Link>}/></div>;
  return <div className="shell page"><div className="section-heading"><div><h1>Quản trị sân</h1><p>{admin ? 'Quản trị viên' : 'Chủ sân'}</p></div>
    <button className="button primary" onClick={() => {setEditing('new');setTab('venues');}}><Plus size={18}/> Thêm cụm sân</button></div>
    <div className="filter-row"><div className="filter-chips"><button className={`chip ${tab === 'venues' ? 'on' : ''}`} onClick={() => setTab('venues')}>Cụm sân</button>
      <button className={`chip ${tab === 'bookings' ? 'on' : ''}`} onClick={() => setTab('bookings')}>Đơn đặt sân</button></div></div>
    {tab === 'venues' ? <div className="admin-columns"><section className="panel admin-list"><h2>Danh sách cụm sân</h2>
      <Alert>{venues.error}</Alert>{venues.loading ? <Loading/> : list.map((venue) => <button className="admin-venue" key={venue.id} aria-pressed={venue.id === editing}
        onClick={() => setEditing(venue.id)}><strong>{venue.name}</strong><span>{venue.area} · {venue.courts.length} sân · {venue.active ? (venue.verified ? 'Đã xác minh' : 'Tham khảo') : 'Đã ẩn'}</span></button>)}</section>
      {editing === 'new' || selected ? <VenueEditor key={editing} venue={selected} admin={admin} onSaved={(id) => {
        setEditing(id);reload((n) => n + 1);
      }}/> : <section className="panel"><h2>Thông tin sân</h2><p className="muted">Chọn một cụm sân để sửa hoặc thêm cụm sân mới.</p></section>}</div> :
      orders.loading ? <Loading/> : orders.error ? <Alert>{orders.error}</Alert> : !orders.value?.length ? <Empty title="Chưa có đơn đặt sân"/> :
        <div className="history-list">{orders.value.map((entry) => <div className="panel order-row" key={entry.id}>
          <div><strong>{entry.venueName} · {entry.courtName}</strong><p>{longDate(entry.date)} · {entry.time}–{entry.end}</p></div>
          <div><strong>{money(entry.amount)}</strong><small className={`state-tag ${entry.status}`}>{bookingStatus[entry.status]}</small>
            {entry.status !== 'review' && entry.paymentStatus === 'review' && <small className="state-tag review">Cần đối soát thanh toán</small>}</div>
          <small>Mã {entry.code} · {entry.provider === 'demo' ? 'Thử' : 'payOS'}</small></div>)}</div>}
  </div>;
}

function VenueEditor({ venue, admin, onSaved }) {
  const [data, setData] = useState(() => venue ? { name:venue.name, area:venue.area || '', address:venue.address,
    lat:venue.lat, lng:venue.lng, open:venue.open, close:venue.close, price:venue.price, image:venue.image,
    featured:Boolean(venue.featured), verified:Boolean(venue.verified), active:Boolean(venue.active), ownerPhone:venue.owner_phone || '' } : blank);
  const [error, setError] = useState(''), [message, setMessage] = useState(''), [busy, setBusy] = useState(false);
  const [map, setMap] = useState(false), [file, setFile] = useState(null), [courtName, setCourtName] = useState('');
  const edit = (key, value) => setData((old) => ({...old,[key]:value}));
  async function submit(event) {
    event.preventDefault();setBusy(true);setError('');setMessage('');
    try {
      let image;
      if (file) {
        if (file.size > 2_000_000) throw new Error('Chọn ảnh nhỏ hơn 2 MB.');
        const encoded = await new Promise((resolve,reject) => {const reader = new FileReader();reader.onload = () => resolve(reader.result);
          reader.onerror = () => reject(new Error('Không đọc được ảnh.'));reader.readAsDataURL(file);});
        image = (await api('/upload-court-photo',{body:{image:encoded}})).image;
      }
      const response = await api(venue ? `/manage/venues/${venue.id}` : '/manage/venues', { method:venue ? 'PUT' : 'POST',
        body:{...data,price:Number(data.price),image} });
      setMessage('Đã lưu cụm sân.');onSaved(response.id);
    } catch (e) {setError(e.message);}
    finally {setBusy(false);}
  }
  async function updateCourt(event, court) {
    event.preventDefault();setBusy(true);setError('');setMessage('');
    try {
      if (court) await api(`/manage/venues/${venue.id}/courts/${court.id}`,{method:'PUT',body:{active:!court.active}});
      else {await api(`/manage/venues/${venue.id}/courts`,{body:{name:courtName}});setCourtName('');}
      onSaved(venue.id);
    } catch (e) {setError(e.message);}
    finally {setBusy(false);}
  }
  return <section className="panel"><h2>{venue ? 'Chỉnh sửa cụm sân' : 'Thêm cụm sân'}</h2><Alert>{error}</Alert>
    {message && <p className="info-box" role="status">{message}</p>}<form onSubmit={submit} className="stack-form">
      <div className="form-split"><label>Tên cụm sân<input required value={data.name} onChange={(e) => edit('name',e.target.value)}/></label>
        <label>Khu vực<input required value={data.area} onChange={(e) => edit('area',e.target.value)}/></label></div>
      <label>Địa chỉ<input required value={data.address} onChange={(e) => edit('address',e.target.value)}/></label>
      <div className="form-split"><label>Mở cửa<input type="time" step="1800" required value={data.open} onChange={(e) => edit('open',e.target.value)}/></label>
        <label>Đóng cửa (HH:mm)<input type="text" pattern="([01][0-9]|2[0-3]):(00|30)|24:00" required value={data.close}
          onChange={(e) => edit('close',e.target.value)}/></label></div>
      <div className="form-split"><label>Giá mỗi giờ (₫)<input type="number" min="1000" max="5000000" required value={data.price} onChange={(e) => edit('price',e.target.value)}/></label>
        <label><span className="location-line"><Camera size={16}/> Ảnh sân</span><input type="file" accept="image/png,image/jpeg,image/webp" onChange={(e) => setFile(e.target.files[0] || null)}/></label></div>
      <div className="form-actions"><button type="button" className="button secondary" onClick={() => setMap(!map)}><MapPin size={17}/>{map ? 'Ẩn bản đồ' : 'Ghim vị trí'}</button>
        <span className="muted">{data.lat == null ? 'Chưa có tọa độ' : `${data.lat.toFixed(5)}, ${data.lng.toFixed(5)}`}</span></div>
      {map && <><p className="muted">Bấm vào bản đồ hoặc kéo ghim đến lối vào cụm sân.</p><CourtMap point={data}
        onPick={(point) => setData((old) => ({...old,...point}))} className="compact-map"/></>}
      {admin && <><label>Số điện thoại chủ sân<input type="tel" value={data.ownerPhone} onChange={(e) => edit('ownerPhone',e.target.value)}
        placeholder="Tài khoản chủ sân đã đăng ký"/></label><div className="check-row">
        <label><input type="checkbox" checked={data.featured} onChange={(e) => edit('featured',e.target.checked)}/> Sân nổi bật</label>
        <label><input type="checkbox" checked={data.verified} onChange={(e) => edit('verified',e.target.checked)}/> Đã xác minh</label></div></>}
      {venue && <label className="check"><input type="checkbox" checked={data.active} onChange={(e) => edit('active',e.target.checked)}/> Hiện cụm sân trên web</label>}
      <button className="button primary" disabled={busy}>{busy ? 'Đang lưu…' : 'Lưu cụm sân'}</button>
    </form>
    {venue && <div className="admin-courts"><h3>Các sân nhỏ</h3>{venue.courts.map((court) => <div key={court.id}><span>{court.name} · {court.active ? 'Mở đặt' : 'Tạm khóa'}</span>
      <button className="text-button" disabled={busy} onClick={(e) => updateCourt(e,court)}>{court.active ? 'Tạm khóa' : 'Mở lại'}</button></div>)}
      <form className="inline-form" onSubmit={(e) => updateCourt(e)}><input required placeholder="Tên sân nhỏ" aria-label="Tên sân nhỏ" value={courtName}
        onChange={(e) => setCourtName(e.target.value)}/><button className="button secondary" disabled={busy}><Plus size={17}/> Thêm sân</button></form></div>}
  </section>;
}
