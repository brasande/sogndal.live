/* Sogndal.live · vêr (MET Norge via /met/-proxy), cookiefri statistikk og PWA */
(() => {
  "use strict";
  const { $ } = SL;

  // ---------------------------------------------------------------- vêr
  // Går via eigen proxy, som set User-Agent og cachar svaret slik MET krev.
  const WEATHER_URL = "/met/weatherapi/locationforecast/2.0/compact?lat=61.229&lon=7.101";
  const SYMBOLS = {
    clearsky: ["☀️", "Klårvêr"], fair: ["🌤", "Lettskya"], partlycloudy: ["⛅", "Delvis skya"], cloudy: ["☁️", "Skya"],
    fog: ["🌫", "Skodde"], lightrain: ["🌦", "Lett regn"], rain: ["🌧", "Regn"], heavyrain: ["🌧", "Kraftig regn"],
    lightrainshowers: ["🌦", "Lette regnbyger"], rainshowers: ["🌦", "Regnbyger"], heavyrainshowers: ["🌧", "Kraftige regnbyger"],
    lightsleet: ["🌨", "Lett sludd"], sleet: ["🌨", "Sludd"], sleetshowers: ["🌨", "Sluddbyger"], lightsleetshowers: ["🌨", "Lette sluddbyger"],
    lightsnow: ["🌨", "Lett snø"], snow: ["❄️", "Snø"], heavysnow: ["❄️", "Kraftig snø"], snowshowers: ["🌨", "Snøbyger"], lightsnowshowers: ["🌨", "Lette snøbyger"],
    rainandthunder: ["⛈", "Regn og torevêr"], rainshowersandthunder: ["⛈", "Regnbyger og torevêr"],
  };
  SL.poll(async () => {
    const res = await fetch(WEATHER_URL);
    if (!res.ok) throw new Error(`vêr HTTP ${res.status}`);
    const ts = (await res.json()).properties.timeseries[0];
    const d = ts.data.instant.details;
    const code = ts.data.next_1_hours?.summary?.symbol_code || ts.data.next_6_hours?.summary?.symbol_code || "";
    const [icon, label] = SYMBOLS[code.replace(/_(day|night|polartwilight)$/, "")] || ["🌡", ""];
    const precip = ts.data.next_1_hours?.details?.precipitation_amount;
    const w = $("weather");
    w.innerHTML = `<span class="w-icon" aria-hidden="true">${icon}</span><strong>${Math.round(d.air_temperature)}°</strong>
      <span class="w-meta">${label ? label + " · " : ""}vind ${Math.round(d.wind_speed)} m/s${precip ? ` · ${precip} mm` : ""}<br/>Sogndal no</span>`;
    w.hidden = false;
  }, 15 * 60_000);

  // ---------------------------------------------------------------- statistikk (valfri, cookiefri)
  const gc = (window.SOGNDAL_CONFIG || {}).goatcounter;
  if (gc && /^[a-z0-9-]+$/i.test(gc)) {
    const s = document.createElement("script");
    s.async = true;
    s.src = "https://gc.zgo.at/count.js";
    s.dataset.goatcounter = `https://${gc}.goatcounter.com/count`;
    document.head.appendChild(s);
  }

  // ---------------------------------------------------------------- PWA
  if ("serviceWorker" in navigator && (location.protocol === "https:" || location.hostname === "localhost")) {
    window.addEventListener("load", () => {
      navigator.serviceWorker.register("/sw.js").catch((err) => console.warn("Service worker feila", err));
    });
  }
})();
