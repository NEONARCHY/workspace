import { LoadingSkeleton } from "./LoadingSkeleton";
import { useCallback, useEffect, useMemo, useRef, useState,
  type KeyboardEvent as ReactKeyboardEvent, type MouseEvent as ReactMouseEvent, type PointerEvent } from "react";
import { ArrowLeft20Regular, Dismiss20Regular, ZoomIn20Regular, ZoomOut20Regular } from "@fluentui/react-icons";
import { Button } from "@fluentui/react-components";
import type { TripRequest, WorkspacePerson } from "@yuksalish/contracts";
import { loadTripGeoIndex, resolveTripDestination, type TripGeoIndex, type TripPlace } from "./trip-geo";
import { clampTripMapViewport, fitTripMapPoints, interpolateTripMapViewport,
  maxMapZoom, minMapZoom, tripMapViewBox, worldViewport, zoomTripMapAt,
  type TripMapViewport } from "./trip-map-viewport";

interface TripWorldMapProps {
  readonly requests: readonly TripRequest[];
  readonly people: readonly WorkspacePerson[];
  readonly onOpenRequest: (id: string) => void;
  readonly onClose: () => void;
}

interface TripMapLocation {
  readonly place: TripPlace;
  readonly requests: readonly TripRequest[];
}

const coordinate = (place: TripPlace) => ({
  x: (place.longitude + 180) * 1000 / 360,
  y: (90 - place.latitude) * 500 / 180,
});
const period = (request: TripRequest) => `${new Date(`${request.startDate}T00:00:00`).toLocaleDateString("ru-RU")} — ${new Date(`${request.endDate}T00:00:00`).toLocaleDateString("ru-RU")}`;
const plural = (count: number, one: string, few: string, many: string) => {
  const rest = count % 100;
  if (rest >= 11 && rest <= 14) return many;
  return count % 10 === 1 ? one : count % 10 >= 2 && count % 10 <= 4 ? few : many;
};
const tripCount = (count: number) => `${count} ${plural(count, "поездка", "поездки", "поездок")}`;

export function TripWorldMap({ requests, people, onOpenRequest, onClose }: TripWorldMapProps) {
  const [index, setIndex] = useState<TripGeoIndex>();
  const [landPath, setLandPath] = useState("");
  const [error, setError] = useState("");
  const [retry, setRetry] = useState(0);
  const [selectedId, setSelectedId] = useState("");
  const [hoveredId, setHoveredId] = useState("");
  const [viewport, setViewport] = useState<TripMapViewport>(worldViewport);
  const viewportRef = useRef<TripMapViewport>(worldViewport);
  const targetRef = useRef<TripMapViewport>(worldViewport);
  const animationRef = useRef<number | undefined>(undefined);
  const didAutoFrame = useRef(false);
  const svgRef = useRef<SVGSVGElement>(null);
  const sidebarRef = useRef<HTMLElement>(null);
  const backButtonRef = useRef<HTMLButtonElement>(null);
  const drag = useRef<{ x: number; y: number; width: number; height: number;
    viewport: TripMapViewport } | undefined>(undefined);

  useEffect(() => { backButtonRef.current?.focus({ preventScroll: true }); }, []);

  useEffect(() => {
    let cancelled = false;
    Promise.all([
      loadTripGeoIndex(),
      import("./assets/trip-world-land.json?url").then(async ({ default: url }) => {
        const response = await fetch(url);
        if (!response.ok) throw new Error("Не удалось открыть контуры карты");
        const raw: unknown = await response.json();
        if (typeof raw !== "object" || raw === null || !("path" in raw) || typeof raw.path !== "string") {
          throw new Error("Некорректные контуры карты");
        }
        return raw.path;
      }),
    ]).then(([places, path]) => {
      if (!cancelled) { setIndex(places); setLandPath(path); setError(""); }
    }).catch(() => { if (!cancelled) setError("Карту не удалось загрузить. Проверьте файлы приложения и повторите попытку."); });
    return () => { cancelled = true; };
  }, [retry]);

  const approved = useMemo(() => requests.filter((request) => request.status === "approved"), [requests]);
  const { locations, withoutPoint } = useMemo(() => {
    const grouped = new Map<string, { place: TripPlace; requests: TripRequest[] }>();
    const unresolved: TripRequest[] = [];
    if (!index) return { locations: [] as TripMapLocation[], withoutPoint: unresolved };
    for (const request of approved) {
      const place = resolveTripDestination(index, request.destination);
      if (!place) { unresolved.push(request); continue; }
      const group = grouped.get(place.id) ?? { place, requests: [] };
      group.requests.push(request);
      grouped.set(place.id, group);
    }
    const locations = [...grouped.values()].map((group) => ({
      ...group, requests: group.requests.sort((left, right) => right.startDate.localeCompare(left.startDate)),
    })).sort((left, right) => right.requests.length - left.requests.length || left.place.name.localeCompare(right.place.name, "ru"));
    return { locations, withoutPoint: unresolved };
  }, [approved, index]);
  const selected = locations.find((location) => location.place.id === selectedId);
  const hovered = locations.find((location) => location.place.id === hoveredId);
  const nameById = new Map(people.map((person) => [person.id, person.name]));
  const viewBox = tripMapViewBox(viewport);

  const cancelAnimation = useCallback(() => {
    if (animationRef.current !== undefined) window.cancelAnimationFrame(animationRef.current);
    animationRef.current = undefined;
  }, []);
  const applyViewport = useCallback((next: TripMapViewport) => {
    const clamped = clampTripMapViewport(next);
    viewportRef.current = clamped;
    setViewport(clamped);
  }, []);
  const animateTo = useCallback((next: TripMapViewport, duration = 360) => {
    cancelAnimation();
    const target = clampTripMapViewport(next);
    targetRef.current = target;
    if (window.matchMedia?.("(prefers-reduced-motion: reduce)").matches ||
        window.matchMedia?.("(forced-colors: active)").matches || duration === 0) {
      applyViewport(target);
      return;
    }
    const start = viewportRef.current;
    let startedAt: number | undefined;
    const frame = (now: number) => {
      startedAt ??= now;
      const progress = Math.min(1, (now - startedAt) / duration);
      applyViewport(interpolateTripMapViewport(start, target, progress));
      if (progress < 1) animationRef.current = window.requestAnimationFrame(frame);
      else animationRef.current = undefined;
    };
    animationRef.current = window.requestAnimationFrame(frame);
  }, [applyViewport, cancelAnimation]);

  useEffect(() => () => cancelAnimation(), [cancelAnimation]);
  useEffect(() => {
    if (!landPath || !locations.length || didAutoFrame.current) return;
    didAutoFrame.current = true;
    animateTo(fitTripMapPoints(locations.map(({ place }) => coordinate(place))), 420);
  }, [animateTo, landPath, locations]);
  useEffect(() => {
    const svg = svgRef.current;
    if (!svg) return;
    const wheel = (event: WheelEvent) => {
      const rect = svg.getBoundingClientRect();
      if (!rect.width || !rect.height) return;
      const unit = event.deltaMode === 1 ? 16 : event.deltaMode === 2 ? rect.height : 1;
      const delta = Math.max(-400, Math.min(400, event.deltaY * unit));
      const base = targetRef.current;
      const next = zoomTripMapAt(base, base.zoom * Math.exp(-delta * 0.0018),
        (event.clientX - rect.left) / rect.width, (event.clientY - rect.top) / rect.height);
      if (next.zoom === base.zoom) return;
      event.preventDefault();
      animateTo(next, 210);
    };
    svg.addEventListener("wheel", wheel, { passive: false });
    return () => svg.removeEventListener("wheel", wheel);
  }, [animateTo, landPath]);

  const changeZoom = (factor: number) =>
    animateTo(zoomTripMapAt(targetRef.current, targetRef.current.zoom * factor, 0.5, 0.5), 280);
  const focusLocation = (location: TripMapLocation) => {
    const point = coordinate(location.place);
    const current = targetRef.current;
    const nextZoom = selectedId === location.place.id
      ? Math.min(maxMapZoom, current.zoom * 1.4) : Math.max(current.zoom, 5.6);
    animateTo({ zoom: nextZoom, centerX: point.x, centerY: point.y }, 420);
    setSelectedId(location.place.id);
    if (sidebarRef.current) sidebarRef.current.scrollTop = 0;
  };
  const pointerDown = (event: PointerEvent<SVGSVGElement>) => {
    if (event.target instanceof Element && event.target.closest("[data-trip-pin]")) return;
    if (event.pointerType === "mouse" && event.button !== 0) return;
    cancelAnimation();
    targetRef.current = viewportRef.current;
    const rect = event.currentTarget.getBoundingClientRect();
    if (!rect.width || !rect.height) return;
    drag.current = { x: event.clientX, y: event.clientY, width: rect.width,
      height: rect.height, viewport: viewportRef.current };
    event.currentTarget.setPointerCapture(event.pointerId);
  };
  const pointerMove = (event: PointerEvent<SVGSVGElement>) => {
    if (!drag.current) return;
    const start = drag.current;
    const box = tripMapViewBox(start.viewport);
    applyViewport({ ...start.viewport,
      centerX: start.viewport.centerX - (event.clientX - start.x) * box.width / start.width,
      centerY: start.viewport.centerY - (event.clientY - start.y) * box.height / start.height,
    });
    targetRef.current = viewportRef.current;
  };
  const doubleClick = (event: ReactMouseEvent<SVGSVGElement>) => {
    if (event.target instanceof Element && event.target.closest("[data-trip-pin]")) return;
    const rect = event.currentTarget.getBoundingClientRect();
    animateTo(zoomTripMapAt(targetRef.current, targetRef.current.zoom * 1.7,
      (event.clientX - rect.left) / rect.width, (event.clientY - rect.top) / rect.height), 300);
  };
  const keyDown = (event: ReactKeyboardEvent<SVGSVGElement>) => {
    if (event.target !== event.currentTarget) return;
    const current = targetRef.current;
    const box = tripMapViewBox(current);
    let next: TripMapViewport | undefined;
    if (event.key === "+" || event.key === "=") next = zoomTripMapAt(current, current.zoom * 1.4, 0.5, 0.5);
    if (event.key === "-" || event.key === "_") next = zoomTripMapAt(current, current.zoom / 1.4, 0.5, 0.5);
    if (event.key === "ArrowLeft") next = { ...current, centerX: current.centerX - box.width * 0.14 };
    if (event.key === "ArrowRight") next = { ...current, centerX: current.centerX + box.width * 0.14 };
    if (event.key === "ArrowUp") next = { ...current, centerY: current.centerY - box.height * 0.14 };
    if (event.key === "ArrowDown") next = { ...current, centerY: current.centerY + box.height * 0.14 };
    if (event.key === "Home") next = worldViewport;
    if (event.key === "0" && locations.length) next = fitTripMapPoints(locations.map(({ place }) => coordinate(place)));
    if (!next) return;
    event.preventDefault();
    animateTo(next, 260);
  };

  return <section className="trip-map-workspace" aria-label="Интерактивная карта поездок">
    <header className="trip-map-heading">
      <div><span className="view-kicker">География командировок</span><h2>Карта поездок</h2>
        <p>Утверждённые поездки, доступные вам. Приближайте карту и открывайте место, чтобы увидеть участников и даты.</p></div>
    </header>
    <div className="trip-map-stats" aria-label="Сводка карты">
      <span><strong>{approved.length}</strong> {plural(approved.length, "утверждённая поездка", "утверждённые поездки", "утверждённых поездок")}</span>
      <span><strong>{locations.length}</strong> {plural(locations.length, "место", "места", "мест")} на карте</span>
      <Button ref={backButtonRef} icon={<ArrowLeft20Regular />} onClick={onClose}>К поездкам</Button>
      {withoutPoint.length ? <span><strong>{withoutPoint.length}</strong> {plural(withoutPoint.length, "поездка", "поездки", "поездок")} без точной отметки</span> : null}
    </div>
    {error ? <div className="trip-map-error" role="alert">{error} <Button onClick={() => setRetry((value) => value + 1)}>Повторить</Button></div> : null}
    <div className="trip-map-layout">
      <div className="trip-map-stage">
        <div className="trip-map-controls" role="group" aria-label="Масштаб карты">
          <Button icon={<ZoomIn20Regular />} aria-label="Приблизить карту" disabled={viewport.zoom >= maxMapZoom} onClick={() => changeZoom(1.4)} />
          <Button icon={<ZoomOut20Regular />} aria-label="Отдалить карту" disabled={viewport.zoom <= minMapZoom} onClick={() => changeZoom(1 / 1.4)} />
          <span className="trip-map-zoom-level" aria-label={`Масштаб ${viewport.zoom.toFixed(1)}`}>{viewport.zoom.toFixed(1)}×</span>
          <Button disabled={!locations.length} onClick={() => animateTo(fitTripMapPoints(locations.map(({ place }) => coordinate(place))), 360)}>Все места</Button>
          <Button onClick={() => animateTo(worldViewport, 360)}>Весь мир</Button>
        </div>
        {landPath ? <svg ref={svgRef} className="trip-map-svg" viewBox={`${viewBox.left} ${viewBox.top} ${viewBox.width} ${viewBox.height}`}
          aria-label="Карта мира с отметками утверждённых поездок" aria-describedby="trip-map-gesture-hint" role="group" tabIndex={0}
          onPointerDown={pointerDown} onPointerMove={pointerMove} onPointerUp={() => { drag.current = undefined; }}
          onPointerCancel={() => { drag.current = undefined; }} onLostPointerCapture={() => { drag.current = undefined; }}
          onDoubleClick={doubleClick} onKeyDown={keyDown}>
          <defs>
            <linearGradient id="trip-map-ocean-gradient" x2="0" y2="1"><stop offset="0" stopColor="#edf8f9" /><stop offset="1" stopColor="#dceef1" /></linearGradient>
            <pattern id="trip-map-grid" width="83.333" height="83.333" patternUnits="userSpaceOnUse"><path d="M 83.333 0 L 0 0 0 83.333" fill="none" className="trip-map-grid-line" /></pattern>
          </defs>
          <rect width="1000" height="500" className="trip-map-ocean" />
          <rect width="1000" height="500" fill="url(#trip-map-grid)" />
          <path d={landPath} className="trip-map-land" />
          {locations.map((location) => {
            const { x, y } = coordinate(location.place);
            const highlighted = selectedId === location.place.id || hoveredId === location.place.id;
            return <g key={location.place.id} data-trip-pin="true" role="button" tabIndex={0}
              aria-label={`${location.place.name}: ${tripCount(location.requests.length)}. Показать участников и даты`}
              className={`trip-map-pin${highlighted ? " active" : ""}`} transform={`translate(${x} ${y})`}
              onPointerEnter={() => setHoveredId(location.place.id)} onPointerLeave={() => setHoveredId("")}
              onFocus={() => setHoveredId(location.place.id)} onBlur={() => setHoveredId("")}
              onClick={() => focusLocation(location)}
              onKeyDown={(event) => { if (event.key === "Enter" || event.key === " ") { event.preventDefault(); focusLocation(location); } }}>
              <circle r={17 / viewport.zoom} className="trip-map-pin-halo" />
              <circle r={8 / viewport.zoom} className="trip-map-pin-core" />
              {location.requests.length > 1 ? <text textAnchor="middle" dominantBaseline="central" fontSize={9 / viewport.zoom}>{location.requests.length}</text> : null}
              {highlighted ? <text className="trip-map-pin-label" y={-20 / viewport.zoom} textAnchor="middle"
                fontSize={11 / viewport.zoom} strokeWidth={3 / viewport.zoom}>{location.place.name}</text> : null}
            </g>;
          })}
        </svg> : !error ? <LoadingSkeleton layout="map" label="Загружаем карту мира…" /> : null}
        {hovered ? <div className="trip-map-hover-card" role="status">
          <strong>{hovered.place.name}</strong><span>{tripCount(hovered.requests.length)}</span>
          <small>{period(hovered.requests[0]!)} · {hovered.requests[0]!.employeeIds.map((id) => nameById.get(id) ?? "Сотрудник").join(", ")}</small>
        </div> : null}
        <div id="trip-map-gesture-hint" className="trip-map-gesture-hint">Колесо — масштаб · Перетащите карту · Двойной щелчок — приблизить</div>
        <div className="trip-map-attribution">Карта: <a href="https://www.naturalearthdata.com/" target="_blank" rel="noreferrer">Natural Earth</a> · Места: <a href="https://www.geonames.org/" target="_blank" rel="noreferrer">GeoNames</a></div>
      </div>
      <aside ref={sidebarRef} className="trip-map-sidebar" aria-label="Поездки на карте">
        {selected ? <>
          <div className="trip-map-selected-heading"><div><span>Выбранное место</span><h3>{selected.place.name}</h3><p>{selected.place.context}</p></div><Button className="trip-map-clear-selection" appearance="subtle" icon={<Dismiss20Regular />} aria-label="Сбросить выбор места" onClick={() => setSelectedId("")} /></div>
          <div className="trip-map-trip-list">{selected.requests.map((request) => <article key={request.id} className="trip-map-trip">
            <span>{request.number} · {period(request)}</span><strong>{request.purpose || request.destination}</strong>
            <p>{request.employeeIds.map((id) => nameById.get(id) ?? "Сотрудник").join(", ")}</p>
            <Button size="small" onClick={() => onOpenRequest(request.id)}>Открыть карточку</Button>
          </article>)}</div>
        </> : null}
        <div className="trip-map-places-heading"><h3>Места поездок</h3><p>Выберите место или точку на карте.</p></div>
        <div className="trip-map-location-list">{locations.map((location) => <button type="button" key={location.place.id}
          aria-pressed={selectedId === location.place.id} onClick={() => focusLocation(location)}>
          <span>{location.place.name}</span><small>{tripCount(location.requests.length)}</small>
        </button>)}{!locations.length ? <p>Пока нет утверждённых поездок с определённым местом.</p> : null}</div>
        {withoutPoint.length ? <section className="trip-map-unresolved" aria-label="Поездки без точной отметки"><h3>Поездки без точной отметки</h3><p>Эти места были введены свободным текстом. Чтобы не показывать неверные точки, они остаются в списке.</p>
      <div>{withoutPoint.map((request) => <button type="button" key={request.id} onClick={() => onOpenRequest(request.id)}>{request.destination}<small>{period(request)} · {request.employeeIds.map((id) => nameById.get(id) ?? "Сотрудник").join(", ")}</small></button>)}</div>
        </section> : null}
      </aside>
    </div>
  </section>;
}
