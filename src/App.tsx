import { useState, useEffect, useRef, MutableRefObject } from 'react';
import { MapContainer, TileLayer, Polyline, useMap, Marker, Tooltip, useMapEvents, LayersControl } from 'react-leaflet';
import { FileDown, Route, Loader2, MapPin, Search, Plus, X, ArrowRight, Footprints, Car, Train } from 'lucide-react';
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
  } else if (mode === 'train' || mode === 'foot') {
    const coords = locations.map(l => `${l.lng},${l.lat}`).join('|');
    const profile = mode === 'train' ? 'rail' : 'trekking';
    const url = `https://brouter.de/brouter?lonlats=${coords}&profile=${profile}&format=geojson`;
    const res = await fetch(url);
    const text = await res.text();
    let data;
    try {
      data = JSON.parse(text);
    } catch (e) {
      if (text.includes('thread-priority-watchdog')) {
        throw new Error(`The ${mode === 'train' ? 'train' : 'walking'} distance is too long to calculate. Please try a shorter route or add more stops.`);
      }
      throw new Error(`${mode === 'train' ? 'Train' : 'Walking'} route not found. Server returned: ${text.slice(0, 50)}...`);
    }
    if (data.features && data.features.length > 0) {
      const coords = data.features[0].geometry.coordinates;
      return coords.map((c: number[]) => ({ lat: c[1], lng: c[0] }));
    }
    throw new Error(`${mode === 'train' ? 'Train' : 'Walking'} route not found.`);
  }
  throw new Error("Invalid travel mode.");
}

function MapUpdater({ points }: { points: {lat: number, lng: number}[] }) {
  const map = useMap();
  useEffect(() => {
    if (points.length > 0) {
      const bounds = L.latLngBounds(points);
      map.fitBounds(bounds, { padding: [50, 50] });
    }
  }, [points, map]);
  return null;
}

function MapEvents({ 
  locations,
  setLocations,
  mapClickGuard
}: { 
  locations: ({lat: number, lng: number, name: string, shortName?: string} | null)[],
  setLocations: (locs: ({lat: number, lng: number, name: string, shortName?: string} | null)[]) => void,
  mapClickGuard: MutableRefObject<number>
}) {
  useMapEvents({
    async click(e) {
      if (Date.now() - mapClickGuard.current < 500) return;

      const { name, shortName } = await reverseGeocode(e.latlng.lat, e.latlng.lng);
      const newLoc = { lat: e.latlng.lat, lng: e.latlng.lng, name, shortName };
      
      const newLocs = [...locations];
      // Find first empty slot
      const emptyIdx = newLocs.findIndex(l => l === null);
      if (emptyIdx !== -1) {
        newLocs[emptyIdx] = newLoc;
      } else {
        newLocs.push(newLoc);
      }
      setLocations(newLocs);
    }
  });
  return null;
}

function LocationSearch({ 
  label, 
  placeholder, 
  location,
  onSelect,
  onRemove
}: { 
  label: string, 
  placeholder: string, 
  location: {lat: number, lng: number, name: string, shortName?: string} | null,
  onSelect: (loc: {lat: number, lng: number, name: string, shortName?: string} | null) => void,
  onRemove?: () => void
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
      if (query.length > 2) {
        try {
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
              className="px-3 py-2 hover:bg-blue-50 cursor-pointer text-sm text-gray-700 border-b border-gray-100 last:border-0"
              onClick={() => {
                setQuery(r.display_name);
                setIsOpen(false);
                const shortName = r.address ? (r.address.city || r.address.town || r.address.village || r.address.county || r.name) : r.display_name.split(',')[0];
                onSelect({ lat: parseFloat(r.lat), lng: parseFloat(r.lon), name: r.display_name, shortName });
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

  const hasRoute = routePoints.length > 0 && !isGenerating;
  const headerTitle = hasRoute ? `${routeMeta.start} → ${routeMeta.end} • ${routePoints.length} waypoints` : "GPX Generator";

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

  const handleDownload = () => {
    if (routePoints.length === 0) return;
    const fileName = `${routeMeta.start}-${routeMeta.end}(${travelMode})`;
    const gpxData = generateGpx(routePoints, fileName);
    const blob = new Blob([gpxData], { type: 'application/gpx+xml' });
    const url = URL.createObjectURL(blob);
    const a = document.createElement('a');
    a.href = url;
    a.download = `${fileName.replace(/[^a-z0-9\-\(\)]/gi, '_').toLowerCase()}.gpx`;
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
      <div className="w-full h-[50vh] md:h-full md:w-[400px] shrink-0 bg-white shadow-2xl z-20 flex flex-col relative overflow-hidden">
        <div className="absolute inset-0 z-0 flex items-center justify-center opacity-[0.03] pointer-events-none">
          <Route className="w-[150%] h-[150%] text-blue-900 -rotate-12" />
        </div>

        <div className="py-2 px-3 md:py-2.5 md:px-4 bg-blue-600 text-white shrink-0 shadow-md relative z-20">
          <div className="flex items-center space-x-2 w-full overflow-hidden">
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
                        <ArrowRight className="w-3.5 h-3.5 opacity-75" />
                        <span>{routeMeta.end}</span>
                        <span className="font-normal opacity-80 ml-1">• {routePoints.length} waypoints</span>
                      </>
                    ) : (
                      "GPX Generator"
                    )}
                  </div>
                </div>
              </>
            )}
          </div>
        </div>

        <div className="p-4 md:p-6 flex-1 space-y-4 md:space-y-6 overflow-y-auto relative z-10">
          <div className="flex flex-col gap-3">
            {locations.map((loc, idx) => (
              <div key={idx} className="relative">
                <LocationSearch 
                  label={idx === 0 ? "Starting Point" : idx === locations.length - 1 ? "Destination" : `Stop ${idx}`} 
                  placeholder="(or click map)" 
                  location={loc}
                  onSelect={(newLoc) => {
                    const newLocs = [...locations];
                    newLocs[idx] = newLoc;
                    setLocations(newLocs);
                  }}
                  onRemove={locations.length > 2 ? () => {
                    const newLocs = [...locations];
                    newLocs.splice(idx, 1);
                    setLocations(newLocs);
                  } : undefined}
                />
                
                {idx < locations.length - 1 && (
                  <button
                    onClick={() => {
                      const newLocs = [...locations];
                      newLocs.splice(idx + 1, 0, null);
                      setLocations(newLocs);
                    }}
                    className="absolute left-1/2 -translate-x-1/2 top-full mt-[18px] -translate-y-1/2 bg-white border border-gray-200 text-gray-500 hover:text-blue-600 hover:border-blue-400 rounded-full p-0.5 shadow-sm transition-colors z-10"
                    title="Add stop here"
                  >
                    <Plus className="w-4 h-4" />
                  </button>
                )}
              </div>
            ))}
          </div>

          <div className="space-y-4">
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
            <div className="p-3 bg-red-50 text-red-700 text-sm rounded-lg border border-red-100">
              {errorMsg}
            </div>
          )}

          {routePoints.length > 0 && !isGenerating && (
            <div className="mt-8 pb-4 space-y-4 animate-in fade-in slide-in-from-bottom-2 duration-300">
              <button
                onClick={handleDownload}
                className="w-full flex justify-center items-center py-3 px-4 rounded-xl shadow-lg text-sm font-bold text-white bg-green-600 hover:bg-green-700 focus:outline-none focus:ring-2 focus:ring-offset-2 focus:ring-green-500 transform transition-all hover:-translate-y-0.5 active:translate-y-0"
              >
                <FileDown className="-ml-1 mr-2 h-5 w-5" />
                Download GPX
              </button>
            </div>
          )}
        </div>
      </div>

      <div className="flex-1 h-full z-0 relative">
        <MapContainer center={[45.9432, 24.9668]} zoom={6} style={{ height: '100%', width: '100%' }}>
          <LayersControl position="topright">
            <LayersControl.BaseLayer checked name="Street View">
              <TileLayer
                attribution='&copy; <a href="https://www.openstreetmap.org/copyright">OpenStreetMap</a> contributors'
                url="https://{s}.tile.openstreetmap.org/{z}/{x}/{y}.png"
              />
            </LayersControl.BaseLayer>
            <LayersControl.BaseLayer name="Satellite">
              <TileLayer
                attribution='Tiles &copy; Esri &mdash; Source: Esri, i-cubed, USDA, USGS, AEX, GeoEye, Getmapping, Aerogrid, IGN, IGP, UPR-EGP, and the GIS User Community'
                url="https://server.arcgisonline.com/ArcGIS/rest/services/World_Imagery/MapServer/tile/{z}/{y}/{x}"
              />
            </LayersControl.BaseLayer>
          </LayersControl>
          <MapEvents locations={locations} setLocations={setLocations} mapClickGuard={mapClickGuard} />
          
          {locations.map((loc, idx) => {
            if (!loc) return null;
            return (
              <Marker 
                key={idx}
                position={[loc.lat, loc.lng]} 
                draggable={true}
                eventHandlers={{
                  async dragend(e) {
                    const m = e.target;
                    const pos = m.getLatLng();
                    const { name, shortName } = await reverseGeocode(pos.lat, pos.lng);
                    const newLocs = [...locations];
                    newLocs[idx] = { lat: pos.lat, lng: pos.lng, name, shortName };
                    setLocations(newLocs);
                  }
                }}
              >
                <Tooltip permanent direction="top">{idx === 0 ? 'Start' : idx === locations.length - 1 ? 'Destination' : `Stop ${idx}`}</Tooltip>
              </Marker>
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
              <MapUpdater points={routePoints} />
            </>
          )}
        </MapContainer>
      </div>
    </div>
  );
}

