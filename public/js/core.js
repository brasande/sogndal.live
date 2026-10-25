/* Sogndal.live · kjerne
 * Kart, tema (lys/mørk), lettvekts-modus, detaljkort, val, animasjon og felles hjelparar.
 * Dei andre modulane (js/*.js) hentar alt frå window.SL.
 */
(() => {
  "use strict";

  const CONFIG = window.SOGNDAL_CONFIG || {};
  const SL = (window.SL = {});

  SL.CLIENT = CONFIG.enturClientName || "sogndallive-kart";
  SL.JP_URL = "https://api.entur.io/journey-planner/v3/graphql";
  SL.GEOCODER_URL = "https://api.entur.io/geocoder/v1/autocomplete";
  SL.FOCUS = { lat: 61.229, lon: 7.101 }; // Sogndal sentrum
  SL.HOME = { center: [7.112, 61.218], zoom: 12.3, pitch: 58, bearing: -28 };

  // ---------------------------------------------------------------- hjelparar
  const $ = (SL.$ = (id) => document.getElementById(id));
  SL.esc = (s) => String(s ?? "").replace(/[&<>"']/g, (c) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" })[c]);
  SL.emptyFC = () => ({ type: "FeatureCollection", features: [] });

  SL.store = {
    get(key, fallback = null) {
      try {
        const v = localStorage.getItem(`sl.${key}`);
        return v === null ? fallback : JSON.parse(v);
      } catch {
        return fallback;
      }
    },
    set(key, value) {
      try {
        localStorage.setItem(`sl.${key}`, JSON.stringify(value));
      } catch { /* privat modus o.l. */ }
    },
  };

  const BUS_COLORS = ["#c8102e", "#0e7c66", "#7a3db8", "#d4570f", "#b8860b", "#a8326e", "#4d7a12", "#8b5a2b", "#00838f", "#5c4ac7"];
  SL.FERRY_COLOR = "#1f6fb2";
  SL.lineColor = (v) => {
    if (v.mode === "FERRY") return SL.FERRY_COLOR;
    const code = v.line?.publicCode || "";
    let h = 0;
    for (const ch of code) h = (h * 31 + ch.charCodeAt(0)) >>> 0;
    return BUS_COLORS[h % BUS_COLORS.length];
  };
  SL.colorForCode = (code, mode) =>
    SL.lineColor({ mode: mode === "water" || mode === "FERRY" ? "FERRY" : "BUS", line: { publicCode: code } });

  SL.fmtTime = (iso) => new Date(iso).toLocaleTimeString("nb-NO", { hour: "2-digit", minute: "2-digit" });
  SL.fmtAgo = (ms) => {
    const s = Math.max(0, Math.round(ms / 1000));
    return s < 60 ? `${s} s sidan` : `${Math.round(s / 60)} min sidan`;
  };
  SL.fmtDelay = (sec) => {
    if (sec == null || Math.abs(sec) > 2 * 3600) return { text: "", cls: "" };
    const m = Math.round(sec / 60);
    if (m >= 5) return { text: `+${m} min`, cls: "very-late" };
    if (m >= 2) return { text: `+${m} min`, cls: "late" };
    if (m <= -2) return { text: `${m} min`, cls: "ok" };
    return { text: "I rute", cls: "ok" };
  };
  SL.minutesUntil = (iso) => {
    const m = Math.round((Date.parse(iso) - Date.now()) / 60000);
    if (m <= 0) return "no";
    if (m < 60) return `${m} min`;
    return SL.fmtTime(iso);
  };
  SL.fmtDuration = (sec) => {
    const m = Math.round(sec / 60);
    return m < 60 ? `${m} min` : `${Math.floor(m / 60)} t ${m % 60} min`;
  };

  SL.gql = async (url, query, variables) => {
    const res = await fetch(url, {
      method: "POST",
      headers: { "Content-Type": "application/json", "ET-Client-Name": SL.CLIENT },
      body: JSON.stringify({ query, variables }),
    });
    if (!res.ok) throw new Error(`HTTP ${res.status}`);
    const json = await res.json();
    if (json.errors?.length && !json.data) throw new Error(json.errors[0].message);
    return json.data;
  };

  // Stadsøk hos Entur, sortert etter avstand frå Sogndal
  SL.geocode = async (text, layers = "venue") => {
    const params = new URLSearchParams({
      text,
      size: "8",
      layers,
      "focus.point.lat": SL.FOCUS.lat,
      "focus.point.lon": SL.FOCUS.lon,
      lang: "no",
    });
    const res = await fetch(`${SL.GEOCODER_URL}?${params}`, { headers: { "ET-Client-Name": SL.CLIENT } });
    if (!res.ok) throw new Error(`HTTP ${res.status}`);
    const json = await res.json();
    return (json.features || []).map((f) => ({
      id: f.properties.id,
      name: f.properties.name,
      label: f.properties.label,
      locality: f.properties.locality || f.properties.county || "",
      category: f.properties.category || [],
      layer: f.properties.layer,
      coord: f.geometry.coordinates,
    }));
  };

  SL.decodePolyline = (str) => {
    const out = [];
    let i = 0, lat = 0, lon = 0;
    while (i < str.length) {
      for (const which of [0, 1]) {
        let shift = 0, result = 0, b;
        do {
          b = str.charCodeAt(i++) - 63;
          result |= (b & 0x1f) << shift;
          shift += 5;
        } while (b >= 0x20);
        const d = result & 1 ? ~(result >> 1) : result >> 1;
        if (which === 0) lat += d; else lon += d;
      }
      out.push([lon / 1e5, lat / 1e5]);
    }
    return out;
  };

  SL.distanceKm = ([lon1, lat1], [lon2, lat2]) => {
    const r = Math.PI / 180;
    const a = Math.sin(((lat2 - lat1) * r) / 2) ** 2 + Math.cos(lat1 * r) * Math.cos(lat2 * r) * Math.sin(((lon2 - lon1) * r) / 2) ** 2;
    return 12742 * Math.asin(Math.sqrt(a));
  };

  SL.debounce = (fn, ms) => {
    let t;
    return (...args) => {
      clearTimeout(t);
      t = setTimeout(() => fn(...args), ms);
    };
  };

  // ---------------------------------------------------------------- sol og tema
  // Soloppgang/-nedgang (NOAA-tilnærming), med borgarleg skumring (zenit 96°)
  function sunTime(date, lat, lon, rising) {
    const rad = Math.PI / 180;
    const start = Date.UTC(date.getUTCFullYear(), 0, 0);
    const N = Math.floor((date - start) / 86_400_000);
    const lngHour = lon / 15;
    const t = N + ((rising ? 6 : 18) - lngHour) / 24;
    const M = 0.9856 * t - 3.289;
    let L = (M + 1.916 * Math.sin(M * rad) + 0.02 * Math.sin(2 * M * rad) + 282.634 + 360) % 360;
    let RA = (Math.atan(0.91764 * Math.tan(L * rad)) / rad + 360) % 360;
    RA += Math.floor(L / 90) * 90 - Math.floor(RA / 90) * 90;
    RA /= 15;
    const sinDec = 0.39782 * Math.sin(L * rad);
    const cosDec = Math.cos(Math.asin(sinDec));
    const cosH = (Math.cos(96 * rad) - sinDec * Math.sin(lat * rad)) / (cosDec * Math.cos(lat * rad));
    if (cosH > 1) return rising ? Infinity : -Infinity; // mørkt heile døgnet
    if (cosH < -1) return rising ? -Infinity : Infinity; // lyst heile døgnet
    let H = rising ? 360 - Math.acos(cosH) / rad : Math.acos(cosH) / rad;
    H /= 15;
    const T = H + RA - 0.06571 * t - 6.622;
    const UT = (((T - lngHour) % 24) + 24) % 24;
    return Date.UTC(date.getUTCFullYear(), date.getUTCMonth(), date.getUTCDate()) + UT * 3_600_000;
  }
  SL.isDark = (now = new Date()) => {
    const rise = sunTime(now, SL.FOCUS.lat, SL.FOCUS.lon, true);
    const set = sunTime(now, SL.FOCUS.lat, SL.FOCUS.lon, false);
    return now < rise || now > set;
  };

  const STYLES = {
    light: "https://tiles.openfreemap.org/styles/liberty",
    dark: "https://tiles.openfreemap.org/styles/dark",
  };
  SL.themeMode = SL.store.get("theme", "auto"); // auto | light | dark
  SL.theme = SL.themeMode === "auto" ? (SL.isDark() ? "dark" : "light") : SL.themeMode;
  document.documentElement.dataset.theme = SL.theme;

  // Fargar for kartlag som må tilpassast lyst/mørkt kart
  SL.themeColors = () =>
    SL.theme === "dark"
      ? { halo: "#141b1d", text: "#e6eef0", accent: "#7fc3cf", stopFill: "#1b2528", routeCasing: "#0d1214" }
      : { halo: "#ffffff", text: "#1f5f6b", accent: "#1f5f6b", stopFill: "#ffffff", routeCasing: "#ffffff" };

  // ---------------------------------------------------------------- lettvekts-modus
  // 3D-terreng er tungt på eldre mobilar. Slå det av automatisk på svake einingar.
  const weakDevice =
    (navigator.deviceMemory && navigator.deviceMemory <= 3) ||
    (navigator.hardwareConcurrency && navigator.hardwareConcurrency <= 4) ||
    navigator.connection?.saveData === true;
  SL.lite = SL.store.get("lite", null) ?? !!weakDevice;

  // ---------------------------------------------------------------- kart
  const map = (SL.map = new maplibregl.Map({
    container: "map",
    style: STYLES[SL.theme],
    ...SL.HOME,
    maxPitch: 80,
    hash: "kart",
    attributionControl: { compact: true },
    canvasContextAttributes: { antialias: !SL.lite },
  }));
  map.addControl(new maplibregl.NavigationControl({ visualizePitch: true }), "top-right");
  map.addControl(new maplibregl.GeolocateControl({ trackUserLocation: false }), "top-right");
  map.addControl(new maplibregl.ScaleControl({ unit: "metric" }), "bottom-right");

  // Ikon vert teikna på canvas ved behov: id = "<type>-<#farge>"
  SL.iconFactories = {};
  map.on("styleimagemissing", (e) => {
    const m = /^([a-z]+)-(#[0-9a-f]{6})$/i.exec(e.id);
    const factory = m && SL.iconFactories[m[1]];
    if (factory && !map.hasImage(e.id)) map.addImage(e.id, factory(m[2]), { pixelRatio: 2 });
  });

  // Modular registrerer kartlag her. Dei vert lagde på nytt kvar gong stilen vert bytt (lys/mørk).
  const styleSetups = [];
  SL.onStyle = (fn) => {
    styleSetups.push(fn);
    if (styleReady) fn();
  };
  let styleReady = false;

  function addBaseLayers() {
    const c = SL.themeColors();
    const dark = SL.theme === "dark";
    map.addSource("terrain", { type: "raster-dem", url: "https://tiles.mapterhorn.com/tilejson.json", tileSize: 512 });
    map.addSource("hillshade", { type: "raster-dem", url: "https://tiles.mapterhorn.com/tilejson.json", tileSize: 512 });
    const layers = map.getStyle().layers;
    const firstSymbol = layers.find((l) => l.type === "symbol")?.id;
    map.addLayer(
      {
        id: "hillshade",
        type: "hillshade",
        source: "hillshade",
        paint: dark
          ? { "hillshade-exaggeration": 0.5, "hillshade-shadow-color": "#000000", "hillshade-highlight-color": "#3d4b52", "hillshade-accent-color": "#11181b" }
          : { "hillshade-exaggeration": 0.45, "hillshade-shadow-color": "#3b4a4f", "hillshade-highlight-color": "#ffffff", "hillshade-accent-color": "#5c6b62" },
      },
      firstSymbol
    );
    // Den mørke stilen har ikkje 3D-bygningar – legg dei til sjølv
    if (!map.getLayer("building-3d") && map.getSource("openmaptiles")) {
      map.addLayer(
        {
          id: "building-3d",
          type: "fill-extrusion",
          source: "openmaptiles",
          "source-layer": "building",
          minzoom: 14,
          paint: {
            "fill-extrusion-color": dark ? "#2a3337" : "#e0dfd8",
            "fill-extrusion-height": ["coalesce", ["get", "render_height"], 6],
            "fill-extrusion-base": ["coalesce", ["get", "render_min_height"], 0],
            "fill-extrusion-opacity": 0.85,
          },
        },
        firstSymbol
      );
    }
    applyLite();
    try {
      map.setSky(
        dark
          ? { "sky-color": "#0b1a2a", "horizon-color": "#1d2c3a", "fog-color": "#0f171c", "sky-horizon-blend": 0.6, "horizon-fog-blend": 0.6, "fog-ground-blend": 0.7, "atmosphere-blend": ["interpolate", ["linear"], ["zoom"], 0, 1, 12, 0.5, 15, 0] }
          : { "sky-color": "#a9cbe4", "horizon-color": "#e7eff3", "fog-color": "#f2f5f6", "sky-horizon-blend": 0.6, "horizon-fog-blend": 0.6, "fog-ground-blend": 0.7, "atmosphere-blend": ["interpolate", ["linear"], ["zoom"], 0, 1, 12, 0.6, 15, 0] }
      );
    } catch { /* eldre MapLibre */ }

    // Rutetrasé: valt køyretøy eller reiseforslag. Gange vert stipla.
    map.addSource("route", { type: "geojson", data: routeData });
    const solid = ["!=", ["get", "dash"], true];
    map.addLayer({
      id: "route-casing",
      type: "line",
      source: "route",
      filter: solid,
      layout: { "line-join": "round", "line-cap": "round" },
      paint: { "line-color": c.routeCasing, "line-width": 8, "line-opacity": 0.9 },
    });
    map.addLayer({
      id: "route-line",
      type: "line",
      source: "route",
      filter: solid,
      layout: { "line-join": "round", "line-cap": "round" },
      paint: { "line-color": ["get", "color"], "line-width": 4.5 },
    });
    map.addLayer({
      id: "route-walk",
      type: "line",
      source: "route",
      filter: ["==", ["get", "dash"], true],
      layout: { "line-join": "round", "line-cap": "round" },
      paint: { "line-color": dark ? "#c9d4d8" : "#4c5856", "line-width": 3.5, "line-dasharray": [0.6, 1.8] },
    });
  }

  function applyLite() {
    if (SL.lite) map.setTerrain(null);
    else if (map.getSource("terrain")) map.setTerrain({ source: "terrain", exaggeration: 1.25 });
    if (map.getLayer("building-3d")) map.setLayoutProperty("building-3d", "visibility", SL.lite ? "none" : "visible");
  }

  map.on("style.load", () => {
    addBaseLayers();
    styleReady = true;
    for (const fn of styleSetups) {
      try {
        fn();
      } catch (err) {
        console.error("Kartlag feila", err);
      }
    }
  });

  SL.setTheme = (mode) => {
    SL.themeMode = mode;
    SL.store.set("theme", mode);
    const next = mode === "auto" ? (SL.isDark() ? "dark" : "light") : mode;
    document.documentElement.dataset.theme = next;
    if (next === SL.theme) return;
    SL.theme = next;
    styleReady = false;
    map.setStyle(STYLES[next], { diff: false });
  };
  // I auto-modus: sjekk solhøgda kvart 5. minutt
  setInterval(() => SL.themeMode === "auto" && SL.setTheme("auto"), 5 * 60_000);

  SL.setLite = (on) => {
    SL.lite = on;
    SL.store.set("lite", on);
    applyLite();
  };

  // ---------------------------------------------------------------- rute på kartet
  let routeData = SL.emptyFC();
  /** lines: [{ coords, color, dash }] */
  SL.setRoute = (lines) => {
    routeData = {
      type: "FeatureCollection",
      features: (lines || [])
        .filter((l) => l.coords?.length > 1)
        .map((l) => ({ type: "Feature", properties: { color: l.color, dash: !!l.dash }, geometry: { type: "LineString", coordinates: l.coords } })),
    };
    map.getSource("route")?.setData(routeData);
  };
  SL.fitCoords = (coords, opts = {}) => {
    if (!coords.length) return;
    const b = coords.reduce((acc, c) => acc.extend(c), new maplibregl.LngLatBounds(coords[0], coords[0]));
    const mobile = mq.matches;
    map.fitBounds(b, {
      padding: mobile ? { top: 60, bottom: 260, left: 30, right: 30 } : { top: 60, bottom: 60, left: 420, right: 400 },
      maxZoom: 15,
      duration: 1400,
      ...opts,
    });
  };

  // ---------------------------------------------------------------- klikk på kartlag
  SL.clickable = (layerId, fn) => {
    map.on("click", layerId, (e) => {
      const f = e.features?.[0];
      if (f) fn(f, e);
    });
    map.on("mouseenter", layerId, () => (map.getCanvas().style.cursor = "pointer"));
    map.on("mouseleave", layerId, () => (map.getCanvas().style.cursor = ""));
  };

  // ---------------------------------------------------------------- val
  /** { kind: "veh" | "plane" | "stop" | "cam" | "msg" | "trip", id } */
  SL.selected = null;
  const selectListeners = [];
  SL.onSelect = (fn) => selectListeners.push(fn);
  SL.select = (kind, id) => {
    SL.selected = kind ? { kind, id } : null;
    for (const fn of selectListeners) fn(SL.selected);
  };
  SL.isSel = (kind, id) => SL.selected?.kind === kind && SL.selected.id === id;

  // ---------------------------------------------------------------- detaljkort
  let token = 0;
  let opener = null;
  const closeListeners = [];
  SL.onDetailClose = (fn) => closeListeners.push(fn);
  SL.detailToken = () => token;

  SL.openDetail = (kind, id, html) => {
    for (const fn of closeListeners) fn();
    token++;
    SL.setRoute(null);
    SL.select(kind, id);
    // Hugs kva som hadde fokus, så fokus kan gå tilbake dit når kortet vert lukka
    if ($("detail").hidden) opener = document.activeElement;
    $("detail-body").innerHTML = html;
    $("detail").hidden = false;
    collapsePanelOnMobile();
    $("detail").focus({ preventScroll: true });
    return token;
  };
  // Byt ut alt etter første .d-section i detaljkortet
  SL.replaceSection = (html) => {
    const sec = $("detail-body").querySelector(".d-section");
    if (!sec) return;
    while (sec.nextSibling) sec.nextSibling.remove();
    sec.insertAdjacentHTML("afterend", html);
  };
  SL.closeDetail = () => {
    token++;
    for (const fn of closeListeners) fn();
    $("detail").hidden = true;
    SL.setRoute(null);
    SL.select(null);
    if (opener && document.contains(opener)) opener.focus();
    opener = null;
  };
  $("detail-close").addEventListener("click", SL.closeDetail);
  document.addEventListener("keydown", (e) => e.key === "Escape" && !$("detail").hidden && SL.closeDetail());

  // ---------------------------------------------------------------- mobilark
  const mq = window.matchMedia("(max-width: 760px)");
  SL.isMobile = () => mq.matches;
  function collapsePanelOnMobile() {
    if (mq.matches) {
      $("panel").classList.add("collapsed");
      $("panel-handle").setAttribute("aria-expanded", "false");
    }
  }
  SL.collapsePanelOnMobile = collapsePanelOnMobile;
  $("panel-handle").addEventListener("click", () => {
    const collapsed = $("panel").classList.toggle("collapsed");
    $("panel-handle").setAttribute("aria-expanded", String(!collapsed));
  });

  // ---------------------------------------------------------------- animasjon
  // Modular registrerer ein funksjon (t) => busy. Løkka går så lenge nokon er i rørsle.
  const animators = [];
  let animating = false;
  SL.addAnimator = (fn) => animators.push(fn);
  SL.kick = () => {
    if (animating) return;
    animating = true;
    requestAnimationFrame(step);
  };
  function step(t) {
    let busy = false;
    for (const fn of animators) busy = fn(t) || busy;
    if (busy && !document.hidden) requestAnimationFrame(step);
    else animating = false;
  }

  // ---------------------------------------------------------------- polling
  // Felles hjelpar: kall fn med jamne mellomrom, med auka pause ved feil og pause når fana er skjult.
  SL.poll = (fn, intervalMs, maxBackoffMs = 120_000) => {
    let timer = null;
    let failures = 0;
    const run = async () => {
      clearTimeout(timer);
      try {
        await fn();
        failures = 0;
      } catch (err) {
        failures++;
        console.warn(err);
      }
      if (!document.hidden) timer = setTimeout(run, failures ? Math.min(maxBackoffMs, intervalMs * 2 ** failures) : intervalMs);
    };
    document.addEventListener("visibilitychange", () => !document.hidden && run());
    run();
    return run;
  };

  // ---------------------------------------------------------------- visning (tema + lettvekt)
  function renderViewControls() {
    for (const b of document.querySelectorAll("#theme-tabs button")) b.setAttribute("aria-pressed", String(b.dataset.theme === SL.themeMode));
    $("t-terrain").checked = !SL.lite;
  }
  $("theme-tabs").addEventListener("click", (e) => {
    const b = e.target.closest("button[data-theme]");
    if (!b) return;
    SL.setTheme(b.dataset.theme);
    renderViewControls();
  });
  $("t-terrain").addEventListener("change", (e) => SL.setLite(!e.target.checked));
  renderViewControls();

  window.sogndalKart = SL; // for feilsøking i konsollen
})();
