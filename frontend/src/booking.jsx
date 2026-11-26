import { useEffect, useMemo, useRef, useState } from 'react';
import { Link, useLocation, useNavigate, useParams, useSearchParams } from 'react-router-dom';
import { ArrowLeft, CalendarDays, CheckCircle2, Clock3, CreditCard, Heart, MapPin, Phone, ShieldCheck, TimerReset } from 'lucide-react';
import { QRCodeSVG } from 'qrcode.react';
import { api, bookingStatus, detailsUrl, isBookingDate, longDate, money, reviewUrl, today, useApi, useCatalog } from './api';
import { Alert, DateStrip, Empty, Loading, RouteLink, VenuePicture, VenueRating } from './ui';
import { CourtMap } from './map';
import { useSite } from './state';

export function Detail() {
  const { id } = useParams();
  const loc = useLocation();
  return <DetailPage key={id + loc.search} id={encodeURIComponent(id)}/>;
}

function DirectoryDetails({ details }) {
  const groups = [
    { label:'Thứ 2 đến Thứ 6', rates:details.weekdayRates },
    { label:'Thứ 7 và Chủ nhật', rates:details.weekendRates },
  ];
  return <section className="panel venue-directory" aria-labelledby="directory-heading">
    <h2 id="directory-heading">Sân nhỏ và bảng giá tham khảo</h2>
    <p className="muted">{details.courtCount} sân nhỏ · {details.courtType} · {details.surface}</p>
    <div className="venue-rates">{groups.map(({ label, rates }) => <table key={label}>
      <caption>{label}</caption>
      <thead><tr><th scope="col">Khung giờ</th><th scope="col">Giá mỗi giờ</th></tr></thead>
      <tbody>{rates.map(({ start, end, hourly }) => <tr key={start}>
        <td>{start}–{end}</td><td>{money(hourly)}</td>
      </tr>)}</tbody>
    </table>)}</div>
    <details>
      <summary>Danh sách sân nhỏ và phụ phí</summary>
      <ul>{details.courts.map(({ code, label }) => <li key={code}><span>{code}</span> {label}</li>)}</ul>
    </details>
    <p className="muted">Thông tin từ danh bạ. Liên hệ chủ sân để xác nhận giá, phụ phí và lịch trống.</p>
  </section>;
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
  const catalog = useCatalog(Boolean(detail.error && (detail.status == null || detail.status >= 500)));
  const venue = detail.value || catalog.value?.find((item) => String(item.id) === id);
  const catalogOnly = Boolean(!detail.value && venue);
  const canBook = Boolean(!catalogOnly && venue?.courts?.length && (site.config?.demo ||
    (venue.verified && site.config?.payment === 'payos')));
  const slotData = useApi(canBook ? `/venues/${id}/availability?${new URLSearchParams({date,duration})}` : null, reload);
  const targetTime = params.get('time');
  const requestedSlot = params.has('court') && targetTime;
  const proposed = !touched && prefill?.date === date && prefill.duration === duration ? prefill : null;
  const court = slotData.value?.find((item) => item.id === (courtId || proposed?.courtId)) ?? slotData.value?.[0];
  const initialTime = !touched && requestedSlot && court?.id === courtId ? targetTime : null;
  const current = court?.slots.find((slot) => slot.time === (selected || initialTime || proposed?.time) && slot.status === 'available');
  const mapVenues = useMemo(() => venue ? [venue] : [], [venue]);
  useEffect(() => {
    if (!canBook || touched || site.sessionLoading || requestedSlot) return;
    const controller = new AbortController();
    api('/quick', { signal:controller.signal, body:{ venueId:venue.id,date,duration,
      after:targetTime || undefined,origin:site.origin || undefined } }).then(({results}) => {
      if (!controller.signal.aborted) setPrefill(results[0] || null);
    }, () => {});
    return () => controller.abort();
  }, [venue, canBook, date, duration, targetTime, requestedSlot, site.origin, site.sessionLoading, touched]);
  useEffect(() => {
    if (!site.origin || !venue || !showMap || catalogOnly) { setRoute(null); setRouteError(''); return; }
    const controller = new AbortController();
    setRoute(null); setRouteError('');
    api(`/venues/${id}/route`, {body:site.origin,signal:controller.signal}).then((result) => {
      if (!controller.signal.aborted) {
        setRoute(result);
        if (!result) setRouteError('Bấm Chỉ đường để xem tuyến đường trên Google Maps.');
      }
    }, (error) => { if (!controller.signal.aborted) setRouteError(error.message); });
    return () => controller.abort();
  }, [venue, catalogOnly, site.origin, id, showMap]);
  if (detail.loading) return <div className="shell page"><Loading/></div>;
  if (detail.error && catalog.loading) return <div className="shell page"><Loading/></div>;
  if (detail.error && !venue) return <div className="shell page"><Alert>{catalog.error || detail.error}</Alert><Link to="/">Về danh sách sân</Link></div>;
  if (!venue) return null;
  const saved = site.favorites.includes(venue.id);
  const review = current ? reviewUrl({venueId:venue.id,courtId:court.id,date,time:current.time,duration}) : null;
  function chooseDate(day) {
    if (!isBookingDate(day)) return;
    setTouched(true);
    setDate(day);
    setSelected(null);
  }
  return <div className="shell page detail"><Link className="back" to="/"><ArrowLeft size={17}/> Danh sách sân</Link>
    <div className="detail-hero"><VenuePicture venue={venue}/><div className="detail-title"><p><MapPin size={16}/> {venue.area}</p>
      <h1>{venue.name}</h1><p>{venue.address}</p></div><button className={`save-button ${saved ? 'saved' : ''}`} aria-pressed={saved}
      aria-label={saved ? 'Bỏ lưu sân' : 'Lưu sân'} onClick={() => catalogOnly ? site.setNotice('Cần kết nối backend để lưu sân vào tài khoản.') : site.saveVenue(venue.id)}><Heart size={20}/></button>
      {venue.image && venue.image_sample ? <span className="photo-caption">Ảnh minh họa</span> : null}</div>
    {venue.photo_source && <a className="photo-source" href={venue.photo_source} target="_blank" rel="noreferrer">Nguồn ảnh</a>}
    <div className="detail-facts"><span><Clock3 size={17}/> {venue.open === '00:00' && venue.close === '24:00' ? 'Mở 24 giờ' : `${venue.open}–${venue.close}`}</span>
      <VenueRating venue={venue}/>{venue.category && <span>{venue.category}</span>}
      {venue.court_count > 0 && <span>{venue.court_count} sân nhỏ</span>}
      {venue.contact_phone && <a className="text-button" href={`tel:${venue.contact_phone.replace(/[^+\d]/g, '')}`}><Phone size={16}/>{venue.contact_phone}</a>}
      {canBook && <span>{site.config.demo ? 'Giá thử ' : ''}{money(venue.price)}/giờ</span>}
      <button className="text-button" onClick={() => setShowMap(!showMap)} aria-expanded={showMap}>
        <MapPin size={17}/>{showMap ? 'Ẩn bản đồ' : 'Xem bản đồ'}</button></div>
    {catalogOnly && <div className="info-box" role="status"><strong>Danh bạ tham khảo</strong>
      <p>Trang chưa kết nối backend. Chưa thể xem lịch trống hoặc đặt sân trực tuyến; hãy liên hệ sân để kiểm tra giờ và giá.</p></div>}
    {!venue.verified && !catalogOnly ? <div className="info-box"><strong>Sân đang chờ xác minh</strong>
      <p>{site.config?.demo ? 'Lịch đặt và giá dùng để chạy thử. Hãy gọi sân để xác nhận giờ và giá thật.' : 'Địa điểm này chưa mở đặt trực tuyến.'}
        {venue.map_url && <a href={venue.map_url} target="_blank" rel="noreferrer"> Xem sân trên Google Maps</a>}</p></div> : null}
    {showMap && <section className="panel map-panel"><h2>Vị trí cụm sân</h2>
      {venue.lat != null && venue.lng != null ? <CourtMap venues={mapVenues} origin={site.origin} route={route?.path}/> :
        <p className="muted">Cụm sân chưa có tọa độ ghim. Địa chỉ ghi trong danh bạ là {venue.address}.</p>}
      {route && <p className="muted">Theo đường đi · {route.km.toFixed(1)} km · khoảng {route.minutes} phút</p>}
      {routeError && <p className="muted">{routeError}</p>}
      <div className="form-actions"><RouteLink venue={venue} origin={site.origin}/><button className="button secondary"
        onClick={() => site.setOverlay('position')}><MapPin size={17}/>{site.origin ? 'Đổi điểm xuất phát' : 'Chọn điểm xuất phát'}</button></div></section>}
    <div className={canBook ? 'detail-columns' : 'detail-columns schedule-only'}><section className="panel schedule"><div className="section-heading"><h2>{canBook ? 'Chọn lịch chơi' : 'Đặt sân trực tuyến'}</h2>
      {canBook && <><label className="sr-only" htmlFor="booking-date">Chọn ngày khác</label><input id="booking-date" type="date" min={today()} max={today(30)}
        value={date} onChange={(e) => chooseDate(e.target.value)}/></>}</div>
      {catalogOnly && <p className="muted">Chưa tải được lịch. Dùng số liên hệ của sân để hỏi giờ còn trống.</p>}
      {canBook && <DateStrip date={date} onChange={chooseDate}/>}
      {canBook && <div className="form-split schedule-filters"><label>Sân nhỏ<select value={court?.id ?? (venue.courts.some((item) => item.id === courtId) ? courtId : venue.courts[0].id)}
        onChange={(e) => {setTouched(true);setCourtId(Number(e.target.value));setSelected(null);}}><option value="" disabled>Chọn sân nhỏ</option>
        {venue.courts.map((item) => <option key={item.id} value={item.id}>{item.name}</option>)}</select></label>
        <label>Thời lượng<select value={duration} onChange={(e) => {setTouched(true);setDuration(Number(e.target.value));setSelected(null);}}>
          {[30,60,90,120,150,180].map((d) => <option key={d} value={d}>{d} phút</option>)}</select></label></div>}
      <Alert>{slotData.error}</Alert>{slotData.error && <button className="button secondary" onClick={() => bump((n) => n + 1)}>Tải lại lịch</button>}
      {!catalogOnly && site.configError && <><Alert>Chưa kiểm tra được trạng thái đặt trực tuyến.</Alert>
        <button className="button secondary" onClick={site.refreshConfig}>Kiểm tra lại</button></>}
      {!catalogOnly && !site.config && !site.configError && <Loading>Đang kiểm tra trạng thái đặt…</Loading>}
      {!canBook && site.config && venue.courts.length > 0 && <div className="listed-courts">
        <h3>{venue.courts.length} sân nhỏ đã thêm</h3>
        <ul>{venue.courts.map((item) => <li key={item.id}>{item.name}</li>)}</ul>
        <p className="muted">Các sân này chưa hiển thị lịch trống để đặt trực tuyến.
          {!venue.verified && ' Quản trị viên cần xác minh cụm sân và giá.'}
          {site.config?.payment === 'off' && ' Hệ thống cần cấu hình thanh toán.'}</p>
      </div>}
      {!catalogOnly && !canBook && !venue.courts.length && <p className="muted">Chưa có sân nhỏ nào mở lịch trực tuyến.</p>}
      {slotData.loading && canBook ? <Loading>Đang kiểm tra giờ trống…</Loading> : canBook && court ? <>
        <h3 className="slot-heading">Giờ bắt đầu – kết thúc <small>Giá mỗi khung đã tính theo thời lượng bạn chọn</small></h3>
        <div className="slot-legend"><span><b/> Còn trống</span><span className="booked"><b/> Đã đặt</span><span className="held"><b/> Đang giữ</span><span className="past"><b/> Đã qua</span></div>
        {!court.slots.length && <p className="muted">Thời lượng này vượt quá giờ hoạt động.</p>}
        <div className="slots">{court.slots.map((slot) => <button type="button" key={slot.time}
          className={`slot ${slot.status} ${current?.time === slot.time ? 'picked' : ''}`}
          disabled={slot.status !== 'available'} aria-pressed={current?.time === slot.time} onClick={() => {setTouched(true);setCourtId(court.id);setSelected(slot.time);}}>
          <strong>{slot.time}–{slot.end}</strong><small>{slot.status === 'booked' ? 'Đã đặt' : slot.status === 'held' ? 'Đang giữ' :
            slot.status === 'past' ? 'Đã qua' : `${money(slot.amount)} / ${duration} phút`}</small></button>)}</div>
        {targetTime && !touched && !current && court.slots.find((slot) => slot.time === targetTime && slot.status === 'available') &&
          <button className="text-button" onClick={() => {setTouched(true);setCourtId(court.id);setSelected(targetTime);}}>Chọn khung tìm kiếm {targetTime}</button>}
      </> : canBook && !slotData.error && <p className="muted">Hiện chưa tải được lịch đặt cho sân nhỏ này.</p>}
    </section>{canBook && <aside className="panel summary"><h2>Đơn của bạn</h2><p className="muted">{venue.name}</p><dl className="summary-list">
      <div><dt>Ngày</dt><dd>{longDate(date)}</dd></div><div><dt>Sân nhỏ</dt><dd>{court?.name || 'Chưa chọn'}</dd></div>
      <div><dt>Giờ chơi</dt><dd>{current ? `${current.time}–${current.end}` : 'Chưa chọn'}</dd></div>
      <div><dt>Thời lượng</dt><dd>{duration} phút</dd></div>
      <div><dt>{site.config.demo ? 'Đơn giá thử' : 'Đơn giá trực tuyến'}</dt><dd>{money(venue.price)}/giờ</dd></div></dl>
      {current && proposed && <p className="demo-caption">Gợi ý đặt nhanh · {proposed.reason}. Bạn có thể đổi sân hoặc giờ.</p>}
      <div className="total" aria-live="polite"><span>Giá cho khung đã chọn</span><strong>{current ? money(current.amount) : '—'}</strong></div>
      {review ? <Link className="button primary wide" to={review}>Xem lại đơn</Link> :
        <button className="button primary wide" disabled>Chọn khung giờ</button>}
    </aside>}</div>
    {venue.directory_details && <DirectoryDetails details={venue.directory_details}/>}
    {review && <div className="mobile-booking-action"><div><span>{current.time}–{current.end}</span><strong>{money(current.amount)}</strong></div>
      <Link className="button primary" to={review}>Xem lại đơn</Link></div>}
  </div>;
}

export function Review() {
  const location = useLocation();
  return <ReviewPage key={location.search} search={location.search}/>;
}
function ReviewPage({search}) {
  const { user, sessionLoading, config, configError, refreshConfig } = useSite();
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
        {configError && <Alert>Chưa kiểm tra được trạng thái thanh toán.</Alert>}
        <div className="form-actions">{sessionLoading ? <Loading/> : user ? <button className="button primary" onClick={reserve} disabled={busy || !config || config.payment === 'off'}>
          {busy ? 'Đang giữ chỗ…' : 'Xác nhận và giữ chỗ'}</button> : <Link className="button primary" to={`/tai-khoan?${new URLSearchParams({next:`/xem-lai${search}`})}`}>Đăng nhập để đặt</Link>}
          {configError && <button className="button secondary" onClick={refreshConfig}>Kiểm tra thanh toán</button>}
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
  const requestedPayment = useRef(false);
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
  useEffect(() => {
    if (requestedPayment.current || entry?.provider !== 'payos' || entry.status !== 'pending' ||
        entry.checkoutUrl || entry.expiresAt <= Math.floor(Date.now() / 1000)) return;
    requestedPayment.current = true;
    pay('payment');
  }, [entry?.provider, entry?.status, entry?.checkoutUrl, entry?.expiresAt, id]);
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
      {entry.provider === 'payos' && entry.status === 'pending' && left > 0 && entry.qrPayload &&
        <div className="payment-qr"><QRCodeSVG value={entry.qrPayload} size={236} marginSize={4} level="M"
          title="Mã VietQR thanh toán đơn đặt sân"/>
          <div><h2>Quét mã để thanh toán</h2><p>Mở ứng dụng ngân hàng và quét VietQR. Kiểm tra người nhận và số tiền trước khi xác nhận chuyển khoản.</p>
            <p>Đơn sẽ tự cập nhật khi payOS xác nhận thanh toán.</p></div></div>}
      {entry.status === 'pending' && left > 0 && <div className="form-actions">
        {entry.provider === 'demo' ? <button className="button primary" disabled={busy} onClick={() => pay('demo-payment')}>Mô phỏng thanh toán</button> :
          entry.checkoutUrl ? <a className="button primary" href={entry.checkoutUrl}><CreditCard size={18}/> Mở trang thanh toán payOS</a> :
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
