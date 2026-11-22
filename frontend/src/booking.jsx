import { useEffect, useMemo, useState } from 'react';
import { Link, useLocation, useNavigate, useParams, useSearchParams } from 'react-router-dom';
import { ArrowLeft, CalendarDays, CheckCircle2, Clock3, CreditCard, Heart, MapPin, Phone, ShieldCheck, TimerReset } from 'lucide-react';
import { api, bookingStatus, detailsUrl, isBookingDate, longDate, money, reviewUrl, today, useApi } from './api';
import { Alert, DateStrip, Empty, Loading, RouteLink, VenuePicture, VenueRating } from './ui';
import { CourtMap } from './map';
import { useSite } from './state';

export function Detail() {
  const { id } = useParams();
  const loc = useLocation();
  return <DetailPage key={id + loc.search} id={encodeURIComponent(id)}/>;
}

function DetailPage({ id }) {
  const site = useSite();
  const [params] = useSearchParams();
  const initialDate = params.get('date');
  const [date, setDate] = useState(isBookingDate(initialDate) ? initialDate : today());
  const [courtId, setCourtId] = useState(Number(params.get('court')) || null);
  const [duration, setDuration] = useState([30,60,90,120,150,180].includes(Number(params.get('duration'))) ? Number(params.get('duration')) : 60);
  const [selected, setSelected] = useState(null), [route, setRoute] = useState(null), [showMap, setShowMap] = useState(false);
  const [prefill, setPrefill] = useState(null), [touched, setTouched] = useState(false);
  const [reload, bump] = useState(0), [routeError, setRouteError] = useState('');
  const detail = useApi(`/venues/${id}`);
  const venue = detail.value;
  const slotData = useApi(venue ? `/venues/${id}/availability?${new URLSearchParams({date,duration})}` : null, reload);
  const targetTime = params.get('time');
  const requestedSlot = params.has('court') && targetTime;
  const proposed = !touched && prefill?.date === date && prefill.duration === duration ? prefill : null;
  const court = slotData.value?.find((item) => item.id === (courtId || proposed?.courtId)) ?? slotData.value?.[0];
  const initialTime = !touched && requestedSlot && court?.id === courtId ? targetTime : null;
  const current = court?.slots.find((slot) => slot.time === (selected || initialTime || proposed?.time) && slot.status === 'available');
  const mapVenues = useMemo(() => venue ? [venue] : [], [venue]);
  useEffect(() => {
    if (!venue || touched || site.sessionLoading || requestedSlot) return;
    const controller = new AbortController();
    api('/quick', { signal:controller.signal, body:{ venueId:venue.id,date,duration,
      after:targetTime || undefined,origin:site.origin || undefined } }).then(({results}) => {
      if (!controller.signal.aborted) setPrefill(results[0] || null);
    }, () => {});
    return () => controller.abort();
  }, [venue, date, duration, targetTime, requestedSlot, site.origin, site.sessionLoading, touched]);
  useEffect(() => {
    if (!site.origin || !venue || !showMap) { setRoute(null); setRouteError(''); return; }
    const controller = new AbortController();
    setRoute(null); setRouteError('');
    api(`/venues/${id}/route`, {body:site.origin,signal:controller.signal}).then((result) => {
      if (!controller.signal.aborted) {
        setRoute(result);
        if (!result) setRouteError('Bấm Chỉ đường để xem tuyến đường trên Google Maps.');
      }
    }, (error) => { if (!controller.signal.aborted) setRouteError(error.message); });
    return () => controller.abort();
  }, [venue, site.origin, id, showMap]);
  if (detail.loading) return <div className="shell page"><Loading/></div>;
  if (detail.error) return <div className="shell page"><Alert>{detail.error}</Alert><Link to="/">Về danh sách sân</Link></div>;
  if (!venue) return null;
  const saved = site.favorites.includes(venue.id);
  const canBook = Boolean(venue.courts.length && (venue.verified || site.config?.demo));
  function chooseDate(day) {
    if (!isBookingDate(day)) return;
    setTouched(true);
    setDate(day);
    setSelected(null);
  }
  return <div className="shell page detail"><Link className="back" to="/"><ArrowLeft size={17}/> Danh sách sân</Link>
    <div className="detail-hero"><VenuePicture venue={venue}/><div className="detail-title"><p><MapPin size={16}/> {venue.area}</p>
      <h1>{venue.name}</h1><p>{venue.address}</p></div><button className={`save-button ${saved ? 'saved' : ''}`} aria-pressed={saved}
      aria-label={saved ? 'Bỏ lưu sân' : 'Lưu sân'} onClick={() => site.saveVenue(venue.id)}><Heart size={20}/></button>
      {venue.image && venue.image_sample ? <span className="photo-caption">Ảnh minh họa</span> : null}</div>
    {venue.photo_source && <a className="photo-source" href={venue.photo_source} target="_blank" rel="noreferrer">Nguồn ảnh</a>}
    <div className="detail-facts"><span><Clock3 size={17}/> {venue.open === '00:00' && venue.close === '24:00' ? 'Mở 24 giờ' : `${venue.open}–${venue.close}`}</span>
      <VenueRating venue={venue}/>{venue.category && <span>{venue.category}</span>}
      {venue.court_count > 0 && <span>{venue.court_count} sân nhỏ</span>}
      {venue.contact_phone && <a className="text-button" href={`tel:${venue.contact_phone.replace(/[^+\d]/g, '')}`}><Phone size={16}/>{venue.contact_phone}</a>}
      <span>{venue.verified ? `${money(venue.price)}/giờ` : site.config?.demo ? `Giá thử ${money(venue.price)}/giờ` : 'Chưa có giá xác minh'}</span>
      <button className="text-button" onClick={() => setShowMap(!showMap)} aria-expanded={showMap}>
        <MapPin size={17}/>{showMap ? 'Ẩn bản đồ' : 'Xem bản đồ'}</button></div>
    {!venue.verified ? <div className="info-box"><strong>Sân đang chờ xác minh</strong>
      <p>{site.config?.demo ? 'Lịch đặt và giá dùng để chạy thử. Hãy gọi sân để xác nhận giờ và giá thật.' : 'Địa điểm này chưa mở đặt trực tuyến.'}
        {venue.map_url && <a href={venue.map_url} target="_blank" rel="noreferrer"> Xem sân trên Google Maps</a>}</p></div> : null}
    {showMap && <section className="panel map-panel"><h2>Vị trí cụm sân</h2>
      {venue.lat != null && venue.lng != null ? <CourtMap venues={mapVenues} origin={site.origin} route={route?.path}/> :
        <p className="muted">Cụm sân chưa có tọa độ ghim. Địa chỉ ghi trong danh bạ là {venue.address}.</p>}
      {route && <p className="muted">Theo đường đi · {route.km.toFixed(1)} km · khoảng {route.minutes} phút</p>}
      {routeError && <p className="muted">{routeError}</p>}
      <div className="form-actions"><RouteLink venue={venue} origin={site.origin}/><button className="button secondary"
        onClick={() => site.setOverlay('position')}><MapPin size={17}/>{site.origin ? 'Đổi điểm xuất phát' : 'Chọn điểm xuất phát'}</button></div></section>}
    <div className="detail-columns"><section className="panel schedule"><div className="section-heading"><h2>Chọn lịch chơi</h2>
      <label className="sr-only" htmlFor="booking-date">Chọn ngày khác</label><input id="booking-date" type="date" min={today()} max={today(30)}
        value={date} disabled={!canBook} onChange={(e) => chooseDate(e.target.value)}/></div>
      {canBook && <DateStrip date={date} onChange={chooseDate}/>}
      {canBook && <div className="form-split schedule-filters"><label>Sân nhỏ<select value={court?.id ?? (venue.courts.some((item) => item.id === courtId) ? courtId : venue.courts[0].id)}
        onChange={(e) => {setTouched(true);setCourtId(Number(e.target.value));setSelected(null);}}><option value="" disabled>Chọn sân nhỏ</option>
        {venue.courts.map((item) => <option key={item.id} value={item.id}>{item.name}</option>)}</select></label>
        <label>Thời lượng<select value={duration} onChange={(e) => {setTouched(true);setDuration(Number(e.target.value));setSelected(null);}}>
          {[30,60,90,120,150,180].map((d) => <option key={d} value={d}>{d} phút</option>)}</select></label></div>}
      <Alert>{slotData.error}</Alert>{slotData.error && <button className="button secondary" onClick={() => bump((n) => n + 1)}>Tải lại lịch</button>}
      {slotData.loading ? <Loading>Đang kiểm tra giờ trống…</Loading> : court ? <>
        <div className="slot-legend"><span><b/> Còn trống</span><span className="booked"><b/> Đã đặt</span><span className="held"><b/> Đang giữ</span></div>
        {!court.slots.length && <p className="muted">Thời lượng này vượt quá giờ hoạt động.</p>}
        <div className="slots">{court.slots.map((slot) => <button type="button" key={slot.time}
          className={`slot ${slot.status} ${current?.time === slot.time ? 'picked' : ''}`}
          disabled={slot.status !== 'available'} aria-pressed={current?.time === slot.time} onClick={() => {setTouched(true);setCourtId(court.id);setSelected(slot.time);}}>
          <strong>{slot.time}</strong><small>{slot.status === 'booked' ? 'Đã đặt' : slot.status === 'held' ? 'Đang giữ' :
            slot.status === 'past' ? 'Đã qua' : `đến ${slot.end}`}</small></button>)}</div>
        {targetTime && !touched && !current && court.slots.find((slot) => slot.time === targetTime && slot.status === 'available') &&
          <button className="text-button" onClick={() => {setTouched(true);setCourtId(court.id);setSelected(targetTime);}}>Chọn khung tìm kiếm {targetTime}</button>}
      </> : !slotData.error && <p className="muted">Hiện chưa có sân nhỏ mở lịch đặt.</p>}
    </section><aside className="panel summary"><h2>Đơn của bạn</h2><p className="muted">{venue.name}</p><dl className="summary-list">
      <div><dt>Ngày</dt><dd>{longDate(date)}</dd></div><div><dt>Sân nhỏ</dt><dd>{court?.name || 'Chưa chọn'}</dd></div>
      <div><dt>Giờ chơi</dt><dd>{current ? `${current.time}–${current.end}` : 'Chưa chọn'}</dd></div></dl>
      {current && proposed && <p className="demo-caption">Gợi ý đặt nhanh · {proposed.reason}. Bạn có thể đổi sân hoặc giờ.</p>}
      <div className="total"><span>Tổng tiền</span><strong>{current ? money(current.amount) : '—'}</strong></div>
      {current ? <Link className="button primary wide" to={reviewUrl({venueId:venue.id,courtId:court.id,date,time:current.time,duration})}>Xem lại đơn</Link> :
        <button className="button primary wide" disabled>Chọn khung giờ</button>}
    </aside></div>
  </div>;
}

export function Review() {
  const location = useLocation();
  return <ReviewPage key={location.search} search={location.search}/>;
}
function ReviewPage({search}) {
  const { user, sessionLoading, config } = useSite();
  const nav = useNavigate();
  const query = new URLSearchParams(search);
  const [quote, setQuote] = useState(null), [busy, setBusy] = useState(false), [error, setError] = useState('');
  const [loading, setLoading] = useState(true), [revision, refresh] = useState(0);
  useEffect(() => {
    const controller = new AbortController();
    const params = new URLSearchParams(search);
    setQuote(null);setLoading(true);setError('');
    api('/quote',{body:Object.fromEntries(params),signal:controller.signal}).then((value) => {
      if (!controller.signal.aborted) {setQuote(value);setLoading(false);}
    },
      (e) => { if (!controller.signal.aborted) {setError(e.message);setLoading(false);} });
    return () => controller.abort();
  }, [search,revision]);
  async function reserve() {
    setBusy(true);setError('');
    try {
      const value = await api('/bookings',{body:{courtId:quote.courtId,date:quote.date,time:quote.time,duration:quote.duration,amount:quote.amount}});
      nav(`/thanh-toan/${value.id}`);
    } catch (e) {setError(e.message);}
    finally {setBusy(false);}
  }
  const relatedVenue = quote?.venueId || Number(query.get('venue'));
  const edit = relatedVenue ? `/san/${relatedVenue}?${new URLSearchParams({date:quote?.date || query.get('date') || '',
    time:quote?.time || query.get('time') || '',court:quote?.courtId || query.get('courtId') || '',
    duration:quote?.duration || query.get('duration') || ''})}` : '/';
  return <div className="shell page narrow"><Link className="back" to={edit}><ArrowLeft size={17}/> {quote ? 'Sửa lựa chọn' : 'Tìm sân'}</Link>
    <h1>Xem lại đơn</h1>{loading ? <Loading/> : <section className="panel checkout"><Alert>{error}</Alert>
      {quote ? <><BookingDetails entry={quote}/><div className="total"><span>Tổng thanh toán</span><strong>{money(quote.amount)}</strong></div>
        <p className="muted">Khi bạn xác nhận, hệ thống kiểm tra lại lịch và giữ chỗ tối đa 10 phút để thanh toán.</p>
        {config?.demo && <p className="demo-caption">Chế độ thử · không thu tiền.</p>}
        {config?.payment === 'off' && <Alert>Thanh toán trực tuyến chưa mở.</Alert>}
        <div className="form-actions">{sessionLoading ? <Loading/> : user ? <button className="button primary" onClick={reserve} disabled={busy || config?.payment === 'off'}>
          {busy ? 'Đang giữ chỗ…' : 'Xác nhận và giữ chỗ'}</button> : <Link className="button primary" to={`/tai-khoan?${new URLSearchParams({next:`/xem-lai${search}`})}`}>Đăng nhập để đặt</Link>}
          <Link className="button secondary" to={edit}>Sửa lựa chọn</Link>
          {error && <button className="text-button" onClick={() => refresh((n) => n + 1)}>Kiểm tra lại lịch và giá</button>}</div>
      </> : <div className="form-actions"><button className="button secondary" onClick={() => refresh((n) => n + 1)}>Thử lại</button>
        {relatedVenue ? <Link to={edit} className="button primary">Chọn giờ khác</Link> : null}</div>}
    </section>}</div>;
}

function BookingDetails({ entry }) {
  return <><h2>{entry.venueName}</h2><p className="muted location-line"><MapPin size={16}/> {entry.address}</p>
    <dl className="summary-list"><div><dt>Sân</dt><dd>{entry.courtName}</dd></div><div><dt>Ngày</dt><dd>{longDate(entry.date)}</dd></div>
      <div><dt>Giờ</dt><dd>{entry.time}–{entry.end} · {entry.duration} phút</dd></div></dl></>;
}

export function Payment() {
  const { id } = useParams();
  const { user, sessionLoading, sessionError } = useSite();
  if (sessionLoading) return <div className="shell page"><Loading/></div>;
  if (sessionError) return <div className="shell page"><Alert>{sessionError}</Alert></div>;
  if (!user) return <div className="shell page"><Empty title="Đăng nhập để xem đơn" action={<Link className="button primary"
    to={`/tai-khoan?${new URLSearchParams({next:`/thanh-toan/${encodeURIComponent(id)}`})}`}>Đăng nhập</Link>}/></div>;
  return <PaymentPage key={`${user.id}:${id}`} id={encodeURIComponent(id)}/>;
}

function PaymentPage({ id }) {
  const [entry, setEntry] = useState(null), [loadError, setLoadError] = useState('');
  const [error, setError] = useState(''), [busy, setBusy] = useState(false), [revision, reload] = useState(0);
  const [clock, tick] = useState(Date.now());
  useEffect(() => {
    const controller = new AbortController();
    let poll;
    async function load() {
      try {
        const result = await api(`/bookings/${id}`, {signal:controller.signal});
        if (controller.signal.aborted) return;
        setEntry(result);
        setLoadError('');
        if (result.status !== 'confirmed') poll = setTimeout(load, result.status === 'pending' ? 3500 : 30000);
      } catch (e) {
        if (controller.signal.aborted) return;
        setLoadError(e.message);
        if (![400,401,403,404].includes(e.status)) poll = setTimeout(load, 6500);
        else setEntry(null);
      }
    }
    load();
    return () => {controller.abort();clearTimeout(poll);};
  }, [id,revision]);
  useEffect(() => {
    if (entry?.status !== 'pending') return;
    tick(Date.now());
    const timer = setInterval(() => tick(Date.now()), 1000);
    return () => clearInterval(timer);
  }, [entry?.status]);
  async function pay(endpoint) {
    setBusy(true);setError('');
    try {
      setEntry(await api(`/bookings/${id}/${endpoint}`,{body:{}}));
      reload((n) => n + 1);
    }
    catch (e) {setError(e.message);}
    finally {setBusy(false);}
  }
  const left = Math.max(0, (entry?.expiresAt || 0) - Math.floor(clock / 1000));
  return <div className="shell page narrow"><Link to="/lich-su" className="back"><ArrowLeft size={17}/> Lịch sử đặt sân</Link>
    <h1>{entry?.status === 'confirmed' ? 'Đặt sân thành công' : 'Thanh toán đặt sân'}</h1>
    <section className="panel checkout"><Alert>{error || loadError}</Alert>{!entry ? loadError ?
      <button className="button secondary" onClick={() => reload((n) => n + 1)}>Tải lại đơn</button> : <Loading/> : <>
      <div className={`payment-banner ${entry.status}`}>
        {entry.status === 'confirmed' ? <CheckCircle2/> : entry.status === 'pending' ? <TimerReset/> : <CreditCard/>}
        <div><strong>{bookingStatus[entry.status]}</strong><p>Mã đơn {entry.code}{entry.status === 'pending' ?
          ` · Còn ${Math.floor(left / 60)}:${String(left % 60).padStart(2,'0')}` : ''}</p></div></div>
      <BookingDetails entry={entry}/><div className="total"><span>Số tiền</span><strong>{money(entry.amount)}</strong></div>
      {entry.provider === 'demo' && <p className="demo-caption">Thanh toán mô phỏng · không thu tiền.</p>}
      {entry.status !== 'review' && entry.paymentStatus === 'review' && <p className="info-box">Giao dịch đang cần đối soát số tiền.</p>}
      {entry.status === 'pending' && left > 0 && <div className="form-actions">
        {entry.provider === 'demo' ? <button className="button primary" disabled={busy} onClick={() => pay('demo-payment')}>Mô phỏng thanh toán</button> :
          entry.checkoutUrl ? <a className="button primary" href={entry.checkoutUrl}><CreditCard size={18}/> Mở QR thanh toán</a> :
            <button className="button primary" disabled={busy} onClick={() => pay('payment')}><CreditCard size={18}/>{busy ? 'Đang tạo QR…' : 'Tạo liên kết thanh toán'}</button>}
      </div>}
      {entry.status === 'confirmed' && <Link className="button primary" to="/lich-su">Xem lịch sử đặt sân</Link>}
      {entry.status === 'expired' && <Link className="button primary" to={detailsUrl(entry.venueId)}>Chọn giờ khác</Link>}
      {entry.status === 'review' && <p className="info-box">Giao dịch cần đối soát. Giữ lại mã đơn để liên hệ quản trị viên.</p>}
      {entry.status === 'pending' && entry.provider === 'payos' && <p className="muted payment-note"><ShieldCheck size={17}/>
        Trạng thái sẽ cập nhật khi hệ thống nhận xác nhận thanh toán.</p>}
    </>}</section></div>;
}

export function History() {
  const site = useSite();
  const orders = useApi(site.user ? '/bookings' : null);
  return <div className="shell page"><h1>Lịch sử đặt sân</h1>{site.sessionError ? <Alert>{site.sessionError}</Alert> :
    site.sessionLoading || orders.loading ? <Loading/> : !site.user ? <Empty title="Đăng nhập để xem lịch sử"
      action={<Link className="button primary" to="/tai-khoan?next=%2Flich-su">Đăng nhập</Link>}/> : orders.error ? <Alert>{orders.error}</Alert> :
      !orders.value?.length ? <Empty title="Bạn chưa có đơn đặt sân" action={<Link className="button primary" to="/">Tìm sân</Link>}/> :
        <div className="history-list">{orders.value.map((entry) => <article className="panel order-row" key={entry.id}>
          <span className="order-icon"><CalendarDays size={22}/></span><div><h2>{entry.venueName}</h2><p>{entry.courtName} · {longDate(entry.date)} · {entry.time}–{entry.end}</p></div>
          <div><strong>{money(entry.amount)}</strong><small className={`state-tag ${entry.status}`}>{bookingStatus[entry.status]}</small>
            {entry.status !== 'review' && entry.paymentStatus === 'review' && <small className="state-tag review">Cần đối soát thanh toán</small>}</div>
          <Link className="button secondary" to={`/thanh-toan/${entry.id}`}>Chi tiết</Link></article>)}</div>}</div>;
}
