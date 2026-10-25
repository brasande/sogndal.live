/* Sogndal.live · haldeplassar, avgangstavler, stoppsøk, ferjestatus og turmål */
(() => {
  "use strict";
  const { $, esc, map } = SL;

  const STOPS = [
    { id: "NSR:StopPlace:35169", name: "Sogndal skysstasjon", sub: "Bussterminal", icon: "🚌" },
    { id: "NSR:StopPlace:59279", name: "Sogndal lufthamn", sub: "Haukåsen · flybuss", icon: "🚌" },
    { id: "NSR:StopPlace:34147", name: "Kaupanger rv. 5", sub: "Buss", icon: "🚌" },
    { id: "NSR:StopPlace:58181", name: "Kaupanger ferjekai", sub: "Ferje og buss", icon: "⛴" },
    { id: "NSR:StopPlace:58180", name: "Mannheller ferjekai", sub: "Ferje til Fodnes", icon: "⛴" },
    { id: "NSR:StopPlace:58457", name: "Leikanger kai", sub: "Buss og båt", icon: "⚓" },
    { id: "NSR:StopPlace:36056", name: "Hafslo", sub: "Luster · buss", icon: "🚌" },
    { id: "NSR:StopPlace:58330", name: "Solvorn ferjekai", sub: "Ferje til Ornes", icon: "⛴" },
  ];

  const PLACES = [
    { name: "Sogndal sentrum", sub: "Byen ved Sogndalsfjorden", c: [7.101, 61.229], zoom: 14.6, pitch: 62, bearing: -20 },
    { name: "Campus Fosshaugane", sub: "Høgskulen på Vestlandet", c: [7.113, 61.2295], zoom: 15.2, pitch: 60, bearing: 40 },
    { name: "Sogndal lufthamn", sub: "Haukåsen, 497 moh.", c: [7.1378, 61.1561], zoom: 13.4, pitch: 60, bearing: 120 },
    { name: "Kaupanger", sub: "Stavkyrkje og ferjekai", c: [7.233, 61.188], zoom: 13.6, pitch: 60, bearing: -10 },
    { name: "Urnes stavkyrkje", sub: "UNESCO verdsarv · Luster", c: [7.3239, 61.2983], zoom: 13.8, pitch: 62, bearing: 200 },
    { name: "Leikanger", sub: "Fylkesbyen ved Sognefjorden", c: [6.81, 61.184], zoom: 13.2, pitch: 58, bearing: 10 },
    { name: "Fjærland", sub: "Bokbyen og Bøyabreen", c: [6.758, 61.43], zoom: 11.8, pitch: 66, bearing: 0 },
    { name: "Sognefjellet", sub: "Rv. 55, 1434 moh.", c: [7.99, 61.565], zoom: 11.5, pitch: 62, bearing: 30 },
    { name: "Sognefjorden", sub: "Oversikt over indre Sogn", c: [7.05, 61.17], zoom: 9.6, pitch: 55, bearing: -15 },
  ];

  // Ferjesambanda rundt Sogndal: kai -> destinasjonar vi viser
  const FERRIES = [
    { id: "NSR:StopPlace:58180", name: "Mannheller" },
    { id: "NSR:StopPlace:58179", name: "Fodnes" },
    { id: "NSR:StopPlace:58324", name: "Hella" },
    { id: "NSR:StopPlace:58339", name: "Vangsnes" },
    { id: "NSR:StopPlace:58344", name: "Dragsvik" },
  ];

  // ---------------------------------------------------------------- kartlag
  let stopsData = SL.emptyFC();
  SL.onStyle(() => {
    const c = SL.themeColors();
    map.addSource("stops", { type: "geojson", data: stopsData });
    map.addLayer({
      id: "stops-circle",
      type: "circle",
      source: "stops",
      paint: {
        "circle-radius": ["interpolate", ["linear"], ["zoom"], 9, 3, 14, 7],
        "circle-color": c.stopFill,
        "circle-stroke-color": c.accent,
        "circle-stroke-width": ["interpolate", ["linear"], ["zoom"], 9, 1.5, 14, 3],
        "circle-pitch-alignment": "map",
      },
    });
    map.addLayer({
      id: "stops-label",
      type: "symbol",
      source: "stops",
      minzoom: 11,
      layout: {
        "text-field": ["get", "name"],
        "text-font": ["Noto Sans Bold"],
        "text-size": 12,
        "text-offset": [0, 1.1],
        "text-anchor": "top",
      },
      paint: { "text-color": c.text, "text-halo-color": c.halo, "text-halo-width": 1.6 },
    });
    applyStopToggle();
  });
  SL.clickable("stops-circle", (f) => {
    const stop = STOPS.find((s) => s.id === f.properties.id);
    if (stop) openStop(stop);
  });

  function refreshStopsSource() {
    stopsData = {
      type: "FeatureCollection",
      features: STOPS.filter((s) => s.coord).map((s) => ({
        type: "Feature",
        properties: { id: s.id, name: s.name },
        geometry: { type: "Point", coordinates: s.coord },
      })),
    };
    map.getSource("stops")?.setData(stopsData);
  }

  async function loadStopCoords() {
    const q = `query($ids: [String]!) { stopPlaces(ids: $ids) { id latitude longitude } }`;
    try {
      const data = await SL.gql(SL.JP_URL, q, { ids: STOPS.map((s) => s.id) });
      for (const sp of data.stopPlaces || []) {
        const s = STOPS.find((x) => x.id === sp.id);
        if (s && sp.latitude) s.coord = [sp.longitude, sp.latitude];
      }
      refreshStopsSource();
    } catch (err) {
      console.warn("Kunne ikkje hente haldeplassar", err);
    }
  }
  loadStopCoords();

  function applyStopToggle() {
    const vis = $("t-stops").checked ? "visible" : "none";
    for (const id of ["stops-circle", "stops-label"]) if (map.getLayer(id)) map.setLayoutProperty(id, "visibility", vis);
  }
  $("t-stops").addEventListener("change", applyStopToggle);

  // ---------------------------------------------------------------- avgangstavle
  const DEPARTURES_QUERY = `query($id: String!, $modes: [TransportMode], $n: Int) {
    stopPlace(id: $id) {
      name
      latitude
      longitude
      estimatedCalls(numberOfDepartures: $n, timeRange: 43200, whiteListedModes: $modes) {
        realtime
        cancellation
        aimedDepartureTime
        expectedDepartureTime
        destinationDisplay { frontText }
        serviceJourney { line { publicCode transportMode } }
      }
      situations { summary { value language } }
    }
  }`;

  let stopTimer = null;
  SL.onDetailClose(() => clearTimeout(stopTimer));

  async function openStop(stop, fly = false) {
    if (fly && stop.coord) map.flyTo({ center: stop.coord, zoom: 14.5, pitch: 55, duration: 1600 });
    const token = SL.openDetail(
      "stop",
      stop.id,
      `<p class="eyebrow">${esc(stop.sub)}</p><h3 id="detail-title">${esc(stop.name)}</h3><p class="d-section">Neste avgangar</p><p class="empty">Hentar avgangar …</p>`
    );
    const load = async () => {
      try {
        const data = await SL.gql(SL.JP_URL, DEPARTURES_QUERY, { id: stop.id, n: 12 });
        if (token !== SL.detailToken()) return;
        const sp = data.stopPlace;
        const calls = sp?.estimatedCalls || [];
        const sits = (sp?.situations || [])
          .map((s) => (s.summary || []).find((x) => ["no", "nob", "nn"].includes(x.language)) || s.summary?.[0])
          .filter(Boolean);
        let html = calls.length
          ? `<ul class="deps">${calls
              .map((c) => {
                const code = c.serviceJourney?.line?.publicCode || "";
                const mode = c.serviceJourney?.line?.transportMode;
                const late = Math.round((Date.parse(c.expectedDepartureTime) - Date.parse(c.aimedDepartureTime)) / 60000);
                return `<li>
                  <span class="badge" style="background:${SL.colorForCode(code, mode)}">${esc(code || "–")}</span>
                  <span class="dep-dest ${c.cancellation ? "cancelled" : ""}">${esc(c.destinationDisplay?.frontText)}</span>
                  <time title="Rutetid ${SL.fmtTime(c.aimedDepartureTime)}"><b>${SL.minutesUntil(c.expectedDepartureTime)}</b>${
                    late >= 2 ? ` <span class="delay late">(+${late})</span>` : ""
                  }${c.realtime ? "" : ' <span aria-label="rutetid utan sanntid">·</span>'}</time>
                </li>`;
              })
              .join("")}</ul><p class="fine">· = rutetid utan sanntid</p>`
          : `<p class="empty">Ingen avgangar dei neste 12 timane.</p>`;
        if (sits.length) html += `<p class="d-section-2">Driftsmeldingar</p>${sits.map((s) => `<p class="fine">${esc(s.value)}</p>`).join("")}`;
        SL.replaceSection(html);
        if (!stop.coord && sp?.latitude) {
          stop.coord = [sp.longitude, sp.latitude];
          if (fly) map.flyTo({ center: stop.coord, zoom: 14.5, pitch: 55, duration: 1600 });
        }
        stopTimer = setTimeout(() => token === SL.detailToken() && load(), 30_000);
      } catch (err) {
        if (token !== SL.detailToken()) return;
        console.warn(err);
        SL.replaceSection(`<p class="empty">Kunne ikkje hente avgangar akkurat no.</p>`);
      }
    };
    load();
  }
  SL.openStop = openStop;

  // ---------------------------------------------------------------- stoppliste og søk
  function renderStopList() {
    $("stop-list").innerHTML = STOPS.map(
      (s, i) => `<li><button type="button" class="row" data-i="${i}">
        <span class="s-icon" aria-hidden="true">${s.icon}</span>
        <span class="s-main"><span class="s-name">${esc(s.name)}</span><span class="s-sub">${esc(s.sub)}</span></span>
      </button></li>`
    ).join("");
  }
  renderStopList();
  $("stop-list").addEventListener("click", (e) => {
    const b = e.target.closest("button[data-i]");
    if (b) openStop(STOPS[+b.dataset.i], true);
  });

  let searchResults = [];
  const runSearch = SL.debounce(async (text) => {
    const ul = $("stop-results");
    if (text.trim().length < 2) {
      ul.innerHTML = "";
      ul.hidden = true;
      return;
    }
    try {
      const results = (await SL.geocode(text, "venue")).filter((r) => r.id?.startsWith("NSR:StopPlace") && SL.distanceKm(r.coord, [SL.FOCUS.lon, SL.FOCUS.lat]) < 200);
      searchResults = results;
      ul.hidden = false;
      ul.innerHTML = results.length
        ? results
            .map(
              (r, i) => `<li><button type="button" class="row" data-r="${i}">
                <span class="s-icon" aria-hidden="true">${r.category.some((c) => /ferry|harbour/i.test(c)) ? "⛴" : r.category.includes("airport") ? "✈" : "🚏"}</span>
                <span class="s-main"><span class="s-name">${esc(r.name)}</span><span class="s-sub">${esc(r.locality)}</span></span>
              </button></li>`
            )
            .join("")
        : `<li class="empty">Fann ingen haldeplassar.</li>`;
    } catch (err) {
      console.warn(err);
      ul.hidden = false;
      ul.innerHTML = `<li class="empty">Søket er ikkje tilgjengeleg akkurat no.</li>`;
    }
  }, 250);
  $("stop-search").addEventListener("input", (e) => runSearch(e.target.value));
  $("stop-results").addEventListener("click", (e) => {
    const b = e.target.closest("button[data-r]");
    if (!b) return;
    const r = searchResults[+b.dataset.r];
    let stop = STOPS.find((s) => s.id === r.id);
    if (!stop) {
      stop = { id: r.id, name: r.name, sub: r.locality, icon: "🚏", coord: r.coord };
      STOPS.push(stop);
      renderStopList();
      refreshStopsSource();
    }
    $("stop-search").value = "";
    $("stop-results").hidden = true;
    openStop(stop, true);
  });

  // ---------------------------------------------------------------- ferjer no
  async function loadFerries() {
    const results = await Promise.all(
      FERRIES.map((f) =>
        SL.gql(SL.JP_URL, DEPARTURES_QUERY, { id: f.id, modes: ["water"], n: 3 })
          .then((d) => ({ ...f, calls: d.stopPlace?.estimatedCalls || [] }))
          .catch(() => ({ ...f, calls: null }))
      )
    );
    if (results.every((r) => r.calls === null)) throw new Error("Ferjeavgangar utilgjengelege");
    $("ferry-list").innerHTML = results
      .map((f) => {
        if (!f.calls) return `<li class="ferry-row"><span class="ferry-from">${esc(f.name)}</span><span class="empty">ikkje tilgjengeleg</span></li>`;
        const next = f.calls.slice(0, 2);
        const dest = next[0]?.destinationDisplay?.frontText || "";
        return `<li><button type="button" class="row ferry-row" data-id="${f.id}" aria-label="Ferje frå ${esc(f.name)}${dest ? " til " + esc(dest) : ""}: ${next.map((c) => SL.fmtTime(c.expectedDepartureTime)).join(" og ") || "ingen avgangar"}">
          <span class="ferry-from">${esc(f.name)}<small>${dest ? "→ " + esc(dest) : ""}</small></span>
          <span class="ferry-times">${
            next.length
              ? next
                  .map((c, i) => {
                    const late = Math.round((Date.parse(c.expectedDepartureTime) - Date.parse(c.aimedDepartureTime)) / 60000);
                    return `<time class="${i === 0 ? "next" : ""} ${c.cancellation ? "cancelled" : ""}">${SL.fmtTime(c.expectedDepartureTime)}${late >= 3 ? `<span class="delay late"> +${late}</span>` : ""}</time>`;
                  })
                  .join("")
              : '<span class="empty">ingen i dag</span>'
          }</span>
        </button></li>`;
      })
      .join("");
  }
  SL.poll(loadFerries, 60_000);
  $("ferry-list").addEventListener("click", (e) => {
    const b = e.target.closest("button[data-id]");
    if (!b) return;
    const f = FERRIES.find((x) => x.id === b.dataset.id);
    openStop({ id: f.id, name: `${f.name} ferjekai`, sub: "Ferjekai", icon: "⛴" }, true);
  });

  // ---------------------------------------------------------------- turmål
  $("place-list").innerHTML = PLACES.map(
    (p, i) => `<li><button type="button" class="row" data-i="${i}"><span class="p-icon" aria-hidden="true">◎</span><span class="p-main">${esc(p.name)}<small>${esc(p.sub)}</small></span></button></li>`
  ).join("");
  $("place-list").addEventListener("click", (e) => {
    const b = e.target.closest("button[data-i]");
    if (!b) return;
    const p = PLACES[+b.dataset.i];
    SL.collapsePanelOnMobile();
    map.flyTo({ center: p.c, zoom: p.zoom, pitch: p.pitch, bearing: p.bearing, duration: 2600, essential: true });
  });
})();
