/* Sogndal.live · reiseplanleggar (Entur Journey Planner v3, trip) */
(() => {
  "use strict";
  const { $, esc, map } = SL;

  const TRIP_QUERY = `query($from: Location!, $to: Location!, $dt: DateTime, $arriveBy: Boolean) {
    trip(from: $from, to: $to, dateTime: $dt, arriveBy: $arriveBy, numTripPatterns: 5, searchWindow: 720) {
      routingErrors { code description }
      tripPatterns {
        expectedStartTime
        expectedEndTime
        duration
        walkDistance
        legs {
          mode
          distance
          realtime
          expectedStartTime
          expectedEndTime
          aimedStartTime
          fromPlace { name }
          toPlace { name }
          line { publicCode name transportMode }
          fromEstimatedCall { destinationDisplay { frontText } cancellation }
          pointsOnLink { points }
        }
      }
    }
  }`;

  const MODE_NAME = { foot: "Gå", bus: "Buss", coach: "Ekspressbuss", water: "Båt", air: "Fly", rail: "Tog", tram: "Trikk", metro: "T-bane" };
  const MODE_ICON = { foot: "🚶", bus: "🚌", coach: "🚌", water: "⛴", air: "✈", rail: "🚆" };

  /** Valde stader: { name, place?, coord? } */
  const chosen = { from: null, to: null };
  let suggestions = { from: [], to: [] };
  let patterns = [];

  // ---------------------------------------------------------------- autoutfylling
  for (const which of ["from", "to"]) {
    const input = $(`trip-${which}`);
    const list = $(`trip-${which}-list`);
    const search = SL.debounce(async (text) => {
      if (text.trim().length < 2) {
        list.hidden = true;
        return;
      }
      try {
        const res = await SL.geocode(text, "venue,address");
        suggestions[which] = res.filter((r) => SL.distanceKm(r.coord, [SL.FOCUS.lon, SL.FOCUS.lat]) < 400);
        list.innerHTML = suggestions[which].length
          ? suggestions[which]
              .map((r, i) => `<li role="option" id="trip-${which}-opt-${i}"><button type="button" class="row" data-i="${i}" tabindex="-1">
                  <span class="s-main"><span class="s-name">${esc(r.name)}</span><span class="s-sub">${esc(r.locality)}</span></span></button></li>`)
              .join("")
          : `<li class="empty">Ingen treff.</li>`;
        list.hidden = false;
        input.setAttribute("aria-expanded", "true");
      } catch (err) {
        console.warn(err);
      }
    }, 250);
    input.addEventListener("input", (e) => {
      chosen[which] = null;
      search(e.target.value);
    });
    input.addEventListener("keydown", (e) => {
      if (e.key === "ArrowDown" && !list.hidden) {
        e.preventDefault();
        list.querySelector("button")?.focus();
      } else if (e.key === "Enter" && suggestions[which].length && !chosen[which]) {
        e.preventDefault();
        pick(which, 0);
      }
    });
    list.addEventListener("keydown", (e) => {
      const items = [...list.querySelectorAll("button")];
      const i = items.indexOf(document.activeElement);
      if (e.key === "ArrowDown") items[Math.min(items.length - 1, i + 1)]?.focus();
      else if (e.key === "ArrowUp") (i <= 0 ? input : items[i - 1]).focus();
      else if (e.key === "Escape") {
        list.hidden = true;
        input.focus();
      } else return;
      e.preventDefault();
    });
    list.addEventListener("click", (e) => {
      const b = e.target.closest("button[data-i]");
      if (b) pick(which, +b.dataset.i);
    });
  }

  function pick(which, i) {
    const r = suggestions[which][i];
    if (!r) return;
    chosen[which] = r.id?.startsWith("NSR:") ? { name: r.name, place: r.id, coord: r.coord } : { name: r.name, coord: r.coord };
    $(`trip-${which}`).value = r.name;
    $(`trip-${which}-list`).hidden = true;
    $(`trip-${which}`).setAttribute("aria-expanded", "false");
    (which === "from" ? $("trip-to") : $("trip-go")).focus();
  }

  $("trip-here").addEventListener("click", () => {
    if (!navigator.geolocation) return;
    $("trip-from").value = "Hentar posisjon …";
    navigator.geolocation.getCurrentPosition(
      (pos) => {
        chosen.from = { name: "Min posisjon", coord: [pos.coords.longitude, pos.coords.latitude] };
        $("trip-from").value = "Min posisjon";
      },
      () => {
        $("trip-from").value = "";
        $("trip-from").placeholder = "Fekk ikkje tilgang til posisjon";
      },
      { enableHighAccuracy: true, timeout: 10_000 }
    );
  });
  $("trip-swap").addEventListener("click", () => {
    [chosen.from, chosen.to] = [chosen.to, chosen.from];
    [$("trip-from").value, $("trip-to").value] = [$("trip-to").value, $("trip-from").value];
  });

  // ---------------------------------------------------------------- søk
  const toLocation = (p) =>
    p.place ? { place: p.place, name: p.name } : { coordinates: { latitude: p.coord[1], longitude: p.coord[0] }, name: p.name };

  $("trip-form").addEventListener("submit", async (e) => {
    e.preventDefault();
    if (!chosen.from || !chosen.to) {
      $("trip-msg").textContent = "Vel både frå og til frå forslagslista.";
      return;
    }
    $("trip-msg").textContent = "";
    const when = $("trip-when").value; // datetime-local
    const token = SL.openDetail(
      "trip",
      "search",
      `<p class="eyebrow">Reiseforslag</p><h3 id="detail-title">${esc(chosen.from.name)} → ${esc(chosen.to.name)}</h3><p class="d-section">Forslag</p><p class="empty">Søkjer …</p>`
    );
    try {
      const data = await SL.gql(SL.JP_URL, TRIP_QUERY, {
        from: toLocation(chosen.from),
        to: toLocation(chosen.to),
        dt: when ? new Date(when).toISOString() : null,
        arriveBy: $("trip-arrive").checked,
      });
      if (token !== SL.detailToken()) return;
      patterns = (data.trip?.tripPatterns || []).filter((p) => p.legs.some((l) => l.mode !== "foot") || p.legs.length === 1);
      SL.replaceSection(
        patterns.length
          ? `<ul class="trips">${patterns.map(patternHtml).join("")}</ul><p class="fine">Trykk på eit forslag for å sjå ruta på kartet.</p>`
          : `<p class="empty">Fann ingen reiser dei neste 12 timane. Prøv eit anna tidspunkt.</p>`
      );
      if (patterns.length) showPattern(0);
    } catch (err) {
      if (token !== SL.detailToken()) return;
      console.warn(err);
      SL.replaceSection(`<p class="empty">Reisesøket er ikkje tilgjengeleg akkurat no.</p>`);
    }
  });

  function patternHtml(p, i) {
    const legs = p.legs
      .filter((l) => l.mode !== "foot" || l.distance > 150)
      .map((l) =>
        l.mode === "foot"
          ? `<span class="leg foot" title="Gå ${Math.round(l.distance)} m">${MODE_ICON.foot} ${Math.round(l.distance / 80)} min</span>`
          : `<span class="badge" style="background:${SL.colorForCode(l.line?.publicCode || "", l.mode)}" title="${esc(MODE_NAME[l.mode] || l.mode)} ${esc(l.line?.publicCode || "")}">${MODE_ICON[l.mode] || ""} ${esc(l.line?.publicCode || "")}</span>`
      )
      .join('<span class="leg-sep" aria-hidden="true">›</span>');
    const first = p.legs.find((l) => l.mode !== "foot");
    const cancelled = p.legs.some((l) => l.fromEstimatedCall?.cancellation);
    return `<li><button type="button" class="row trip ${i === 0 ? "active" : ""}" data-p="${i}">
      <span class="trip-times"><b>${SL.fmtTime(p.expectedStartTime)}–${SL.fmtTime(p.expectedEndTime)}</b><small>${SL.fmtDuration(p.duration)}</small></span>
      <span class="trip-legs">${legs}</span>
      ${first ? `<span class="trip-sub">${esc(first.fromPlace?.name)}${cancelled ? ' · <span class="cancelled">innstilt</span>' : ""}</span>` : ""}
    </button></li>`;
  }

  function showPattern(i) {
    const p = patterns[i];
    if (!p) return;
    for (const b of document.querySelectorAll("#detail-body .trip")) b.classList.toggle("active", +b.dataset.p === i);
    const lines = p.legs
      .filter((l) => l.pointsOnLink?.points)
      .map((l) => ({
        coords: SL.decodePolyline(l.pointsOnLink.points),
        color: l.mode === "foot" ? "#4c5856" : SL.colorForCode(l.line?.publicCode || "", l.mode),
        dash: l.mode === "foot",
      }));
    SL.setRoute(lines);
    const all = lines.flatMap((l) => l.coords);
    SL.fitCoords(all);
    // Detaljar for kvar etappe under forslaget
    const box = document.querySelector(`#detail-body .trip[data-p="${i}"]`)?.parentElement;
    document.querySelectorAll("#detail-body .trip-detail").forEach((el) => el.remove());
    box?.insertAdjacentHTML(
      "beforeend",
      `<ol class="trip-detail">${p.legs
        .map((l) =>
          l.mode === "foot"
            ? `<li class="foot">${MODE_ICON.foot} Gå ${Math.round(l.distance)} m til ${esc(l.toPlace?.name)}</li>`
            : `<li><b>${SL.fmtTime(l.expectedStartTime)}</b> ${esc(MODE_NAME[l.mode] || l.mode)} ${esc(l.line?.publicCode || "")} mot ${esc(l.fromEstimatedCall?.destinationDisplay?.frontText || l.toPlace?.name)}<br/><small>${esc(l.fromPlace?.name)} → ${esc(l.toPlace?.name)}, framme ${SL.fmtTime(l.expectedEndTime)}${l.realtime ? "" : " · rutetid"}</small></li>`
        )
        .join("")}</ol>`
    );
  }

  $("detail-body").addEventListener("click", (e) => {
    const b = e.target.closest("button.trip[data-p]");
    if (b && SL.selected?.kind === "trip") showPattern(+b.dataset.p);
  });

  // Lukk forslagslister ved klikk utanfor
  document.addEventListener("click", (e) => {
    for (const which of ["from", "to"]) {
      if (!e.target.closest(`#trip-${which}-wrap`)) $(`trip-${which}-list`).hidden = true;
    }
  });
})();
