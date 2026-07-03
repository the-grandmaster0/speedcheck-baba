# SPEEDCHECK BABA

https://speedcheck-baba.netlify.app/#
link for app above


 SPEEDCHECK BABA 

A modern, client-side internet speed test application built with React and Vite. Test your connection's download and upload speeds with real-time visualization and accurate measurements.

## Features

- **Real-time speed gauge** — animated SVG arc that updates live during the test
- **Live history chart** — line chart tracking speed fluctuations per phase
- **Warmup period** — first 1 second of each test is excluded to avoid TCP slow-start spikes
- **Parallel upload workers** — 6 concurrent streams to saturate available bandwidth
- **CORS-safe upload** — upload requests are proxied through Vite's dev server to bypass browser CORS restrictions
- **Network info** — shows your ISP/provider fetched from `ipapi.co` after the test
- **Responsive design** — works on desktop, tablet, mobile portrait, mobile landscape, and small screens
- **PWA ready** — includes a service worker and web manifest

## Tech Stack

- React 19 + Vite 7
- Chart.js + react-chartjs-2
- Vanilla CSS with glassmorphism and gradient themes
- XMLHttpRequest for precise per-byte progress tracking

## Getting Started

```bash
npm install
npm run dev
```

Then open `http://localhost:5173`.

## How It Works

See [Working.md](Working.md) for a detailed breakdown of the measurement logic and architecture.

## Notes

- Download uses Cloudflare CDN endpoints (`speed.cloudflare.com`)
- Upload is proxied to `speed.cloudflare.com/__up` via Vite dev server proxy to avoid CORS
- Network info is fetched from `ipapi.co/json/`
- Each test phase runs for 15 seconds
- Created by Aditya [(maratanda8-ux)](https://www.github.com/maratanda8-ux)
