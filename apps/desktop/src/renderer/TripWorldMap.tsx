import { useEffect, useMemo, useRef, useState, type PointerEvent } from "react";
import { ArrowLeft20Regular, Dismiss20Regular, ZoomIn20Regular, ZoomOut20Regular } from "@fluentui/react-icons";
import { Button } from "@fluentui/react-components";
import type { TripRequest, WorkspacePerson } from "@yuksalish/contracts";
import { loadTripGeoIndex, resolveTripDestination, type TripGeoIndex, type TripPlace } from "./trip-geo";

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

interface Viewport { readonly zoom: number; readonly centerX: number; readonly centerY: number }
const initialViewport: Viewport = { zoom: 1, centerX: 500, centerY: 250 };
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
  const [viewport, setViewport] = useState<Viewport>(initialViewport);
  const drag = useRef<{ x: number; y: number; centerX: number; centerY: number } | undefined>(undefined);

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
  const viewWidth = 1000 / viewport.zoom;
  const viewHeight = 500 / viewport.zoom;
  const left = Math.max(0, Math.min(1000 - viewWidth, viewport.centerX - viewWidth / 2));
  const top = Math.max(0, Math.min(500 - viewHeight, viewport.centerY - viewHeight / 2));

  const changeZoom = (factor: number) => setViewport((current) => ({ ...current,
    zoom: Math.max(1, Math.min(4, Math.round(current.zoom * factor * 10) / 10)),
  }));
  const pointerDown = (event: PointerEvent<SVGSVGElement>) => {
    if (event.target instanceof Element && event.target.closest("[data-trip-pin]")) return;
    drag.current = { x: event.clientX, y: event.clientY,
      centerX: viewport.centerX, centerY: viewport.centerY };
    event.currentTarget.setPointerCapture(event.pointerId);
  };
  const pointerMove = (event: PointerEvent<SVGSVGElement>) => {
    if (!drag.current) return;
    const x = drag.current.centerX - (event.clientX - drag.current.x) * viewWidth / event.currentTarget.clientWidth;
    const y = drag.current.centerY - (event.clientY - drag.current.y) * viewHeight / event.currentTarget.clientHeight;
    setViewport((current) => ({ ...current,
      centerX: Math.max(viewWidth / 2, Math.min(1000 - viewWidth / 2, x)),
      centerY: Math.max(viewHeight / 2, Math.min(500 - viewHeight / 2, y)),
    }));
  };

  return <section className="trip-map-workspace" aria-label="Интерактивная карта поездок">
    <header className="trip-map-heading">
      <div><span className="view-kicker">География командировок</span><h2>Карта поездок</h2>
        <p>Утверждённые поездки, доступные вам. Наведите на точку или выберите её, чтобы увидеть участников и даты.</p></div>
      <Button icon={<ArrowLeft20Regular />} onClick={onClose}>К поездкам</Button>
    </header>
    <div className="trip-map-stats" aria-label="Сводка карты">
      <span><strong>{approved.length}</strong> {plural(approved.length, "утверждённая поездка", "утверждённые поездки", "утверждённых поездок")}</span>
      <span><strong>{locations.length}</strong> {plural(locations.length, "место", "места", "мест")} на карте</span>
      {withoutPoint.length ? <span><strong>{withoutPoint.length}</strong> {plural(withoutPoint.length, "поездка", "поездки", "поездок")} без точной отметки</span> : null}
    </div>
    {error ? <div className="trip-map-error" role="alert">{error} <Button onClick={() => setRetry((value) => value + 1)}>Повторить</Button></div> : null}
    <div className="trip-map-layout">
      <div className="trip-map-stage">
        <div className="trip-map-controls" role="group" aria-label="Масштаб карты">
          <Button icon={<ZoomIn20Regular />} aria-label="Приблизить карту" disabled={viewport.zoom >= 4} onClick={() => changeZoom(1.4)} />
          <Button icon={<ZoomOut20Regular />} aria-label="Отдалить карту" disabled={viewport.zoom <= 1} onClick={() => changeZoom(1 / 1.4)} />
          <Button onClick={() => setViewport(initialViewport)}>Весь мир</Button>
        </div>
        {landPath ? <svg className="trip-map-svg" viewBox={`${left} ${top} ${viewWidth} ${viewHeight}`}
          aria-label="Карта мира с отметками утверждённых поездок" role="group"
          onPointerDown={pointerDown} onPointerMove={pointerMove} onPointerUp={() => { drag.current = undefined; }}
          onPointerCancel={() => { drag.current = undefined; }}>
          <defs><pattern id="trip-map-grid" width="83.333" height="83.333" patternUnits="userSpaceOnUse"><path d="M 83.333 0 L 0 0 0 83.333" fill="none" className="trip-map-grid-line" /></pattern></defs>
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
              onClick={() => setSelectedId(location.place.id)}
              onKeyDown={(event) => { if (event.key === "Enter" || event.key === " ") { event.preventDefault(); setSelectedId(location.place.id); } }}>
              <circle r={17 / viewport.zoom} className="trip-map-pin-halo" />
              <circle r={8 / viewport.zoom} className="trip-map-pin-core" />
              {location.requests.length > 1 ? <text textAnchor="middle" dominantBaseline="central" fontSize={9 / viewport.zoom}>{location.requests.length}</text> : null}
            </g>;
          })}
        </svg> : !error ? <div className="trip-map-loading" role="status">Загружаем карту мира…</div> : null}
        {hovered ? <div className="trip-map-hover-card" role="status">
          <strong>{hovered.place.name}</strong><span>{tripCount(hovered.requests.length)}</span>
          <small>{period(hovered.requests[0]!)} · {hovered.requests[0]!.employeeIds.map((id) => nameById.get(id) ?? "Сотрудник").join(", ")}</small>
        </div> : null}
        <div className="trip-map-attribution">Карта: <a href="https://www.naturalearthdata.com/" target="_blank" rel="noreferrer">Natural Earth</a> · Места: <a href="https://www.geonames.org/" target="_blank" rel="noreferrer">GeoNames</a></div>
      </div>
      <aside className="trip-map-sidebar" aria-label="Поездки на карте">
        {selected ? <>
          <div className="trip-map-selected-heading"><div><span>Выбранное место</span><h3>{selected.place.name}</h3><p>{selected.place.context}</p></div><Button appearance="subtle" icon={<Dismiss20Regular />} aria-label="Сбросить выбор места" onClick={() => setSelectedId("")} /></div>
          <div className="trip-map-trip-list">{selected.requests.map((request) => <article key={request.id} className="trip-map-trip">
            <span>{request.number} · {period(request)}</span><strong>{request.purpose || request.destination}</strong>
            <p>{request.employeeIds.map((id) => nameById.get(id) ?? "Сотрудник").join(", ")}</p>
            <Button size="small" onClick={() => onOpenRequest(request.id)}>Открыть карточку</Button>
          </article>)}</div>
        </> : <><h3>Места поездок</h3><p>Нажмите на точку или выберите место из списка.</p>
          <div className="trip-map-location-list">{locations.map((location) => <button type="button" key={location.place.id} onClick={() => setSelectedId(location.place.id)}>
            <span>{location.place.name}</span><small>{tripCount(location.requests.length)}</small>
          </button>)}{!locations.length ? <p>Пока нет утверждённых поездок с определённым местом.</p> : null}</div></>}
      </aside>
    </div>
    {withoutPoint.length ? <div className="trip-map-unresolved"><h3>Поездки без точной отметки</h3><p>Эти места были введены свободным текстом. Чтобы не показывать неверные точки, они остаются в списке.</p>
      <div>{withoutPoint.map((request) => <button type="button" key={request.id} onClick={() => onOpenRequest(request.id)}>{request.destination}<small>{period(request)} · {request.employeeIds.map((id) => nameById.get(id) ?? "Сотрудник").join(", ")}</small></button>)}</div>
    </div> : null}
  </section>;
}
