// app/lib/addElevationToGpx.ts
export async function addElevationToGpx(gpx: string): Promise<string> {
    const doc = new DOMParser().parseFromString(gpx, 'application/xml');
    const pts = Array.from(doc.querySelectorAll('trkpt, rtept'));
    const missing = pts.filter((p) => !p.querySelector('ele'));
    if (!missing.length) return gpx;

    for (let i = 0; i < missing.length; i += 100) {
        const chunk = missing.slice(i, i + 100);
        const lat = chunk.map((p) => p.getAttribute('lat')).join(',');
        const lon = chunk.map((p) => p.getAttribute('lon')).join(',');

        const res = await fetch(
            `https://api.open-meteo.com/v1/elevation?latitude=${lat}&longitude=${lon}`
        );
        if (!res.ok) throw new Error(`Elevation API error ${res.status}`);
        const { elevation } = await res.json();

        chunk.forEach((p, j) => {
            const ele = doc.createElementNS(p.namespaceURI, 'ele');
            ele.textContent = String(elevation[j]);
            p.insertBefore(ele, p.firstChild); // <ele> comes first in GPX
        });
    }
    return new XMLSerializer().serializeToString(doc);
}