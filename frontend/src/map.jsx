import { useEffect, useRef } from 'react';
import L from 'leaflet';
import 'leaflet/dist/leaflet.css';

export const mapCenter = [21.5902, 105.8294];
const pin = L.divIcon({ className:'map-pin', html:'<b></b>', iconSize:[29,29], iconAnchor:[14,28], popupAnchor:[0,-27] });
const hasPoint = (point) => point?.lat != null && point?.lng != null;

export function CourtMap({ venues = [], origin, route, point, onPick, className = '' }) {
  const element = useRef(null), instance = useRef(null), layers = useRef(null), pickHandler = useRef(onPick);
  pickHandler.current = onPick;
  useEffect(() => {
    const map = L.map(element.current, { scrollWheelZoom:false }).setView(mapCenter, 13);
    L.tileLayer('https://tile.openstreetmap.org/{z}/{x}/{y}.png', { maxZoom:18,
      attribution:'&copy; <a href="https://www.openstreetmap.org/copyright">OpenStreetMap</a>' }).addTo(map);
    map.on('click', ({ latlng }) => pickHandler.current?.({lat:latlng.lat,lng:latlng.lng}));
    instance.current = map;
    layers.current = L.layerGroup().addTo(map);
    const resize = new ResizeObserver(() => map.invalidateSize());
    resize.observe(element.current);
    return () => { resize.disconnect(); map.remove(); instance.current = null; };
  }, []);
  useEffect(() => {
    const map = instance.current, group = layers.current;
    if (!map || !group) return;
    group.clearLayers();
    const bounds = [];
    for (const venue of venues.filter(hasPoint)) {
      const coordinates = [venue.lat, venue.lng];
      bounds.push(coordinates);
      const popup = document.createElement('div');
      const label = document.createElement('strong'); label.textContent = venue.name;
      const address = document.createElement('p'); address.textContent = venue.address;
      const link = document.createElement('a'); link.href = `/san/${venue.id}`; link.textContent = 'Xem sân và lịch trống';
      popup.append(label, address, link);
      L.marker(coordinates, { icon:pin, title:venue.name, alt:venue.name }).bindPopup(popup).addTo(group);
    }
    if (hasPoint(origin)) {
      const coordinates = [origin.lat, origin.lng]; bounds.push(coordinates);
      L.circleMarker(coordinates, { radius:7, fillOpacity:1, fillColor:'#3774f1', color:'#fff', weight:3 })
        .bindTooltip('Điểm xuất phát').addTo(group);
    }
    if (hasPoint(point)) {
      const coordinates = [point.lat, point.lng]; bounds.push(coordinates);
      L.marker(coordinates, { icon:pin, draggable:Boolean(onPick), alt:'Điểm đã chọn' }).on('dragend', (event) => {
        const p = event.target.getLatLng(); pickHandler.current?.({lat:p.lat,lng:p.lng});
      }).addTo(group);
    }
    if (route?.length) {
      L.polyline(route, { color:'#296642', weight:5 }).addTo(group); bounds.push(...route);
    }
    if (onPick && map.__pickerReady) return;
    if (onPick) map.__pickerReady = true;
    if (bounds.length > 1) map.fitBounds(bounds, { padding:[28,28], maxZoom:15 });
    else if (bounds.length === 1) map.setView(bounds[0], 15);
  }, [venues, origin, route, point, onPick]);
  return <div className={`map ${className}`} ref={element} aria-label="Bản đồ sân pickleball" />;
}
