const WSS_URL = "wss://broker.emqx.io:8084/mqtt";
const TOPIC_DATOS = "esp32/monitoreo_agua_lluvia_99481/datos";
const TOPIC_ESTADO = "esp32/monitoreo_agua_lluvia_99481/estado";
const MAX_PUNTOS = 36;
const STORAGE_AGENDA_KEY = "agenda_inundaciones_esp32_v1";

const nombresDefecto = {
  1: "Sector 1",
  2: "Sector 2",
  3: "Sector 3"
};

let espOnlineFlag = false;
let ultimoPaqueteMs = 0;

let estadoActual = {
  s1: false,
  s2: false,
  s3: false,
  clima: "SECO",
  porcentaje: 0
};

let stats = {
  sectores: {
    1: { secoTotal: 0, inundadoTotal: 0, rachaInundado: 0 },
    2: { secoTotal: 0, inundadoTotal: 0, rachaInundado: 0 },
    3: { secoTotal: 0, inundadoTotal: 0, rachaInundado: 0 }
  },
  clima: {
    SECO: 0,
    LLOVIZNA: 0,
    "LLUVIA FUERTE": 0
  },
  puntosAgua: [],
  puntosLluvia: []
};

let agendaEventos = [];
let eventosActivos = { 1: null, 2: null, 3: null };

let metaGraficaAgua = null;
let metaGraficaLluvia = null;

function obtenerFechaHoraActual() {
  const ahora = new Date();
  const fecha = ahora.toLocaleDateString("es-EC", {
    day: "2-digit",
    month: "2-digit",
    year: "numeric"
  });
  const hora = ahora.toLocaleTimeString("es-EC", {
    hour12: false,
    hour: "2-digit",
    minute: "2-digit",
    second: "2-digit"
  });
  return { fecha, hora, ts: ahora.getTime() };
}

function formatearTiempo(seg) {
  const s = Math.max(0, Math.floor(seg));
  if (s < 60) return `${s}s`;
  const min = Math.floor(s / 60);
  const rem = s % 60;
  if (min < 60) return `${min}m ${rem}s`;
  const hrs = Math.floor(min / 60);
  return `${hrs}h ${min % 60}m`;
}

function obtenerNombreSector(num) {
  return document.getElementById(`nombre-${num}`).textContent;
}

function cargarAgenda() {
  try {
    const raw = localStorage.getItem(STORAGE_AGENDA_KEY);
    if (raw) {
      const parsed = JSON.parse(raw);
      if (Array.isArray(parsed)) {
        agendaEventos = parsed.map((ev) =>
          ev.activo ? { ...ev, activo: false, horaFin: ev.horaFin || "Sesión previa" } : ev
        );
        guardarAgenda();
      }
    }
  } catch (e) {
    agendaEventos = [];
  }
  renderizarAgenda();
}

function guardarAgenda() {
  try {
    localStorage.setItem(STORAGE_AGENDA_KEY, JSON.stringify(agendaEventos.slice(0, 120)));
  } catch (e) {}
}

function limpiarAgenda() {
  agendaEventos = [];
  eventosActivos = { 1: null, 2: null, 3: null };
  localStorage.removeItem(STORAGE_AGENDA_KEY);
  renderizarAgenda();
  renderizarEstadisticas();
}

function gestionarTransicionSector(num, inundado) {
  const { fecha, hora, ts } = obtenerFechaHoraActual();

  if (inundado) {
    if (!eventosActivos[num]) {
      const nuevoEvento = {
        id: `${num}-${ts}`,
        sectorNum: num,
        sectorNombre: obtenerNombreSector(num),
        fecha,
        horaInicio: hora,
        horaFin: "En curso...",
        inicioTs: ts,
        duracionSeg: 0,
        activo: true
      };
      eventosActivos[num] = nuevoEvento;
      agendaEventos.unshift(nuevoEvento);
      guardarAgenda();
      renderizarAgenda();
    }
  } else {
    stats.sectores[num].rachaInundado = 0;
    if (eventosActivos[num]) {
      const ev = eventosActivos[num];
      ev.activo = false;
      ev.horaFin = hora;
      ev.duracionSeg = Math.max(1, Math.round((ts - ev.inicioTs) / 1000));
      eventosActivos[num] = null;
      guardarAgenda();
      renderizarAgenda();
    }
  }
}

function renderizarAgenda() {
  const tbody = document.getElementById("agendaBody");
  document.getElementById("contadorAgenda").textContent =
    `${agendaEventos.length} ${agendaEventos.length === 1 ? "registro guardado" : "registros guardados"}`;
  document.getElementById("totalEventosTexto").textContent =
    `${agendaEventos.length} ${agendaEventos.length === 1 ? "evento" : "eventos"}`;

  if (agendaEventos.length === 0) {
    tbody.innerHTML =
      '<tr><td colspan="6" class="agenda-vacia">Sin eventos de inundación registrados aún.</td></tr>';
    return;
  }

  tbody.innerHTML = agendaEventos
    .map((ev) => {
      const nombreActual = obtenerNombreSector(ev.sectorNum) || ev.sectorNombre;
      const badge = ev.activo
        ? '<span class="badge-evento badge-activo">● Inundado</span>'
        : '<span class="badge-evento badge-finalizado">✓ Secado</span>';
      return `
        <tr>
          <td><strong>${ev.fecha}</strong></td>
          <td>${nombreActual}</td>
          <td>${ev.horaInicio}</td>
          <td>${ev.horaFin}</td>
          <td><strong>${formatearTiempo(ev.duracionSeg)}</strong></td>
          <td>${badge}</td>
        </tr>
      `;
    })
    .join("");
}

function sincronizarLeyendas() {
  for (let i = 1; i <= 3; i++) {
    document.getElementById(`leyenda-s${i}`).textContent = obtenerNombreSector(i);
  }
}

function cargarNombres() {
  for (let i = 1; i <= 3; i++) {
    const guardado = localStorage.getItem(`nombre_sector_${i}`);
    const texto = guardado && guardado.trim() ? guardado.trim() : nombresDefecto[i];
    document.getElementById(`nombre-${i}`).textContent = texto;
  }
  sincronizarLeyendas();
}

function abrirModal() {
  for (let i = 1; i <= 3; i++) {
    document.getElementById(`input-${i}`).value = obtenerNombreSector(i);
  }
  document.getElementById("modalNombres").classList.add("activo");
  setTimeout(() => document.getElementById("input-1").focus(), 60);
}

function cerrarModal() {
  document.getElementById("modalNombres").classList.remove("activo");
}

function cerrarPorFondo(event) {
  if (event.target.id === "modalNombres") {
    cerrarModal();
  }
}

function restablecerDefecto() {
  for (let i = 1; i <= 3; i++) {
    document.getElementById(`input-${i}`).value = nombresDefecto[i];
  }
}

function guardarNombres() {
  for (let i = 1; i <= 3; i++) {
    const val = document.getElementById(`input-${i}`).value.trim();
    const finalNombre = val || nombresDefecto[i];
    localStorage.setItem(`nombre_sector_${i}`, finalNombre);
    document.getElementById(`nombre-${i}`).textContent = finalNombre;
  }
  sincronizarLeyendas();
  renderizarAgenda();
  renderizarEstadisticas();
  cerrarModal();
}

function reiniciarGraficasYContadores() {
  stats = {
    sectores: {
      1: { secoTotal: 0, inundadoTotal: 0, rachaInundado: 0 },
      2: { secoTotal: 0, inundadoTotal: 0, rachaInundado: 0 },
      3: { secoTotal: 0, inundadoTotal: 0, rachaInundado: 0 }
    },
    clima: {
      SECO: 0,
      LLOVIZNA: 0,
      "LLUVIA FUERTE": 0
    },
    puntosAgua: [],
    puntosLluvia: []
  };
  renderizarEstadisticas();
}

document.addEventListener("keydown", (e) => {
  if (e.key === "Escape" && document.getElementById("modalNombres").classList.contains("activo")) {
    cerrarModal();
  }
});

function actualizarIndicadorESP(conectado) {
  const box = document.getElementById("indicadorEsp");
  const txt = document.getElementById("textoIndicadorEsp");
  if (conectado) {
    box.classList.add("conectado");
    txt.textContent = "ESP32 conectado a la web";
  } else {
    box.classList.remove("conectado");
    txt.textContent = "ESP32 no conectado a la web";
  }
}

function actualizarEstadoSector(num, inundacion) {
  const card = document.getElementById(`card-${num}`);
  const el = document.getElementById(`estado-${num}`);
  if (inundacion) {
    card.classList.add("alerta");
    el.textContent = "alerta inundacion";
    el.className = "estado-pill estado-alerta";
  } else {
    card.classList.remove("alerta");
    el.textContent = "estado normal";
    el.className = "estado-pill estado-normal";
  }
}

function prepararCanvas(canvas) {
  const dpr = window.devicePixelRatio || 1;
  const rect = canvas.getBoundingClientRect();
  const width = Math.max(260, Math.floor(rect.width));
  const height = Math.max(190, Math.floor(rect.height));
  if (canvas.width !== width * dpr || canvas.height !== height * dpr) {
    canvas.width = width * dpr;
    canvas.height = height * dpr;
  }
  const ctx = canvas.getContext("2d");
  ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
  return { ctx, width, height };
}

function dibujarCurvaSuave(ctx, coords) {
  if (coords.length === 0) return;
  ctx.moveTo(coords[0].x, coords[0].y);
  if (coords.length === 1) return;
  for (let i = 0; i < coords.length - 1; i++) {
    const xc = (coords[i].x + coords[i + 1].x) / 2;
    const yc = (coords[i].y + coords[i + 1].y) / 2;
    ctx.quadraticCurveTo(coords[i].x, coords[i].y, xc, yc);
  }
  const last = coords[coords.length - 1];
  ctx.lineTo(last.x, last.y);
}

function dibujarGraficaAguaPro(hoverIdx = -1) {
  const canvas = document.getElementById("graficaAguaPro");
  const { ctx, width, height } = prepararCanvas(canvas);
  ctx.clearRect(0, 0, width, height);

  const padLeft = 48;
  const padRight = 18;
  const padTop = 16;
  const padBottom = 28;
  const plotW = Math.max(40, width - padLeft - padRight);
  const plotH = Math.max(40, height - padTop - padBottom);

  const pts = stats.puntosAgua;
  let maxVal = 10;
  pts.forEach((p) => {
    maxVal = Math.max(maxVal, p.s1, p.s2, p.s3);
  });
  maxVal = Math.ceil(maxVal / 5) * 5;

  ctx.font = "600 10.5px Inter, system-ui, sans-serif";
  ctx.textBaseline = "middle";
  const pasosY = 4;
  for (let g = 0; g <= pasosY; g++) {
    const frac = g / pasosY;
    const y = padTop + plotH - frac * plotH;
    const valEtiqueta = Math.round(frac * maxVal);

    ctx.save();
    ctx.strokeStyle = g === 0 ? "#cbd5e1" : "#e2e8f0";
    if (g > 0) ctx.setLineDash([4, 4]);
    ctx.lineWidth = 1;
    ctx.beginPath();
    ctx.moveTo(padLeft, y);
    ctx.lineTo(padLeft + plotW, y);
    ctx.stroke();
    ctx.restore();

    ctx.fillStyle = "#64748b";
    ctx.textAlign = "right";
    ctx.fillText(`${valEtiqueta}s`, padLeft - 9, y);
  }

  if (pts.length === 0) {
    metaGraficaAgua = null;
    ctx.fillStyle = "#94a3b8";
    ctx.font = "600 12px Inter, system-ui, sans-serif";
    ctx.textAlign = "center";
    ctx.fillText("Esperando lecturas del ESP32...", padLeft + plotW / 2, padTop + plotH / 2);
    return;
  }

  const denom = Math.max(1, MAX_PUNTOS - 1);

  ctx.fillStyle = "#64748b";
  ctx.font = "600 10px Inter, system-ui, sans-serif";
  ctx.textBaseline = "top";
  const pasoX = Math.max(1, Math.floor(MAX_PUNTOS / 5));
  pts.forEach((muestra, idx) => {
    if (idx % pasoX === 0 || idx === pts.length - 1) {
      const x = padLeft + (idx / denom) * plotW;
      ctx.textAlign = idx === 0 ? "left" : idx === pts.length - 1 ? "right" : "center";
      ctx.fillText(muestra.hora, x, padTop + plotH + 8);
    }
  });

  const series = [
    { key: "s1", color: "#2563eb", fill: "rgba(37, 99, 235, 0.08)" },
    { key: "s2", color: "#16a34a", fill: "rgba(22, 163, 74, 0.08)" },
    { key: "s3", color: "#ea580c", fill: "rgba(234, 88, 12, 0.08)" }
  ];

  series.forEach((serie) => {
    const coords = pts.map((m, idx) => ({
      x: padLeft + (idx / denom) * plotW,
      y: padTop + plotH - (Math.min(maxVal, m[serie.key]) / maxVal) * plotH,
      val: m[serie.key]
    }));

    ctx.save();
    ctx.beginPath();
    dibujarCurvaSuave(ctx, coords);
    ctx.lineTo(coords[coords.length - 1].x, padTop + plotH);
    ctx.lineTo(coords[0].x, padTop + plotH);
    ctx.closePath();
    ctx.fillStyle = serie.fill;
    ctx.fill();
    ctx.restore();

    ctx.save();
    ctx.strokeStyle = serie.color;
    ctx.lineWidth = 2.4;
    ctx.beginPath();
    dibujarCurvaSuave(ctx, coords);
    ctx.stroke();
    ctx.restore();

    coords.forEach((pt, idx) => {
      const isHover = idx === hoverIdx;
      ctx.beginPath();
      ctx.arc(pt.x, pt.y, isHover ? 5.5 : 3.2, 0, Math.PI * 2);
      ctx.fillStyle = isHover ? serie.color : "#ffffff";
      ctx.fill();
      ctx.lineWidth = 2;
      ctx.strokeStyle = serie.color;
      ctx.stroke();
    });
  });

  if (hoverIdx >= 0 && hoverIdx < pts.length) {
    const hx = padLeft + (hoverIdx / denom) * plotW;
    ctx.save();
    ctx.strokeStyle = "#94a3b8";
    ctx.setLineDash([3, 3]);
    ctx.beginPath();
    ctx.moveTo(hx, padTop);
    ctx.lineTo(hx, padTop + plotH);
    ctx.stroke();
    ctx.restore();
  }

  metaGraficaAgua = { padLeft, plotW, denom, pts };
}

function dibujarGraficaLluviaPro(hoverIdx = -1) {
  const canvas = document.getElementById("graficaLluviaPro");
  const { ctx, width, height } = prepararCanvas(canvas);
  ctx.clearRect(0, 0, width, height);

  const padLeft = 48;
  const padRight = 18;
  const padTop = 16;
  const padBottom = 28;
  const plotW = Math.max(40, width - padLeft - padRight);
  const plotH = Math.max(40, height - padTop - padBottom);

  const niveles = [100, 75, 50, 25, 0];
  ctx.font = "600 10.5px Inter, system-ui, sans-serif";
  ctx.textBaseline = "middle";

  niveles.forEach((val) => {
    const y = padTop + plotH - (val / 100) * plotH;
    ctx.save();
    ctx.strokeStyle = val === 0 ? "#cbd5e1" : "#e2e8f0";
    if (val > 0) ctx.setLineDash([4, 4]);
    ctx.lineWidth = 1;
    ctx.beginPath();
    ctx.moveTo(padLeft, y);
    ctx.lineTo(padLeft + plotW, y);
    ctx.stroke();
    ctx.restore();

    ctx.fillStyle = "#64748b";
    ctx.textAlign = "right";
    ctx.fillText(`${val}%`, padLeft - 9, y);
  });

  const pts = stats.puntosLluvia;
  if (pts.length === 0) {
    metaGraficaLluvia = null;
    ctx.fillStyle = "#94a3b8";
    ctx.font = "600 12px Inter, system-ui, sans-serif";
    ctx.textAlign = "center";
    ctx.fillText("Esperando lecturas del sensor de lluvia...", padLeft + plotW / 2, padTop + plotH / 2);
    return;
  }

  const denom = Math.max(1, MAX_PUNTOS - 1);

  ctx.fillStyle = "#64748b";
  ctx.font = "600 10px Inter, system-ui, sans-serif";
  ctx.textBaseline = "top";
  const pasoX = Math.max(1, Math.floor(MAX_PUNTOS / 5));
  pts.forEach((muestra, idx) => {
    if (idx % pasoX === 0 || idx === pts.length - 1) {
      const x = padLeft + (idx / denom) * plotW;
      ctx.textAlign = idx === 0 ? "left" : idx === pts.length - 1 ? "right" : "center";
      ctx.fillText(muestra.hora, x, padTop + plotH + 8);
    }
  });

  const coords = pts.map((m, idx) => ({
    x: padLeft + (idx / denom) * plotW,
    y: padTop + plotH - (Math.max(0, Math.min(100, m.pct)) / 100) * plotH,
    pct: m.pct,
    clima: m.clima
  }));

  const grad = ctx.createLinearGradient(0, padTop, 0, padTop + plotH);
  grad.addColorStop(0, "rgba(2, 132, 199, 0.24)");
  grad.addColorStop(1, "rgba(2, 132, 199, 0.01)");

  ctx.save();
  ctx.beginPath();
  dibujarCurvaSuave(ctx, coords);
  ctx.lineTo(coords[coords.length - 1].x, padTop + plotH);
  ctx.lineTo(coords[0].x, padTop + plotH);
  ctx.closePath();
  ctx.fillStyle = grad;
  ctx.fill();
  ctx.restore();

  ctx.save();
  ctx.strokeStyle = "#0284c7";
  ctx.lineWidth = 2.4;
  ctx.beginPath();
  dibujarCurvaSuave(ctx, coords);
  ctx.stroke();
  ctx.restore();

  coords.forEach((pt, idx) => {
    let color = "#0284c7";
    if (pt.clima === "SECO") color = "#64748b";
    else if (pt.clima === "LLOVIZNA") color = "#eab308";
    else if (pt.clima === "LLUVIA FUERTE") color = "#1d4ed8";

    const isHover = idx === hoverIdx;
    ctx.beginPath();
    ctx.arc(pt.x, pt.y, isHover ? 5.5 : 3.5, 0, Math.PI * 2);
    ctx.fillStyle = isHover ? color : "#ffffff";
    ctx.fill();
    ctx.lineWidth = 2;
    ctx.strokeStyle = color;
    ctx.stroke();
  });

  if (hoverIdx >= 0 && hoverIdx < pts.length) {
    const hx = padLeft + (hoverIdx / denom) * plotW;
    ctx.save();
    ctx.strokeStyle = "#94a3b8";
    ctx.setLineDash([3, 3]);
    ctx.beginPath();
    ctx.moveTo(hx, padTop);
    ctx.lineTo(hx, padTop + plotH);
    ctx.stroke();
    ctx.restore();
  }

  metaGraficaLluvia = { padLeft, plotW, denom, pts };
}

function configurarTooltips() {
  const cAgua = document.getElementById("graficaAguaPro");
  const tAgua = document.getElementById("tooltipAgua");

  cAgua.addEventListener("mousemove", (e) => {
    if (!metaGraficaAgua || metaGraficaAgua.pts.length === 0) return;
    const rect = cAgua.getBoundingClientRect();
    const mx = e.clientX - rect.left;
    const { padLeft, plotW, denom, pts } = metaGraficaAgua;
    const rel = Math.max(0, Math.min(1, (mx - padLeft) / plotW));
    const idx = Math.min(pts.length - 1, Math.round(rel * denom));
    const m = pts[idx];

    dibujarGraficaAguaPro(idx);
    tAgua.style.display = "block";
    tAgua.innerHTML = `
      <div class="tooltip-time">Hora: ${m.hora}</div>
      <div class="tooltip-row">
        <span class="tooltip-left"><span class="tooltip-swatch" style="background:#2563eb"></span>${obtenerNombreSector(1)}</span>
        <strong>${m.s1 === 0 ? "0s (Seco)" : formatearTiempo(m.s1)}</strong>
      </div>
      <div class="tooltip-row">
        <span class="tooltip-left"><span class="tooltip-swatch" style="background:#16a34a"></span>${obtenerNombreSector(2)}</span>
        <strong>${m.s2 === 0 ? "0s (Seco)" : formatearTiempo(m.s2)}</strong>
      </div>
      <div class="tooltip-row">
        <span class="tooltip-left"><span class="tooltip-swatch" style="background:#ea580c"></span>${obtenerNombreSector(3)}</span>
        <strong>${m.s3 === 0 ? "0s (Seco)" : formatearTiempo(m.s3)}</strong>
      </div>
    `;
    const leftPos = Math.min(rect.width - 180, Math.max(12, mx + 12));
    tAgua.style.left = `${leftPos}px`;
    tAgua.style.top = "14px";
  });

  cAgua.addEventListener("mouseleave", () => {
    tAgua.style.display = "none";
    dibujarGraficaAguaPro(-1);
  });

  const cLluvia = document.getElementById("graficaLluviaPro");
  const tLluvia = document.getElementById("tooltipLluvia");

  cLluvia.addEventListener("mousemove", (e) => {
    if (!metaGraficaLluvia || metaGraficaLluvia.pts.length === 0) return;
    const rect = cLluvia.getBoundingClientRect();
    const mx = e.clientX - rect.left;
    const { padLeft, plotW, denom, pts } = metaGraficaLluvia;
    const rel = Math.max(0, Math.min(1, (mx - padLeft) / plotW));
    const idx = Math.min(pts.length - 1, Math.round(rel * denom));
    const m = pts[idx];

    dibujarGraficaLluviaPro(idx);
    tLluvia.style.display = "block";
    tLluvia.innerHTML = `
      <div class="tooltip-time">Hora: ${m.hora}</div>
      <div class="tooltip-row">
        <span>Humedad:</span>
        <strong>${m.pct}%</strong>
      </div>
      <div class="tooltip-row">
        <span>Condición:</span>
        <strong>${m.clima}</strong>
      </div>
    `;
    const leftPos = Math.min(rect.width - 170, Math.max(12, mx + 12));
    tLluvia.style.left = `${leftPos}px`;
    tLluvia.style.top = "14px";
  });

  cLluvia.addEventListener("mouseleave", () => {
    tLluvia.style.display = "none";
    dibujarGraficaLluviaPro(-1);
  });
}

function renderizarEstadisticas() {
  let maxInundSeg = 0;
  let maxInundSector = null;
  let maxSecoSeg = 0;
  let maxSecoSector = null;

  for (let i = 1; i <= 3; i++) {
    const seco = stats.sectores[i].secoTotal;
    const inund = stats.sectores[i].inundadoTotal;
    if (inund > maxInundSeg) {
      maxInundSeg = inund;
      maxInundSector = obtenerNombreSector(i);
    }
    if (seco > maxSecoSeg) {
      maxSecoSeg = seco;
      maxSecoSector = obtenerNombreSector(i);
    }
  }

  if (maxInundSector && maxInundSeg > 0) {
    document.getElementById("mayorInundadoNombre").textContent = maxInundSector;
    document.getElementById("mayorInundadoDetalle").textContent = `${formatearTiempo(maxInundSeg)} totales en alerta`;
  } else {
    document.getElementById("mayorInundadoNombre").textContent = "Ninguno inundado";
    document.getElementById("mayorInundadoDetalle").textContent = "0s acumulados";
  }

  if (maxSecoSector && maxSecoSeg > 0) {
    document.getElementById("mayorSecoNombre").textContent = maxSecoSector;
    document.getElementById("mayorSecoDetalle").textContent = `${formatearTiempo(maxSecoSeg)} totales en normal`;
  } else {
    document.getElementById("mayorSecoNombre").textContent = "Sin registro aún";
    document.getElementById("mayorSecoDetalle").textContent = "0s acumulados";
  }

  document.getElementById("resumenTiemposAgua").textContent =
    `S1: ${formatearTiempo(stats.sectores[1].inundadoTotal)} · ` +
    `S2: ${formatearTiempo(stats.sectores[2].inundadoTotal)} · ` +
    `S3: ${formatearTiempo(stats.sectores[3].inundadoTotal)} inund.`;

  const cSeco = stats.clima["SECO"];
  const cLlov = stats.clima["LLOVIZNA"];
  const cFuer = stats.clima["LLUVIA FUERTE"];
  const cTotal = cSeco + cLlov + cFuer;

  const pSeco = cTotal > 0 ? Math.round((cSeco / cTotal) * 100) : 0;
  const pLlov = cTotal > 0 ? Math.round((cLlov / cTotal) * 100) : 0;
  const pFuer = cTotal > 0 ? Math.max(0, 100 - pSeco - pLlov) : 0;

  document.getElementById("datoClimaSeco").textContent = `${pSeco}% (${formatearTiempo(cSeco)})`;
  document.getElementById("datoClimaLlovizna").textContent = `${pLlov}% (${formatearTiempo(cLlov)})`;
  document.getElementById("datoClimaFuerte").textContent = `${pFuer}% (${formatearTiempo(cFuer)})`;

  if (cTotal > 0) {
    const pares = [
      { nombre: "SECO", val: cSeco },
      { nombre: "LLOVIZNA", val: cLlov },
      { nombre: "LLUVIA FUERTE", val: cFuer }
    ].sort((a, b) => b.val - a.val);
    document.getElementById("climaPredominante").textContent = `Predominante: ${pares[0].nombre}`;
  } else {
    document.getElementById("climaPredominante").textContent = "Condición predominante: Sin registro";
  }

  dibujarGraficaAguaPro(-1);
  dibujarGraficaLluviaPro(-1);
}

function aplicarDatos(data) {
  if (!data) return;
  const nuevoS1 = Boolean(data.s1);
  const nuevoS2 = Boolean(data.s2);
  const nuevoS3 = Boolean(data.s3);

  estadoActual.s1 = nuevoS1;
  estadoActual.s2 = nuevoS2;
  estadoActual.s3 = nuevoS3;

  actualizarEstadoSector(1, nuevoS1);
  actualizarEstadoSector(2, nuevoS2);
  actualizarEstadoSector(3, nuevoS3);

  gestionarTransicionSector(1, nuevoS1);
  gestionarTransicionSector(2, nuevoS2);
  gestionarTransicionSector(3, nuevoS3);

  const clima = data.clima || "SECO";
  estadoActual.clima = ["SECO", "LLOVIZNA", "LLUVIA FUERTE"].includes(clima) ? clima : "SECO";
  estadoActual.porcentaje = Math.max(0, Math.min(100, Number(data.porcentaje || 0)));

  const ao = data.ao ?? "--";
  document.getElementById("climaTexto").textContent = estadoActual.clima;
  document.getElementById("climaPct").textContent = estadoActual.porcentaje;
  document.getElementById("rainBar").style.width = `${estadoActual.porcentaje}%`;
  document.getElementById("rawInfo").textContent = `AO: ${ao}`;
}

window.addEventListener("resize", () => {
  dibujarGraficaAguaPro(-1);
  dibujarGraficaLluviaPro(-1);
});

cargarNombres();
cargarAgenda();
configurarTooltips();
actualizarIndicadorESP(false);
renderizarEstadisticas();

const client = mqtt.connect(WSS_URL, {
  reconnectPeriod: 2000,
  connectTimeout: 8000
});

client.on("connect", () => {
  client.subscribe([TOPIC_DATOS, TOPIC_ESTADO]);
});

client.on("message", (topic, message) => {
  const texto = message.toString();
  if (topic === TOPIC_ESTADO) {
    if (texto === "online") {
      espOnlineFlag = true;
      ultimoPaqueteMs = Date.now();
      actualizarIndicadorESP(true);
    } else if (texto === "offline") {
      espOnlineFlag = false;
      actualizarIndicadorESP(false);
    }
  } else if (topic === TOPIC_DATOS) {
    try {
      const data = JSON.parse(texto);
      espOnlineFlag = true;
      ultimoPaqueteMs = Date.now();
      actualizarIndicadorESP(true);
      aplicarDatos(data);
    } catch (e) {}
  }
});

setInterval(() => {
  if (espOnlineFlag && (Date.now() - ultimoPaqueteMs > 4000)) {
    espOnlineFlag = false;
    actualizarIndicadorESP(false);
  }

  if (espOnlineFlag) {
    const { hora, ts } = obtenerFechaHoraActual();
    let huboCambioAgenda = false;

    for (let i = 1; i <= 3; i++) {
      if (estadoActual[`s${i}`]) {
        stats.sectores[i].inundadoTotal += 1;
        stats.sectores[i].rachaInundado += 1;
        if (eventosActivos[i]) {
          eventosActivos[i].duracionSeg = Math.max(1, Math.round((ts - eventosActivos[i].inicioTs) / 1000));
          huboCambioAgenda = true;
        }
      } else {
        stats.sectores[i].secoTotal += 1;
        stats.sectores[i].rachaInundado = 0;
      }
    }

    if (huboCambioAgenda) {
      renderizarAgenda();
    }

    stats.clima[estadoActual.clima] = (stats.clima[estadoActual.clima] || 0) + 1;

    stats.puntosAgua.push({
      hora,
      s1: stats.sectores[1].rachaInundado,
      s2: stats.sectores[2].rachaInundado,
      s3: stats.sectores[3].rachaInundado
    });
    if (stats.puntosAgua.length > MAX_PUNTOS) {
      stats.puntosAgua.shift();
    }

    stats.puntosLluvia.push({
      hora,
      pct: estadoActual.porcentaje,
      clima: estadoActual.clima
    });
    if (stats.puntosLluvia.length > MAX_PUNTOS) {
      stats.puntosLluvia.shift();
    }

    renderizarEstadisticas();
  }
}, 1000);