// app/lib/loadMapPlugins.ts
const ELEVATION_VERSION = '2.5.2'; // match the version you installed
const BASE = `https://unpkg.com/@raruto/leaflet-elevation@${ELEVATION_VERSION}/dist`;

const loadScript = (src: string) =>
    new Promise<void>((resolve, reject) => {
        const s = document.createElement('script');
        s.src = src;
        s.onload = () => resolve();
        s.onerror = () => reject(new Error(`Failed to load ${src}`));
        document.head.appendChild(s);
    });

const loadCss = (href: string) => {
    if (document.querySelector(`link[href="${href}"]`)) return;
    const l = document.createElement('link');
    l.rel = 'stylesheet';
    l.href = href;
    document.head.appendChild(l);
};

let pending: Promise<any> | null = null;

// Loads leaflet, leaflet-gpx and leaflet-elevation once and returns the real global L
export function loadMapPlugins(): Promise<any> {
    if (!pending) {
        pending = (async () => {
            const leaflet: any = await import('leaflet');
            const win = window as any;
            win.L = win.L ?? leaflet.default ?? leaflet;

            await import('leaflet-gpx'); // attaches L.GPX to the global L

            loadCss(`${BASE}/leaflet-elevation.min.css`);
            await loadScript(`${BASE}/leaflet-elevation.min.js`);

            return win.L;
        })();
    }
    return pending;
}