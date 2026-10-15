import { useEffect, useId, useState } from "react";
import { Location16Regular } from "@fluentui/react-icons";
import { Input } from "./WorkspaceInput";
import { loadTripGeoIndex, searchTripPlaces, type TripPlace } from "./trip-geo";

interface TripDestinationPickerProps {
  readonly value: string;
  readonly onChange: (value: string) => void;
  readonly disabled?: boolean;
}

export function TripDestinationPicker({ value, onChange, disabled = false }: TripDestinationPickerProps) {
  const id = useId();
  const listId = `${id}-places`;
  const [focused, setFocused] = useState(false);
  const [expanded, setExpanded] = useState(false);
  const [loading, setLoading] = useState(false);
  const [geoError, setGeoError] = useState(false);
  const [retry, setRetry] = useState(0);
  const [suggestions, setSuggestions] = useState<readonly TripPlace[]>([]);
  const [active, setActive] = useState(0);

  useEffect(() => {
    if (!focused || value.trim().length < 2) return;
    let cancelled = false;
    const timer = window.setTimeout(() => {
      setLoading(true);
      void loadTripGeoIndex().then((index) => {
        if (cancelled) return;
        setSuggestions(searchTripPlaces(index, value));
        setActive(0);
        setGeoError(false);
      }).catch(() => { if (!cancelled) { setSuggestions([]); setGeoError(true); } })
        .finally(() => { if (!cancelled) setLoading(false); });
    }, 120);
    return () => { cancelled = true; window.clearTimeout(timer); };
  }, [focused, value, retry]);

  const visible = focused && expanded && (suggestions.length > 0 || loading || geoError);
  const choose = (place: TripPlace) => {
    onChange(place.destination);
    setExpanded(false);
    setSuggestions([]);
  };

  return <div className="trip-destination-picker record-field-wide">
    <label htmlFor={`${id}-input`}>Куда едем</label>
    <Input id={`${id}-input`} aria-label="Куда едем" aria-required role="combobox"
      aria-autocomplete="list" aria-expanded={visible} aria-controls={listId}
      aria-activedescendant={visible && suggestions[active] ? `${id}-place-${active}` : undefined}
      autoFocus disabled={disabled} placeholder="Город, страна или место встречи" value={value}
      contentBefore={<Location16Regular aria-hidden="true" />}
      onFocus={() => { setFocused(true); setExpanded(true); }}
      onBlur={() => { setFocused(false); setExpanded(false); setSuggestions([]); setLoading(false); setGeoError(false); }}
      onChange={(_, data) => { onChange(data.value); setExpanded(true); setSuggestions([]); setLoading(false); setGeoError(false); }}
      onKeyDown={(event) => {
        if (event.key === "Escape" && visible) { event.preventDefault(); setExpanded(false); return; }
        if (!visible || !suggestions.length) return;
        if (event.key === "ArrowDown" || event.key === "ArrowUp") {
          event.preventDefault();
          setActive((current) => (current + (event.key === "ArrowDown" ? 1 : -1) + suggestions.length) % suggestions.length);
        } else if (event.key === "Enter") {
          event.preventDefault();
          choose(suggestions[active] ?? suggestions[0]!);
        }
      }} />
    {visible ? <ul id={listId} className="trip-destination-list" role="listbox" aria-label="Подходящие места">
      {loading && !suggestions.length ? <li className="trip-destination-hint" role="presentation">Ищем места…</li> : null}
      {geoError ? <li className="trip-destination-hint" role="presentation">Справочник мест недоступен. Введите место вручную или <button type="button" onMouseDown={(event) => event.preventDefault()} onClick={() => { setGeoError(false); setRetry((current) => current + 1); }}>повторите загрузку</button>.</li> : null}
      {suggestions.map((place, index) => <li id={`${id}-place-${index}`} role="option"
        aria-selected={index === active} className={index === active ? "active" : ""} key={place.id}
        onPointerDown={(event) => { event.preventDefault(); choose(place); }} onClick={() => choose(place)}>
        <span className="trip-destination-icon" aria-hidden="true">{place.kind === "country" ? "◎" : "⌖"}</span>
        <span><strong>{place.name}</strong><small>{place.context}</small></span>
      </li>)}
    </ul> : null}
    <small className="trip-destination-note">Выберите место из подсказок для отметки на карте. Свободный ввод тоже доступен. Справочник: <a href="https://www.geonames.org/" target="_blank" rel="noreferrer">GeoNames</a>.</small>
  </div>;
}
