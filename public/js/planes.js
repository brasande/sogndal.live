/* Sogndal.live · flytavle for Haukåsen (Avinor via Allemannsdata) og fly i lufta (adsb.lol via /adsb/-proxy) */
(() => {
  "use strict";
  const { $, esc, map } = SL;

  const FLIGHTS_URL =
    "/ad/avinor/get_flights?airport_id=SOG&hours_back=1&hours_ahead=24&include_codeshare=false&max_results=100&limit=100";
  const SOG = { lat: 61.1561, lon: 7.1378 };
  const ADSB_URL = `/adsb/v2/point/${SOG.lat}/${SOG.lon}/80`; // 80 nm rundt Haukåsen
  const PLANE_COLOR = "#2f3b45";
  const PLANE_COLOR_DARK = "#c9d4d8";
  const PLANE_SOG_COLOR = "#e0601b";

  const AIRPORTS = {
    OSL: "Oslo", BGO: "Bergen", SDN: "Sandane", HOV: "Ørsta-Volda", FRO: "Florø", FDE: "Førde", AES: "Ålesund",
    TRD: "Trondheim", SVG: "Stavanger", MOL: "Molde", KSU: "Kristiansund", HAU: "Haugesund", KRS: "Kristiansand",
    TOS: "Tromsø", BOO: "Bodø", SOG: "Sogndal",
  };
  const ICAO_TO_IATA = { WIF: "WF", SAS: "SK", NOZ: "DY", NAX: "DY", NSZ: "D8" };

  // ---------------------------------------------------------------- ikon og kartlag
  const PLANE_PATH = new Path2D(
    "M24 2C26 2 27 5 27 8L27 18L45 28L45 32L27 27L27 38L33 43L33 46L24 43.5L15 46L15 43L21 38L21 27L3 32L3 28L21 18L21 8C21 5 22 2 24 2Z"
  );
  SL.iconFactories.plane = (color) => {
    const c = document.createElement("canvas");
    c.width = c.height = 48;
    const ctx = c.getContext("2d");
    ctx.lineJoin = "round";
    ctx.strokeStyle = color === PLANE_COLOR_DARK ? "#111" : "#fff";
    ctx.lineWidth = 3;
    ctx.stroke(PLANE_PATH);
    ctx.fillStyle = color;
    ctx.fill(PLANE_PATH);
    return { width: 48, height: 48, data: ctx.getImageData(0, 0, 48, 48).data };
  };

  SL.onStyle(() => {
    const c = SL.themeColors();
    map.addSource("planes", { type: "geojson", data: SL.emptyFC() });
    map.addLayer({
      id: "plane-halo",
      type: "circle",
      source: "planes",
      filter: ["==", ["get", "id"], SL.selected?.kind === "plane" ? SL.selected.id : ""],
      paint: {
        "circle-radius": 22,
        "circle-color": PLANE_SOG_COLOR,
        "circle-opacity": 0.2,
        "circle-stroke-color": PLANE_SOG_COLOR,
        "circle-stroke-width": 2,
      },
    });
    map.addLayer({
      id: "plane-icon",
      type: "symbol",
      source: "planes",
      layout: {
        "icon-image": ["concat", "plane-", ["get", "color"]],
        "icon-rotate": ["get", "track"],
        "icon-rotation-alignment": "map",
        "icon-size": ["interpolate", ["linear"], ["zoom"], 6, 0.6, 10, 0.9, 14, 1.3],
        "icon-allow-overlap": true,
        "icon-ignore-placement": true,
        "symbol-sort-key": ["get", "sort"],
        "text-field": ["get", "label"],
        "text-font": ["Noto Sans Bold"],
        "text-size": 11,
        "text-offset": [0, 1.7],
        "text-anchor": "top",
        "text-optional": true,
      },
      paint: {
        "icon-opacity": ["case", ["get", "high"], 0.55, 1],
        "text-color": ["get", "color"],
        "text-halo-color": c.halo,
        "text-halo-width": 1.6,
        "text-opacity": ["step", ["zoom"], ["case", ["get", "sog"], 1, 0], 9, 1],
      },
    });
    pushPlanes();
  });
  SL.clickable("plane-icon", (f) => openPlane(f.properties.id));
  SL.onSelect((sel) => {
    if (map.getLayer("plane-halo")) map.setFilter("plane-halo", ["==", ["get", "id"], sel?.kind === "plane" ? sel.id : ""]);
    renderFlightBoard();
  });

  // ---------------------------------------------------------------- fly i lufta
  /** hex -> { ac, fixLon, fixLat, fixTime, pos } */
  const planes = (SL.planes = new Map());

  SL.poll(async () => {
    try {
      const res = await fetch(ADSB_URL);
      if (!res.ok) throw new Error(`adsb HTTP ${res.status}`);
      const json = await res.json();
      const now = Date.now();
      const seen = new Set();
      for (const ac of json.ac || []) {
        if (typeof ac.lat !== "number" || (ac.seen_pos ?? 0) > 60) continue;
        seen.add(ac.hex);
        const p = planes.get(ac.hex) || {};
        planes.set(ac.hex, { ...p, ac, fixLon: ac.lon, fixLat: ac.lat, fixTime: now - (ac.seen_pos ?? 0) * 1000, pos: p.pos || [ac.lon, ac.lat] });
      }
      for (const hex of [...planes.keys()]) {
        if (!seen.has(hex)) {
          planes.delete(hex);
          if (SL.isSel("plane", hex)) SL.closeDetail();
        }
      }
      if (SL.selected?.kind === "plane") renderPlaneDetail(SL.selected.id);
      $("c-plane").textContent = planes.size;
      renderFlightBoard();
      SL.kick();
    } catch (err) {
      if (!planes.size) $("c-plane").textContent = "–";
      throw err;
    }
  }, 10_000);

  const onGround = (ac) => ac.alt_baro === "ground";
  const altMeters = (ac) => (onGround(ac) ? 0 : Math.round(((typeof ac.alt_geom === "number" ? ac.alt_geom : ac.alt_baro) || 0) * 0.3048));
  const callsign = (ac) => (ac.flight || "").trim();
  function flightNumber(ac) {
    const m = /^([A-Z]{3})(\d+[A-Z]?)$/.exec(callsign(ac));
    return m && ICAO_TO_IATA[m[1]] ? ICAO_TO_IATA[m[1]] + m[2] : null;
  }
  // Er flyet på veg til eller frå Haukåsen? Slår opp i flytavla.
  function sogFlight(ac) {
    const fn = flightNumber(ac);
    if (!fn) return null;
    const same = flights.filter((f) => f.flight_id === fn);
    const arr = same.find((f) => f.direction === "arrival" && !["A", "C"].includes(f.status?.code));
    if (arr) return { dir: "arrival", flight: arr };
    const dep = same.find((f) => f.direction === "departure" && f.status?.code === "D");
    return dep ? { dir: "departure", flight: dep } : null;
  }

  // Dødrekning mellom pollingane så flya glir jamt over kartet
  function planePosition(p, now) {
    const ac = p.ac;
    if (onGround(ac) || typeof ac.gs !== "number" || typeof ac.track !== "number") return [p.fixLon, p.fixLat];
    const dt = Math.min(60, (now - p.fixTime) / 1000);
    const dist = ac.gs * 0.514444 * dt;
    const rad = (ac.track * Math.PI) / 180;
    return [
      p.fixLon + (dist * Math.sin(rad)) / (111_320 * Math.cos((p.fixLat * Math.PI) / 180)),
      p.fixLat + (dist * Math.cos(rad)) / 111_320,
    ];
  }

  function pushPlanes() {
    const src = map.getSource("planes");
    if (!src) return;
    const show = $("t-plane").checked;
    const base = SL.theme === "dark" ? PLANE_COLOR_DARK : PLANE_COLOR;
    const now = Date.now();
    const features = [];
    for (const [hex, p] of planes) {
      p.pos = planePosition(p, now);
      if (!show) continue;
      const ac = p.ac;
      const sog = !!sogFlight(ac);
      const alt = altMeters(ac);
      features.push({
        type: "Feature",
        properties: {
          id: hex,
          track: typeof ac.track === "number" ? ac.track : (ac.true_heading ?? 0),
          color: sog ? PLANE_SOG_COLOR : base,
          sog,
          high: !sog && alt > 6000,
          sort: sog ? 2 : alt > 6000 ? 0 : 1,
          label: `${callsign(ac) || ac.r || hex}${onGround(ac) ? " · på bakken" : ` · ${alt.toLocaleString("nb-NO")} m`}`,
        },
        geometry: { type: "Point", coordinates: p.pos },
      });
    }
    src.setData({ type: "FeatureCollection", features });
  }

  let lastPush = 0;
  SL.addAnimator((t) => {
    const moving = planes.size > 0 && $("t-plane").checked;
    if (moving && t - lastPush > 250) {
      lastPush = t;
      pushPlanes();
    }
    return moving;
  });
  $("t-plane").addEventListener("change", () => {
    pushPlanes();
    SL.kick();
  });

  // ---------------------------------------------------------------- detaljar
  function openPlane(hex, fly = false) {
    const p = planes.get(hex);
    if (!p) return;
    if (fly) map.flyTo({ center: p.pos, zoom: Math.min(Math.max(map.getZoom(), 10), 12), duration: 1600 });
    SL.openDetail("plane", hex, `<div id="plane-head"></div>`);
    renderPlaneDetail(hex);
  }

  function renderPlaneDetail(hex) {
    const head = document.getElementById("plane-head");
    const p = planes.get(hex);
    if (!head || !p) return;
    const ac = p.ac;
    const sog = sogFlight(ac);
    const alt = altMeters(ac);
    const kmh = typeof ac.gs === "number" ? Math.round(ac.gs * 1.852) : null;
    const vr = ac.baro_rate ?? ac.geom_rate;
    const trend = typeof vr === "number" && Math.abs(vr) > 300 ? (vr > 0 ? " · stig" : " · søkk") : "";
    let route = "";
    if (sog) {
      const other = AIRPORTS[sog.flight.airport] || sog.flight.airport;
      route = sog.dir === "arrival" ? `${esc(other)} → Sogndal` : `Sogndal → ${esc(other)}`;
      if (sog.dir === "arrival") route += ` · venta ${SL.fmtTime(sog.flight.status?.time || sog.flight.schedule_time)}`;
    }
    head.innerHTML = `
      <div class="d-row"><span class="badge" style="background:${sog ? PLANE_SOG_COLOR : PLANE_COLOR}">✈ ${esc(sog?.flight.flight_id || callsign(ac) || "–")}</span></div>
      <h3 id="detail-title">${route || esc(callsign(ac) || ac.r || "Ukjent fly")}</h3>
      <p class="d-meta">${esc(ac.desc || ac.t || "Ukjend type")}${ac.r ? ` · ${esc(ac.r)}` : ""}${callsign(ac) ? ` · ${esc(callsign(ac))}` : ""}</p>
      <dl class="facts">
        <div><dt>Høgd</dt><dd>${onGround(ac) ? "På bakken" : `${alt.toLocaleString("nb-NO")} m${trend}`}</dd></div>
        <div><dt>Fart</dt><dd>${kmh != null ? `${kmh} km/t` : "–"}</dd></div>
        <div><dt>Kurs</dt><dd>${typeof ac.track === "number" ? `${Math.round(ac.track)}°` : "–"}</dd></div>
        <div><dt>Sist sett</dt><dd>${Math.round(ac.seen_pos ?? ac.seen ?? 0)} s</dd></div>
      </dl>
      <p class="fine">Posisjon frå ADS-B-mottakarar via adsb.lol. Mellom oppdateringane er posisjonen rekna ut frå fart og kurs.</p>`;
  }

  // ---------------------------------------------------------------- flytavle
  let flights = [];
  let flightDir = "departure";

  SL.poll(async () => {
    try {
      const res = await fetch(FLIGHTS_URL);
      if (!res.ok) throw new Error(`flytavle HTTP ${res.status}`);
      flights = (await res.json()).data?.flights || [];
      renderFlightBoard();
    } catch (err) {
      if (!flights.length) $("flight-list").innerHTML = `<li class="empty">Flytavla er ikkje tilgjengeleg akkurat no.</li>`;
      throw err;
    }
  }, 2 * 60_000);

  function flightStatus(f) {
    const st = f.status || {};
    const t = st.time ? SL.fmtTime(st.time) : "";
    switch (st.code) {
      case "A": return { text: `Landa ${t}`, cls: "ok" };
      case "D": return { text: `Gått ${t}`, cls: "ok" };
      case "C": return { text: "Innstilt", cls: "very-late" };
      case "E": {
        const late = Math.round((Date.parse(st.time) - Date.parse(f.schedule_time)) / 60000);
        return late >= 5 ? { text: `Ny tid ${t}`, cls: "late" } : { text: f.direction === "arrival" ? `Venta ${t}` : "I rute", cls: "ok" };
      }
      default: return { text: "", cls: "" };
    }
  }
  function planeForFlight(fn) {
    for (const [hex, p] of planes) if (flightNumber(p.ac) === fn) return hex;
    return null;
  }

  function renderFlightBoard() {
    for (const b of document.querySelectorAll("#flight-tabs button")) b.setAttribute("aria-pressed", String(b.dataset.dir === flightDir));
    const list = flights.filter((f) => f.direction === flightDir).slice(0, 8);
    const ul = $("flight-list");
    if (!list.length) {
      ul.innerHTML = `<li class="empty">${flights.length ? "Ingen fleire " + (flightDir === "arrival" ? "ankomstar" : "avgangar") + " i dag." : "Hentar flytavla …"}</li>`;
      return;
    }
    ul.innerHTML = list
      .map((f) => {
        const s = flightStatus(f);
        const hex = planeForFlight(f.flight_id);
        const place = AIRPORTS[f.airport] || f.airport;
        const via = f.via_airport ? ` via ${AIRPORTS[f.via_airport] || f.via_airport}` : "";
        return `<li><button type="button" class="row ${hex && SL.isSel("plane", hex) ? "active" : ""}" data-hex="${hex || ""}"
            aria-label="${esc(f.flight_id)} ${flightDir === "arrival" ? "frå" : "til"} ${esc(place)} klokka ${SL.fmtTime(f.schedule_time)}${s.text ? ", " + esc(s.text) : ""}${hex ? ", i lufta" : ""}">
          <time>${SL.fmtTime(f.schedule_time)}</time>
          <span class="f-main">
            <span class="f-dest ${f.status?.code === "C" ? "cancelled" : ""}">${esc(place)}<small>${esc(via)}</small></span>
            <span class="f-sub">${esc(f.flight_id)}${hex ? ' · <b class="live-tag">i lufta</b>' : ""}</span>
          </span>
          <span class="delay ${s.cls}">${esc(s.text)}</span>
        </button></li>`;
      })
      .join("");
  }
  $("flight-tabs").addEventListener("click", (e) => {
    const b = e.target.closest("button[data-dir]");
    if (!b) return;
    flightDir = b.dataset.dir;
    renderFlightBoard();
  });
  $("flight-list").addEventListener("click", (e) => {
    const b = e.target.closest("button[data-hex]");
    if (!b) return;
    if (b.dataset.hex) openPlane(b.dataset.hex, true);
    else map.flyTo({ center: [SOG.lon, SOG.lat], zoom: 13.4, pitch: 60, bearing: 120, duration: 1800 });
  });

  setInterval(renderFlightBoard, 30_000);
})();
