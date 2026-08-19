# MapsToGPX for Fog of World 🌍

A clean, modern, and mobile-friendly web application designed specifically to generate high-quality GPX tracks for the game **Fog of World**. 

Easily map out your road trips, train rides, and walking routes, and export them as dense, accurately plotted GPX files perfect for importing into the game to clear your fog!

## ✨ Capabilities & Features

- 📍 **Multi-Stop Routing:** Plan complex trips by adding a start, destination, and unlimited intermediate detours. Click anywhere on the generated route to seamlessly drag and snap it to a new road.
- 🚗🚶🚂 **Smart Travel Modes:** 
  - **Car:** Utilizes a balanced eco-routing engine to prioritize major roads and highways, just like a real driver would.
  - **Walk:** Snaps to standard pedestrian paths and sidewalks.
  - **Train:** Specialized railway routing engine to accurately plot your scenic train journeys.
- 🔗 **Versatile Search Inputs:** 
  - Type city names or addresses.
  - Paste raw coordinates (e.g., `45.9432, 24.9668`).
  - Paste **Google Maps URLs** directly into the search box to automatically extract the location.
- 🗺️ **Rich Map Layers:** Toggle seamlessly between Street View, Pure Satellite, and Hybrid (Satellite with road/city labels) map layers.
- 📥 **Fog of World Optimized GPX Export:** The app automatically interpolates waypoints (adding points every 1km) to ensure your imported tracks render smoothly and continuously in Fog of World, completely eliminating straight-line gaps across curved roads.
- 💾 **Persistent State:** Automatically saves your map position, zoom level, and last used travel mode so you can pick up exactly where you left off.

## 🚀 How to Use

1. **Set your Start and End points** by typing in the search boxes, pasting a Google Maps link, or clicking directly on the map.
2. **Adjust your route** by dragging the map pins, or add intermediate stops using the `+` button in the sidebar.
3. **Select your Travel Mode** (Car, Walk, or Train) to recalculate the route along the correct paths.
4. **Download** your route by clicking the white download icon in the top right corner of the header.
5. **Import** the resulting `.gpx` file directly into your Fog of World sync folder!

## 🛠️ Built With
- **React & TypeScript**
- **Tailwind CSS** for a responsive, modern UI
- **Leaflet / React-Leaflet** for interactive mapping
- **OSRM & BRouter** for highly accurate, mode-specific pathfinding algorithms
- **Nominatim** for open-source geocoding and search
