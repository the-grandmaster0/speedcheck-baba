const DOWNLOAD_URLS = [
    'https://speed.cloudflare.com/__down?bytes=100000000', // 100MB
    'https://speed.cloudflare.com/__down?bytes=50000000',  // 50MB
    'https://speed.cloudflare.com/__down?bytes=25000000',  // 25MB
    'https://speed.cloudflare.com/__down?bytes=10000000',  // 10MB
    'https://speed.cloudflare.com/__down?bytes=5000000'    // 5MB
];

const UPLOAD_ENDPOINTS = [
    // Use proxy in development to bypass CORS. In production, direct upload might work
    // depending on deployment, or switch back to direct URL if hosted on same domain.
    '/upload-proxy'
];
let currentUploadEndpointIndex = 0;

export class SpeedTest {
    constructor() {
        this.downloadSpeed = 0; // Mbps
        this.uploadSpeed = 0; // Mbps
        this.isTesting = false;
        this.abortController = null;
    }

    async getNetworkInfo() {
        try {
            const response = await fetch('https://ipapi.co/json/');
            if (!response.ok) throw new Error('Failed to fetch IP info');
            return await response.json();
        } catch (error) {
            console.error('Error fetching network info:', error);
            return null;
        }
    }

    async runDownloadTest(onProgress) {
        this.abortController = new AbortController();
        const signal = this.abortController.signal;

        const startTime = performance.now();
        const duration = 15000; // 15 seconds
        const warmupDuration = 1000; // 1 second warmup period to stabilize
        let totalLoadedBytes = 0;
        let lastUpdate = startTime;
        let attemptIndex = 0;
        let measurementStartTime = null;
        let measurementStartBytes = 0;

        try {
            while (performance.now() - startTime < duration) {
                if (signal.aborted) break;

                const targetUrl = DOWNLOAD_URLS[attemptIndex % DOWNLOAD_URLS.length];

                try {
                    await new Promise((resolve, reject) => {
                        const xhr = new XMLHttpRequest();
                        // Add random query param to prevent caching
                        const cacheBuster = (targetUrl.includes('?') ? '&' : '?') + 't=' + Date.now() + Math.random();
                        xhr.open('GET', targetUrl + cacheBuster, true);
                        xhr.responseType = 'arraybuffer';

                        // Check time periodically
                        const timerCheck = setInterval(() => {
                            if (performance.now() - startTime >= duration) {
                                xhr.abort();
                                clearInterval(timerCheck);
                                resolve(); // Graceful finish for time limit
                            }
                        }, 100);

                        // We track bytes manually by using the diff
                        let previousLoaded = 0;
                        xhr.onprogress = (event) => {
                            if (signal.aborted) {
                                clearInterval(timerCheck);
                                xhr.abort();
                                reject(new Error('Aborted'));
                                return;
                            }

                            const newBytes = event.loaded - previousLoaded;
                            previousLoaded = event.loaded;
                            totalLoadedBytes += newBytes;

                            const now = performance.now();
                            const elapsed = now - startTime;

                            // Start measuring after warmup period
                            if (elapsed >= warmupDuration && measurementStartTime === null) {
                                measurementStartTime = now;
                                measurementStartBytes = totalLoadedBytes;
                            }

                            // Calculate speed only after warmup
                            if (measurementStartTime !== null && now - lastUpdate > 100) {
                                const measurementDuration = (now - measurementStartTime) / 1000;
                                const measurementBytes = totalLoadedBytes - measurementStartBytes;

                                if (measurementDuration > 0.1 && measurementBytes > 0) {
                                    const bitsLoaded = measurementBytes * 8;
                                    const speedMbps = (bitsLoaded / measurementDuration) / 1000000;
                                    this.downloadSpeed = speedMbps;
                                    onProgress(speedMbps);
                                    lastUpdate = now;
                                }
                            }
                        };

                        xhr.onload = () => {
                            clearInterval(timerCheck);
                            if (xhr.status < 200 || xhr.status >= 300) {
                                // If 404 or something, convert to error to try next URL
                                reject(new Error(`Network response was not ok: ${xhr.status}`));
                                return;
                            }
                            resolve();
                        };

                        xhr.onerror = (e) => {
                            clearInterval(timerCheck);
                            reject(e);
                        };

                        signal.addEventListener('abort', () => {
                            clearInterval(timerCheck);
                            xhr.abort();
                            reject(new Error('Aborted'));
                        });

                        xhr.send();
                    });

                    // If we finished a download very quickly (fast network), we loop immediately to the next one
                    attemptIndex++;

                } catch (e) {
                    // Check if it was our manual time-limit abort (though we resolved on time limit, so this catch is for real errors)
                    if (performance.now() - startTime >= duration) break;

                    if (signal.aborted) throw e;

                    console.warn(`Failed to fetch from ${targetUrl}, trying next.`, e);
                    attemptIndex++;
                    await new Promise(r => setTimeout(r, 200));
                }
            }

            return this.downloadSpeed;

        } catch (error) {
            if (error.name === 'AbortError' || (error.message && error.message.includes('Aborted'))) {
                console.log('Download test aborted');
            } else {
                console.error('Download test failed', error);
            }
            return this.downloadSpeed; // Return whatever speed we managed to calculate
        }
    }

    async runUploadTest(onProgress) {
        this.abortController = new AbortController();
        const signal = this.abortController.signal;
        const startTime = performance.now();
        const duration = 15000; // 15 seconds
        const warmupDuration = 1000; // 1 second warmup period to stabilize

        // Use 1MB chunks to be highly compatible and prevent 413 payload-too-large errors
        const size = 1 * 1024 * 1024;
        const buffer = new Uint8Array(size);
        for (let i = 0; i < size; i++) buffer[i] = Math.random() * 255;
        const blob = new Blob([buffer], { type: 'application/octet-stream' });

        const CONCURRENCY = 6; // Run 6 parallel uploads to fully saturate bandwidth

        // Use an array to track bytes from each worker to avoid race conditions
        const workerBytesUploaded = Array(CONCURRENCY).fill(0);
        let isTestComplete = false;
        let measurementStartTime = null;
        let measurementStartBytes = 0;

        try {
            // Main progress reporting loop
            const progressInterval = setInterval(() => {
                const now = performance.now();
                const elapsed = now - startTime;

                // Sum all worker uploads
                const totalUploadedBytes = workerBytesUploaded.reduce((sum, bytes) => sum + bytes, 0);

                // Start measuring after warmup period
                if (elapsed >= warmupDuration && measurementStartTime === null) {
                    measurementStartTime = now;
                    measurementStartBytes = totalUploadedBytes;
                }

                // Calculate speed only after warmup
                if (measurementStartTime !== null) {
                    const measurementDuration = (now - measurementStartTime) / 1000;
                    const measurementBytes = totalUploadedBytes - measurementStartBytes;

                    if (measurementDuration > 0.1 && measurementBytes > 0) {
                        const bitsLoaded = measurementBytes * 8;
                        const speedMbps = (bitsLoaded / measurementDuration) / 1000000;
                        this.uploadSpeed = speedMbps;
                        onProgress(speedMbps);
                    }
                }

                if (now - startTime >= duration && !isTestComplete) {
                    isTestComplete = true;
                    clearInterval(progressInterval);
                    this.cancel(); // Stop all workers
                }
            }, 200);

            // Worker function for a single upload stream
            const runWorker = async (workerId) => {
                while (performance.now() - startTime < duration && !isTestComplete) {
                    if (signal.aborted) break;

                    try {
                        await new Promise((resolve, reject) => {
                            const xhr = new XMLHttpRequest();
                            const endpoint = UPLOAD_ENDPOINTS[currentUploadEndpointIndex % UPLOAD_ENDPOINTS.length];
                            xhr.open('POST', endpoint + '?t=' + Date.now() + Math.random(), true);

                            let previousLoaded = 0;
                            xhr.upload.onprogress = (event) => {
                                if (signal.aborted || isTestComplete) {
                                    xhr.abort();
                                    return;
                                }
                                const newBytes = event.loaded - previousLoaded;
                                previousLoaded = event.loaded;
                                // Update this worker's byte count - no race condition since each worker has its own index
                                workerBytesUploaded[workerId] += newBytes;
                            };

                            xhr.onload = () => {
                                if (xhr.status >= 200 && xhr.status < 300) {
                                    resolve();
                                } else {
                                    reject(new Error(`Upload failed with status ${xhr.status}`));
                                }
                            };
                            xhr.onerror = () => {
                                reject(new Error('Network error during upload'));
                            };
                            xhr.onabort = () => resolve();

                            // Force abort if main timer expires
                            const checkAbort = () => {
                                if (signal.aborted || isTestComplete) xhr.abort();
                            };
                            signal.addEventListener('abort', checkAbort);

                            xhr.send(blob);
                        });
                    } catch (err) {
                        console.warn(`Worker ${workerId} upload failed:`, err);
                        // Delay before retrying to prevent hot loops
                        currentUploadEndpointIndex++;
                        await new Promise(r => setTimeout(r, 1000));
                    }
                }
            };

            // Start workers with unique IDs
            await Promise.all(Array.from({ length: CONCURRENCY }, (_, i) => runWorker(i)));

            clearInterval(progressInterval);

            // Final calculation based on measurement period (after warmup)
            if (measurementStartTime !== null) {
                const totalUploadedBytes = workerBytesUploaded.reduce((sum, bytes) => sum + bytes, 0);
                const measurementBytes = totalUploadedBytes - measurementStartBytes;
                const finalDuration = (performance.now() - measurementStartTime) / 1000;
                
                if (measurementBytes > 0 && finalDuration > 0) {
                    const bitsLoaded = measurementBytes * 8;
                    this.uploadSpeed = (bitsLoaded / finalDuration) / 1000000;
                }
            }

            return this.uploadSpeed;

        } catch (error) {
            console.error('Upload test error', error);
            return this.uploadSpeed;
        }
    }

    cancel() {
        if (this.abortController) {
            this.abortController.abort();
        }
        this.isTesting = false;
    }
}

export const speedTestInstance = new SpeedTest();
