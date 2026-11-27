import { useEffect, useMemo, useState } from 'react';
import { Link } from 'react-router-dom';
import { CalendarDays, Clock3, Crosshair, LayoutGrid, Map, MapPin, Search, SlidersHorizontal, Zap } from 'lucide-react';
import { api, sameText, today, useApi, useCatalog } from './api';
import { Alert, CourtCard, Empty, Loading } from './ui';
import { CourtMap } from './map';
import { useSite } from './state';

export function Home() {
  const site = useSite();
  const [draft, setDraft] = useState({ query:'', area:'', date:'', after:'' });
  const [filter, setFilter] = useState(draft), [group, setGroup] = useState('all'), [view, setView] = useState('list');
  const [sort, setSort] = useState('default'), [price, setPrice] = useState(''), [distance, setDistance] = useState({});
  const [distanceError, setDistanceError] = useState('');
  const [availability, setAvailability] = useState(false), [revision, reload] = useState(0);
  const all = useApi('/venues', revision);
  const catalog = useCatalog(Boolean(all.error));
  const catalogOnly = Boolean(all.error && catalog.value);
  const filteredDay = availability || filter.date || filter.after;
  const bookingDate = filter.date || (filteredDay ? today() : '');
  const available = useApi(filteredDay && all.value ? `/venues?${new URLSearchParams({ date:bookingDate,
    available:'1', ...(filter.after ? {after:filter.after} : {}) })}` : null, revision);
  const areas = [...new Set((all.value ?? catalog.value ?? []).map((venue) => venue.area).filter(Boolean))];
  const source = all.error ? catalog : filteredDay && all.value ? available : all;
  useEffect(() => {
    setDistance({});
    setDistanceError('');
    if (!site.origin) return;
    if (catalogOnly) {
      const rows = catalog.value.filter(({lat,lng}) => Number.isFinite(lat) && Number.isFinite(lng)).map((venue) => {
        const dLat = (venue.lat - site.origin.lat) * Math.PI / 180;
        const dLng = (venue.lng - site.origin.lng) * Math.PI / 180;
        const a = Math.sin(dLat / 2) ** 2 + Math.cos(site.origin.lat * Math.PI / 180) *
          Math.cos(venue.lat * Math.PI / 180) * Math.sin(dLng / 2) ** 2;
        return [venue.id, { km: 12742 * Math.asin(Math.sqrt(Math.min(1, a))), type: 'straight' }];
      });
      setDistance(Object.fromEntries(rows));
      return;
    }
    const controller = new AbortController();
    api('/distances', { body:site.origin, signal:controller.signal }).then((rows) => {
      if (!controller.signal.aborted) setDistance(Object.fromEntries(rows.map((row) => [row.venueId,row])));
    }, (error) => { if (!controller.signal.aborted) setDistanceError(error.message); });
    return () => controller.abort();
  }, [site.origin, revision, catalogOnly, catalog.value]);

  const venues = useMemo(() => (source.value ?? []).filter((venue) => {
    if (group === 'featured' && !venue.featured) return false;
    if (group === 'online' && !(site.config?.payment === 'payos' && venue.verified && venue.court_count > 0)) return false;
    if (group === 'roof' && !/(?:có mái che|trong nhà)/i.test(venue.directory_details?.courtType ?? '')) return false;
    if (group === 'affordable' && knownPrice(venue) > 120000) return false;
    if (filter.area && venue.area !== filter.area) return false;
    if (price && knownPrice(venue) > Number(price)) return false;
    return sameText(`${venue.name} ${venue.area} ${venue.address}`).includes(sameText(filter.query.trim()));
  }).sort((a,b) => sort === 'price' ? knownPrice(a) - knownPrice(b) : sort === 'near' ?
    (distance[a.id]?.km ?? Infinity) - (distance[b.id]?.km ?? Infinity) :
    Number(site.favorites.includes(b.id)) - Number(site.favorites.includes(a.id)) || b.featured - a.featured),
  [source.value, filter, sort, site.favorites, site.config, price, group, distance]);
  function knownPrice(venue) {
    return site.config?.demo || (site.config?.payment === 'payos' && venue.verified && venue.court_count > 0)
      ? venue.price : venue.directory_details?.prices.offPeak ?? Infinity;
  }
  const update = (key, value) => setDraft((old) => ({ ...old, [key]:value }));
  function search(event) {
    event.preventDefault(); setFilter(draft);
    document.getElementById('tim-san')?.scrollIntoView({ block:'start' });
  }
  function reset() {
    const empty = { query:'', area:'', date:'', after:'' };
    setDraft(empty); setFilter(empty); setGroup('all'); setPrice(''); setAvailability(false);setSort('default');
  }
  return <>
    <section className="hero" aria-labelledby="home-title"><div className="shell hero-inner">
      <div className="hero-copy"><div className="hero-place"><MapPin size={14}/> PICKLEBALL TẠI THÁI NGUYÊN</div>
        <h1 id="home-title">Tìm sân gần bạn.<br/><em>Đặt lịch ra sân.</em></h1>
        <p>Xem sân trống, chọn giờ hợp ý và giữ chỗ ngay trên web.</p>
        <div className="hero-actions"><a className="button lime" href="#tim-san"><Search size={20}/> Tìm sân ngay</a>
          <button className="button glass" onClick={() => site.setOverlay('quick')}><Zap size={18}/> Đặt nhanh thông minh</button></div>
      </div></div></section>

    <div className="shell home-content"><form className="search-panel" onSubmit={search} aria-label="Tìm sân pickleball">
      <label><Search size={19}/><span>Tìm sân<input type="search" placeholder="Tên sân, địa chỉ…" value={draft.query} onChange={(e) => update('query',e.target.value)}/></span></label>
      <label><MapPin size={19}/><span>Khu vực<select value={draft.area} onChange={(e) => update('area',e.target.value)}><option value="">Tất cả khu vực</option>
        {areas.map((a) => <option key={a}>{a}</option>)}</select></span></label>
      <label><CalendarDays size={19}/><span>Ngày chơi<input aria-label="Ngày chơi" type="date" min={today()} max={today(30)} value={draft.date} onChange={(e) => update('date',e.target.value)}/></span></label>
      <label><Clock3 size={19}/><span>Sau giờ<input aria-label="Giờ bắt đầu tìm" type="time" value={draft.after} onChange={(e) => update('after',e.target.value)}/></span></label>
      <button className="button primary"><Search size={18}/> Tìm sân</button>
    </form>

    <section id="tim-san" className="court-section" aria-labelledby="court-list-heading">
      <div className="section-heading"><div><h2 id="court-list-heading">Sân pickleball</h2>
        <p>{source.loading ? 'Đang tải danh sách sân…' : `${venues.length} cụm sân${filter.area ? ` tại ${filter.area}` : ' tại Thái Nguyên'}`}</p></div>
        <button className="button secondary locate" onClick={() => site.setOverlay('position')}><Crosshair size={17}/>{site.origin ? 'Đổi vị trí' : 'Dùng vị trí của tôi'}</button></div>
      <div className="filter-row"><div className="filter-chips" aria-label="Bộ lọc sân">
        <button className={`chip ${group === 'all' ? 'on' : ''}`} onClick={() => setGroup('all')} aria-pressed={group === 'all'}>Tất cả</button>
        <button className={`chip ${group === 'online' ? 'on' : ''}`} onClick={() => setGroup('online')} aria-pressed={group === 'online'}>Đặt trực tuyến</button>
        <button className={`chip ${group === 'roof' ? 'on' : ''}`} onClick={() => setGroup('roof')} aria-pressed={group === 'roof'}>Có mái che</button>
        <button className={`chip ${group === 'affordable' ? 'on' : ''}`} onClick={() => setGroup('affordable')} aria-pressed={group === 'affordable'}>Giá mềm</button>
        <button className={`chip ${group === 'featured' ? 'on' : ''}`} onClick={() => setGroup('featured')} aria-pressed={group === 'featured'}>Nổi bật</button>
        <button className={`chip ${availability ? 'on' : ''}`} onClick={() => setAvailability(!availability)} aria-pressed={availability}>Còn giờ trống</button>
        <label className="chip select-chip"><SlidersHorizontal size={15}/><select aria-label="Giá mỗi giờ" value={price} onChange={(e) => setPrice(e.target.value)}>
          <option value="">Mức giá</option><option value="100000">Tối đa 100.000 ₫/giờ</option><option value="150000">Tối đa 150.000 ₫/giờ</option>
          <option value="200000">Tối đa 200.000 ₫/giờ</option></select></label>
      </div><div className="view-tools"><select aria-label="Sắp xếp sân" value={sort} onChange={(e) => {
        setSort(e.target.value); if (e.target.value === 'near' && !site.origin) site.setOverlay('position');
      }}><option value="default">Ưu tiên sân đã lưu</option><option value="near">Gần nhất</option><option value="price">Giá thấp nhất</option></select>
        <div className="view-toggle"><button aria-label="Danh sách" aria-pressed={view === 'list'} onClick={() => setView('list')}><LayoutGrid size={17}/></button>
          <button aria-label="Bản đồ" aria-pressed={view === 'map'} onClick={() => setView('map')}><Map size={17}/></button></div></div></div>
      {catalogOnly && <div className="info-box" role="status"><strong>Đang hiển thị danh bạ sân</strong>
        <p>Trang này chưa kết nối backend nên chưa có lịch trống, đăng nhập hoặc đặt sân trực tuyến. Khoảng cách hiển thị là đường chim bay; mở từng sân để xem bản đồ và số liên hệ.</p></div>}
      {site.config?.payment === 'off' && <div className="info-box" role="status"><strong>Đặt sân trực tuyến chưa mở</strong>
        <p>Bạn có thể xem giá tham khảo và thông tin liên hệ của từng sân.</p></div>}
      <p className="demo-caption">Thông tin sân và đánh giá lấy từ CSV.{site.config?.demo ? ' Giá và lịch đặt của sân chưa xác minh dùng để chạy thử.' : ''}</p>
      {distanceError && <p className="info-box" role="status">Chưa tính được khoảng cách. {distanceError} <button className="text-button" onClick={() => reload((n) => n + 1)}>Thử lại</button></p>}
      {source.error ? <><Alert>{source.error}</Alert><button className="button secondary" onClick={() => reload((n) => n + 1)}>Thử lại</button></> :
        source.loading ? <Loading/> : !venues.length ? <Empty title="Chưa tìm thấy sân phù hợp" action={<button className="button secondary" onClick={reset}>Xóa bộ lọc</button>}/> :
        view === 'map' ? <><CourtMap venues={venues} origin={site.origin} date={bookingDate} after={filter.after}/>{venues.some((v) => v.lat == null || v.lng == null) &&
          <p className="muted">Một số sân chưa có tọa độ. Bạn vẫn có thể xem chúng ở danh sách.</p>}</> :
        <div className="court-grid">{venues.map((venue) => <CourtCard key={venue.id} venue={venue} distance={distance[venue.id]} payment={site.config?.payment}
          date={bookingDate} after={filter.after} saved={site.favorites.includes(venue.id)}
          onSave={catalogOnly ? () => site.setNotice('Cần kết nối backend để lưu sân vào tài khoản.') : site.saveVenue}/>)}</div>}
    </section></div>
  </>;
}

export function Saved() {
  const site = useSite();
  const all = useApi(site.user ? '/venues' : null);
  const venues = all.value?.filter((venue) => site.favorites.includes(venue.id)) ?? [];
  return <div className="shell page"><h1>Sân đã lưu</h1>
    {site.sessionError ? <Alert>{site.sessionError}</Alert> : site.sessionLoading || site.favoriteLoading || all.loading ? <Loading/> :
      !site.user ? <Empty title="Đăng nhập để xem sân đã lưu" action={<Link to="/tai-khoan?next=%2Fda-luu" className="button primary">Đăng nhập</Link>}/> :
      all.error ? <Alert>{all.error}</Alert> : venues.length ? <div className="court-grid">{venues.map((venue) => <CourtCard key={venue.id} venue={venue}
        saved payment={site.config?.payment} onSave={site.saveVenue}/>)}</div> : <Empty title="Bạn chưa lưu sân nào" action={<Link to="/" className="button primary">Tìm sân</Link>}>Bấm biểu tượng trái tim để lưu sân bạn muốn đặt lại.</Empty>}</div>;
}
