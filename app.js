// ⚠️ REEMPLAZA ESTA LÍNEA CON TU URL DE GOOGLE APPS SCRIPT (termina en /exec)
const API_URL = "https://script.google.com/macros/s/AKfycbzjJ52VUx8pcqCeueksIUcMhDc4fR0gkDIvsybD3iU7KOs1JPYZMmtbxWnWKmmrMdQ/exec";

let state = {
  usuario: null,
  ultimoEventoHoy: null,
  locales: [],
  marcas: [],
  documentos: [],
  seguimiento: []
};

// ==========================================
// INICIO Y SERVICE WORKER
// ==========================================
if ("serviceWorker" in navigator) {
  navigator.serviceWorker.register("./sw.js").catch(() => {});
}

window.addEventListener("DOMContentLoaded", () => {
  iniciarReloj();
  const sesion = localStorage.getItem("rade_user");
  if (sesion) {
    state.usuario = JSON.parse(sesion);
    state.ultimoEventoHoy = localStorage.getItem("rade_ultimo_evento") || null;
    mostrarApp();
    cargarDatosIniciales();
  }
});

// ==========================================
// UTILIDADES DE RED, GPS Y NORMALIZACIÓN
// ==========================================
async function apiGet(params) {
  const query = new URLSearchParams(params).toString();
  const res = await fetch(`${API_URL}?${query}`);
  return res.json();
}

// Usa text/plain para evitar bloqueo CORS preflight de Google Apps Script
async function apiPost(payload) {
  const res = await fetch(API_URL, {
    method: "POST",
    headers: { "Content-Type": "text/plain;charset=utf-8" },
    body: JSON.stringify(payload)
  });
  return res.json();
}

function obtenerGPS() {
  return new Promise((resolve, reject) => {
    if (!navigator.geolocation) {
      return reject("Tu dispositivo no soporta GPS.");
    }
    navigator.geolocation.getCurrentPosition(
      pos => resolve({
        lat: Number(pos.coords.latitude.toFixed(6)),
        lng: Number(pos.coords.longitude.toFixed(6))
      }),
      err => reject("Activa el GPS y permite la ubicación en el navegador."),
      { enableHighAccuracy: true, timeout: 12000, maximumAge: 0 }
    );
  });
}

// Lee propiedades del Sheet tolerando espacios, acentos o guiones bajos
function val(obj, ...posiblesClaves) {
  if (!obj) return "";
  const norm = s => String(s).toLowerCase().normalize("NFD").replace(/[\u0300-\u036f]/g, "").replace(/[^a-z0-9]/g, "");
  const map = {};
  Object.keys(obj).forEach(k => { map[norm(k)] = obj[k]; });
  for (const clave of posiblesClaves) {
    const v = map[norm(clave)];
    if (v !== undefined && v !== null && v !== "") return String(v);
  }
  return "";
}

function toast(msg) {
  const el = document.getElementById("toast");
  el.textContent = msg;
  el.classList.remove("hidden");
  setTimeout(() => el.classList.add("hidden"), 3500);
}

function iniciarReloj() {
  const actualizar = () => {
    const el = document.getElementById("reloj-vivo");
    if (el) el.textContent = new Date().toLocaleTimeString("es-MX", { hour12: false });
  };
  actualizar();
  setInterval(actualizar, 1000);
}

// ==========================================
// LOGIN Y SESIÓN
// ==========================================
document.getElementById("form-login").addEventListener("submit", async (e) => {
  e.preventDefault();
  const btn = document.getElementById("btn-login");
  btn.disabled = true;
  btn.textContent = "Verificando...";

  try {
    const correo = document.getElementById("login-correo").value.trim();
    const pin = document.getElementById("login-pin").value.trim();
    const res = await apiGet({ action: "login", correo, pin });

    if (res.status !== "ok") {
      toast(res.message || "Error al iniciar sesión");
    } else {
      state.usuario = res.usuario;
      state.ultimoEventoHoy = res.ultimoEventoHoy || null;
      localStorage.setItem("rade_user", JSON.stringify(res.usuario));
      if (state.ultimoEventoHoy) localStorage.setItem("rade_ultimo_evento", state.ultimoEventoHoy);
      mostrarApp();
      cargarDatosIniciales();
    }
  } catch (err) {
    toast("Error de conexión con el servidor");
  } finally {
    btn.disabled = false;
    btn.textContent = "Ingresar";
  }
});

function mostrarApp() {
  document.getElementById("view-login").classList.add("hidden");
  document.getElementById("app-shell").classList.remove("hidden");
  document.getElementById("header-user").textContent = `${state.usuario.nombre} (${state.usuario.rol})`;
  renderAsistencia();
}

function cerrarSesion() {
  localStorage.removeItem("rade_user");
  localStorage.removeItem("rade_ultimo_evento");
  location.reload();
}

function cambiarTab(tabId, titulo) {
  document.querySelectorAll(".tab-view").forEach(v => v.classList.add("hidden"));
  document.getElementById(`tab-${tabId}`).classList.remove("hidden");
  document.getElementById("header-title").textContent = titulo;
  document.querySelectorAll(".bottom-nav button").forEach(b => {
    b.classList.toggle("active", b.dataset.tab === tabId);
  });
}

// ==========================================
// CARGA DE CATÁLOGOS
// ==========================================
async function cargarDatosIniciales(mostrarAviso = false) {
  try {
    if (mostrarAviso) toast("Sincronizando datos...");
    const res = await apiGet({ action: "init" });
    if (res.status === "ok") {
      state.locales = res.locales || [];
      state.marcas = res.marcas || [];
      state.documentos = res.documentos || [];
      state.seguimiento = res.seguimiento || [];

      llenarSelects();
      renderMarcas();
      renderSeguimiento();
      renderDocumentos();
      if (mostrarAviso) toast("Datos actualizados");
    }
  } catch (err) {
    toast("No se pudieron cargar los catálogos");
  }
}

function llenarSelects() {
  // Plazas únicas para Visitas
  const plazas = [...new Set(state.locales.map(l => val(l, "Plaza")).filter(Boolean))];
  const selPlaza = document.getElementById("vis-plaza");
  selPlaza.innerHTML = `<option value="">Selecciona plaza...</option>` +
    plazas.map(p => `<option value="${p}">${p}</option>`).join("");

  // Locales para Seguimiento (con etiqueta VIP)
  const selSegLocal = document.getElementById("seg-local");
  selSegLocal.innerHTML = `<option value="">Selecciona local...</option>` +
    state.locales.map(l => {
      const plaza = val(l, "Plaza");
      const num = val(l, "Numero_Local", "Local");
      const prio = val(l, "Prioridad").toUpperCase() === "VIP" ? "[VIP] " : "";
      const texto = `${prio}${plaza} - ${num}`;
      return `<option value="${texto}">${texto}</option>`;
    }).join("");

  // Marcas para Visitas y Seguimiento
  const opcionesMarcas = state.marcas.map(m => {
    const n = val(m, "Nombre Comercial", "Nombre_Comercial", "Marca");
    return `<option value="${n}">${n}</option>`;
  }).join("");

  document.getElementById("vis-marca").innerHTML = `<option value="">Ninguna / Recorrido interno</option>` + opcionesMarcas;
  document.getElementById("seg-marca").innerHTML = `<option value="">Selecciona marca...</option>` + opcionesMarcas;
}

// Cascada Plaza -> Local en Visitas
document.getElementById("vis-plaza").addEventListener("change", (e) => {
  const plazaSel = e.target.value;
  const filtrados = state.locales.filter(l => val(l, "Plaza") === plazaSel);
  document.getElementById("vis-local").innerHTML = `<option value="">Selecciona local...</option>` +
    filtrados.map(l => {
      const num = val(l, "Numero_Local", "Local");
      const sup = val(l, "Superficie_m2", "Superficie");
      return `<option value="${num}">${num}${sup ? ` (${sup} m²)` : ""}</option>`;
    }).join("");
});

// ==========================================
// MÓDULO 1: ASISTENCIA
// ==========================================
function renderAsistencia() {
  const ult = state.ultimoEventoHoy;
  document.getElementById("asist-ultimo").textContent = ult || "Sin registros hoy";

  let opciones = [];
  if (!ult || ult === "Salida") {
    opciones = [{ tipo: "Entrada", clase: "btn-success", texto: "🟢 Registrar Entrada" }];
  } else if (ult === "Entrada") {
    opciones = [
      { tipo: "Inicio Comida", clase: "btn-warn", texto: "🍽️ Inicio de Comida" },
      { tipo: "Salida", clase: "btn-danger", texto: "🔴 Registrar Salida" }
    ];
  } else if (ult === "Inicio Comida") {
    opciones = [{ tipo: "Fin Comida", clase: "btn-success", texto: "✅ Fin de Comida" }];
  } else if (ult === "Fin Comida") {
    opciones = [{ tipo: "Salida", clase: "btn-danger", texto: "🔴 Registrar Salida" }];
  }

  document.getElementById("asist-botones").innerHTML = opciones.map(o =>
    `<button class="btn ${o.clase}" onclick="registrarAsistencia('${o.tipo}', this)">${o.texto}</button>`
  ).join("");
}

async function registrarAsistencia(tipoEvento, btn) {
  btn.disabled = true;
  const textoOrig = btn.textContent;
  btn.textContent = "Obteniendo GPS...";

  try {
    const gps = await obtenerGPS();
    btn.textContent = "Guardando...";
    const res = await apiPost({
      action: "guardar_asistencia",
      empleado: state.usuario.nombre,
      tipoEvento,
      lat: gps.lat,
      lng: gps.lng,
      nota: document.getElementById("asist-nota").value.trim()
    });

    if (res.status === "ok") {
      state.ultimoEventoHoy = tipoEvento;
      localStorage.setItem("rade_ultimo_evento", tipoEvento);
      document.getElementById("asist-nota").value = "";
      renderAsistencia();
      toast(`✅ ${tipoEvento} guardada (${res.estatusZona} - ${res.distancia}m)`);
    } else {
      toast(res.message || "Error al guardar");
    }
  } catch (err) {
    toast(typeof err === "string" ? err : "Error de conexión");
  } finally {
    btn.disabled = false;
    btn.textContent = textoOrig;
  }
}

// ==========================================
// MÓDULO 2: VISITAS
// ==========================================
document.getElementById("form-visita").addEventListener("submit", async (e) => {
  e.preventDefault();
  const btn = document.getElementById("btn-guardar-visita");
  btn.disabled = true;
  btn.textContent = "Obteniendo ubicación GPS...";

  try {
    const gps = await obtenerGPS();
    btn.textContent = "Guardando visita...";
    const res = await apiPost({
      action: "guardar_visita",
      asesor: state.usuario.nombre,
      plaza: document.getElementById("vis-plaza").value,
      local: document.getElementById("vis-local").value,
      tipoVisita: document.getElementById("vis-tipo").value,
      marcaCliente: document.getElementById("vis-marca").value,
      comentarios: document.getElementById("vis-comentarios").value.trim(),
      lat: gps.lat,
      lng: gps.lng
    });

    if (res.status === "ok") {
      e.target.reset();
      toast(`✅ Visita ${res.id} registrada con GPS`);
    } else {
      toast(res.message || "Error al guardar visita");
    }
  } catch (err) {
    toast(typeof err === "string" ? err : "Error de conexión");
  } finally {
    btn.disabled = false;
    btn.textContent = "📍 Guardar Visita con GPS";
  }
});

// ==========================================
// MÓDULO 3: SEGUIMIENTO
// ==========================================
document.getElementById("form-seguimiento").addEventListener("submit", async (e) => {
  e.preventDefault();
  const btn = document.getElementById("btn-guardar-seg");
  btn.disabled = true;
  btn.textContent = "Guardando...";

  try {
    const res = await apiPost({
      action: "guardar_seguimiento",
      asesor: state.usuario.nombre,
      localPlaza: document.getElementById("seg-local").value,
      marca: document.getElementById("seg-marca").value,
      canal: document.getElementById("seg-canal").value,
      estatus: document.getElementById("seg-estatus").value,
      proximoSeguimiento: document.getElementById("seg-proximo").value,
      notas: document.getElementById("seg-notas").value.trim()
    });

    if (res.status === "ok") {
      e.target.reset();
      toast(`✅ Seguimiento ${res.id} guardado`);
      cargarDatosIniciales();
    } else {
      toast(res.message || "Error al guardar");
    }
  } catch (err) {
    toast("Error de conexión");
  } finally {
    btn.disabled = false;
    btn.textContent = "Guardar Seguimiento";
  }
});

function renderSeguimiento() {
  const cont = document.getElementById("lista-seguimiento");
  if (!state.seguimiento.length) {
    cont.innerHTML = `<p style="color:var(--muted); font-size:13px;">Sin seguimientos recientes.</p>`;
    return;
  }
  cont.innerHTML = state.seguimiento.slice(0, 20).map(s => `
    <div class="item-card">
      <div class="item-header">
        <span class="item-title">${val(s, "Marca")}</span>
        <span class="badge">${val(s, "Estatus")}</span>
      </div>
      <div class="item-meta">
        <strong>${val(s, "Local_Plaza", "Local / Plaza")}</strong><br>
        ${val(s, "Notas", "Notas / Motivo")}<br>
        <small>${val(s, "Asesor")} · ${val(s, "Canal")} · ${val(s, "Fecha_Hora")}</small>
      </div>
    </div>
  `).join("");
}

// ==========================================
// MÓDULO 4: DIRECTORIO DE MARCAS + WHATSAPP
// ==========================================
function toggleFormMarca() {
  document.getElementById("box-nueva-marca").classList.toggle("hidden");
}

document.getElementById("form-marca").addEventListener("submit", async (e) => {
  e.preventDefault();
  const btn = document.getElementById("btn-guardar-marca");
  btn.disabled = true;
  btn.textContent = "Guardando...";

  try {
    const res = await apiPost({
      action: "guardar_marca",
      nombreComercial: document.getElementById("mrc-nombre").value.trim(),
      giro: document.getElementById("mrc-giro").value,
      directorExpansion: document.getElementById("mrc-director").value.trim(),
      whatsapp: document.getElementById("mrc-whatsapp").value.trim(),
      correo: document.getElementById("mrc-correo").value.trim(),
      requerimientoEspacio: document.getElementById("mrc-req").value.trim()
    });

    if (res.status === "ok") {
      e.target.reset();
      toggleFormMarca();
      toast("✅ Marca agregada al directorio");
      cargarDatosIniciales();
    } else {
      toast(res.message || "Error al guardar marca");
    }
  } catch (err) {
    toast("Error de conexión");
  } finally {
    btn.disabled = false;
    btn.textContent = "Guardar Marca";
  }
});

document.getElementById("buscar-marca").addEventListener("input", renderMarcas);

function renderMarcas() {
  const q = document.getElementById("buscar-marca").value.toLowerCase();
  const filtradas = state.marcas.filter(m =>
    JSON.stringify(m).toLowerCase().includes(q)
  );

  document.getElementById("lista-marcas").innerHTML = filtradas.map(m => {
    const nombre = val(m, "Nombre Comercial", "Nombre_Comercial");
    const giro = val(m, "Giro");
    const dir = val(m, "Director de Expansión", "Director_Expansion", "Director");
    const wa = val(m, "WhatsApp", "Telefono");
    const req = val(m, "Requerimiento de Espacio", "Requerimiento_Espacio", "Requerimiento");

    return `
      <div class="item-card">
        <div class="item-header">
          <span class="item-title">${nombre}</span>
          <span class="badge">${giro}</span>
        </div>
        <div class="item-meta">
          👤 ${dir || "Sin contacto"}<br>
          📐 ${req || "Sin requerimiento especificado"}
        </div>
        ${wa ? `<button class="wa-btn" onclick="contactarWhatsApp('${nombre.replace(/'/g, "")}', '${dir.replace(/'/g, "")}', '${wa}')">💬 WhatsApp Directo</button>` : ""}
      </div>
    `;
  }).join("") || `<p style="color:var(--muted); font-size:13px;">No se encontraron marcas.</p>`;
}

function contactarWhatsApp(marca, director, telefono) {
  let num = String(telefono).replace(/\D/g, "");
  if (num.length === 10) num = "52" + num;
  const saludo = `Hola ${director || ""}, te contacto de RADE Grupo Inmobiliario para compartirte una ubicación comercial disponible ideal para ${marca}.`;
  window.open(`https://wa.me/${num}?text=${encodeURIComponent(saludo)}`, "_blank");

  // Precarga la pestaña de Seguimiento para que el asesor solo elija el local y guarde
  document.getElementById("seg-marca").value = marca;
  document.getElementById("seg-canal").value = "WhatsApp";
  cambiarTab("seguimiento", "Seguimiento");
  toast("Selecciona el local para registrar el contacto");
}

// ==========================================
// MÓDULO 5: REPOSITORIO DOCUMENTAL
// ==========================================
document.getElementById("filtro-docs").addEventListener("change", renderDocumentos);

function renderDocumentos() {
  const cat = document.getElementById("filtro-docs").value;
  const filtrados = state.documentos.filter(d => !cat || val(d, "Categoria") === cat);

  document.getElementById("lista-docs").innerHTML = filtrados.map(d => {
    const titulo = val(d, "Titulo");
    const categoria = val(d, "Categoria");
    const url = val(d, "URL_Drive", "URL", "Enlace");
    return `
      <div class="item-card">
        <div class="item-header">
          <span class="item-title">${titulo}</span>
          <span class="badge">${categoria}</span>
        </div>
        <div style="margin-top:10px;">
          <a href="${url}" target="_blank" class="btn btn-outline" style="display:block; text-align:center; text-decoration:none; padding:9px; margin:0;">
            Abrir / Descargar PDF
          </a>
        </div>
      </div>
    `;
  }).join("") || `<p style="color:var(--muted); font-size:13px;">No hay documentos en esta categoría.</p>`;
}
