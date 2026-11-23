import { useEffect, useRef, useState } from 'react';
import { Link } from 'react-router-dom';
import { CalendarDays, Clock3, Heart, ImageOff, MapPin, Navigation, ShieldCheck, Sparkles, Star, X } from 'lucide-react';
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
  if (!venue.image || failed === venue.image) return <div className="venue-photo-missing"><ImageOff size={24}/><span>{venue.directory_id ? 'Chưa có ảnh xác minh' : 'Ảnh chưa có'}</span></div>;
  return <img loading="lazy" src={venue.image} alt={venue.image_sample ? 'Ảnh minh họa' : `Ảnh danh bạ ${venue.name}`}
    onError={() => setFailed(venue.image)} />;
}

export function VenueRating({ venue }) {
  return venue.rating != null ? <span className="venue-rating" title="Điểm đánh giá theo CSV"><Star size={15}/>
    {venue.rating.toLocaleString('vi-VN',{minimumFractionDigits:1})}
    {venue.rating_count != null && <small>({venue.rating_count})</small>}</span> : null;
}

export function CourtCard({ venue, saved, onSave, distance, date, after, demo }) {
  const url = detailsUrl(venue.id, date, after);
  return <article className="court-card"><div className="court-photo"><Link to={url} aria-label={`Xem ${venue.name}`}>
    <VenuePicture venue={venue}/></Link>
    {venue.featured ? <span className="featured-tag"><Sparkles size={13}/> Nổi bật</span> : null}
    {venue.image && venue.image_sample ? <span className="photo-caption">Ảnh minh họa</span> : null}
    <button type="button" className={`save-button ${saved ? 'saved' : ''}`} aria-pressed={saved}
      aria-label={saved ? `Bỏ lưu ${venue.name}` : `Lưu ${venue.name}`} onClick={() => onSave(venue.id)}><Heart size={20}/></button>
  </div><div className="court-body"><div className="court-location"><MapPin size={15}/>{venue.area || 'Thái Nguyên'}
      {distance && <span title={distance.type === 'route' ? 'Theo đường đi' : 'Đường chim bay'}>· {distance.km.toFixed(1)} km{distance.type === 'straight' ? ' (chim bay)' : ''}</span>}</div>
    <h3><Link to={url}>{venue.name}</Link></h3>
    <div className="court-meta"><span><Clock3 size={16}/>{venue.open === '00:00' && venue.close === '24:00' ? 'Mở 24 giờ' : `${venue.open}–${venue.close}`}</span>
      <VenueRating venue={venue}/>
      <span className="court-verify">{venue.verified ? <><ShieldCheck size={14}/> Đã xác minh</> : 'Tham khảo'}</span></div>
    <div className="court-bottom"><div>{venue.verified ? <><strong>{money(venue.price)}</strong><span> / giờ</span></> :
      <span>{demo ? `Giá thử ${money(venue.price)}/giờ` : venue.directory_details ?
        `Tham khảo từ ${money(venue.directory_details.prices.offPeak)}/giờ` : 'Chưa có giá xác minh'}</span>}</div><Link className="small-button" to={url}>Xem sân</Link></div>
  </div></article>;
}

export function ResultList({ results, onChoose }) {
  return <div className="results">{results.map((result) => <article className="result" key={`${result.courtId}:${result.time}`}>
    <div><strong>{result.venueName}</strong><p>{result.courtName} · {result.time}–{result.end} · {longDate(result.date)}</p>
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
