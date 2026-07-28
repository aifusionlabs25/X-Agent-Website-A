'use client';

import { useEffect, useMemo, useRef, useState } from 'react';
import { ExternalLink, LocateFixed, MapPinned } from 'lucide-react';
import {
    buildGoogleMapsDirectionsUrl,
    getMovePlanStopCoordinates,
    MovePlanStop,
} from '@/lib/anam/evan-move-planner';

interface EvanRouteMapProps {
    stops: MovePlanStop[];
}

const markerColor = (stop: MovePlanStop) => {
    if (stop.kind === 'Origin') return '#5d24d6';
    if (stop.kind === 'Destination') return '#e4a323';
    return '#9568df';
};

const escapeMapHtml = (value: string) => value
    .replaceAll('&', '&amp;')
    .replaceAll('<', '&lt;')
    .replaceAll('>', '&gt;')
    .replaceAll('"', '&quot;')
    .replaceAll("'", '&#039;');

export default function EvanRouteMap({ stops }: EvanRouteMapProps) {
    const mapContainerRef = useRef<HTMLDivElement>(null);
    const [mapReady, setMapReady] = useState(false);
    const mappedStops = useMemo(() => stops.flatMap((stop, index) => {
        const coordinates = getMovePlanStopCoordinates(stop);
        return coordinates ? [{ stop, index, coordinates }] : [];
    }), [stops]);
    const googleMapsUrl = useMemo(() => buildGoogleMapsDirectionsUrl(stops), [stops]);
    const streetLevelCount = mappedStops.filter(({ stop }) => stop.precision === 'address' || stop.precision === 'address-range').length;

    useEffect(() => {
        const container = mapContainerRef.current;
        if (!container || !mappedStops.length) return undefined;

        let disposed = false;
        let map: import('leaflet').Map | null = null;
        setMapReady(false);

        void import('leaflet').then((L) => {
            if (disposed) return;

            map = L.map(container, {
                attributionControl: true,
                zoomControl: false,
                scrollWheelZoom: false,
            });

            L.tileLayer('https://{s}.tile.openstreetmap.org/{z}/{x}/{y}.png', {
                attribution: '&copy; OpenStreetMap contributors',
                maxZoom: 19,
            }).addTo(map);
            L.control.zoom({ position: 'bottomright' }).addTo(map);

            const latLngs = mappedStops.map(({ coordinates }) => (
                [coordinates.latitude, coordinates.longitude] as [number, number]
            ));

            if (latLngs.length > 1) {
                L.polyline(latLngs, {
                    color: '#5d24d6',
                    opacity: 0.86,
                    weight: 5,
                    lineCap: 'round',
                    lineJoin: 'round',
                }).addTo(map);
            }

            mappedStops.forEach(({ stop, index, coordinates }) => {
                const icon = L.divIcon({
                    className: 'evan-route-marker-shell',
                    html: `<span class="evan-route-marker" style="--evan-pin:${markerColor(stop)}"><b>${index + 1}</b></span>`,
                    iconAnchor: [18, 42],
                    iconSize: [36, 42],
                    popupAnchor: [0, -42],
                });

                const visibleLocation = stop.displayAddress || stop.address || stop.city;
                const popupLocation = escapeMapHtml(visibleLocation);
                const popupKind = escapeMapHtml(stop.kind);
                L.marker([coordinates.latitude, coordinates.longitude], {
                    icon,
                    keyboard: true,
                    title: `${index + 1}. ${visibleLocation} — ${stop.kind}`,
                })
                    .addTo(map as import('leaflet').Map)
                    .bindPopup(
                        `<div class="evan-route-popup"><strong>${index + 1}. ${popupLocation}</strong><span>${popupKind}</span></div>`,
                    );
            });

            if (latLngs.length === 1) {
                map.setView(latLngs[0], streetLevelCount ? 15 : 10);
            } else {
                map.fitBounds(L.latLngBounds(latLngs), {
                    maxZoom: streetLevelCount ? 14 : 10,
                    padding: [38, 38],
                });
            }

            window.setTimeout(() => map?.invalidateSize(), 80);
            setMapReady(true);
        });

        return () => {
            disposed = true;
            map?.remove();
        };
    }, [mappedStops, streetLevelCount]);

    if (!mappedStops.length) return null;

    return (
        <div className="mt-6 overflow-hidden border border-[#321064]/15 bg-white shadow-[0_18px_48px_rgba(42,16,80,0.12)]" data-testid="evan-route-map">
            <div className="flex flex-wrap items-center justify-between gap-3 border-b border-[#321064]/10 bg-[#2a1050] px-4 py-3 text-white sm:px-5">
                <div className="flex items-center gap-3">
                    <span className="flex h-9 w-9 items-center justify-center rounded-full bg-[#ffc857] text-[#2a1050]">
                        <MapPinned size={18} />
                    </span>
                    <div>
                        <p className="text-[10px] font-bold uppercase tracking-[0.18em] text-[#ffdc8a]">Live route map</p>
                        <p className="text-sm font-semibold">{mappedStops.length} mapped {mappedStops.length === 1 ? 'location' : 'locations'}</p>
                    </div>
                </div>
                <span className="inline-flex items-center gap-2 rounded-full border border-white/15 bg-white/7 px-3 py-1.5 text-[10px] font-bold uppercase tracking-[0.12em] text-white/70">
                    <LocateFixed size={13} className={mapReady ? 'text-[#ffc857]' : 'animate-pulse text-white/35'} />
                    {streetLevelCount ? `${streetLevelCount} street-level ${streetLevelCount === 1 ? 'pin' : 'pins'}` : 'City-level working route'}
                </span>
            </div>

            <div className="relative">
                <div ref={mapContainerRef} className="evan-route-map h-[310px] w-full bg-[#eee7f8] sm:h-[360px]" aria-label="Working map of move locations" />
                {!mapReady && (
                    <div className="pointer-events-none absolute inset-0 flex items-center justify-center bg-[#eee7f8] text-sm font-semibold text-[#684a83]">
                        Building the working route…
                    </div>
                )}
                <div className="pointer-events-none absolute left-3 top-3 z-[500] hidden max-w-[220px] sm:block border border-[#321064]/10 bg-white/92 px-3 py-2 shadow-[0_8px_24px_rgba(42,16,80,0.13)] backdrop-blur">
                    <p className="text-[9px] font-bold uppercase tracking-[0.16em] text-[#7540cf]">Planning preview</p>
                    <p className="mt-1 text-[11px] leading-4 text-[#6c5a79]">Confirmed addresses use street-level pins. The line shows stop order—not driving directions.</p>
                </div>
            </div>

            <div className="flex flex-col gap-3 border-t border-[#321064]/10 bg-[#faf7fd] px-4 py-4 sm:flex-row sm:items-center sm:justify-between sm:px-5">
                <div className="flex flex-wrap gap-x-4 gap-y-2 text-[10px] font-bold uppercase tracking-[0.1em] text-[#71617c]">
                    <span className="inline-flex items-center gap-1.5"><i className="h-2.5 w-2.5 rounded-full bg-[#5d24d6]" /> Origin</span>
                    <span className="inline-flex items-center gap-1.5"><i className="h-2.5 w-2.5 rounded-full bg-[#9568df]" /> Additional stop</span>
                    <span className="inline-flex items-center gap-1.5"><i className="h-2.5 w-2.5 rounded-full bg-[#e4a323]" /> Destination</span>
                </div>
                {googleMapsUrl && (
                    <a
                        href={googleMapsUrl}
                        target="_blank"
                        rel="noreferrer"
                        className="inline-flex min-h-10 items-center justify-center gap-2 rounded-md bg-[#5d24d6] px-4 py-2 text-xs font-bold text-white shadow-[0_8px_22px_rgba(93,36,214,0.24)] transition hover:-translate-y-0.5 hover:bg-[#4d1cbc]"
                    >
                        Open in Google Maps <ExternalLink size={14} />
                    </a>
                )}
            </div>
        </div>
    );
}
