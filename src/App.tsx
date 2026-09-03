import { useState, useEffect, useRef, useMemo, MutableRefObject } from 'react';
import { MapContainer, TileLayer, Polyline, useMap, Marker, Tooltip, useMapEvents, LayerGroup } from 'react-leaflet';
import { FileDown, Route, Loader2, MapPin, Search, Plus, Minus, X, ArrowRight, ArrowUpDown, Footprints, Car, Train, Layers, Cloud } from 'lucide-react';
import L from 'leaflet';
import 'leaflet/dist/leaflet.css';

// Fix for default Leaflet marker icons in React
delete (L.Icon.Default.prototype as any)._getIconUrl;
L.Icon.Default.mergeOptions({
  iconRetinaUrl: 'https://cdnjs.cloudflare.com/ajax/libs/leaflet/1.7.1/images/marker-icon-2x.png',
  iconUrl: 'https://cdnjs.cloudflare.com/ajax/libs/leaflet/1.7.1/images/marker-icon.png',
  shadowUrl: 'https://cdnjs.cloudflare.com/ajax/libs/leaflet/1.7.1/images/marker-shadow.png',
});

function haversineDistance(lat1: number, lon1: number, lat2: number, lon2: number) {
  const R = 6371; // km
  const dLat = (lat2 - lat1) * Math.PI / 180;
  const dLon = (lon2 - lon1) * Math.PI / 180;
  const a = Math.sin(dLat/2) * Math.sin(dLat/2) +
            Math.cos(lat1 * Math.PI / 180) * Math.cos(lat2 * Math.PI / 180) *
            Math.sin(dLon/2) * Math.sin(dLon/2);
  const c = 2 * Math.atan2(Math.sqrt(a), Math.sqrt(1-a));
  return R * c;
}

async function reverseGeocode(lat: number, lng: number): Promise<{name: string, shortName: string}> {
  try {
    const res = await fetch(`https://nominatim.openstreetmap.org/reverse?format=json&lat=${lat}&lon=${lng}`, {
      headers: { 'User-Agent': 'MapsToGPX-AIStudio-App' }
    });
    const data = await res.json();
    const shortName = data.address ? (data.address.city || data.address.town || data.address.village || data.address.county || data.name) : (data.display_name ? data.display_name.split(',')[0] : `${lat.toFixed(4)}`);
    return { name: data.display_name || `${lat.toFixed(4)}, ${lng.toFixed(4)}`, shortName: shortName || `${lat.toFixed(4)}` };
  } catch (e) {
    return { name: `${lat.toFixed(4)}, ${lng.toFixed(4)}`, shortName: `${lat.toFixed(4)}` };
  }
}

function interpolatePoints(points: {lat: number, lng: number}[], maxDistanceKm: number = 1.0) {
  if (points.length === 0) return [];
  const result = [points[0]];
  for (let i = 1; i < points.length; i++) {
    const p1 = points[i-1];
    const p2 = points[i];
    const dist = haversineDistance(p1.lat, p1.lng, p2.lat, p2.lng);
    if (dist > maxDistanceKm) {
      const segments = Math.ceil(dist / maxDistanceKm);
      for (let j = 1; j < segments; j++) {
        const fraction = j / segments;
        result.push({
          lat: p1.lat + (p2.lat - p1.lat) * fraction,
          lng: p1.lng + (p2.lng - p1.lng) * fraction
        });
      }
    }
    result.push(p2);
  }
  return result;
}

function generateGpx(points: {lat: number, lng: number}[], routeName: string) {
  let gpx = '<?xml version="1.0" encoding="UTF-8"?>\n';
  gpx += '<gpx xmlns="http://www.topografix.com/GPX/1/1" version="1.1" creator="Free Maps to GPX by AI Studio">\n';
  gpx += '  <trk>\n';
  gpx += `    <name>${routeName}</name>\n`;
  gpx += '    <trkseg>\n';
  
  for (const pt of points) {
    gpx += `      <trkpt lat="${pt.lat.toFixed(6)}" lon="${pt.lng.toFixed(6)}"></trkpt>\n`;
  }
  
  gpx += '    </trkseg>\n';
  gpx += '  </trk>\n';
  gpx += '</gpx>';
  return gpx;
}

async function getRoute(locations: {lat: number, lng: number}[], mode: string) {
  if (locations.length < 2) return [];

  if (mode === 'car') {
    // Try BRouter 'car-eco' first for a balanced, more direct route
    try {
      const brouterCoords = locations.map(l => `${l.lng},${l.lat}`).join('|');
      const brouterUrl = `https://brouter.de/brouter?lonlats=${brouterCoords}&profile=car-eco&format=geojson`;
      const res = await fetch(brouterUrl);
      const text = await res.text();
      const data = JSON.parse(text);
      if (data.features && data.features.length > 0) {
        const coords = data.features[0].geometry.coordinates;
        return coords.map((c: number[]) => ({ lat: c[1], lng: c[0] }));
      }
    } catch (e) {
      console.warn("BRouter car-fast failed, falling back to OSRM", e);
    }

    // Fallback to OSRM if BRouter fails (e.g., watchdog timeout on massive routes)
    const coords = locations.map(l => `${l.lng},${l.lat}`).join(';');
    const url = `https://router.project-osrm.org/route/v1/driving/${coords}?overview=full&geometries=geojson`;
    const res = await fetch(url);
    const text = await res.text();
    let data;
    try {
      data = JSON.parse(text);
    } catch (e) {
      throw new Error(`Failed to parse routing data. Server returned: ${text.slice(0, 50)}...`);
    }
    if (data.code === 'Ok' && data.routes.length > 0) {
      const coords = data.routes[0].geometry.coordinates;
      return coords.map((c: number[]) => ({ lat: c[1], lng: c[0] }));
    }
    throw new Error(`Car route not found. Try a different location.`);
  } else if (mode === 'foot') {
    try {
      const coords = locations.map(l => `${l.lng},${l.lat}`).join(';');
      const url = `https://router.project-osrm.org/route/v1/foot/${coords}?overview=full&geometries=geojson`;
      const res = await fetch(url);
      const text = await res.text();
      const data = JSON.parse(text);
      if (data.code === 'Ok' && data.routes.length > 0) {
        const coords = data.routes[0].geometry.coordinates;
        return coords.map((c: number[]) => ({ lat: c[1], lng: c[0] }));
      }
    } catch (e) {
      console.warn("OSRM foot failed, falling back to BRouter shortest", e);
    }

    const brouterCoords = locations.map(l => `${l.lng},${l.lat}`).join('|');
    const brouterUrl = `https://brouter.de/brouter?lonlats=${brouterCoords}&profile=shortest&format=geojson`;
    const res = await fetch(brouterUrl);
    const text = await res.text();
    let data;
    try {
      data = JSON.parse(text);
    } catch (e) {
      if (text.includes('thread-priority-watchdog')) {
        throw new Error(`The walking distance is too long to calculate. Please try a shorter route or add more stops.`);
      }
      throw new Error(`Walking route not found. Server returned: ${text.slice(0, 50)}...`);
    }
    if (data.features && data.features.length > 0) {
      const coords = data.features[0].geometry.coordinates;
      return coords.map((c: number[]) => ({ lat: c[1], lng: c[0] }));
    }
    throw new Error(`Walking route not found.`);

  } else if (mode === 'train') {
    const coords = locations.map(l => `${l.lng},${l.lat}`).join('|');
    const url = `https://brouter.de/brouter?lonlats=${coords}&profile=rail&format=geojson`;
    const res = await fetch(url);
    const text = await res.text();
    let data;
    try {
      data = JSON.parse(text);
    } catch (e) {
      if (text.includes('thread-priority-watchdog')) {
        throw new Error(`The train distance is too long to calculate. Please try a shorter route or add more stops.`);
      }
      throw new Error(`Train route not found. Server returned: ${text.slice(0, 50)}...`);
    }
    if (data.features && data.features.length > 0) {
      const coords = data.features[0].geometry.coordinates;
      return coords.map((c: number[]) => ({ lat: c[1], lng: c[0] }));
    }
    throw new Error(`Train route not found.`);
  }
  throw new Error("Invalid travel mode.");
}

function MapUpdater({ points, disableAutoFit }: { points: {lat: number, lng: number}[], disableAutoFit: MutableRefObject<boolean> }) {
  const map = useMap();
  useEffect(() => {
    if (points.length > 0) {
      if (!disableAutoFit.current) {
        const bounds = L.latLngBounds(points);
        map.fitBounds(bounds, { padding: [50, 50] });
      }
      disableAutoFit.current = false;
    }
  }, [points, map, disableAutoFit]);
  return null;
}

function CustomZoomControl() {
  const map = useMap();
  const divRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    if (divRef.current) {
      L.DomEvent.disableClickPropagation(divRef.current);
      L.DomEvent.disableScrollPropagation(divRef.current);
    }
  }, []);

  return (
    <div 
      ref={divRef}
      className="absolute top-4 left-4 z-[1000] flex flex-col shadow-md rounded-lg overflow-hidden border-2 border-gray-200/50"
    >
      <button 
        onClick={() => map.zoomIn()} 
        className="w-7 h-7 bg-white flex items-center justify-center text-gray-700 hover:bg-gray-50 hover:text-blue-600 transition-colors border-b border-gray-100"
        title="Zoom In"
      >
        <Plus className="w-4 h-4" />
      </button>
      <button 
        onClick={() => map.zoomOut()} 
        className="w-7 h-7 bg-white flex items-center justify-center text-gray-700 hover:bg-gray-50 hover:text-blue-600 transition-colors"
        title="Zoom Out"
      >
        <Minus className="w-4 h-4" />
      </button>
    </div>
  );
}

function MapEvents({ 
  locations,
  setLocations,
  mapClickGuard,
  disableAutoFit
}: { 
  locations: ({lat: number, lng: number, name: string, shortName?: string} | null)[],
  setLocations: (locs: ({lat: number, lng: number, name: string, shortName?: string} | null)[]) => void,
  mapClickGuard: MutableRefObject<number>,
  disableAutoFit: MutableRefObject<boolean>
}) {
  useMapEvents({
    moveend(e) {
      const map = e.target;
      localStorage.setItem('gpx_mapView', JSON.stringify({
        center: map.getCenter(),
        zoom: map.getZoom()
      }));
    },
    async click(e) {
      if (Date.now() - mapClickGuard.current < 500) return;

      // Find first empty slot
      const emptyIdx = locations.findIndex(l => l === null);
      
      // If no empty slots exist, do nothing on map click
      if (emptyIdx === -1) return;

      disableAutoFit.current = true;

      const { name, shortName } = await reverseGeocode(e.latlng.lat, e.latlng.lng);
      const newLoc = { lat: e.latlng.lat, lng: e.latlng.lng, name, shortName };
      
      const newLocs = [...locations];
      newLocs[emptyIdx] = newLoc;
      setLocations(newLocs);
    }
  });
  return null;
}

async function parseSpecialInput(input: string): Promise<{lat: number, lng: number, name: string, shortName: string}[] | null> {
  const waypoints: {lat: number, lng: number, name: string, shortName: string}[] = [];

  // 1. Single coordinate pair
  const coordMatch = input.trim().match(/^([-+]?\d{1,2}(?:\.\d+)?)[,\s]+([-+]?\d{1,3}(?:\.\d+)?)$/);
  if (coordMatch) {
    const lat = parseFloat(coordMatch[1]);
    const lng = parseFloat(coordMatch[2]);
    if (!isNaN(lat) && !isNaN(lng) && lat >= -90 && lat <= 90 && lng >= -180 && lng <= 180) {
      const { name, shortName } = await reverseGeocode(lat, lng);
      waypoints.push({ lat, lng, name, shortName });
      return waypoints;
    }
  }

  // 2. Google Maps URL (dir)
  if (input.includes('google.') && input.includes('/dir/')) {
    try {
      const urlStr = input.match(/https?:\/\/[^\s]+/)?.[0];
      if (urlStr) {
        const url = new URL(urlStr);
        const pathParts = url.pathname.split('/dir/')[1]?.split('/') || [];
        for (const part of pathParts) {
          if (!part || part.startsWith('@') || part.startsWith('data=')) continue;
          const ptMatch = part.match(/^([-+]?\d{1,2}(?:\.\d+)?),([-+]?\d{1,3}(?:\.\d+)?)$/);
          if (ptMatch) {
            const lat = parseFloat(ptMatch[1]);
            const lng = parseFloat(ptMatch[2]);
            const { name, shortName } = await reverseGeocode(lat, lng);
            waypoints.push({ lat, lng, name, shortName });
          } else {
            const decoded = decodeURIComponent(part).replace(/\+/g, ' ');
            const searchRes = await fetch(`https://nominatim.openstreetmap.org/search?format=json&q=${encodeURIComponent(decoded)}&limit=1&addressdetails=1`, {
              headers: { 'User-Agent': 'MapsToGPX-AIStudio-App' }
            });
            const data = await searchRes.json();
            if (data && data.length > 0) {
              const r = data[0];
              const shortName = r.address ? (r.address.city || r.address.town || r.address.village || r.address.county || r.name) : r.display_name.split(',')[0];
              waypoints.push({
                lat: parseFloat(r.lat),
                lng: parseFloat(r.lon),
                name: r.display_name,
                shortName
              });
            }
          }
        }
        if (waypoints.length > 0) return waypoints;
      }
    } catch (e) { console.error(e); }
  }

  // 3. Google Maps URL (place or general @lat,lng)
  if (input.includes('google.') && input.includes('/maps/')) {
    const atMatch = input.match(/@([-+]?\d{1,2}(?:\.\d+)?),([-+]?\d{1,3}(?:\.\d+)?)/);
    if (atMatch) {
      const lat = parseFloat(atMatch[1]);
      const lng = parseFloat(atMatch[2]);
      const { name, shortName } = await reverseGeocode(lat, lng);
      waypoints.push({ lat, lng, name, shortName });
      return waypoints;
    }
  }

  return null;
}

function LocationSearch({ 
  label, 
  placeholder, 
  location,
  onSelect,
  onRemove,
  onMultiSelect
}: { 
  label: string, 
  placeholder: string, 
  location: {lat: number, lng: number, name: string, shortName?: string} | null,
  onSelect: (loc: {lat: number, lng: number, name: string, shortName?: string} | null) => void,
  onRemove?: () => void,
  onMultiSelect?: (locs: {lat: number, lng: number, name: string, shortName?: string}[]) => void
}) {
  const [query, setQuery] = useState(location?.name || '');
  const [results, setResults] = useState<any[]>([]);
  const [isOpen, setIsOpen] = useState(false);
  
  useEffect(() => {
    setQuery(location?.name || '');
  }, [location]);

  useEffect(() => {
    if (query === location?.name) return; // Don't search if query is exactly the synced location
    
    const delay = setTimeout(async () => {
      if (query.includes('goo.gl/') || query.includes('maps.app.goo.gl/')) {
        setResults([{
          place_id: 'error-shortlink',
          display_name: "Short links (goo.gl) are not supported. Please paste the full expanded Google Maps URL.",
          unselectable: true
        }]);
        setIsOpen(true);
        return;
      }

      if (query.length > 2) {
        try {
          const special = await parseSpecialInput(query);
          if (special) {
            if (special.length === 1) {
              setResults([{
                place_id: 'special-1',
                lat: special[0].lat,
                lon: special[0].lng,
                display_name: special[0].name,
                shortName: special[0].shortName,
                isSpecial: true
              }]);
              setIsOpen(true);
              return;
            } else if (special.length > 1 && onMultiSelect) {
              onMultiSelect(special);
              setQuery(special[0].name);
              setIsOpen(false);
              return;
            }
          }

          const res = await fetch(`https://nominatim.openstreetmap.org/search?format=json&q=${encodeURIComponent(query)}&limit=5&addressdetails=1`, {
            headers: { 'User-Agent': 'MapsToGPX-AIStudio-App' }
          });
          const data = await res.json();
          setResults(data);
          setIsOpen(true);
        } catch (e) {
          console.error(e);
        }
      } else {
        setResults([]);
        setIsOpen(false);
      }
    }, 600);
    return () => clearTimeout(delay);
  }, [query]);

  return (
    <div className="relative space-y-1">
      <label className="text-sm font-semibold text-gray-700">{label}</label>
      <div className="relative">
        <div className="absolute inset-y-0 left-0 pl-3 flex items-center pointer-events-none">
          <Search className="h-4 w-4 text-gray-400" />
        </div>
        <input
          type="text"
          placeholder={placeholder}
          value={query}
          onChange={e => {
            setQuery(e.target.value);
            onSelect(null);
          }}
          onFocus={() => {
            if (results.length > 0) setIsOpen(true);
          }}
          className="block w-full pl-10 pr-10 py-2.5 border border-gray-300 rounded-lg focus:ring-2 focus:ring-blue-500 focus:border-blue-500 text-sm"
        />
        {onRemove && (
          <button
            type="button"
            onClick={onRemove}
            className="absolute inset-y-0 right-0 pr-3 flex items-center text-gray-400 hover:text-red-500 transition-colors"
          >
            <X className="h-4 w-4" />
          </button>
        )}
      </div>
      {isOpen && results.length > 0 && (
        <ul className="absolute z-20 w-full bg-white border border-gray-200 mt-1 rounded-lg shadow-lg max-h-48 overflow-y-auto">
          {results.map((r: any) => (
            <li 
              key={r.place_id} 
              className={`px-3 py-2 text-sm border-b border-gray-100 last:border-0 ${r.unselectable ? 'bg-red-50 text-red-600' : 'hover:bg-blue-50 cursor-pointer text-gray-700'}`}
              onClick={() => {
                if (r.unselectable) return;
                setQuery(r.display_name);
                setIsOpen(false);
                if (r.isSpecial) {
                  onSelect({ lat: parseFloat(r.lat), lng: parseFloat(r.lon), name: r.display_name, shortName: r.shortName });
                } else {
                  const shortName = r.address ? (r.address.city || r.address.town || r.address.village || r.address.county || r.name) : r.display_name.split(',')[0];
                  onSelect({ lat: parseFloat(r.lat), lng: parseFloat(r.lon), name: r.display_name, shortName });
                }
              }}
            >
              {r.display_name}
            </li>
          ))}
        </ul>
      )}
    </div>
  );
}

export default function App() {
  const [locations, setLocations] = useState<({lat: number, lng: number, name: string, shortName?: string} | null)[]>(() => {
    try {
      const saved = localStorage.getItem('gpx_locations');
      if (saved) {
        const parsed = JSON.parse(saved);
        if (Array.isArray(parsed) && parsed.length >= 2) return parsed;
      }
    } catch(e) {}
    return [null, null];
  });
  
  const [travelMode, setTravelMode] = useState<'car' | 'train' | 'foot'>(() => {
    return (localStorage.getItem('gpx_travelMode') as any) || 'car';
  });
  
  const [isGenerating, setIsGenerating] = useState(false);
  const [routePoints, setRoutePoints] = useState<{lat: number, lng: number}[]>([]);
  const [routeMeta, setRouteMeta] = useState({ start: '', end: '' });
  const [errorMsg, setErrorMsg] = useState('');
  
  const mapClickGuard = useRef(0);
  const disableAutoFit = useRef(true);
  const [activeLayer, setActiveLayer] = useState<'street' | 'hybrid' | 'satellite'>('street');
  const layersControlRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    if (layersControlRef.current) {
      L.DomEvent.disableClickPropagation(layersControlRef.current);
      L.DomEvent.disableScrollPropagation(layersControlRef.current);
    }
  }, []);

  const [initialView] = useState(() => {
    try {
      const saved = localStorage.getItem('gpx_mapView');
      if (saved) return JSON.parse(saved);
    } catch(e) {}
    return { center: [45.9432, 24.9668], zoom: 6 };
  });

  const hasRoute = routePoints.length > 0 && !isGenerating;

  const routeDistanceKm = useMemo(() => {
    if (routePoints.length < 2) return 0;
    let total = 0;
    for (let i = 1; i < routePoints.length; i++) {
      total += haversineDistance(routePoints[i-1].lat, routePoints[i-1].lng, routePoints[i].lat, routePoints[i].lng);
    }
    return total;
  }, [routePoints]);

  const formattedDistance = routeDistanceKm < 10 
    ? `${routeDistanceKm.toFixed(1)} km` 
    : `${Math.round(routeDistanceKm)} km`;

  const headerTitle = hasRoute ? `${routeMeta.start} → ${routeMeta.end} • ${formattedDistance}` : "GPX Generator";

  const headerContainerRef = useRef<HTMLDivElement>(null);
  const headerTextRef = useRef<HTMLDivElement>(null);
  const [textScale, setTextScale] = useState(1);

  useEffect(() => {
    const checkFit = () => {
      if (headerTextRef.current && headerContainerRef.current) {
        // Reset scale briefly to measure intrinsic width
        headerTextRef.current.style.transform = 'scale(1)';
        const containerWidth = headerContainerRef.current.clientWidth;
        const textWidth = headerTextRef.current.scrollWidth;
        
        if (textWidth > containerWidth && containerWidth > 0) {
          setTextScale(containerWidth / textWidth);
        } else {
          setTextScale(1);
        }
      }
    };
    
    const timer = setTimeout(checkFit, 50);
    window.addEventListener('resize', checkFit);
    return () => {
      clearTimeout(timer);
      window.removeEventListener('resize', checkFit);
    };
  }, [headerTitle, locations]);

  useEffect(() => {
    localStorage.setItem('gpx_locations', JSON.stringify(locations));
  }, [locations]);

  useEffect(() => {
    localStorage.setItem('gpx_travelMode', travelMode);
  }, [travelMode]);

  const validLocations = locations.filter(l => l !== null) as {lat: number, lng: number, name: string, shortName?: string}[];

  useEffect(() => {
    if (validLocations.length < 2) {
      setRoutePoints([]);
      setErrorMsg('');
      return;
    }

    let isCancelled = false;
    
    const generate = async () => {
      setIsGenerating(true);
      setErrorMsg('');
      try {
        const startName = validLocations[0].shortName || validLocations[0].name.split(',')[0];
        const endName = validLocations[validLocations.length - 1].shortName || validLocations[validLocations.length - 1].name.split(',')[0];
        if (!isCancelled) setRouteMeta({ start: startName, end: endName });
        
        const path = await getRoute(validLocations, travelMode);
        
        if (!isCancelled) {
          const densePoints = interpolatePoints(path, 1.0);
          setRoutePoints(densePoints);
        }
      } catch (err: any) {
        console.error(err);
        if (!isCancelled) {
          setErrorMsg(err.message || "Failed to generate route. Please try again.");
          setRoutePoints([]);
        }
      } finally {
        if (!isCancelled) setIsGenerating(false);
      }
    };
    
    // Add debounce to avoid rapid re-fetches while dragging or typing
    const timer = setTimeout(generate, 600);
    return () => {
      isCancelled = true;
      clearTimeout(timer);
    };
  }, [locations, travelMode]);

  const handlePolylineClick = async (e: any) => {
    mapClickGuard.current = Date.now();
    e.originalEvent?.stopPropagation();
    if (validLocations.length < 2) return;
    const clickPt = e.latlng;
    
    disableAutoFit.current = true;
    
    let bestI = 0;
    let minDetour = Infinity;
    for (let i = 0; i < validLocations.length - 1; i++) {
      const l1 = validLocations[i];
      const l2 = validLocations[i+1];
      const detour = haversineDistance(l1.lat, l1.lng, clickPt.lat, clickPt.lng) +
                     haversineDistance(clickPt.lat, clickPt.lng, l2.lat, l2.lng) -
                     haversineDistance(l1.lat, l1.lng, l2.lat, l2.lng);
      if (detour < minDetour) {
        minDetour = detour;
        bestI = i;
      }
    }
    
    const name = await reverseGeocode(clickPt.lat, clickPt.lng);
    const newLoc = { lat: clickPt.lat, lng: clickPt.lng, name };
    
    // We want to insert `newLoc` directly after the original validLocations[bestI]
    // Find the corresponding validIndex to insert after it.
    let validIndex = -1;
    let spliceIndex = locations.length;
    for (let i = 0; i < locations.length; i++) {
      if (locations[i] !== null) {
        validIndex++;
        if (validIndex === bestI) {
          spliceIndex = i + 1;
          break;
        }
      }
    }
    
    const newLocs = [...locations];
    newLocs.splice(spliceIndex, 0, newLoc);
    setLocations(newLocs);
  };

  const handleOpenDropbox = () => {
    try {
      if (window.top && window.top !== window) {
        window.top.location.href = "https://www.dropbox.com/home/Apps/Fog%20of%20World/Import";
        return;
      }
    } catch {
      // In case of cross-origin iframe security restrictions
    }
    window.location.href = "https://www.dropbox.com/home/Apps/Fog%20of%20World/Import";
  };

  const handleDownload = () => {
    if (routePoints.length === 0) return;
    const modeStr = travelMode === 'foot' ? 'walk' : travelMode;
    const fileName = `${routeMeta.start}-${routeMeta.end}(${modeStr})`;
    const gpxData = generateGpx(routePoints, fileName);
    const blob = new Blob([gpxData], { type: 'application/gpx+xml' });
    const url = URL.createObjectURL(blob);
    const a = document.createElement('a');
    a.href = url;
    a.download = `${fileName.replace(/[^\p{L}\p{N}\-\(\)]/gu, '_').toLowerCase()}.gpx`;
    document.body.appendChild(a);
    a.click();
    document.body.removeChild(a);
    URL.revokeObjectURL(url);
  };

  return (
    <div className="relative w-full h-screen bg-gray-100 font-sans flex flex-col md:flex-row overflow-hidden">
      <style>{`
        .leaflet-control-layers-toggle {
          width: 30px !important;
          height: 30px !important;
          background-size: 16px 16px !important;
        }
      `}</style>
      <div className="w-full max-h-[55vh] md:max-h-none md:h-full md:w-[400px] shrink-0 bg-white shadow-2xl z-20 flex flex-col relative overflow-hidden">
        <div className="absolute inset-0 z-0 flex items-center justify-center opacity-[0.03] pointer-events-none">
          <Route className="w-[150%] h-[150%] text-blue-900 -rotate-12" />
        </div>

        <div className="py-2 px-3 md:py-2.5 md:px-4 bg-blue-600 text-white shrink-0 shadow-md sticky top-0 z-50 min-h-[48px] md:min-h-[52px] flex items-center">
          <div className="flex items-center justify-between gap-2 w-full min-h-[32px]">
            <div className="flex items-center space-x-2 flex-1 overflow-hidden min-h-[32px]">
              {isGenerating && !errorMsg ? (
                <>
                  <Loader2 className="w-4 h-4 text-blue-100 shrink-0 animate-spin" />
                  <div className="flex-1 overflow-hidden relative flex items-center">
                    <div className="text-sm font-bold tracking-tight whitespace-nowrap">
                      Calculating route...
                    </div>
                  </div>
                </>
              ) : (
                <>
                  <Route className="w-4 h-4 text-blue-100 shrink-0" />
                  <div className="flex-1 overflow-hidden relative flex items-center" ref={headerContainerRef}>
                    <div 
                      ref={headerTextRef} 
                      style={{ transform: `scale(${textScale})`, transformOrigin: 'left center' }}
                      className="text-sm font-bold tracking-tight whitespace-nowrap transition-transform duration-200 flex items-center gap-1.5"
                    >
                      {hasRoute ? (
                        <>
                          <span>{routeMeta.start}</span>
                          <ArrowRight className="w-3.5 h-3.5 opacity-75 shrink-0" />
                          <span>{routeMeta.end}</span>
                          <span className="font-normal opacity-80 ml-1 shrink-0">• {formattedDistance}</span>
                        </>
                      ) : (
                        "GPX Generator"
                      )}
                    </div>
                  </div>
                </>
              )}
            </div>

            {hasRoute && (
              <div className="flex items-center gap-1.5 shrink-0">
                <button
                  id="dropbox-import-btn"
                  onClick={handleOpenDropbox}
                  className="shrink-0 bg-white/10 hover:bg-white/20 text-white p-1.5 rounded-lg transition-colors flex items-center justify-center"
                  title="Open Fog of World Import Folder in Dropbox"
                  aria-label="Open Fog of World Import Folder in Dropbox"
                >
                  <Cloud className="w-5 h-5" />
                </button>
                <button
                  id="download-gpx-btn"
                  onClick={handleDownload}
                  className="shrink-0 bg-white/10 hover:bg-white/20 text-white p-1.5 rounded-lg transition-colors flex items-center justify-center"
                  title="Download GPX"
                  aria-label="Download GPX"
                >
                  <FileDown className="w-5 h-5" />
                </button>
              </div>
            )}
          </div>
        </div>

        <div className="p-3 md:p-6 shrink min-h-0 space-y-3 md:space-y-6 overflow-y-auto relative z-10 flex flex-col">
          <div className="flex flex-col gap-3">
            {locations.map((loc, idx) => (
              <div key={idx} className="relative">
                <LocationSearch 
                  label={idx === 0 ? "Starting Point" : idx === locations.length - 1 ? "Destination" : `Stop ${idx}`} 
                  placeholder="(or click map)" 
                  location={loc}
                  onSelect={(newLoc) => {
                    disableAutoFit.current = false;
                    const newLocs = [...locations];
                    newLocs[idx] = newLoc;
                    setLocations(newLocs);
                  }}
                  onMultiSelect={(newLocs) => {
                    disableAutoFit.current = false;
                    setLocations(newLocs);
                  }}
                  onRemove={locations.length > 2 ? () => {
                    disableAutoFit.current = true;
                    const newLocs = [...locations];
                    newLocs.splice(idx, 1);
                    setLocations(newLocs);
                  } : undefined}
                />
                
                {idx < locations.length - 1 && (
                  <>
                    <button
                      id={`add-stop-btn-${idx}`}
                      type="button"
                      onClick={() => {
                        disableAutoFit.current = true;
                        const newLocs = [...locations];
                        newLocs.splice(idx + 1, 0, null);
                        setLocations(newLocs);
                      }}
                      className="absolute left-1/2 -translate-x-1/2 top-full mt-[18px] -translate-y-1/2 bg-white border border-gray-200 text-gray-500 hover:text-blue-600 hover:border-blue-400 rounded-full p-0.5 shadow-sm transition-colors z-10"
                      title="Add stop here"
                      aria-label="Add stop here"
                    >
                      <Plus className="w-4 h-4" />
                    </button>

                    {locations.length === 2 && (
                      <button
                        id="reverse-route-btn"
                        type="button"
                        onClick={() => {
                          disableAutoFit.current = false;
                          setLocations([locations[1], locations[0]]);
                        }}
                        className="absolute right-3 top-full mt-[18px] -translate-y-1/2 text-gray-500 hover:text-blue-600 transition-all active:scale-90 z-10 p-1 flex items-center justify-center"
                        title="Reverse route"
                        aria-label="Reverse route"
                      >
                        <ArrowUpDown className="w-4 h-4" />
                      </button>
                    )}
                  </>
                )}
              </div>
            ))}
          </div>

          <div className="space-y-3 shrink-0">
            <div className="space-y-1">
              <label className="text-sm font-semibold text-gray-700">Travel Mode</label>
              <div className="grid grid-cols-3 gap-2">
                <button
                  onClick={() => setTravelMode('foot')}
                  className={`py-1.5 px-1 text-sm font-semibold rounded-lg transition-colors flex flex-row items-center justify-center gap-1.5 ${
                    travelMode === 'foot'
                      ? 'bg-blue-600 text-white shadow-md'
                      : 'bg-gray-100 text-gray-600 hover:bg-gray-200'
                  }`}
                >
                  <Footprints className="w-4 h-4" />
                  <span>Walk</span>
                </button>
                <button
                  onClick={() => setTravelMode('car')}
                  className={`py-1.5 px-1 text-sm font-semibold rounded-lg transition-colors flex flex-row items-center justify-center gap-1.5 ${
                    travelMode === 'car'
                      ? 'bg-blue-600 text-white shadow-md'
                      : 'bg-gray-100 text-gray-600 hover:bg-gray-200'
                  }`}
                >
                  <Car className="w-4 h-4" />
                  <span>Car</span>
                </button>
                <button
                  onClick={() => setTravelMode('train')}
                  className={`py-1.5 px-1 text-sm font-semibold rounded-lg transition-colors flex flex-row items-center justify-center gap-1.5 ${
                    travelMode === 'train'
                      ? 'bg-blue-600 text-white shadow-md'
                      : 'bg-gray-100 text-gray-600 hover:bg-gray-200'
                  }`}
                >
                  <Train className="w-4 h-4" />
                  <span>Train</span>
                </button>
              </div>
            </div>
          </div>

          {errorMsg && (
            <div className="p-3 bg-red-50 text-red-700 text-sm rounded-lg border border-red-100 shrink-0">
              {errorMsg}
            </div>
          )}
        </div>

        <div className="w-full text-center py-1.5 bg-transparent shrink-0 relative z-20 pointer-events-none">
          <a 
            href="https://github.com/boanska" 
            target="_blank" 
            rel="noopener noreferrer"
            className="text-[11px] text-gray-400 hover:text-blue-500 transition-colors inline-block pointer-events-auto"
          >
            &copy; github.com/boanska
          </a>
        </div>
      </div>

      <div className="flex-1 h-full z-0 relative">
        <MapContainer center={initialView.center} zoom={initialView.zoom} zoomControl={false} style={{ height: '100%', width: '100%' }}>
          <CustomZoomControl />
          {activeLayer === 'street' && (
            <TileLayer
              attribution='&copy; <a href="https://www.openstreetmap.org/copyright">OpenStreetMap</a> contributors'
              url="https://{s}.tile.openstreetmap.org/{z}/{x}/{y}.png"
            />
          )}
          {activeLayer === 'hybrid' && (
            <LayerGroup>
              <TileLayer
                attribution='Tiles &copy; Esri &mdash; Source: Esri, i-cubed, USDA, USGS, AEX, GeoEye, Getmapping, Aerogrid, IGN, IGP, UPR-EGP, and the GIS User Community'
                url="https://server.arcgisonline.com/ArcGIS/rest/services/World_Imagery/MapServer/tile/{z}/{y}/{x}"
              />
              <TileLayer
                url="https://server.arcgisonline.com/ArcGIS/rest/services/Reference/World_Transportation/MapServer/tile/{z}/{y}/{x}"
              />
              <TileLayer
                url="https://server.arcgisonline.com/ArcGIS/rest/services/Reference/World_Boundaries_and_Places/MapServer/tile/{z}/{y}/{x}"
              />
            </LayerGroup>
          )}
          {activeLayer === 'satellite' && (
            <TileLayer
              attribution='Tiles &copy; Esri'
              url="https://server.arcgisonline.com/ArcGIS/rest/services/World_Imagery/MapServer/tile/{z}/{y}/{x}"
            />
          )}

          <MapEvents locations={locations} setLocations={setLocations} mapClickGuard={mapClickGuard} disableAutoFit={disableAutoFit} />
          
          {locations.map((loc, idx) => {
            if (!loc) return null;
            return (
              <Marker 
                key={idx}
                position={[loc.lat, loc.lng]} 
                draggable={true}
                icon={L.divIcon({
                  html: idx === 0 
                    ? `<div class="relative w-8 h-10 flex flex-col items-center">
                         <div class="absolute -bottom-1 w-5 h-2 bg-black/40 blur-[2px] rounded-[100%]"></div>
                         <div class="w-8 h-8 bg-blue-500 rounded-full border-[3px] border-white shadow-md flex items-center justify-center relative z-10">
                           <div class="w-2.5 h-2.5 bg-white rounded-full opacity-80"></div>
                         </div>
                         <div class="w-0 h-0 border-l-[6px] border-l-transparent border-r-[6px] border-r-transparent border-t-[8px] border-t-white absolute bottom-0.5"></div>
                       </div>`
                    : idx === locations.length - 1
                    ? `<div class="relative w-8 h-10 flex flex-col items-center">
                         <div class="absolute -bottom-1 w-5 h-2 bg-black/40 blur-[2px] rounded-[100%]"></div>
                         <div class="w-8 h-8 rounded-full border-[3px] border-white shadow-md flex items-center justify-center relative z-10 overflow-hidden bg-white">
                           <div class="w-full h-full" style="background-image: conic-gradient(#1f2937 90deg, #ffffff 90deg 180deg, #1f2937 180deg 270deg, #ffffff 270deg); background-size: 50% 50%;"></div>
                         </div>
                         <div class="w-0 h-0 border-l-[6px] border-l-transparent border-r-[6px] border-r-transparent border-t-[8px] border-t-white absolute bottom-0.5"></div>
                       </div>`
                    : `<div class="relative w-6 h-6 flex flex-col items-center justify-center">
                         <div class="absolute top-1 w-5 h-5 bg-black/30 blur-[2px] rounded-full"></div>
                         <div class="w-5 h-5 bg-white rounded-full border-[3px] border-gray-400 relative z-10"></div>
                       </div>`,
                  className: '',
                  iconSize: idx === 0 || idx === locations.length - 1 ? [32, 40] : [24, 24],
                  iconAnchor: idx === 0 || idx === locations.length - 1 ? [16, 40] : [12, 12]
                })}
                eventHandlers={{
                  async dragend(e) {
                    disableAutoFit.current = true;
                    const m = e.target;
                    const pos = m.getLatLng();
                    const { name, shortName } = await reverseGeocode(pos.lat, pos.lng);
                    const newLocs = [...locations];
                    newLocs[idx] = { lat: pos.lat, lng: pos.lng, name, shortName };
                    setLocations(newLocs);
                  }
                }}
              />
            );
          })}

          {routePoints.length > 0 && (
            <>
              <Polyline 
                positions={routePoints} 
                color="#2563eb" 
                weight={5} 
                opacity={isGenerating ? 0.3 : 0.8}
                className={isGenerating ? "animate-pulse transition-opacity duration-300" : "transition-opacity duration-300"}
                eventHandlers={{ click: handlePolylineClick }}
              />
              <MapUpdater points={routePoints} disableAutoFit={disableAutoFit} />
            </>
          )}
        </MapContainer>

        <div ref={layersControlRef} className="absolute top-4 right-4 z-[1000] flex flex-row-reverse items-start">
          <button 
            onClick={() => {
              if (activeLayer === 'street') setActiveLayer('satellite');
              else if (activeLayer === 'satellite') setActiveLayer('hybrid');
              else setActiveLayer('street');
            }}
            className="w-10 h-10 bg-white rounded-lg shadow-md border-2 border-gray-200/50 flex items-center justify-center text-gray-700 hover:bg-gray-50 hover:text-blue-600 transition-colors peer"
            title="Toggle Map Layer"
          >
            <Layers className="w-5 h-5" />
          </button>
          
          <div className="mr-2 bg-white rounded-lg shadow-md p-1.5 flex gap-1.5 opacity-0 peer-hover:opacity-100 hover:opacity-100 transition-opacity duration-200 pointer-events-none peer-hover:pointer-events-auto hover:pointer-events-auto">
            <button 
              onClick={() => setActiveLayer('street')} 
              className={`px-3 py-1.5 text-xs font-semibold rounded-md transition-colors ${activeLayer === 'street' ? 'bg-blue-100 text-blue-700' : 'bg-transparent text-gray-700 hover:bg-gray-100'}`}
            >
              Street
            </button>
            <button 
              onClick={() => setActiveLayer('satellite')} 
              className={`px-3 py-1.5 text-xs font-semibold rounded-md transition-colors ${activeLayer === 'satellite' ? 'bg-blue-100 text-blue-700' : 'bg-transparent text-gray-700 hover:bg-gray-100'}`}
            >
              Satellite
            </button>
            <button 
              onClick={() => setActiveLayer('hybrid')} 
              className={`px-3 py-1.5 text-xs font-semibold rounded-md transition-colors ${activeLayer === 'hybrid' ? 'bg-blue-100 text-blue-700' : 'bg-transparent text-gray-700 hover:bg-gray-100'}`}
            >
              Hybrid
            </button>
          </div>
        </div>
      </div>
    </div>
  );
}

