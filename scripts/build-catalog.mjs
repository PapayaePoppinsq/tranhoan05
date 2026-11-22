import { readFileSync, writeFileSync, existsSync } from 'node:fs';
import { parse } from 'csv-parse/sync';

const root = new URL('../', import.meta.url);
const rows = parse(readFileSync(new URL('backend/data/thai-nguyen.csv', root), 'utf8'), {
  columns: true, bom: true, trim: true, skip_empty_lines: true,
});
const photos = JSON.parse(readFileSync(new URL('backend/data/catalog-photos.json', root), 'utf8'));
const photoById = new Map(photos.map((photo) => [photo.id, photo]));
const catalog = rows.map((row) => {
  const id = Number(row.id);
  const photo = photoById.get(id);
  if (!Number.isInteger(id) || !photo || photo.name !== row.ten_san || photo.address !== row.dia_chi) {
    throw new Error(`Ảnh và CSV không khớp ở sân ${row.id}`);
  }
  if (photo.cover && !existsSync(new URL(`frontend/public${photo.cover}`, root))) {
    throw new Error(`Thiếu ảnh sân ${id}: ${photo.cover}`);
  }
  const hours = row.thoi_gian_hoat_dong?.match(/(\d{2}:\d{2})\s*-\s*(\d{2}:\d{2})/);
  const [open, close] = hours ? hours.slice(1) : /24\/24/.test(row.thoi_gian_hoat_dong) ? ['00:00', '24:00'] : [];
  const lat = Number(row.vi_do), lng = Number(row.kinh_do);
  if (!open || !close || !Number.isFinite(lat) || !Number.isFinite(lng)) {
    throw new Error(`Vị trí hoặc giờ hoạt động không hợp lệ ở sân ${id}`);
  }
  return {
    id, directory_id: id, name: row.ten_san,
    area: row.dia_chi.match(/(?:Phường|Xã)\s+([^,]+)/i)?.[1]?.trim() || 'Thái Nguyên',
    address: row.dia_chi, lat, lng, open, close,
    image: photo.cover || '', image_sample: 0, photo_source: photo.source || null,
    map_url: row.link_google_maps, category: row.the_loai || null,
    rating: row.so_sao ? Number(row.so_sao.replace(',', '.')) : null,
    rating_count: row.so_luot_danh_gia ? Number(row.so_luot_danh_gia) : null,
    contact_phone: row.so_dien_thoai || null,
    featured: 0, verified: 0, price: 100000, court_count: 0, courts: [],
  };
});
if (new Set(catalog.map((venue) => venue.id)).size !== catalog.length || catalog.length !== photos.length) {
  throw new Error('Danh bạ có mã sân trùng hoặc thiếu ảnh đối chiếu.');
}
writeFileSync(new URL('frontend/public/catalog.json', root), `${JSON.stringify(catalog, null, 2)}\n`);
console.log(`Đã tạo danh bạ tĩnh cho ${catalog.length} sân.`);
