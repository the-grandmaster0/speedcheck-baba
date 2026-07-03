# How It Works: SPEEDCHECK BABA

A breakdown of the implementation, measurement logic, and architecture.

---

## Overview

SPEEDCHECK BABA is a fully client-side React app that measures download and upload throughput using public endpoints and visualizes results in real-time via a gauge and live chart. No backend is required except a Vite dev proxy for upload CORS handling.

---

## Core Flow

1. User clicks **Start Test**
2. Download test runs for 15 seconds
3. Upload test runs for 15 seconds
4. Results (download speed, upload speed, ISP info) are shown
5. User can click **Test Again** to restart

State transitions: `idle → downloading → uploading → complete` (or `error`)

---

## Speed Test Logic (`src/utils/speedTest.js`)

### Download Test

- Fetches from **Cloudflare CDN** endpoints with sizes ranging from 5MB to 100MB.
- Cycles through multiple URL sizes so fast connections always have data to consume.
- Uses `XMLHttpRequest` with `onprogress` to track byte deltas in real-time.
- **Warmup period**: the first 1000ms of data is discarded. Measurement starts after warmup to avoid inflated readings caused by TCP slow-start and connection ramp-up.
- Speed is calculated as: `(bytes transferred since warmup end × 8) / seconds since warmup end`
- Updates the UI every ~100ms.
- Runs for **15 seconds** total, then aborts gracefully.
- Cache-busting query params (`?t=<timestamp><random>`) prevent cached responses.

### Upload Test

- Runs **6 concurrent worker streams** to saturate available upload bandwidth.
- Each worker uploads a **1MB random binary blob** (`Uint8Array`) in a loop for the full test duration.
- Blob type is `application/octet-stream`.
- Upload endpoint is `/upload-proxy`, which Vite's dev server proxies to `https://speed.cloudflare.com/__up`. This sidesteps CORS restrictions that would block direct browser uploads from `localhost`.
- **Warmup period**: same 1000ms warmup as download — bytes uploaded during warmup are tracked but excluded from speed calculations.
- Speed is calculated as: `(bytes uploaded since warmup end × 8) / seconds since warmup end`
- Each worker tracks its own byte count independently (indexed array) to avoid race conditions.
- Progress is reported every 200ms by aggregating all worker byte counts.
- Workers stop gracefully when the 15-second window expires or `cancel()` is called.
- On worker error, it waits 1 second before retrying to avoid hot loops.

### Warmup Period (Both Tests)

Both tests skip the first 1 second of data before starting speed calculations. This eliminates the initial spike caused by:
- TCP slow-start ramp-up
- Connection establishment overhead
- OS buffer flushing behavior

`measurementStartTime` and `measurementStartBytes` are set at the 1000ms mark, and all subsequent speed calculations use only the bytes transferred after that point.

### Network Info

- Fetches from `https://ipapi.co/json/` in the background when a test starts (non-blocking).
- Displays ISP/provider name in the results panel once available.

---

## State Management (`src/hooks/useSpeedTest.js`)

- `status`: tracks the test phase — `idle | downloading | uploading | complete | error`
- `downloadSpeed` / `uploadSpeed`: updated via callbacks from the speed test utility on each progress tick
- `speedHistory`: array of `{ speed }` objects, reset at the start of each phase — feeds the live chart
- `ipInfo`: populated async from `ipapi.co` during the test
- `error`: set if an exception is thrown during the test flow
- `cancelTest()`: calls `speedTestInstance.cancel()` which triggers the `AbortController`, stopping all XHR requests

---

## UI Layer

### `App.jsx`
- Orchestrates layout and conditional rendering based on `status`
- Shows the gauge during all states
- Shows the live chart only during `downloading` or `uploading`
- Shows result cards and network info only after `complete`

### `Gauge.jsx` + `Gauge.css`
- SVG-based arc gauge using `strokeDasharray` / `strokeDashoffset` to animate the progress arc
- Arc spans 240 degrees; value is linearly mapped from 0–200 Mbps
- Gradient stroke from cyan (`#00f2ff`) to red (`#ff0055`)
- Glow filter applied via SVG `<feGaussianBlur>`
- Displays numeric speed, unit (Mbps), and phase label in the center
- Pulsing dot shown during active test phases
- Fully responsive via CSS breakpoints: scales from 200px (mobile) to 280px (desktop)

### `LineChart.jsx`
- Built with `chart.js` + `react-chartjs-2`
- Cyan line for download phase, purple for upload phase
- Axes hidden for a clean look; filled area below the line
- Animation disabled (`duration: 0`) for real-time performance
- `tension: 0.4` for smooth curves

---

## Responsiveness

Breakpoints handled in `App.css` and `Gauge.css`:

| Breakpoint | Behavior |
|---|---|
| > 1024px | Default desktop layout |
| ≤ 1024px | Dashboard max-width relaxed to 90% |
| ≤ 768px | Single column, larger touch targets, adjusted spacing |
| ≤ 480px | Result cards switch to horizontal row layout, compact fonts |
| ≤ 360px | Ultra-compact layout for small phones |
| landscape + height ≤ 500px | Short-screen landscape mode with reduced chart height |

`index.css` switches `body` from `display: flex` to `display: block` on mobile so the page scrolls naturally if content overflows.

---

## Vite Proxy Config (`vite.config.js`)

```js
server: {
  proxy: {
    '/upload-proxy': {
      target: 'https://speed.cloudflare.com',
      changeOrigin: true,
      rewrite: (path) => path.replace(/^\/upload-proxy/, '/__up'),
    },
  },
}
```

Requests from the browser to `/upload-proxy` are forwarded server-side to Cloudflare, bypassing browser CORS enforcement entirely.

---

## File Structure

```
src/
  utils/
    speedTest.js       # SpeedTest class — download/upload logic
  hooks/
    useSpeedTest.js    # React hook wrapping SpeedTest with state
  components/
    Gauge.jsx          # SVG arc gauge component
    Gauge.css          # Gauge styles + responsive breakpoints
    LineChart.jsx      # Chart.js live line chart
  App.jsx              # Main layout and conditional rendering
  App.css              # Global layout + responsive styles
  index.css            # Body/root base styles
public/
  sw.js                # Service worker (PWA)
  manifest.json        # Web app manifest
vite.config.js         # Vite config with upload proxy
```
