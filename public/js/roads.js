/* Sogndal.live · vegmeldingar, fjelloverganger og vegkamera
 * Trafikkmeldingar: Statens vegvesen via Allemannsdata (get_traffic_messages)
 * Kamerabilete: Statens vegvesen (kamera.atlas.vegvesen.no). Lista under er handplukka;
 * nye kamera kan leggjast til med id frå https://www.vegvesen.no/trafikk.
 */
(() => {
  "use strict";
  const { $, esc, map } = SL;

  const MESSAGES_URL =
    "/ad/vegvesen/get_traffic_messages?lat=61.2&lon=7.4&radius_km=120&limit=100";

  // Fjelloverganger i og rundt Sogn. road = vegnummer slik Vegvesenet skriv det, c = omtrentleg midtpunkt.
  const PASSES = [
    { id: "sognefjellet", name: "Sognefjellet", road: "R55", label: "Rv. 55", c: [7.99, 61.565], r: 30 },
    { id: "gaularfjellet", name: "Gaularfjellet", road: "R13", label: "Rv. 13", c: [6.28, 61.36], r: 22 },
    { id: "vikafjellet", name: "Vikafjellet", road: "R13", label: "Rv. 13", c: [6.55, 60.94], r: 22 },
    { id: "aurlandsfjellet", name: "Aurlandsfjellet (Snøvegen)", road: "F243", label: "Fv. 243", c: [7.33, 60.92], r: 25 },
    { id: "hemsedalsfjellet", name: "Hemsedalsfjellet", road: "R52", label: "Rv. 52", c: [8.25, 61.06], r: 30 },
    { id: "filefjell", name: "Filefjell", road: "E16", label: "E16", c: [8.25, 61.15], r: 25 },
  ];

  // Vegkamera (id frå Vegvesenet). Koordinatane er omtrentlege, henta frå stadnamn/NVDB.
  const WEBCAMS = [
    { id: "1429034", name: "Kaupanger", road: "Rv. 5", c: [7.2177, 61.1969] },
    { id: "1429028", name: "Mannheller ferjekai", road: "Rv. 5", c: [7.3368, 61.1604] },
    { id: "1429026", name: "Fodnestunnelen vest", road: "Rv. 5", c: [7.392, 61.1497] },
    { id: "1429004", name: "Frudalen", road: "Rv. 5", c: [6.8761, 61.3472] },
    { id: "1429035", name: "Berge", road: "Rv. 5", c: [6.7552, 61.3804] },
    { id: "1429006", name: "Bøyadalen", road: "Rv. 5", c: [6.7387, 61.4594] },
    { id: "1429005", name: "Lundebotn", road: "Rv. 5", c: [6.6574, 61.515] },
    { id: "1429038", name: "Fatlaberget", road: "Rv. 13", c: [6.9023, 61.1754] },
    { id: "1429039", name: "Hella ferjekai", road: "Rv. 13", c: [6.598, 61.2074] },
    { id: "1429036", name: "Vangsnes ferjekai", road: "Rv. 13", c: [6.6372, 61.1749] },
    { id: "1429040", name: "Dragsvik", road: "Fv. 613", c: [6.5649, 61.2151] },
    { id: "1429013", name: "Brennborg, Årdal", road: "Fv. 53", c: [7.7645, 61.2722] },
    { id: "1429011", name: "Borgund", road: "E16", c: [7.8476, 61.0795] },
    { id: "1429016", name: "Honing bru, Filefjell", road: "E16", c: [8.009, 61.1018] },
    { id: "1429021", name: "Langhuso", road: "E16", c: [7.0552, 60.8934] },
    { id: "1429020", name: "Flåm", road: "E16", c: [7.1151, 60.8616] },
  ];
  const camUrl = (id, bust = true) => `https://kamera.atlas.vegvesen.no/api/images/${id}_1${bust ? `?t=${Math.floor(Date.now() / 60_000)}` : ""}`;

  // ---------------------------------------------------------------- ikon
  SL.iconFactories.cam = (color) => {
    const c = document.createElement("canvas");
    c.width = c.height = 40;
    const ctx = c.getContext("2d");
    ctx.beginPath();
    ctx.arc(20, 20, 17, 0, Math.PI * 2);
    ctx.fillStyle = "#fff";
    ctx.fill();
    ctx.beginPath();
    ctx.arc(20, 20, 14.5, 0, Math.PI * 2);
    ctx.fillStyle = color;
    ctx.fill();
    ctx.fillStyle = "#fff";
    ctx.beginPath();
    ctx.roundRect ? ctx.roundRect(9, 14, 16, 12, 2.5) : ctx.rect(9, 14, 16, 12);
    ctx.fill();
    ctx.beginPath();
    ctx.moveTo(25, 18);
    ctx.lineTo(31, 14.5);
    ctx.lineTo(31, 25.5);
    ctx.lineTo(25, 22);
    ctx.closePath();
    ctx.fill();
    return { width: 40, height: 40, data: ctx.getImageData(0, 0, 40, 40).data };
  };
  SL.iconFactories.warn = (color) => {
    const c = document.createElement("canvas");
    c.width = c.height = 40;
    const ctx = c.getContext("2d");
    ctx.lineJoin = "round";
    ctx.beginPath();
    ctx.moveTo(20, 3);
    ctx.lineTo(37, 34);
    ctx.lineTo(3, 34);
    ctx.closePath();
    ctx.fillStyle = "#fff";
    ctx.strokeStyle = "#fff";
    ctx.lineWidth = 4;
    ctx.stroke();
    ctx.fill();
    ctx.beginPath();
    ctx.moveTo(20, 7);
    ctx.lineTo(34, 32);
    ctx.lineTo(6, 32);
    ctx.closePath();
    ctx.fillStyle = color;
    ctx.fill();
    ctx.fillStyle = "#fff";
    ctx.font = "bold 18px sans-serif";
    ctx.textAlign = "center";
    ctx.fillText("!", 20, 29);
    return { width: 40, height: 40, data: ctx.getImageData(0, 0, 40, 40).data };
  };

  const SEVERITY_COLOR = { closed: "#b8402f", convoy: "#c07a12", info: "#d4a017" };

  // ---------------------------------------------------------------- klassifisering
  function classify(m) {
    const text = `${m.description || ""} ${(m.sub_types || []).join(" ")}`;
    if (/kolonne/i.test(text)) return { level: "convoy", text: "Kolonnekøyring" };
    const closed = (m.sub_types || []).includes("roadClosed") || /vegen er stengt|veien er stengt|stengt for all trafikk/i.test(text);
    if (closed && !/korte perioder|korte periodar|gjennomslipp|kortvarig/i.test(text)) return { level: "closed", text: "Stengt" };
    if (closed) return { level: "convoy", text: "Periodevis stengt" };
    return { level: "info", text: "Merknad" };
  }
  const RANK = { closed: 3, convoy: 2, info: 1, open: 0 };

  // ---------------------------------------------------------------- kartlag
  let messages = [];
  let msgData = SL.emptyFC();
  const camData = {
    type: "FeatureCollection",
    features: WEBCAMS.map((w) => ({ type: "Feature", properties: { id: w.id, name: w.name }, geometry: { type: "Point", coordinates: w.c } })),
  };

  SL.onStyle(() => {
    const c = SL.themeColors();
    map.addSource("road-msgs", { type: "geojson", data: msgData });
    map.addSource("webcams", { type: "geojson", data: camData });
    map.addLayer({
      id: "webcam-icon",
      type: "symbol",
      source: "webcams",
      minzoom: 8,
      layout: {
        "icon-image": `cam-${SL.theme === "dark" ? "#3f7f8c" : "#1f5f6b"}`,
        "icon-size": ["interpolate", ["linear"], ["zoom"], 8, 0.5, 12, 0.75, 15, 0.9],
        "icon-allow-overlap": true,
        "text-field": ["get", "name"],
        "text-font": ["Noto Sans Bold"],
        "text-size": 11,
        "text-offset": [0, 1.3],
        "text-anchor": "top",
        "text-optional": true,
      },
      paint: { "text-color": c.text, "text-halo-color": c.halo, "text-halo-width": 1.5, "text-opacity": ["step", ["zoom"], 0, 11.5, 1] },
    });
    map.addLayer({
      id: "road-msg-icon",
      type: "symbol",
      source: "road-msgs",
      layout: {
        "icon-image": ["concat", "warn-", ["get", "color"]],
        "icon-size": ["interpolate", ["linear"], ["zoom"], 7, 0.5, 11, 0.75, 15, 0.9],
        "icon-allow-overlap": true,
        "symbol-sort-key": ["get", "rank"],
      },
    });
    applyToggles();
  });
  SL.clickable("webcam-icon", (f) => openCam(f.properties.id));
  SL.clickable("road-msg-icon", (f) => openMessage(f.properties.id));

  function applyToggles() {
    if (map.getLayer("webcam-icon")) map.setLayoutProperty("webcam-icon", "visibility", $("t-cams").checked ? "visible" : "none");
    if (map.getLayer("road-msg-icon")) map.setLayoutProperty("road-msg-icon", "visibility", $("t-roads").checked ? "visible" : "none");
  }
  $("t-cams").addEventListener("change", applyToggles);
  $("t-roads").addEventListener("change", applyToggles);

  // ---------------------------------------------------------------- data
  SL.poll(async () => {
    try {
      const res = await fetch(MESSAGES_URL);
      if (!res.ok) throw new Error(`vegmeldingar HTTP ${res.status}`);
      const json = await res.json();
      messages = (json.data?.messages || [])
        .filter((m) => m.active !== false && typeof m.lat === "number")
        .map((m) => ({ ...m, cls: classify(m) }));
      msgData = {
        type: "FeatureCollection",
        features: messages.map((m) => ({
          type: "Feature",
          properties: { id: m.situation_id, color: SEVERITY_COLOR[m.cls.level], rank: RANK[m.cls.level] },
          geometry: { type: "Point", coordinates: [m.lon, m.lat] },
        })),
      };
      map.getSource("road-msgs")?.setData(msgData);
      $("roads-updated").textContent = `Oppdatert ${new Date().toLocaleTimeString("nb-NO", { hour: "2-digit", minute: "2-digit" })}`;
      renderPasses();
      renderMessages();
    } catch (err) {
      if (!messages.length) {
        $("pass-list").innerHTML = `<li class="empty">Vegstatus er ikkje tilgjengeleg akkurat no.</li>`;
        $("roads-updated").textContent = "";
      }
      throw err;
    }
  }, 5 * 60_000);

  function passStatus(p) {
    const hits = messages.filter((m) => m.road === p.road && SL.distanceKm([m.lon, m.lat], p.c) <= p.r);
    const worst = hits.reduce((acc, m) => (RANK[m.cls.level] > RANK[acc.level] ? m.cls : acc), { level: "open", text: "Ingen meldingar" });
    return { ...worst, hits };
  }

  function renderPasses() {
    $("pass-list").innerHTML = PASSES.map((p) => {
      const s = passStatus(p);
      return `<li><button type="button" class="row" data-pass="${p.id}" aria-label="${esc(p.name)}, ${esc(p.label)}: ${esc(s.text)}">
        <span class="pass-dot ${s.level}" aria-hidden="true"></span>
        <span class="s-main"><span class="s-name">${esc(p.name)}</span><span class="s-sub">${esc(p.label)}</span></span>
        <span class="pass-status ${s.level}">${esc(s.text)}</span>
      </button></li>`;
    }).join("");
  }
  function renderMessages() {
    const local = messages.filter((m) => SL.distanceKm([m.lon, m.lat], [7.2, 61.2]) < 90).sort((a, b) => RANK[b.cls.level] - RANK[a.cls.level]);
    $("c-roads").textContent = local.length;
    $("msg-list").innerHTML = local.length
      ? local
          .slice(0, 12)
          .map(
            (m) => `<li><button type="button" class="row" data-msg="${esc(m.situation_id)}">
              <span class="pass-dot ${m.cls.level}" aria-hidden="true"></span>
              <span class="s-main"><span class="s-name">${esc(roadLabel(m.road))} · ${esc(shortLocation(m.location))}</span><span class="s-sub">${esc(m.cls.text)}</span></span>
            </button></li>`
          )
          .join("")
      : `<li class="empty">Ingen aktive vegmeldingar i Sogn.</li>`;
  }
  const roadLabel = (r) => (r || "").replace(/^R(\d)/, "Rv. $1").replace(/^F(\d)/, "Fv. $1").replace(/^K(\d)/, "Kv. $1");
  const shortLocation = (loc) => (loc || "").split(" - ")[0].replace(/^(E\d+|Rv\. \d+|Fv\. \d+)\s*/, "").split(",")[0];

  $("pass-list").addEventListener("click", (e) => {
    const b = e.target.closest("button[data-pass]");
    if (b) openPass(PASSES.find((p) => p.id === b.dataset.pass));
  });
  $("msg-list").addEventListener("click", (e) => {
    const b = e.target.closest("button[data-msg]");
    if (b) openMessage(b.dataset.msg, true);
  });

  // ---------------------------------------------------------------- detaljar
  const messageHtml = (m) => `
    <li class="msg">
      <span class="pass-status ${m.cls.level}">${esc(m.cls.text)}</span>
      <strong>${esc(m.location)}</strong>
      <p>${esc(m.description)}</p>
      ${m.end_time ? `<p class="fine">Gjeld til ${new Date(m.end_time).toLocaleString("nb-NO", { dateStyle: "medium", timeStyle: "short" })}</p>` : ""}
    </li>`;

  function openPass(p) {
    const s = passStatus(p);
    map.flyTo({ center: p.c, zoom: 10.5, pitch: 55, duration: 1800 });
    const cams = WEBCAMS.filter((w) => SL.distanceKm(w.c, p.c) <= p.r);
    SL.openDetail(
      "pass",
      p.id,
      `<p class="eyebrow">${esc(p.label)} · fjellovergang</p>
       <h3 id="detail-title">${esc(p.name)}</h3>
       <p class="d-meta"><span class="pass-status ${s.level}">${esc(s.text)}</span></p>
       <p class="d-section">Meldingar</p>
       ${s.hits.length ? `<ul class="msgs">${s.hits.map(messageHtml).join("")}</ul>` : `<p class="empty">Vegvesenet har ingen aktive meldingar for ${esc(p.name)} no.</p>`}
       ${cams.length ? `<p class="d-section-2">Vegkamera i nærleiken</p>${cams.map(camFigure).join("")}` : ""}
       <p class="fine">Ingen melding betyr ikkje at vegen er garantert open. Sjekk alltid <a href="https://www.vegvesen.no/trafikk/" target="_blank" rel="noopener">vegvesen.no/trafikk</a> eller ring 175 før du køyrer over fjellet.</p>`
    );
  }

  function openMessage(id, fly = false) {
    const m = messages.find((x) => x.situation_id === id);
    if (!m) return;
    if (fly) map.flyTo({ center: [m.lon, m.lat], zoom: 12, duration: 1600 });
    SL.openDetail(
      "msg",
      id,
      `<p class="eyebrow">${esc(roadLabel(m.road))} · vegmelding</p>
       <h3 id="detail-title">${esc(shortLocation(m.location))}</h3>
       <p class="d-section">Melding frå Statens vegvesen</p>
       <ul class="msgs">${messageHtml(m)}</ul>
       <p class="fine">Sist oppdatert ${new Date(m.last_update).toLocaleString("nb-NO", { dateStyle: "medium", timeStyle: "short" })}.</p>`
    );
  }

  const camFigure = (w) => `
    <figure class="cam">
      <a href="${camUrl(w.id, false)}" target="_blank" rel="noopener" aria-label="Opne biletet frå ${esc(w.name)} i full storleik">
        <img src="${camUrl(w.id)}" alt="Vegkamera ${esc(w.road)} ${esc(w.name)}" loading="lazy" width="640" height="360" />
      </a>
      <figcaption>${esc(w.road)} ${esc(w.name)}</figcaption>
    </figure>`;

  let camTimer = null;
  SL.onDetailClose(() => clearInterval(camTimer));

  function openCam(id, fly = false) {
    const w = WEBCAMS.find((x) => x.id === id);
    if (!w) return;
    if (fly) map.flyTo({ center: w.c, zoom: 13, duration: 1600 });
    SL.openDetail(
      "cam",
      id,
      `<p class="eyebrow">${esc(w.road)} · vegkamera</p>
       <h3 id="detail-title">${esc(w.name)}</h3>
       <p class="d-section">Bilete no</p>
       ${camFigure(w)}
       <p class="fine">Biletet vert oppdatert kvart minutt. Kjelde: Statens vegvesen.</p>`
    );
    // Hent nytt bilete kvart minutt medan kortet er ope
    camTimer = setInterval(() => {
      const img = document.querySelector("#detail-body .cam img");
      if (img) img.src = camUrl(w.id);
    }, 60_000);
  }

  $("cam-list").innerHTML = WEBCAMS.map(
    (w) => `<li><button type="button" class="row" data-cam="${w.id}"><span class="s-icon" aria-hidden="true">📷</span>
      <span class="s-main"><span class="s-name">${esc(w.name)}</span><span class="s-sub">${esc(w.road)}</span></span></button></li>`
  ).join("");
  $("cam-list").addEventListener("click", (e) => {
    const b = e.target.closest("button[data-cam]");
    if (b) openCam(b.dataset.cam, true);
  });
})();
