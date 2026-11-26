import { useEffect, useRef, useState } from 'react';
import { Link } from 'react-router-dom';
import { CalendarDays, Clock3, Heart, MapPin, Navigation, Sparkles, Star, X } from 'lucide-react';
import { detailsUrl, longDate, money, reviewUrl, today } from './api';

export function Brand() {
  return <Link to="/" className="brand"><img src="/icon.svg" alt="" width="38" height="38"/><span>Sân<span>Pick</span></span></Link>;
}
export function Alert({ children }) { return children ? <p className="alert" role="alert">{children}</p> : null; }
export function Loading({ children = 'Đang tải…' }) { return <div className="placeholder" role="status">{children}</div>; }
export function Empty({ title, children, action }) { return <div className="empty panel"><CalendarDays size={28}/><h2>{title}</h2>
  {children && <p>{children}</p>}{action}</div>; }

export function Dialog({ title, icon, onClose, children, className = '' }) {
  const ref = useRef(null);
  useEffect(() => { const dialog = ref.current; dialog.showModal(); return () => { if (dialog.open) dialog.close(); }; }, []);
  return <dialog ref={ref} className={`dialog ${className}`} onCancel={(event) => { event.preventDefault(); onClose(); }}
    onClick={(event) => { if (event.target === ref.current) onClose(); }} aria-label={title}>
    <div className="dialog-inner"><header className="dialog-heading"><div>{icon}<h2>{title}</h2></div>
      <button className="icon-button" onClick={onClose} aria-label="Đóng"><X size={21}/></button></header>{children}</div>
  </dialog>;
}

export function VenuePicture({ venue }) {
  const [failed, setFailed] = useState(null);
  if (!venue.image || failed === venue.image) return <div className="venue-photo-missing" role="img" aria-label={`Chưa có ảnh chụp của ${venue.name}`}>
    <svg className="venue-court-graphic" viewBox="0 0 360 180" aria-hidden="true" focusable="false">
      <rect x="20" y="14" width="320" height="152" rx="5" fill="#c6dfc5"/>
      <rect x="34" y="28" width="292" height="124" fill="none" stroke="#f9fcf7" strokeWidth="4"/>
      <path d="M110 28v124m140-124v124M34 90h292M180 28v62" fill="none" stroke="#f9fcf7" strokeWidth="4"/>
      <path d="M180 20v140" fill="none" stroke="#356847" strokeWidth="5" strokeDasharray="4 5"/>
    </svg>
    <span>Chưa có ảnh chụp sân</span>
  </div>;
  return <img loading="lazy" src={venue.image} alt={venue.image_sample ? 'Ảnh minh họa' : `Ảnh danh bạ ${venue.name}`}
    onError={() => setFailed(venue.image)} />;
}

export function VenueRating({ venue }) {
  return venue.rating != null ? <span className="venue-rating" title="Điểm đánh giá theo CSV"><Star size={15}/>
    {venue.rating.toLocaleString('vi-VN',{minimumFractionDigits:1})}
    {venue.rating_count != null && <small>({venue.rating_count})</small>}</span> : null;
}

export function CourtCard({ venue, saved, onSave, distance, date, after, payment }) {
  const url = detailsUrl(venue.id, date, after);
  const canBook = Boolean(payment === 'payos' && venue.verified && venue.court_count > 0);
  const count = venue.court_count || venue.directory_details?.courtCount;
  return <article className="court-card"><div className="court-photo"><Link to={url} aria-label={`Xem ${venue.name}`}>
    <VenuePicture venue={venue}/></Link>
    {canBook ? <span className="featured-tag">Đặt trực tuyến</span> :
      venue.featured ? <span className="featured-tag"><Sparkles size={13}/> Nổi bật</span> : null}
    {venue.rating != null && <div className="court-photo-rating"><VenueRating venue={venue}/></div>}
    {venue.image && venue.image_sample ? <span className="photo-caption">Ảnh minh họa</span> : null}
    <button type="button" className={`save-button ${saved ? 'saved' : ''}`} aria-pressed={saved}
      aria-label={saved ? `Bỏ lưu ${venue.name}` : `Lưu ${venue.name}`} onClick={() => onSave(venue.id)}><Heart size={20}/></button>
  </div><div className="court-body"><h3><Link to={url}>{venue.name}</Link></h3>
    <div className="court-keyfacts"><p className="court-address" title={venue.address}><MapPin size={15}/><span>{venue.address || venue.area || 'Thái Nguyên'}</span></p>
      <div className="court-meta"><span><Clock3 size={15}/>{venue.open === '00:00' && venue.close === '24:00' ? 'Mở 24 giờ' : `${venue.open}–${venue.close}`}</span>
        {count > 0 && <span>{count} sân nhỏ{!venue.court_count && ' theo danh bạ'}</span>}
        {distance && <span title={distance.type === 'route' ? 'Theo đường đi' : 'Đường chim bay'}>{distance.km.toFixed(1)} km{distance.type === 'straight' ? ' đường chim bay' : ''}</span>}</div></div>
    <div className="court-bottom"><div>{canBook ? <><strong>{money(venue.price)}</strong><span> / giờ</span></> :
      <span>{payment === 'demo' ? `Giá thử ${money(venue.price)}/giờ` : venue.directory_details ?
        `Tham khảo từ ${money(venue.directory_details.prices.offPeak)}/giờ` : 'Chưa có giá xác minh'}</span>}</div><Link className="small-button" to={url}>{canBook ? 'Xem lịch' : 'Xem sân'}</Link></div>
  </div></article>;
}

export function ResultList({ results, onChoose, highlightFirst = false, variant = 'default' }) {
  if (variant === 'quick') return <div className="results quick-results">{results.map((result, index) => {
    const isWeekend = [0, 6].includes(new Date(`${result.date}T12:00:00Z`).getUTCDay());
    const tag = index === 0 ? 'Phù hợp nhất' : isWeekend ? 'Cuối tuần' :
      results.some((item) => item.amount > result.amount) &&
      result.amount === Math.min(...results.map((item) => item.amount)) ? 'Giá tốt' : null;
    const reason = result.reason?.split(' · ').filter((item) => item !== 'Khung giờ còn trống').join(' · ');
    const day = new Intl.DateTimeFormat('vi-VN', { timeZone:'UTC', weekday:'long', day:'2-digit',
      month:'2-digit', year:'numeric' }).format(new Date(`${result.date}T12:00:00Z`));
    const court = result.courtName.replace(/^sân/i, 'Sân');
    return <article className={`result quick-result ${index === 0 ? 'result-best' : ''}`}
      key={`${result.courtId}:${result.date}:${result.time}`}>
      <div className="quick-result-main">{tag && <span className="result-tag">{tag}</span>}
        <strong className="quick-venue-name">{result.venueName}</strong>
        <p className="quick-slot-line"><strong>{court}</strong><span>·</span><strong>{result.time}–{result.end}</strong></p>
        <p className="quick-slot-date">{day}</p>{reason && <small>{reason}</small>}</div>
      <div className="quick-result-action"><strong>{money(result.amount)}<small>/{result.duration === 60 ? 'giờ' : `${result.duration} phút`}</small></strong>
        <Link onClick={onChoose} to={reviewUrl(result)} className="small-button">Xem lại đơn</Link></div>
    </article>;
  })}</div>;
  return <div className="results">{results.map((result, index) => <article className={`result ${highlightFirst && index === 0 ? 'result-best' : ''}`} key={`${result.courtId}:${result.date}:${result.time}`}>
    <div>{highlightFirst && index === 0 && <span className="result-tag">Gợi ý phù hợp nhất</span>}
      <strong>{result.venueName}</strong><p>{result.courtName} · {result.time}–{result.end} · {longDate(result.date)}</p>
      <small>{result.reason}</small></div><div><strong>{money(result.amount)}</strong>
      <Link onClick={onChoose} to={reviewUrl(result)} className="small-button">Xem lại đơn</Link></div>
  </article>)}</div>;
}

export function DateStrip({ date, onChange }) {
  const strip = useRef(null);
  const selected = useRef(null);
  useEffect(() => {
    const container = strip.current, active = selected.current;
    if (!container || !active) return;
    const bounds = container.getBoundingClientRect(), day = active.getBoundingClientRect();
    if (day.left < bounds.left || day.right > bounds.right) {
      container.scrollLeft += day.left - bounds.left - (bounds.width - day.width) / 2;
    }
  }, [date]);
  return <div ref={strip} className="date-strip" role="group" aria-label="Ngày đặt sân">{Array.from({ length: 31 }, (_, i) => {
    const value = today(i), [year, month, day] = value.split('-');
    const label = i === 0 ? 'Hôm nay' : new Intl.DateTimeFormat('vi-VN', { timeZone:'UTC', weekday:'short' })
      .format(new Date(`${year}-${month}-${day}T12:00:00Z`));
    return <button type="button" key={value} ref={date === value ? selected : null} aria-label={longDate(value)}
      aria-pressed={date === value} className={date === value ? 'selected' : ''}
      onClick={() => onChange(value)}><small>{label}</small><strong>{day}</strong><small>Thg {+month}</small></button>;
  })}</div>;
}

export function RouteLink({ venue, origin }) {
  const params = new URLSearchParams({ api:'1', destination:`${venue.lat},${venue.lng}`, travelmode:'driving' });
  if (origin) params.set('origin', `${origin.lat},${origin.lng}`);
  const href = venue.lat != null && venue.lng != null ? `https://www.google.com/maps/dir/?${params}` : venue.map_url;
  return href ? <a className="button secondary" href={href} target="_blank" rel="noreferrer"><Navigation size={17}/> Chỉ đường</a> : null;
}
