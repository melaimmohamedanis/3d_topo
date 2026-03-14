/*
const express = require('express');
const axios = require('axios');
const cors = require('cors');

const app = express();

app.use(cors());
app.use(express.json());

app.get('/api/terrain', async (req, res) => {
  console.log(">>> [BACKEND] Received request for /api/terrain");

  // Grab the bounding box from the request URL, fallback to defaults if not provided
  const minLat = parseFloat(req.query.minLat) || 45.8;
  const maxLat = parseFloat(req.query.maxLat) || 46.0;
  const minLng = parseFloat(req.query.minLng) || 6.8;
  const maxLng = parseFloat(req.query.maxLng) || 7.0;
  
  const resolution = 80; 

  console.log(`>>> [BACKEND] BBox: Lat(${minLat} to ${maxLat}), Lng(${minLng} to ${maxLng})`);

  const locations = [];
  for (let i = 0; i <= resolution; i++) {
    const lat = maxLat - (i / resolution) * (maxLat - minLat);
    for (let j = 0; j <= resolution; j++) {
      const lng = minLng + (j / resolution) * (maxLng - minLng);
      locations.push({ latitude: lat, longitude: lng });
    }
  }

  try {
    console.log(`>>> [BACKEND] Fetching ${locations.length} points from Open-Elevation...`);
    const response = await axios.post('https://api.open-elevation.com/api/v1/lookup', { locations });
    
    if (!response.data || !response.data.results) {
      return res.status(500).json({ error: "Empty data from Elevation API" });
    }

    const heights = response.data.results.map(r => r.elevation);
    res.json({ heights, resolution });
  } catch (err) {
    console.error("!!! [BACKEND] Error:", err.message);
    res.status(500).json({ error: err.message });
  }
});

app.listen(3001, () => console.log('Backend Debugger running on http://localhost:3001'));
*/