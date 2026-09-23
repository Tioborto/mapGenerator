// app/lib/addElevationToGpx.ts
const API_URL = process.env.NEXT_PUBLIC_API_URL || 'http://localhost:8000';

export async function addElevationToGpx(gpx: string): Promise<string> {
    const doc = new DOMParser().parseFromString(gpx, 'application/xml');
    const pts = Array.from(doc.querySelectorAll('trkpt, rtept'));
    const missing = pts.filter((p) => !p.querySelector('ele'));
    if (!missing.length) return gpx;

    // Process all missing points in one backend call (backend batches internally)
    const latitudes = missing.map((p) => parseFloat(p.getAttribute('lat')!));
    const longitudes = missing.map((p) => parseFloat(p.getAttribute('lon')!));

    const res = await fetch(`${API_URL}/api/elevation`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ latitudes, longitudes }),
    });

    if (!res.ok) throw new Error(`Elevation API error ${res.status}`);
    const { elevation } = await res.json();

    missing.forEach((p, j) => {
        const ele = doc.createElementNS(p.namespaceURI, 'ele');
        ele.textContent = String(elevation[j]);
        p.insertBefore(ele, p.firstChild); // <ele> comes first in GPX
    });

    return new XMLSerializer().serializeToString(doc);
}