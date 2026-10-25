/* Sogndal.live · bussar og ferjer i sanntid (Entur Vehicle Positions) */
(() => {
  "use strict";
  const { $, esc, map } = SL;

  const VEHICLES_URL = "https://api.entur.io/realtime/v2/vehicles/graphql";
  // Indre Sogn: Vik/Balestrand i vest, Lærdal/Årdal i aust, Luster/Fjærland i nord
  const BBOX = { minLat: 60.85, minLon: 6.3, maxLat: 61.7, maxLon: 8.0 };
  const POLL_MS = 10_000;
  const MAX_AGE_MS = 10 * 60_000; // skjul køyretøy eldre enn dette
  const STALE_MS = 2 * 60_000; // dim køyretøy eldre enn dette
  const MODEL_MINZOOM = 14.5;

  // ---------------------------------------------------------------- ikon (sett ovanfrå, front mot nord)
  function shade(hex, amt) {
    const n = parseInt(hex.slice(1), 16);
    const ch = (v) => Math.round(amt < 0 ? v * (1 + amt) : v + (255 - v) * amt);
    return `rgb(${ch(n >> 16)},${ch((n >> 8) & 255)},${ch(n & 255)})`;
  }
  function roundRect(ctx, x, y, w, h, r) {
    ctx.beginPath();
    ctx.roundRect ? ctx.roundRect(x, y, w, h, r) : ctx.rect(x, y, w, h);
  }
  function canvas(w, h) {
    const c = document.createElement("canvas");
    c.width = w;
    c.height = h;
    const ctx = c.getContext("2d");
    ctx.lineJoin = "round";
    return ctx;
  }
  const imageOf = (ctx) => ({ width: ctx.canvas.width, height: ctx.canvas.height, data: ctx.getImageData(0, 0, ctx.canvas.width, ctx.canvas.height).data });

  SL.iconFactories.bus = (color) => {
    const ctx = canvas(32, 72);
    ctx.shadowColor = "rgba(0,0,0,0.35)";
    ctx.shadowBlur = 4;
    roundRect(ctx, 4, 3, 24, 66, 7);
    ctx.fillStyle = "#fff";
    ctx.fill();
    ctx.shadowColor = "transparent";
    roundRect(ctx, 6, 5, 20, 62, 5);
    ctx.fillStyle = color;
    ctx.fill();
    roundRect(ctx, 8, 7, 16, 8, 3); // frontrute
    ctx.fillStyle = "#1c2830";
    ctx.fill();
    roundRect(ctx, 9, 18, 14, 44, 3); // tak
    ctx.fillStyle = shade(color, 0.22);
    ctx.fill();
    ctx.fillStyle = shade(color, -0.25); // takluker
    for (const y of [24, 38, 52]) {
      roundRect(ctx, 12, y, 8, 5, 1.5);
      ctx.fill();
    }
    roundRect(ctx, 10, 63, 12, 3, 1); // bakrute
    ctx.fillStyle = "#1c2830";
    ctx.fill();
    return imageOf(ctx);
  };

  SL.iconFactories.ferry = (color) => {
    const ctx = canvas(40, 96);
    const hull = new Path2D("M20 2 C29 10 35 22 35 34 L35 88 Q35 94 29 94 L11 94 Q5 94 5 88 L5 34 C5 22 11 10 20 2 Z");
    ctx.shadowColor = "rgba(0,0,0,0.35)";
    ctx.shadowBlur = 4;
    ctx.fillStyle = "#fff";
    ctx.fill(hull);
    ctx.shadowColor = "transparent";
    ctx.save();
    ctx.translate(20, 48);
    ctx.scale(0.86, 0.94);
    ctx.translate(-20, -48);
    ctx.fillStyle = color;
    ctx.fill(hull);
    ctx.restore();
    roundRect(ctx, 10, 30, 20, 58, 3); // bildekk
    ctx.fillStyle = shade(color, -0.3);
    ctx.fill();
    roundRect(ctx, 11, 40, 18, 34, 3); // overbygg
    ctx.fillStyle = "#f4f6f8";
    ctx.fill();
    roundRect(ctx, 12, 42, 16, 6, 2); // bru
    ctx.fillStyle = "#1c2830";
    ctx.fill();
    roundRect(ctx, 17, 60, 6, 6, 1.5); // skorstein
    ctx.fillStyle = shade(color, -0.1);
    ctx.fill();
    return imageOf(ctx);
  };

  // ---------------------------------------------------------------- 3D-modellar (fill-extrusion)
  // Kvar modell er boksar i lokale meter: [x0, y0, x1, y1, botn, topp, farge]; x på tvers, y langs (front +).
  function busParts(color) {
    const L = 12, W = 2.55, hl = L / 2, hw = W / 2;
    const dark = "#1c2830", tyre = "#202020";
    const parts = [];
    for (const y of [hl - 2.6, -hl + 3.2]) {
      for (const x of [-hw + 0.05, hw - 0.35]) parts.push([x, y - 0.5, x + 0.3, y + 0.5, 0, 0.95, tyre]);
    }
    parts.push(
      [-hw, -hl, hw, hl, 0.35, 1.2, color], // underdel
      [-hw, -hl + 0.15, hw, hl - 0.15, 1.2, 2.55, dark], // vindaugsband
      [-hw, -hl, hw, -hl + 0.15, 1.2, 2.55, color], // bakvegg
      [-hw, hl - 0.15, hw, hl, 1.2, 1.45, color], // under frontruta
      [-hw, -hl, hw, hl, 2.55, 3.0, color], // tak
      [-hw + 0.45, -hl + 2, hw - 0.45, hl - 2.5, 3.0, 3.25, shade(color, 0.35)] // takboks
    );
    return parts;
  }
  function ferryParts(color) {
    const L = 100, W = 17, hl = L / 2, hw = W / 2;
    return [
      [-hw, -hl, hw, hl - 8, 0, 3, "#1d3557"],
      [-hw * 0.7, hl - 8, hw * 0.7, hl, 0, 3, "#1d3557"],
      [-hw, -hl, hw, hl - 8, 3, 6.5, color],
      [-hw * 0.7, hl - 8, hw * 0.7, hl, 3, 6.5, color],
      [-hw + 1, -hl + 14, hw - 1, hl - 22, 6.5, 12, "#f4f6f8"], // overbygg
      [-hw + 1.5, hl - 30, hw - 1.5, hl - 22, 12, 15, "#1c2830"], // bru
      [-1.6, -6, 1.6, -1, 12, 18, shade(color, -0.1)], // skorstein
    ];
  }
  function partsToFeatures(id, [lon, lat], bearing, scale, parts) {
    const rad = ((bearing || 0) * Math.PI) / 180;
    const cos = Math.cos(rad), sin = Math.sin(rad);
    const mLat = 111_320, mLon = 111_320 * Math.cos((lat * Math.PI) / 180);
    const pt = (x, y) => [lon + ((x * cos + y * sin) * scale) / mLon, lat + ((-x * sin + y * cos) * scale) / mLat];
    return parts.map(([x0, y0, x1, y1, base, top, color]) => ({
      type: "Feature",
      properties: { id, color, base: base * scale, height: top * scale },
      geometry: { type: "Polygon", coordinates: [[pt(x0, y0), pt(x1, y0), pt(x1, y1), pt(x0, y1), pt(x0, y0)]] },
    }));
  }
  // Modellane vert overdrivne når ein zoomar ut, så dei ikkje forsvinn heilt
  const modelScale = (kind) => {
    const z = map.getZoom();
    return kind === "ferry" ? Math.min(3, Math.max(1, 2 ** (14.5 - z))) : Math.min(5, Math.max(1.4, 2 ** (17.3 - z)));
  };

  // ---------------------------------------------------------------- kartlag
  SL.onStyle(() => {
    map.addSource("vehicles", { type: "geojson", data: SL.emptyFC() });
    map.addSource("vehicles3d", { type: "geojson", data: SL.emptyFC() });
    map.addLayer({
      id: "veh-halo",
      type: "circle",
      source: "vehicles",
      filter: ["==", ["get", "id"], SL.selected?.kind === "veh" ? SL.selected.id : ""],
      paint: {
        "circle-radius": ["interpolate", ["linear"], ["zoom"], 8, 8, 11, 12, 13, 18, 16, 22],
        "circle-color": ["get", "color"],
        "circle-opacity": 0.25,
        "circle-stroke-color": ["get", "color"],
        "circle-stroke-width": 2,
        "circle-pitch-alignment": "map",
      },
    });
    map.addLayer({
      id: "veh-icon",
      type: "symbol",
      source: "vehicles",
      maxzoom: MODEL_MINZOOM,
      layout: {
        "icon-image": ["concat", ["get", "kind"], "-", ["get", "color"]],
        "icon-rotate": ["get", "bearing"],
        "icon-rotation-alignment": "map",
        "icon-pitch-alignment": "map",
        "icon-size": [
          "interpolate", ["linear"], ["zoom"],
          8, ["match", ["get", "kind"], "ferry", 0.5, 0.42],
          11, ["match", ["get", "kind"], "ferry", 0.7, 0.62],
          13, ["match", ["get", "kind"], "ferry", 0.95, 0.85],
          14.5, ["match", ["get", "kind"], "ferry", 1.1, 1.05],
        ],
        "icon-allow-overlap": true,
        "icon-ignore-placement": true,
        "symbol-sort-key": ["case", ["get", "stale"], 0, 1],
      },
      paint: { "icon-opacity": ["case", ["get", "stale"], 0.55, 1] },
    });
    map.addLayer({
      id: "veh-3d",
      type: "fill-extrusion",
      source: "vehicles3d",
      minzoom: MODEL_MINZOOM - 0.3,
      paint: {
        "fill-extrusion-color": ["get", "color"],
        "fill-extrusion-base": ["get", "base"],
        "fill-extrusion-height": ["get", "height"],
        "fill-extrusion-opacity": ["interpolate", ["linear"], ["zoom"], MODEL_MINZOOM - 0.3, 0, MODEL_MINZOOM, 1],
        "fill-extrusion-vertical-gradient": true,
      },
    });
    const labelPaint = { "text-color": "#ffffff", "text-halo-color": ["get", "color"], "text-halo-width": 2.4 };
    map.addLayer({
      id: "veh-label",
      type: "symbol",
      source: "vehicles",
      minzoom: 12,
      maxzoom: MODEL_MINZOOM,
      layout: {
        "text-field": ["get", "code"],
        "text-font": ["Noto Sans Bold"],
        "text-size": ["interpolate", ["linear"], ["zoom"], 12, 10, 14.5, 11.5],
        "text-allow-overlap": true,
        "text-ignore-placement": true,
      },
      paint: labelPaint,
    });
    map.addLayer({
      id: "veh-label-3d",
      type: "symbol",
      source: "vehicles",
      minzoom: MODEL_MINZOOM,
      layout: {
        "text-field": ["get", "code"],
        "text-font": ["Noto Sans Bold"],
        "text-size": ["interpolate", ["linear"], ["zoom"], 14.5, 11.5, 18, 14],
        "text-anchor": "bottom",
        "text-offset": [0, -1.6],
        "text-allow-overlap": true,
        "text-ignore-placement": true,
      },
      paint: labelPaint,
    });
    modelsShown = false;
    applyToggles();
    pushVehicles();
  });

  const onClick = (f) => openVehicle(f.properties.id);
  SL.clickable("veh-icon", onClick);
  SL.clickable("veh-3d", onClick);

  SL.onSelect((sel) => {
    if (map.getLayer("veh-halo")) map.setFilter("veh-halo", ["==", ["get", "id"], sel?.kind === "veh" ? sel.id : ""]);
    renderVehicleList();
  });

  // ---------------------------------------------------------------- data
  const VEHICLE_QUERY = `query($b: BoundingBox!) {
    vehicles(boundingBox: $b) {
      vehicleId
      mode
      lastUpdated
      delay
      bearing
      destinationName
      originName
      location { latitude longitude }
      line { lineRef publicCode lineName }
      serviceJourney { id }
    }
  }`;

  /** vehicleId -> { data, from, to, pos, t0, heading, authority } */
  const vehicles = (SL.vehicles = new Map());

  SL.poll(async () => {
    try {
      const data = await SL.gql(VEHICLES_URL, VEHICLE_QUERY, { b: BBOX });
      ingest(data.vehicles || []);
      setStatus("ok", `Oppdatert ${new Date().toLocaleTimeString("nb-NO")}`);
    } catch (err) {
      setStatus("error", "Sanntidskjelda er utilgjengeleg – prøver igjen");
      throw err;
    }
  }, POLL_MS, 60_000);

  function ingest(list) {
    // Same køyretøy kan liggje inne fleire gonger (éin per tur) – behald nyaste
    const latest = new Map();
    for (const v of list) {
      if (!v.location || !v.vehicleId) continue;
      const prev = latest.get(v.vehicleId);
      if (!prev || Date.parse(v.lastUpdated) > Date.parse(prev.lastUpdated)) latest.set(v.vehicleId, v);
    }
    const now = Date.now();
    for (const [id, v] of latest) if (now - Date.parse(v.lastUpdated) > MAX_AGE_MS) latest.delete(id);

    for (const id of [...vehicles.keys()]) {
      if (!latest.has(id)) {
        vehicles.delete(id);
        if (SL.isSel("veh", id)) SL.closeDetail();
      }
    }

    const t = performance.now();
    for (const [id, v] of latest) {
      const pos = [v.location.longitude, v.location.latitude];
      let entry = vehicles.get(id);
      if (!entry) {
        entry = { from: pos, to: pos, pos, t0: 0 };
        vehicles.set(id, entry);
      } else if (pos[0] !== entry.to[0] || pos[1] !== entry.to[1]) {
        entry.from = entry.pos;
        entry.to = pos;
        entry.t0 = t;
      }
      const prevJourney = entry.data?.serviceJourney?.id;
      entry.data = v;
      if (SL.isSel("veh", id)) {
        if (prevJourney !== v.serviceJourney?.id) openVehicle(id);
        else renderVehicleHeader(entry);
      }
    }
    pushVehicles();
    SL.kick();
    renderVehicleList();
  }

  const vehicleKind = (v) => (v.mode === "FERRY" ? "ferry" : "bus");
  const isVisible = (v) => (v.mode === "FERRY" ? $("t-ferry").checked : $("t-bus").checked);

  // Kurs: frå kjelda om ho har det, elles rekna ut frå rørsla
  function heading(e) {
    if (typeof e.data.bearing === "number") return (e.heading = e.data.bearing);
    const [x0, y0] = e.from, [x1, y1] = e.to;
    const dx = (x1 - x0) * Math.cos((y0 * Math.PI) / 180), dy = y1 - y0;
    if (Math.hypot(dx, dy) * 111_320 > 5) e.heading = ((Math.atan2(dx, dy) * 180) / Math.PI + 360) % 360;
    return e.heading ?? 0;
  }

  function pushVehicles() {
    const src = map.getSource("vehicles");
    if (!src) return;
    const now = Date.now();
    src.setData({
      type: "FeatureCollection",
      features: [...vehicles.entries()].map(([id, e]) => ({
        type: "Feature",
        properties: {
          id,
          kind: vehicleKind(e.data),
          code: e.data.line?.publicCode || "",
          color: SL.lineColor(e.data),
          bearing: heading(e),
          stale: now - Date.parse(e.data.lastUpdated) > STALE_MS,
        },
        geometry: { type: "Point", coordinates: e.pos },
      })),
    });
    pushModels();
  }

  let modelsShown = false;
  function pushModels() {
    const src = map.getSource("vehicles3d");
    if (!src) return;
    if (map.getZoom() < MODEL_MINZOOM - 0.3) {
      if (modelsShown) src.setData(SL.emptyFC());
      modelsShown = false;
      return;
    }
    modelsShown = true;
    const [w, s, e, n] = map.getBounds().toArray().flat();
    const pad = 0.02;
    const features = [];
    for (const [id, entry] of vehicles) {
      if (!isVisible(entry.data)) continue;
      const [lon, lat] = entry.pos;
      if (lon < w - pad || lat < s - pad || lon > e + pad || lat > n + pad) continue;
      const kind = vehicleKind(entry.data);
      const color = SL.lineColor(entry.data);
      const parts = kind === "ferry" ? ferryParts(color) : busParts(color);
      features.push(...partsToFeatures(id, entry.pos, heading(entry), modelScale(kind), parts));
    }
    src.setData({ type: "FeatureCollection", features });
  }
  let zoomTimer = null;
  map.on("zoom", () => {
    if (zoomTimer) return;
    zoomTimer = setTimeout(() => {
      zoomTimer = null;
      pushModels();
    }, 120);
  });
  map.on("moveend", pushModels);

  // Glidande overgang mellom posisjonar. setData ~12 gonger i sekundet, ikkje kvar ramme.
  const ANIM_MS = 2000;
  const FRAME_MS = 80;
  let lastPush = 0;
  SL.addAnimator((t) => {
    let busy = false;
    let done = false;
    for (const e of vehicles.values()) {
      if (!e.t0) continue;
      const k = Math.min(1, (t - e.t0) / ANIM_MS);
      const s = k < 0.5 ? 2 * k * k : 1 - (-2 * k + 2) ** 2 / 2;
      e.pos = [e.from[0] + (e.to[0] - e.from[0]) * s, e.from[1] + (e.to[1] - e.from[1]) * s];
      if (k < 1) busy = true;
      else {
        e.t0 = 0;
        done = true;
      }
    }
    if (done || (busy && t - lastPush > FRAME_MS)) {
      lastPush = t;
      pushVehicles();
    }
    return busy;
  });

  function setStatus(state, text) {
    const el = $("live-status");
    el.dataset.state = state;
    el.querySelector("span").textContent = text;
  }

  // ---------------------------------------------------------------- liste
  function renderVehicleList() {
    const list = [...vehicles.values()].map((e) => e.data);
    $("c-bus").textContent = list.filter((v) => v.mode !== "FERRY").length;
    $("c-ferry").textContent = list.filter((v) => v.mode === "FERRY").length;
    const shown = list
      .filter(isVisible)
      .sort((a, b) => (a.mode === b.mode ? 0 : a.mode === "FERRY" ? 1 : -1) || (a.line?.publicCode || "").localeCompare(b.line?.publicCode || "", "nb", { numeric: true }));

    const ul = $("vehicle-list");
    if (!shown.length) {
      ul.innerHTML = `<li class="empty">Ingen køyretøy med ferske posisjonar akkurat no.</li>`;
      return;
    }
    ul.innerHTML = shown
      .map((v) => {
        const d = SL.fmtDelay(v.delay);
        const kind = v.mode === "FERRY" ? "Ferje" : "Buss";
        return `<li><button type="button" class="row ${SL.isSel("veh", v.vehicleId) ? "active" : ""}" data-id="${esc(v.vehicleId)}"
            aria-label="${kind} ${esc(v.line?.publicCode || "")} til ${esc(v.destinationName || "ukjend mål")}${d.text ? ", " + esc(d.text) : ""}">
          <span class="badge" style="background:${SL.lineColor(v)}">${esc(v.line?.publicCode || "–")}</span>
          <span class="v-main">
            <span class="v-dest">${esc(v.destinationName || v.line?.lineName || "Ukjend mål")}</span>
            <span class="v-sub">${kind} · ${SL.fmtAgo(Date.now() - Date.parse(v.lastUpdated))}</span>
          </span>
          <span class="delay ${d.cls}">${d.text}</span>
        </button></li>`;
      })
      .join("");
  }
  $("vehicle-list").addEventListener("click", (e) => {
    const b = e.target.closest("button[data-id]");
    if (b) openVehicle(b.dataset.id, true);
  });

  // ---------------------------------------------------------------- detaljar
  const JOURNEY_QUERY = `query($id: String!) {
    serviceJourney(id: $id) {
      line { publicCode name transportMode authority { name } }
      pointsOnLink { points }
      estimatedCalls {
        quay { name }
        aimedDepartureTime
        expectedDepartureTime
        actualDepartureTime
        cancellation
      }
    }
  }`;

  async function openVehicle(id, fly = false) {
    const entry = vehicles.get(id);
    if (!entry) return;
    const v = entry.data;
    if (fly) map.flyTo({ center: entry.pos, zoom: Math.max(map.getZoom(), 13.5), duration: 1400 });
    const token = SL.openDetail("veh", id, `<div id="veh-head"></div><p class="d-section">Vidare stopp</p><p class="empty">Hentar ruta …</p>`);
    renderVehicleHeader(entry);

    const sjId = v.serviceJourney?.id;
    if (!sjId || !sjId.includes(":")) {
      SL.replaceSection(`<p class="empty">Ingen rutedata for denne turen.</p>`);
      return;
    }
    try {
      const data = await SL.gql(SL.JP_URL, JOURNEY_QUERY, { id: sjId });
      if (token !== SL.detailToken()) return;
      const sj = data.serviceJourney;
      if (!sj) throw new Error("Fann ikkje turen");
      const color = SL.lineColor(v);
      if (sj.pointsOnLink?.points) SL.setRoute([{ coords: SL.decodePolyline(sj.pointsOnLink.points), color }]);
      const now = Date.now();
      const calls = (sj.estimatedCalls || []).filter((c) => !c.actualDepartureTime && Date.parse(c.expectedDepartureTime) > now - 60_000);
      SL.replaceSection(
        calls.length
          ? `<ul class="calls" style="--line-color:${color}">${calls
              .slice(0, 14)
              .map((c) => `<li><span${c.cancellation ? ' class="cancelled"' : ""}>${esc(c.quay?.name)}</span><time>${SL.fmtTime(c.expectedDepartureTime)}</time></li>`)
              .join("")}</ul>`
          : `<p class="empty">Turen er ved endestoppet.</p>`
      );
      entry.authority = sj.line?.authority?.name || "";
      renderVehicleHeader(entry);
    } catch (err) {
      if (token !== SL.detailToken()) return;
      console.warn(err);
      SL.replaceSection(`<p class="empty">Kunne ikkje hente ruta for denne turen.</p>`);
    }
  }
  SL.openVehicle = openVehicle;

  function renderVehicleHeader(entry) {
    const head = document.getElementById("veh-head");
    if (!head) return;
    const v = entry.data;
    const d = SL.fmtDelay(v.delay);
    const kind = v.mode === "FERRY" ? "Ferje" : "Buss";
    const auth = entry.authority;
    head.innerHTML = `
      <div class="d-row"><span class="badge" style="background:${SL.lineColor(v)}">${esc(v.line?.publicCode || "–")}</span>
        <span class="delay ${d.cls}">${d.text}</span></div>
      <h3 id="detail-title">${esc(v.destinationName || "Ukjend mål")}</h3>
      <p class="d-meta">${kind} · ${esc(v.line?.lineName || "")}${v.originName ? ` · frå ${esc(v.originName)}` : ""}<br/>Sist melde ${SL.fmtAgo(Date.now() - Date.parse(v.lastUpdated))}${auth ? ` · ${esc(auth)}` : ""}</p>`;
  }

  // ---------------------------------------------------------------- brytarar
  function applyToggles() {
    const kinds = [];
    if ($("t-bus").checked) kinds.push("bus");
    if ($("t-ferry").checked) kinds.push("ferry");
    const kindFilter = ["in", ["get", "kind"], ["literal", kinds]];
    for (const id of ["veh-icon", "veh-label", "veh-label-3d"]) if (map.getLayer(id)) map.setFilter(id, kindFilter);
    pushModels();
    renderVehicleList();
  }
  for (const id of ["t-bus", "t-ferry"]) $(id).addEventListener("change", applyToggles);

  // Hald «sist melde» og dimming oppdatert mellom pollingane
  setInterval(() => {
    pushVehicles();
    renderVehicleList();
  }, 15_000);
})();
