// ─────────────────────────────────────────────────────────────────────────────
// IMPORTS — cada módulo importado UNA sola vez
// ─────────────────────────────────────────────────────────────────────────────
import { initializeApp, getApps, getApp }
  from 'https://www.gstatic.com/firebasejs/10.12.0/firebase-app.js';

import {
  getFirestore, collection, addDoc, getDocs,
  deleteDoc, doc, getDoc, updateDoc, serverTimestamp, query, orderBy, where, limit
} from 'https://www.gstatic.com/firebasejs/10.12.0/firebase-firestore.js';

import {
  getAuth, onAuthStateChanged, signInWithEmailAndPassword,
  signOut, setPersistence, browserLocalPersistence, sendPasswordResetEmail
} from 'https://www.gstatic.com/firebasejs/10.12.0/firebase-auth.js';

// ─────────────────────────────────────────────────────────────────────────────
// ESTADO GLOBAL
// ─────────────────────────────────────────────────────────────────────────────
const CFG_KEY = 'fb_sol_v3';

// Config hardcodeada del proyecto (se puede sobreescribir desde UI)
const DEFAULT_CFG = {
  apiKey:            'AIzaSyD4jVqJQd-jA9D6L7ZNneBcTMZ7zF3yShk',
  authDomain:        'solicitudes-f2ce8.firebaseapp.com',
  projectId:         'solicitudes-f2ce8',
  storageBucket:     'solicitudes-f2ce8.firebasestorage.app',
  messagingSenderId: '1011786962364',
  appId:             '1:1011786962364:web:ce2360a3a8b6b2ae1887b9',
  coleccion:         'solicitudes'
};

let db           = null;
let auth         = null;
let coleccion    = 'solicitudes';
let currentUser  = null;
let currentRole  = 'user';
let registros    = [];
let registrosFiltrados = [];
let articulosData = [{codigo:'', descripcion:'', serial:''}];
let loginAttempts = 0;
let loginLocked = false;
const MAX_LOGIN_ATTEMPTS = 5;
const LOGIN_LOCK_MS = 15 * 60 * 1000; // 15 minutos
let devuelveData  = [{id:'', detalle:'', numeroSerie:''}];
let registrosParsed = [];
let firebaseReady = false;
let editandoId = null; // ID del registro en edición (null = modo creación)
let originalData = null; // Datos originales para comparar cambios
let inventarioDB = [];       // Cache local del inventario
let inventarioCargado = false;
const INVENTARIO_COL = 'inventario'; // colección Firebase con ID/Código y Descripcion

// BUSCADOR GLOBAL
let filaActiva = null;  // Referencia a la fila activa (artículo o devolución)
let equipamientoDB = []; // Cache de equipamiento para búsqueda global

// ─────────────────────────────────────────────────────────────────────────────
// UTILS
// ─────────────────────────────────────────────────────────────────────────────


function toast(msg, tipo = 'success') {
  const el = document.getElementById('toast');
  document.getElementById('toastMsg').textContent = msg;
  document.getElementById('toastIcon').textContent =
    tipo === 'success' ? '✓' : tipo === 'error' ? '✕' : 'i';
  el.className = `toast show ${tipo}`;
  clearTimeout(el._t);
  el._t = setTimeout(() => { el.className = 'toast'; }, 3200);
}

function setStatus(ok, msg) {
  document.getElementById('statusDot').className = 'dot ' + (ok ? 'ok' : 'err');
  document.getElementById('statusText').textContent = msg;
}

function formatFecha(ts) {
  if (!ts) return '—';
  try {
    const d = ts.toDate ? ts.toDate() : new Date(ts);
    return d.toLocaleDateString('es-CL', {
      day:'2-digit', month:'2-digit', year:'numeric',
      hour:'2-digit', minute:'2-digit'
    });
  } catch(e) { return '—'; }
}

function formatLogFecha(ts) {
  if (!ts) return '—';
  try {
    const d = ts.toDate ? ts.toDate() : new Date(ts);
    return d.toLocaleString('es-CL');
  } catch(e) { return '—'; }
}

function getTipoOperacionSeleccionado() {
  return document.querySelector('input[name="tipoOperacion"]:checked')?.value || 'instalacion';
}

function setTipoOperacionSeleccionado(value) {
  const input = document.querySelector(`input[name="tipoOperacion"][value="${value}"]`);
  if (input) input.checked = true;
}

function calcularProgreso(fechaInicio, fechaLimite) {
  if (!fechaInicio || !fechaLimite) return null;
  const inicio = fechaInicio.toDate ? fechaInicio.toDate() : new Date(fechaInicio);
  const limite = fechaLimite.toDate ? fechaLimite.toDate() : new Date(fechaLimite);
  const ahora = new Date();
  const total = limite - inicio;
  if (total <= 0) return 0;
  const restante = limite - ahora;
  const porcentaje = (restante / total) * 100;
  return porcentaje;
}

function obtenerColor(porcentaje) {
  if (porcentaje === null) return '';
  if (porcentaje <= 0) return 'rojo';
  if (porcentaje <= 29) return 'amarillo';
  return 'verde';
}

function actualizarEstados() {
  if (!document.getElementById('view-registros').classList.contains('active')) return;
  renderLista(registrosFiltrados.length ? registrosFiltrados : registros);
}

// ─────────────────────────────────────────────────────────────────────────────
// PERMUTA — temporizador y colores
// ─────────────────────────────────────────────────────────────────────────────
const PERMUTA_HORAS = 167;

function calcularProgreso(fechaInicio, fechaLimite) {
  if (!fechaInicio || !fechaLimite) return null;
  const inicio  = (fechaInicio.toDate  ? fechaInicio.toDate()  : new Date(fechaInicio));
  const limite  = (fechaLimite.toDate  ? fechaLimite.toDate()  : new Date(fechaLimite));
  const ahora   = new Date();
  const total   = limite - inicio;
  const restante = limite - ahora;
  if (total <= 0) return 0;
  return Math.max(0, (restante / total) * 100);
}

function obtenerColorPermuta(porcentaje) {
  if (porcentaje === null) return null;
  if (porcentaje <= 0)  return 'rojo';
  if (porcentaje <= 29) return 'amarillo';
  return 'verde';
}

function formatearRestante(fechaLimite) {
  if (!fechaLimite) return '';
  const limite = fechaLimite.toDate ? fechaLimite.toDate() : new Date(fechaLimite);
  const ahora  = new Date();
  const ms     = limite - ahora;
  if (ms <= 0) return 'Vencida';
  const h = Math.floor(ms / 3600000);
  const m = Math.floor((ms % 3600000) / 60000);
  if (h >= 24) {
    const d = Math.floor(h / 24);
    const hr = h % 24;
    return `${d}d ${hr}h restantes`;
  }
  return `${h}h ${m}m restantes`;
}

function aplicarColorPermutas() {
  registrosFiltrados.forEach(r => {
    const el = document.getElementById('ri-' + r.id);
    if (!el) return;
    el.classList.remove('permuta-verde', 'permuta-amarillo', 'permuta-rojo');
    if (r.tipoOperacion !== 'permuta') return;
    const pct   = calcularProgreso(r.fechaInicioPermuta, r.fechaLimitePermuta);
    const color = obtenerColorPermuta(pct);
    if (color) el.classList.add('permuta-' + color);
  });
}

function copiarAlPortapapeles(texto) {
  // Intenta con Clipboard API (moderno, HTTPS)
  if (navigator.clipboard && navigator.clipboard.writeText) {
    return navigator.clipboard.writeText(texto)
      .then(() => {
        toast('Copiado al portapapeles');
        return true;
      })
      .catch(() => copiarAlPortapapelesFallback(texto));
  } else {
    // Fallback para navegadores antiguos o HTTP
    return copiarAlPortapapelesFallback(texto);
  }
}

function copiarAlPortapapelesFallback(texto) {
  try {
    // Crear un textarea temporal
    const textarea = document.createElement('textarea');
    textarea.value = texto;
    textarea.style.position = 'fixed';
    textarea.style.opacity = '0';
    textarea.style.pointerEvents = 'none';
    document.body.appendChild(textarea);
    
    // Seleccionar y copiar
    textarea.select();
    textarea.setSelectionRange(0, 99999); // Para móviles
    const exitoso = document.execCommand('copy');
    document.body.removeChild(textarea);
    
    if (exitoso) {
      toast('Copiado al portapapeles');
      return Promise.resolve(true);
    } else {
      toast('Error al copiar', 'error');
      return Promise.reject();
    }
  } catch (e) {
    toast('Error al copiar: ' + e.message, 'error');
    return Promise.reject(e);
  }
}

function registrarLog(accion, detalle, changedFields = []) {
  if (!db || !currentUser) return;

  addDoc(collection(db, 'logs'), {
    usuario: currentUser.email || currentUser.uid || 'desconocido',
    uid: currentUser.uid,
    accion,
    detalle,
    changedFields,
    fecha: serverTimestamp()
  }).catch(error => console.error('Error log:', error));
}

// ─────────────────────────────────────────────────────────────────────────────
// BUSCADOR GLOBAL DE EQUIPAMIENTO
// ─────────────────────────────────────────────────────────────────────────────
async function cargarEquipamientoGlobal() {
  if (equipamientoDB.length > 0 || !db) return; // Ya cargado
  try {
    const snap = await getDocs(collection(db, INVENTARIO_COL));
    equipamientoDB = snap.docs.map(d => {
      const data = d.data();
      return {
        id:      data.ID || data.codigo || d.id || '',
        detalle: data.Descripcion || data.descripcion || '',
        cant:    Number(data.Cant ?? data.cant ?? data.Cantidad ?? data.cantidad ?? 0) || 0
      };
    });
    console.log('[Equipamiento Global] Cargados', equipamientoDB.length, 'items');
  } catch(e) {
    console.warn('No se pudo cargar equipamiento global:', e.message);
  }
}

function buscarEquipamientoGlobal(search) {
  const q = search.toLowerCase();
  return equipamientoDB.filter(item =>
    (item.id && item.id.toLowerCase().includes(q)) ||
    (item.detalle && item.detalle.toLowerCase().includes(q))
  ).slice(0, 15);
}

function completarEnTabla(item, tablaTipo) {
  // Agregar nueva fila a la tabla correspondiente
  if (tablaTipo === 'art') {
    articulosData.push({codigo: item.id, descripcion: item.detalle, serial: ''});
    renderArticulos();
    setupAutocomplete('artBody', 'art');
  } else if (tablaTipo === 'dev') {
    devuelveData.push({id: item.id, detalle: item.detalle, numeroSerie: ''});
    renderDevuelve();
    setupAutocomplete('devBody', 'dev');
  }

  // Limpiar búsqueda
  document.getElementById('busquedaGlobal').value = '';
  document.getElementById('resultadosBusqueda').innerHTML = '';
  document.getElementById('resultadosBusqueda').style.display = 'none';
}

function renderResultadosBusqueda(lista) {
  const resultadosDiv = document.getElementById('resultadosBusqueda');
  resultadosDiv.innerHTML = '';

  if (!lista.length) {
    resultadosDiv.innerHTML = '<div style="padding:10px;color:var(--text-dim);text-align:center">Sin coincidencias</div>';
    resultadosDiv.style.display = 'block';
    return;
  }

  lista.forEach(item => {
    const div = document.createElement('div');
    div.style.cssText = 'padding:8px 12px;border-bottom:1px solid var(--border);display:flex;justify-content:space-between;align-items:center;transition:background 0.2s';
    div.classList.add('resultado-equipo');

    const contenido = document.createElement('div');
    contenido.style.cssText = 'flex:1;display:flex;align-items:center;gap:8px';
    contenido.innerHTML = `<strong>${esc(item.id)}</strong> — ${esc(item.detalle)}`;

    if (item.cant >= 1) {
      const qty = document.createElement('span');
      qty.style.cssText = 'background:var(--success);color:#0f172a;padding:2px 6px;border-radius:10px;font-size:11px;font-weight:600;margin-left:8px';
      qty.textContent = `Disponible: ${item.cant}`;
      contenido.appendChild(qty);
    }

    const botones = document.createElement('div');
    botones.style.cssText = 'display:flex;gap:6px;margin-left:8px';

    const btnSolicitud = document.createElement('button');
    btnSolicitud.textContent = 'Solicitud';
    btnSolicitud.style.cssText = 'padding:4px 8px;font-size:11px;background:var(--accent);color:white;border:1px solid var(--accent);border-radius:3px;cursor:pointer;white-space:nowrap;transition:all 0.2s';
    btnSolicitud.addEventListener('mouseenter', () => {
      btnSolicitud.style.background = '#6fa3fa';
    });
    btnSolicitud.addEventListener('mouseleave', () => {
      btnSolicitud.style.background = 'var(--accent)';
    });

    btnSolicitud.addEventListener('click', (e) => {
      e.stopPropagation();
      completarEnTabla(item, 'art');
      toast('Agregado a Solicitud', 'success');
    });

    const btnDevolucion = document.createElement('button');
    btnDevolucion.textContent = 'Devolución';
    btnDevolucion.style.cssText = 'padding:4px 8px;font-size:11px;background:var(--warning);color:#0f172a;border:1px solid var(--warning);border-radius:3px;cursor:pointer;white-space:nowrap;transition:all 0.2s';
    btnDevolucion.addEventListener('mouseenter', () => {
      btnDevolucion.style.background = '#f7c84f';
    });
    btnDevolucion.addEventListener('mouseleave', () => {
      btnDevolucion.style.background = 'var(--warning)';
    });

    btnDevolucion.addEventListener('click', (e) => {
      e.stopPropagation();
      completarEnTabla(item, 'dev');
      toast('Agregado a Devolución', 'success');
    });

    botones.appendChild(btnSolicitud);
    botones.appendChild(btnDevolucion);

    div.addEventListener('mouseenter', () => {
      div.style.background = 'var(--bg-secondary)';
    });
    div.addEventListener('mouseleave', () => {
      div.style.background = 'transparent';
    });

    div.appendChild(contenido);
    div.appendChild(botones);
    resultadosDiv.appendChild(div);
  });

  resultadosDiv.style.display = 'block';
}

function debounceSearch(fn, delay = 300) {
  let timer;
  return (...args) => {
    clearTimeout(timer);
    timer = setTimeout(() => fn(...args), delay);
  };
}

function esc(s) {
  return String(s || '').replace(/&/g,'&amp;').replace(/</g,'&lt;').replace(/>/g,'&gt;');
}

function autoH(el) {
  el.style.height = 'auto';
  el.style.height = el.scrollHeight + 'px';
}

// ─────────────────────────────────────────────────────────────────────────────
// FIREBASE — inicialización única y segura
// ─────────────────────────────────────────────────────────────────────────────
function cargarCfg() {
  try { return JSON.parse(sessionStorage.getItem(CFG_KEY)); } catch(e) { return null; }
}

function poblarCfgUI(c) {
  if (!c) return;
  document.getElementById('cfgApiKey').value        = c.apiKey            || '';
  document.getElementById('cfgAuthDomain').value    = c.authDomain        || '';
  document.getElementById('cfgProjectId').value     = c.projectId         || '';
  document.getElementById('cfgStorageBucket').value = c.storageBucket     || '';
  document.getElementById('cfgSenderId').value      = c.messagingSenderId || '';
  document.getElementById('cfgAppId').value         = c.appId             || '';
  document.getElementById('cfgColeccion').value     = c.coleccion         || 'solicitudes';
}

async function inicializarFirebase(cfg) {
  try {
    // Reusar instancia si ya existe, nunca llamar deleteApp
    const app = getApps().length ? getApp() : initializeApp(cfg);

    db   = getFirestore(app);
    auth = getAuth(app);
    coleccion = cfg.coleccion || 'solicitudes';

    await setPersistence(auth, browserLocalPersistence);

    // El listener onAuthStateChanged controla TODA la UI desde aquí
    onAuthStateChanged(auth, async (user) => {
      if (user) {
        currentUser = user;
        await cargarRol(user.uid);
        mostrarApp();
        await cargarRegistros();
        await cargarInventario(); // precargar inventario para autocomplete
        await cargarEquipamientoGlobal(); // precargar equipamiento para buscador global
      } else {
        currentUser = null;
        currentRole = 'user';
        mostrarLogin();
      }
    });

    firebaseReady = true;
    setStatus(true, 'Firebase conectado');
    document.getElementById('loginBtn').disabled = false;
    document.getElementById('loginInit').textContent = 'Listo. Puedes ingresar.';
    return true;

  } catch(e) {
    setStatus(false, 'Error conexión');
    document.getElementById('loginInit').textContent = 'Error: ' + e.message;
    toast('Error Firebase: ' + e.message, 'error');
    return false;
  }
}

// ─────────────────────────────────────────────────────────────────────────────
// AUTH — control de UI basado en onAuthStateChanged
// ─────────────────────────────────────────────────────────────────────────────
function mostrarLogin() {
  document.getElementById('loginView').style.display  = 'flex';
  document.getElementById('appShell').style.display   = 'none';
  document.getElementById('loginError').textContent   = '';
}

function mostrarApp() {
  document.getElementById('loginView').style.display = 'none';
  document.getElementById('appShell').style.display  = 'block';
  document.getElementById('topbarUser').textContent  = currentUser ? currentUser.email : '';
  // Actualizar campo de creador
  document.getElementById('fCreador').value = currentUser ? currentUser.email : '';
}

async function cargarRol(uid) {
  try {
    const snap = await getDoc(doc(db, 'usuarios', uid));
    currentRole = snap.exists() ? (snap.data().role || 'user') : 'user';
  } catch(e) {
    currentRole = 'user';
  }
  aplicarPermisosUI();
}

function aplicarPermisosUI() {
  const isAdmin = currentRole === 'admin';

  // Mostrar/ocultar elementos admin-only
  document.querySelectorAll('.admin-only').forEach(el => {
    el.style.display = isAdmin ? (el.classList.contains('nav-tab') ? 'flex' : 'block') : 'none';
  });

  // Recargar registros para aplicar filtros de rol
  if (db) cargarRegistros();
}

// LOGIN
document.getElementById('loginBtn').addEventListener('click', async () => {
  if (!firebaseReady) { toast('Firebase no está listo aún', 'error'); return; }
  if (loginLocked) { errEl.textContent = 'Demasiados intentos. Intenta más tarde.'; return; }
  const email = document.getElementById('loginEmail').value.trim();
  const pass  = document.getElementById('loginPass').value;
  const errEl = document.getElementById('loginError');
  const btn   = document.getElementById('loginBtn');

  errEl.textContent = '';
  if (!email || !pass) { errEl.textContent = 'Ingresa correo y contraseña'; return; }

  btn.disabled = true;
  btn.textContent = 'Ingresando...';
  try {
    await signInWithEmailAndPassword(auth, email, pass);
    loginAttempts = 0;
    // onAuthStateChanged se encarga de mostrar la app automáticamente
  } catch(e) {
    loginAttempts += 1;
    if (loginAttempts >= MAX_LOGIN_ATTEMPTS) {
      loginLocked = true;
      setTimeout(() => {
        loginLocked = false;
        loginAttempts = 0;
      }, LOGIN_LOCK_MS);
      errEl.textContent = 'Se ha bloqueado el acceso. Intenta de nuevo más tarde.';
    } else {
      errEl.textContent = 'Credenciales incorrectas';
    }
    btn.disabled = false;
    btn.textContent = 'Ingresar';
  }
});

// Permitir Enter en campos login
['loginEmail','loginPass'].forEach(id => {
  document.getElementById(id).addEventListener('keydown', e => {
    if (e.key === 'Enter') document.getElementById('loginBtn').click();
  });
});

// CAMBIAR CONTRASEÑA
document.getElementById('btnResetPassword').addEventListener('click', async () => {
  try {
    const user = auth?.currentUser;
    const typedEmail = document.getElementById('loginEmail')?.value?.trim();
    const email = user?.email || typedEmail;

    if (!auth) {
      console.warn('[ResetPassword] auth no inicializado');
      toast('Firebase aún no está listo. Recarga la página y vuelve a intentar.', 'error');
      return;
    }

    if (!email) {
      toast('No se encontró correo para restablecer. Ingresa tu email en el login.', 'error');
      return;
    }

    await sendPasswordResetEmail(auth, email);
    console.log('[ResetPassword] Solicitud enviada para', email);
    toast('Correo de restablecimiento enviado a ' + email, 'success');
  } catch(e) {
    console.error('[ResetPassword] error:', e);
    const code = e.code || 'unknown';
    const message = e.message || 'No se pudo enviar el correo';
    toast('Error (' + code + '): ' + message, 'error');
  }
});

// LOGOUT
document.getElementById('btnLogout').addEventListener('click', async () => {
  try { await signOut(auth); } catch(e) { toast('Error al salir', 'error'); }
});

// ─────────────────────────────────────────────────────────────────────────────
// TABLAS DINÁMICAS
// ─────────────────────────────────────────────────────────────────────────────
function renderArticulos() {
  const tbody = document.getElementById('artBody');
  tbody.innerHTML = articulosData.map((row, i) => `
    <tr data-idx="${i}" data-tabla="art">
      <td style="position:relative;overflow:visible">
        <div class="ac-wrap">
          <input type="text" placeholder="E-XXXXX o buscar..." value="${esc(row.codigo)}" data-field="codigo" data-idx="${i}" data-tabla="art" autocomplete="off">
          <div class="ac-dropdown" id="ac-drop-art-${i}"></div>
        </div>
      </td>
      <td style="position:relative;overflow:visible">
        <div class="ac-wrap">
          <textarea placeholder="Descripción del artículo..." rows="1" data-field="descripcion" data-idx="${i}" data-tabla="art" style="height:32px;overflow:hidden">${esc(row.descripcion)}</textarea>
          <div class="ac-dropdown" id="ac-drop-art-desc-${i}"></div>
        </div>
      </td>
      <td><input type="text" placeholder="Numero Serie" value="${esc(row.serial)}" data-field="serial" data-idx="${i}" data-tabla="art" autocomplete="off"></td>
      <td class="td-actions">
        <button class="btn-rm" data-idx="${i}" data-tabla="art" ${articulosData.length === 1 ? 'disabled' : ''}>&times;</button>
      </td>
    </tr>`).join('');
}

function renderDevuelve() {
  const tbody = document.getElementById('devBody');
  tbody.innerHTML = devuelveData.map((row, i) => `
    <tr data-idx="${i}" data-tabla="dev">
      <td style="position:relative;overflow:visible">
        <div class="ac-wrap">
          <input type="text" placeholder="E-XXXXX o buscar..." value="${esc(row.id)}" data-field="id" data-idx="${i}" data-tabla="dev" autocomplete="off">
          <div class="ac-dropdown" id="ac-drop-dev-${i}"></div>
        </div>
      </td>
      <td style="position:relative;overflow:visible">
        <div class="ac-wrap">
          <textarea placeholder="Detalle del equipo devuelto..." rows="1" data-field="detalle" data-idx="${i}" data-tabla="dev" style="height:32px;overflow:hidden">${esc(row.detalle)}</textarea>
          <div class="ac-dropdown" id="ac-drop-dev-detalle-${i}"></div>
        </div>
      </td>
      <td><input type="text" placeholder="Numero Serie" value="${esc(row.numeroSerie)}" data-field="numeroSerie" data-idx="${i}" data-tabla="dev" autocomplete="off"></td>
      <td class="td-actions">
        <button class="btn-rm" data-idx="${i}" data-tabla="dev" ${devuelveData.length === 1 ? 'disabled' : ''}>&times;</button>
      </td>
    </tr>`).join('');
}

// Delegación de eventos para las tablas (evita inline JS)
function setupTablaEvents(tbodyId) {
  document.getElementById(tbodyId).addEventListener('input', e => {
    const el = e.target;
    if (!el.dataset.field) return;
    const idx   = parseInt(el.dataset.idx);
    const tabla = el.dataset.tabla;
    const field = el.dataset.field;
    const arr   = tabla === 'art' ? articulosData : devuelveData;
    arr[idx][field] = el.value;
    if (el.tagName === 'TEXTAREA') autoH(el);
  });

  document.getElementById(tbodyId).addEventListener('click', e => {
    const btn = e.target.closest('.btn-rm');
    if (!btn || btn.disabled) return;
    const idx   = parseInt(btn.dataset.idx);
    const tabla = btn.dataset.tabla;
    if (tabla === 'art' && articulosData.length > 1) {
      articulosData.splice(idx, 1);
      renderArticulos();
      setupAutocomplete('artBody', 'art');
    } else if (tabla === 'dev' && devuelveData.length > 1) {
      devuelveData.splice(idx, 1);
      renderDevuelve();
      setupAutocomplete('devBody', 'dev');
    }
  });
}

// ─────────────────────────────────────────────────────────────────────────────
// AUTOCOMPLETE INVENTARIO
// ─────────────────────────────────────────────────────────────────────────────
async function cargarInventario() {
  if (inventarioCargado || !db) return;
  try {
    const snap = await getDocs(collection(db, INVENTARIO_COL));
    inventarioDB = snap.docs.map(d => {
      const data = d.data();
      // Soporta tanto "ID" como "codigo" y "Descripcion" como "descripcion"
      return {
        codigo:      data.ID || data.codigo || d.id || '',
        descripcion: data.Descripcion || data.descripcion || ''
      };
    });
    inventarioCargado = true;
  } catch(e) {
    console.warn('No se pudo cargar inventario:', e.message);
  }
}

function buscarEnInventario(texto) {
  if (!texto || texto.length < 1) return [];
  const q = texto.toLowerCase();
  return inventarioDB.filter(item =>
    item.codigo.toLowerCase().includes(q) ||
    item.descripcion.toLowerCase().includes(q)
  ).slice(0, 12);
}

let acTimers = {};

function setupAutocomplete(tbodyId, tableType) {
  // Usa delegación sobre tbody para manejar inputs de código y descripción
  const tbody = document.getElementById(tbodyId);

  tbody.addEventListener('input', e => {
    const el = e.target;
    const expectedFields = tableType === 'art' ? ['codigo', 'descripcion'] : ['id', 'detalle'];
    if (!expectedFields.includes(el.dataset.field) || el.dataset.tabla !== tableType) return;
    const idx = parseInt(el.dataset.idx);
    const timerKey = tableType + '-' + idx;
    clearTimeout(acTimers[timerKey]);
    acTimers[timerKey] = setTimeout(() => mostrarDropdown(el, idx, tableType), 120);
  });

  tbody.addEventListener('keydown', e => {
    const el = e.target;
    const expectedFields = tableType === 'art' ? ['codigo', 'descripcion'] : ['id', 'detalle'];
    if (!expectedFields.includes(el.dataset.field) || el.dataset.tabla !== tableType) return;
    const idx  = parseInt(el.dataset.idx);
    const field = el.dataset.field;
    const dropId = field === 'descripcion' || field === 'detalle'
      ? `ac-drop-${tableType}-${field}-${idx}`
      : `ac-drop-${tableType}-${idx}`;
    const drop = document.getElementById(dropId);
    if (!drop || !drop.classList.contains('open')) return;

    const items = drop.querySelectorAll('.ac-item');
    const selIdx = [...items].findIndex(i => i.classList.contains('selected'));

    if (e.key === 'ArrowDown') {
      e.preventDefault();
      const next = Math.min(selIdx + 1, items.length - 1);
      items.forEach(i => i.classList.remove('selected'));
      if (items[next]) items[next].classList.add('selected');
    } else if (e.key === 'ArrowUp') {
      e.preventDefault();
      const prev = Math.max(selIdx - 1, 0);
      items.forEach(i => i.classList.remove('selected'));
      if (items[prev]) items[prev].classList.add('selected');
    } else if (e.key === 'Enter' || e.key === 'Tab') {
      const sel = drop.querySelector('.ac-item.selected');
      if (sel) {
        e.preventDefault();
        aplicarSeleccion(idx, sel.dataset.codigo, sel.dataset.descripcion, tableType, field);
      } else {
        cerrarDropdown(idx, tableType, field);
      }
    } else if (e.key === 'Escape') {
      cerrarDropdown(idx, tableType, field);
    }
  });

  // Cerrar dropdown al hacer click fuera
  document.addEventListener('click', e => {
    if (!e.target.closest('.ac-wrap')) {
      document.querySelectorAll('.ac-dropdown.open').forEach(d => d.classList.remove('open'));
    }
  });
}

async function mostrarDropdown(inputEl, idx, tableType) {
  const field = inputEl.dataset.field;
  const dropId = field === 'descripcion' || field === 'detalle'
    ? `ac-drop-${tableType}-${field}-${idx}`
    : `ac-drop-${tableType}-${idx}`;
  const drop = document.getElementById(dropId);
  if (!drop) return;

  const texto = inputEl.value.trim();
  if (!texto) { cerrarDropdown(idx, tableType, field); return; }

  // Cargar inventario si no está listo
  if (!inventarioCargado) {
    drop.innerHTML = '<div class="ac-loading">⟳ Cargando inventario...</div>';
    drop.classList.add('open');
    await cargarInventario();
  }

  const resultados = buscarEnInventario(texto);
  if (!resultados.length) {
    drop.innerHTML = '<div class="ac-item-empty">Sin coincidencias en inventario</div>';
    drop.classList.add('open');
    return;
  }

  drop.innerHTML = resultados.map(r => `
    <div class="ac-item" data-codigo="${esc(r.codigo)}" data-descripcion="${esc(r.descripcion)}">
      <div class="ac-item-id">${esc(r.codigo)}</div>
      <div class="ac-item-desc">${esc(r.descripcion)}</div>
    </div>`).join('');

  drop.classList.add('open');

  // Click en un item
  drop.querySelectorAll('.ac-item').forEach(item => {
    item.addEventListener('mousedown', e => {
      e.preventDefault(); // evita blur antes del click
      aplicarSeleccion(idx, item.dataset.codigo, item.dataset.descripcion, tableType, field);
    });
  });
}

function aplicarSeleccion(idx, codigo, descripcion, tableType, field = null) {
  if (tableType === 'art') {
    articulosData[idx].codigo      = codigo;
    articulosData[idx].descripcion = descripcion;
    renderArticulos();
    setupAutocomplete('artBody', 'art'); // re-bind tras re-render
  } else if (tableType === 'dev') {
    devuelveData[idx].id           = codigo;
    devuelveData[idx].detalle      = descripcion;
    renderDevuelve();
    setupAutocomplete('devBody', 'dev'); // re-bind tras re-render
  }
  cerrarDropdown(idx, tableType, field);

  // Focus lógico después de selección
  const row = document.querySelector(`#${tableType}Body tr[data-idx="${idx}"]`);
  if (row) {
    // Si se seleccionó desde código, ir a descripción
    // Si se seleccionó desde descripción, mantener el foco ahí
    const targetField = (field === 'codigo' || field === 'id') ? 'textarea' : null;
    if (targetField) {
      const ta = row.querySelector(targetField);
      if (ta) { ta.focus(); ta.select(); }
    }
  }
}

function cerrarDropdown(idx, tableType, field = null) {
  const dropId = field && (field === 'descripcion' || field === 'detalle')
    ? `ac-drop-${tableType}-${field}-${idx}`
    : `ac-drop-${tableType}-${idx}`;
  const drop = document.getElementById(dropId);
  if (drop) drop.classList.remove('open');
}

// ─────────────────────────────────────────────────────────────────────────────
// LISTENERS BUSCADOR GLOBAL
// ─────────────────────────────────────────────────────────────────────────────

// Detectar fila activa al hacer focus en cualquier input de tabla
document.addEventListener('focusin', (e) => {
  const tr = e.target.closest('tr[data-tabla]');
  if (tr) {
    filaActiva = tr;
    console.log('[BuscadorGlobal] Fila activa:', filaActiva.dataset.tabla, 'índice:', filaActiva.dataset.idx);
  }
});

// Búsqueda con debounce
const inputBusqueda = document.getElementById('busquedaGlobal');
const debouncedSearch = debounceSearch(async (valor) => {
  if (valor.length < 2) {
    document.getElementById('resultadosBusqueda').innerHTML = '';
    document.getElementById('resultadosBusqueda').style.display = 'none';
    return;
  }

  // Cargar equipamiento si no está listo
  if (equipamientoDB.length === 0) {
    await cargarEquipamientoGlobal();
  }

  const resultados = buscarEquipamientoGlobal(valor);
  renderResultadosBusqueda(resultados);
}, 300);

inputBusqueda.addEventListener('input', (e) => {
  const valor = e.target.value.trim().toLowerCase();
  debouncedSearch(valor);
});

// Limpiar búsqueda
document.getElementById('btnLimpiarBusqueda').addEventListener('click', () => {
  document.getElementById('busquedaGlobal').value = '';
  document.getElementById('resultadosBusqueda').innerHTML = '';
  document.getElementById('resultadosBusqueda').style.display = 'none';
  filaActiva = null;
  inputBusqueda.focus();
});

document.getElementById('btnAgregarArticulo').addEventListener('click', () => {
  const last = articulosData[articulosData.length - 1];
  if (!last.codigo && !last.descripcion) { toast('Completa el artículo antes de agregar otro', 'info'); return; }
  articulosData.push({codigo:'', descripcion:'', serial:''});
  renderArticulos();
  setupAutocomplete('artBody', 'art');
});

document.getElementById('btnAgregarDevuelve').addEventListener('click', () => {
  const last = devuelveData[devuelveData.length - 1];
  if (!last.id && !last.detalle) { toast('Completa el equipo antes de agregar otro', 'info'); return; }
  devuelveData.push({id:'', detalle:'', numeroSerie:''});
  renderDevuelve();
  setupAutocomplete('devBody', 'dev');
});

// ─────────────────────────────────────────────────────────────────────────────
// FORMULARIO NUEVA SOLICITUD
// ─────────────────────────────────────────────────────────────────────────────
function limpiarFormulario() {
  ['fSolicitud','fDevolucion','fUsuario','fDireccion','fBcs','fSci','observacion'].forEach(id => {
    document.getElementById(id).value = '';
  });
  setTipoOperacionSeleccionado('instalacion');
  // El creador se mantiene igual (es el usuario logueado)
  articulosData = [{codigo:'', descripcion:'', serial:''}];
  devuelveData  = [{id:'', detalle:'', numeroSerie:''}];
  editandoId = null;
  originalData = null; // Resetear datos originales
  document.getElementById('btnGuardar').textContent = 'Guardar';
  document.getElementById('formMsg').textContent = '';
  renderArticulos();
  renderDevuelve();
  document.getElementById('fSolicitud').focus();
  setupAutocomplete('artBody', 'art');
  setupAutocomplete('devBody', 'dev');
}

document.getElementById('btnLimpiar').addEventListener('click', limpiarFormulario);

document.getElementById('btnCopiar').addEventListener('click', () => {
  const sol = document.getElementById('fSolicitud').value.trim();
  const dev = document.getElementById('fDevolucion').value.trim();
  const usr = document.getElementById('fUsuario').value.trim();
  const dir = document.getElementById('fDireccion').value.trim();
  const bcs = document.getElementById('fBcs').value.trim();
  const sci = document.getElementById('fSci').value.trim();

  let texto = `solicitud: ${sol}\ndevolucion: ${dev}\n\n`;
  texto += `Usuario: ${usr}\nDireccion: ${dir}\nBCS: ${bcs}\nSCI: ${sci}\n\n`;
  texto += 'articulos solicitados:\n';
  articulosData.forEach(a => {
    if (a.codigo || a.descripcion)
      texto += `- ${a.codigo || '—'} - ${a.descripcion || '—'} - ${a.serial || '—'}\n`;
  });
  texto += '\ndevuelve:\n';
  devuelveData.forEach(d => {
    if (d.id || d.detalle)
      texto += `- ${d.id || '—'} - ${d.detalle || '—'} - ${d.numeroSerie || '—'}\n`;
  });

  copiarAlPortapapeles(texto);
});

document.getElementById('btnGuardar').addEventListener('click', async () => {
  if (!db) { toast('Firebase no conectado', 'error'); return; }
  const btn   = document.getElementById('btnGuardar');
  const msgEl = document.getElementById('formMsg');
  const sol   = document.getElementById('fSolicitud').value.trim();
  const usr   = document.getElementById('fUsuario').value.trim();
  if (!sol && !usr) { toast('Ingresa al menos N° Solicitud o Usuario', 'error'); return; }

  const artsL = articulosData.filter(a => a.codigo || a.descripcion);
  const devL  = devuelveData.filter(a => a.id || a.detalle);

  // Tipo operación y fechas de permuta
  const tipoOp = document.querySelector('input[name="tipoOperacion"]:checked')?.value || '';
  let fechaInicioPermuta = null;
  let fechaLimitePermuta = null;
  if (tipoOp === 'permuta' && !editandoId) {
    // Solo crear fechas al crear, no al editar (se preservan las originales)
    fechaInicioPermuta = new Date();
    fechaLimitePermuta = new Date(fechaInicioPermuta.getTime() + PERMUTA_HORAS * 3600 * 1000);
  } else if (tipoOp === 'permuta' && editandoId && originalData) {
    // Al editar permuta: conservar fechas originales si ya existen
    fechaInicioPermuta = originalData.fechaInicioPermuta || new Date();
    fechaLimitePermuta = originalData.fechaLimitePermuta || new Date(new Date().getTime() + PERMUTA_HORAS * 3600 * 1000);
  }

  const data = {
    solicitud:     sol,
    devolucion:    document.getElementById('fDevolucion').value.trim(),
    usuario:       usr,
    creador:       document.getElementById('fCreador').value.trim(),
    direccion:     document.getElementById('fDireccion').value.trim(),
    bcs:           document.getElementById('fBcs').value.trim(),
    sci:           document.getElementById('fSci').value.trim(),
    observaciones: document.getElementById('observacion').value.trim(),
    articulos:     artsL,
    devuelve:      devL,
    uid:           currentUser ? currentUser.uid : '',
    tipoOperacion:      tipoOp || '',
    fechaInicioPermuta: fechaInicioPermuta,
    fechaLimitePermuta: fechaLimitePermuta,
  };

  btn.disabled = true;
  msgEl.textContent = editandoId ? 'Actualizando...' : 'Guardando...';
  try {
    if (editandoId) {
      // MODO EDICIÓN — actualizar documento existente, conservar fecha original
      await updateDoc(doc(db, coleccion, editandoId), data);
      const changedFields = [];
      const fieldsToCheck = ['solicitud', 'devolucion', 'usuario', 'creador', 'direccion', 'bcs', 'sci', 'observaciones', 'tipoOperacion', 'articulos', 'devuelve'];
      fieldsToCheck.forEach(field => {
        if (JSON.stringify(data[field]) !== JSON.stringify(originalData[field])) {
          changedFields.push(field);
        }
      });
      registrarLog('EDITAR_SOLICITUD', `Solicitud ${sol} actualizada por ${usr}`, changedFields);
      toast('Registro actualizado correctamente');
    } else {
      // MODO CREACIÓN — nuevo documento con timestamp actual
      await addDoc(collection(db, coleccion), { ...data, fecha: serverTimestamp() });
      registrarLog('CREAR_SOLICITUD', `Solicitud ${sol} creada por ${usr}`);
      toast('Solicitud guardada correctamente');
    }
    limpiarFormulario();
    await cargarRegistros();
  } catch(e) {
    toast('Error: ' + e.message, 'error');
  }
  btn.disabled = false;
  msgEl.textContent = '';
});

// ─────────────────────────────────────────────────────────────────────────────
// REGISTROS
// ─────────────────────────────────────────────────────────────────────────────
async function cargarRegistros() {
  if (!db) { renderLista([]); return; }
  try {
    const q    = query(collection(db, coleccion), orderBy('fecha', 'desc'));
    const snap = await getDocs(q);
    registros  = snap.docs.map(d => Object.assign({id: d.id}, d.data()));
    // Filter based on role
    if (currentRole === 'user') {
      registros = registros.filter(r => r.uid === currentUser.uid);
    }
    // For globalviewer and admin, show all
    document.getElementById('totalBadge').textContent = registros.length;
    filtrarRegistros();
  } catch(e) {
    toast('Error al cargar: ' + e.message, 'error');
    renderLista([]);
  }
}

function filtrarRegistros() {
  const q     = document.getElementById('searchInput').value.trim().toLowerCase();
  const campo = document.getElementById('filterField').value;
  if (!q) {
    registrosFiltrados = registros.slice();
    renderLista(registrosFiltrados);
    return;
  }
  registrosFiltrados = registros.filter(r => {
    const artsStr = (r.articulos||[]).map(a => `${a.codigo||''} ${a.descripcion||''} ${a.serial||''}`).join(' ').toLowerCase();
    const devStr  = (r.devuelve||[]).map(a => `${a.id||a.codigo||''} ${a.detalle||a.descripcion||''} ${a.numeroSerie||''}`).join(' ').toLowerCase();
    if (campo === 'all') {
      return ['solicitud','devolucion','usuario','creador','bcs','sci','observaciones','direccion']
        .some(k => (r[k]||'').toLowerCase().includes(q)) || artsStr.includes(q) || devStr.includes(q);
    }
    if (campo === 'codigo')   return artsStr.includes(q);
    if (campo === 'serial')   return artsStr.includes(q);
    if (campo === 'devuelve') return devStr.includes(q);
    if (campo === 'creador')  return (r.creador||'').toLowerCase().includes(q);
    return (r[campo]||'').toLowerCase().includes(q);
  });
  renderLista(registrosFiltrados);
}

function renderLista(lista) {
  const el = document.getElementById('regList');
  const headers = document.getElementById('regColHeaders');
  if (!lista.length) {
    el.innerHTML = `<div class="empty">${db ? 'Sin registros que mostrar' : 'Configura Firebase primero'}</div>`;
    if (headers) headers.classList.add('oculto');
    return;
  }
  if (headers) headers.classList.remove('oculto');
  el.innerHTML = '<div class="reg-list">' + lista.map(r => {
    const arts    = r.articulos || [];
    const devs    = r.devuelve  || [];
    const hasDev  = devs.filter(d => d.id || d.detalle || d.codigo || d.descripcion).length;
    const hasObs  = !!r.observaciones;
    const pillsDev  = hasDev ? `<span class="pill pill-warn">dev ${hasDev}</span> ` : '';
    const pillsObs  = hasObs ? '<span class="pill pill-blue">obs</span> ' : '';
    const pillsArts = arts.length ? `<span class="pill pill-green">art ${arts.length}</span>` : '';

    // Permuta: calcular progreso y badge
    let permutaBadgeHtml = '';
    let permutaDetailHtml = '';
    let permutaColorClass = '';
    if (r.tipoOperacion === 'permuta') {
      const pct   = calcularProgreso(r.fechaInicioPermuta, r.fechaLimitePermuta);
      const color = obtenerColor(pct);
      permutaColorClass = color ? ' ' + color : '';
      const restanteStr = pct !== null ? (pct <= 0 ? 'Vencido' : `${Math.max(0, Math.round(pct))}% restante`) : 'Sin fechas';
      permutaBadgeHtml = color
        ? `<span class="permuta-badge ${color}">⏱ ${restanteStr}</span> `
        : '<span class="permuta-badge">⏱ Permuta</span> ';
      const inicioStr = r.fechaInicioPermuta ? formatFecha(r.fechaInicioPermuta) : '—';
      const limiteStr = r.fechaLimitePermuta ? formatFecha(r.fechaLimitePermuta) : '—';
      permutaDetailHtml = `<div class="permuta-detail${color ? ' ' + color : ''}">
        <strong>Permuta</strong>
        <span>Inicio: ${inicioStr}</span>
        <span>Límite: ${limiteStr}</span>
        <span>${restanteStr}</span>
      </div>`;
    } else if (r.tipoOperacion === 'instalacion') {
      permutaBadgeHtml = '<span class="pill pill-blue">instalación</span> ';
    }

    const artsHtml = arts.length
      ? arts.map(a => `<div class="det-art-row"><div class="det-art-cod">${esc(a.codigo||'—')}</div><div>${esc(a.descripcion||'—')}</div><div class="det-art-ser">${esc(a.serial||'—')}</div></div>`).join('')
      : '<div style="color:var(--text-dim);font-size:13px;padding:4px 0">Sin artículos registrados</div>';

    const devsFiltered = devs.filter(d => d.id || d.detalle || d.codigo || d.descripcion);
    const devsHtml = devsFiltered.length
      ? devsFiltered.map(d => `<div class="det-dev-row">${(d.id || d.codigo) ? `<strong style="font-family:var(--mono);font-size:12px">${esc(d.id||d.codigo)}</strong> — ` : ''}${esc(d.detalle||d.descripcion||d.id||d.codigo||'')} ${d.numeroSerie ? `<span style="color:var(--text-muted);font-size:12px">(${esc(d.numeroSerie)})</span>` : ''}</div>`).join('')
      : '<div style="color:var(--text-dim);font-size:13px;padding:4px 0">Sin equipos devueltos</div>';

    const obsRow = r.observaciones
      ? `<div class="det-field" style="grid-column:1/-1"><label>Observaciones</label><div class="det-val warn">${esc(r.observaciones)}</div></div>`
      : '';

    return `<div class="reg-item${permutaColorClass}" id="ri-${r.id}">
      <div class="reg-header" data-rid="${r.id}">
        <div class="reg-sol">${esc(r.solicitud||'—')}</div>
        <div class="reg-user">${esc(r.usuario||'—')} <span style="font-size:11px;color:var(--text-muted)">${permutaBadgeHtml}${pillsDev}${pillsObs}${pillsArts}</span></div>
        <div class="reg-bcs">${esc(r.bcs||'—')}</div>
        <div class="reg-sci">${esc(r.sci||'—')}</div>
        <div class="reg-chevron">&#9660;</div>
      </div>
      <div class="reg-body">
        ${permutaDetailHtml}
        <div class="det-grid">
          <div class="det-field"><label>N° Solicitud</label><div class="det-val mono">${esc(r.solicitud||'—')}</div></div>
          <div class="det-field"><label>N° Devolución</label><div class="det-val mono">${esc(r.devolucion||'—')}</div></div>
          <div class="det-field"><label>Usuario</label><div class="det-val">${esc(r.usuario||'—')}</div></div>
          <div class="det-field"><label>Creador</label><div class="det-val" style="color:var(--text-muted);font-size:12px;font-family:var(--mono)">${esc(r.creador||'—')}</div></div>
          <div class="det-field"><label>Fecha</label><div class="det-val" style="color:var(--text-muted)">${formatFecha(r.fecha)}</div></div>
          <div class="det-field" style="grid-column:1/-1"><label>Dirección</label><div class="det-val">${esc(r.direccion||'—')}</div></div>
          <div class="det-field"><label>BCS</label><div class="det-val mono">${esc(r.bcs||'—')}</div></div>
          <div class="det-field"><label>SCI</label><div class="det-val mono">${esc(r.sci||'—')}</div></div>
          ${obsRow}
        </div>
        <hr class="det-sep">
        <div class="det-sub">Artículos Solicitados (${arts.length})</div>
        ${artsHtml}
        <hr class="det-sep">
        <div class="det-sub">Equipamiento devuelto</div>
        ${devsHtml}
        <div class="det-actions">
          <button class="btn btn-ghost" style="font-size:12px;padding:6px 12px" data-action="copiar" data-rid="${r.id}">&#128203; Copiar</button>
          <button class="btn btn-primary" style="font-size:12px;padding:6px 12px" data-action="correo" data-rid="${r.id}">✉️ Enviar por correo</button>
          <button class="btn btn-ghost" style="font-size:12px;padding:6px 12px" data-action="editar" data-rid="${r.id}" style="display:${(currentRole === 'admin' || r.uid === currentUser.uid) ? 'inline-flex' : 'none'}">Editar</button>
          <button class="btn btn-danger" style="font-size:12px;padding:6px 12px;display:${(currentRole === 'admin' || r.uid === currentUser.uid) ? 'inline-flex' : 'none'}" data-action="eliminar" data-rid="${r.id}">Eliminar</button>
        </div>
      </div>
    </div>`;
  }).join('') + '</div>';
}

// Delegación de eventos en la lista
document.getElementById('regList').addEventListener('click', async e => {
  // Toggle acordeón
  const header = e.target.closest('.reg-header');
  if (header) {
    const item = header.closest('.reg-item');
    if (item) item.classList.toggle('open');
    return;
  }
  // Acciones
  const btn = e.target.closest('[data-action]');
  if (!btn) return;
  const rid    = btn.dataset.rid;
  const action = btn.dataset.action;
  if (action === 'copiar')   copiarRegistro(rid);
  if (action === 'correo')   enviarCorreo(rid);
  if (action === 'editar')   editarRegistro(rid);
  if (action === 'eliminar') await eliminarRegistro(rid);
});

function generarTextoRegistro(id) {
  const r = registros.find(x => x.id === id);
  if (!r) return '';

  let texto = '';
  texto += `solicitud: ${r.solicitud || ''}\n`;
  texto += `devolucion: ${r.devolucion || ''}\n\n`;
  texto += `Usuario: ${r.usuario || ''}\n`;
  texto += `Direccion: ${r.direccion || ''}\n`;
  texto += `BCS: ${r.bcs || ''}\n`;
  texto += `SCI: ${r.sci || ''}\n`;
  if (r.observaciones) texto += `Observaciones: ${r.observaciones}\n`;
  texto += '\n';

  const arts = (r.articulos || []).filter(a => a.codigo || a.descripcion);
  texto += 'Articulos solicitados:\n';
  if (arts.length) {
    arts.forEach(a => { texto += `- ${a.codigo || '—'} - ${a.descripcion || '—'} - ${a.serial || '—'}\n`; });
  } else {
    texto += '- Sin artículos\n';
  }

  const devs = (r.devuelve || []).filter(d => d.id || d.detalle || d.codigo || d.descripcion);
  if (devs.length) {
    texto += '\nDevuelve:\n';
    devs.forEach(d => { texto += `- ${d.id || d.codigo || '—'} - ${d.detalle || d.descripcion || '—'} - ${d.numeroSerie || '—'}\n`; });
  }

  return texto;
}

function copiarRegistro(id) {
  const texto = generarTextoRegistro(id);
  if (!texto) return;

  copiarAlPortapapeles(texto);
}

function enviarCorreo(id) {
  const texto = generarTextoRegistro(id);
  if (!texto) {
    toast('No hay datos para enviar', 'error');
    return;
  }

  const asunto = encodeURIComponent('Solicitud de equipamiento');
  const cuerpo = encodeURIComponent(texto);
  const mailtoLink = `mailto:?subject=${asunto}&body=${cuerpo}`;

  window.location.href = mailtoLink;
}

document.getElementById('searchInput').addEventListener('input', filtrarRegistros);
document.getElementById('filterField').addEventListener('change', filtrarRegistros);
document.getElementById('btnActualizar').addEventListener('click', cargarRegistros);

function editarRegistro(id) {
  const r = registros.find(x => x.id === id);
  if (!r) return;
  if (!(currentRole === 'admin' || r.uid === currentUser.uid)) {
    toast('No tienes permisos para editar este registro', 'error');
    return;
  }
  originalData = { ...r }; // Guardar datos originales para comparar cambios
  document.getElementById('fSolicitud').value   = r.solicitud     || '';
  document.getElementById('fDevolucion').value  = r.devolucion    || '';
  document.getElementById('fUsuario').value     = r.usuario       || '';
  document.getElementById('fDireccion').value   = r.direccion     || '';
  document.getElementById('fBcs').value         = r.bcs           || '';
  document.getElementById('fSci').value         = r.sci           || '';
  document.getElementById('observacion').value  = r.observaciones || '';
  setTipoOperacionSeleccionado(r.tipoOperacion || 'instalacion');
  articulosData = (r.articulos && r.articulos.length)
    ? r.articulos.map(a => ({codigo: a.codigo||'', descripcion: a.descripcion||'', serial: a.serial||''}))
    : [{codigo:'', descripcion:'', serial:''}];
  devuelveData = (r.devuelve && r.devuelve.length)
    ? r.devuelve.map(a => ({id: a.id||a.codigo||'', detalle: a.detalle||a.descripcion||'', numeroSerie: a.numeroSerie||''}))
    : [{id:'', detalle:'', numeroSerie:''}];
  editandoId = id;
  document.getElementById('btnGuardar').textContent = 'Actualizar';
  document.getElementById('formMsg').textContent = 'Editando registro existente';
  renderArticulos();
  renderDevuelve();
  cambiarVista('nueva');
  toast('Datos cargados — modifica y presiona Actualizar', 'info');
}

async function eliminarRegistro(id) {
  const r = registros.find(x => x.id === id);
  if (!db || !r || !(currentRole === 'admin' || r.uid === currentUser.uid)) {
    toast('No tienes permisos para eliminar este registro', 'error');
    return;
  }
  if (!confirm('¿Eliminar este registro?')) return;
  try {
    await deleteDoc(doc(db, coleccion, id));
    toast('Registro eliminado');
    registrarLog('ELIMINAR_REGISTRO', `Registro ${id} eliminado`);
    await cargarRegistros();
  } catch(e) { toast('Error: ' + e.message, 'error'); }
}

// ─────────────────────────────────────────────────────────────────────────────
// NAV
// ─────────────────────────────────────────────────────────────────────────────
function cambiarVista(nombre) {
  const viewEl = document.getElementById('view-' + nombre);
  if (viewEl && viewEl.classList.contains('admin-only') && currentRole !== 'admin') {
    toast('No tienes permisos para acceder a esta sección', 'error');
    return;
  }

  if (nombre === 'subir') {
    window.open('subir_inventario.html', '_blank');
    return;
  }

  document.querySelectorAll('.view').forEach(v => v.classList.remove('active'));
  document.querySelectorAll('.nav-tab').forEach(t => t.classList.remove('active'));
  const tabEl  = document.querySelector(`[data-view="${nombre}"]`);
  if (viewEl) viewEl.classList.add('active');
  if (tabEl)  tabEl.classList.add('active');
  window.scrollTo(0, 0);
  if (nombre === 'registros') cargarRegistros();
}

document.getElementById('mainNav').addEventListener('click', e => {
  const tab = e.target.closest('.nav-tab');
  if (tab && tab.dataset.view) cambiarVista(tab.dataset.view);
});

// ─────────────────────────────────────────────────────────────────────────────
// CONFIG GUARDADO
// ─────────────────────────────────────────────────────────────────────────────
document.getElementById('btnGuardarConfig').addEventListener('click', async () => {
  const cfg = {
    apiKey:            document.getElementById('cfgApiKey').value.trim(),
    authDomain:        document.getElementById('cfgAuthDomain').value.trim(),
    projectId:         document.getElementById('cfgProjectId').value.trim(),
    storageBucket:     document.getElementById('cfgStorageBucket').value.trim(),
    messagingSenderId: document.getElementById('cfgSenderId').value.trim(),
    appId:             document.getElementById('cfgAppId').value.trim(),
    coleccion:         document.getElementById('cfgColeccion').value.trim() || 'solicitudes'
  };
  if (!cfg.apiKey || !cfg.projectId) { toast('Completa API Key y Project ID', 'error'); return; }
  sessionStorage.setItem(CFG_KEY, JSON.stringify(cfg));
  const ok = await inicializarFirebase(cfg);
  if (ok) toast('Configuración guardada en sesión y conectado');
});

document.getElementById('btnProbarConfig').addEventListener('click', () => {
  toast(db ? 'Firebase conectado correctamente' : 'No hay conexión activa', db ? 'success' : 'error');
});

// ─────────────────────────────────────────────────────────────────────────────
// IMPORTAR TXT
// ─────────────────────────────────────────────────────────────────────────────
function parsearTXT(texto) {
  const bloques = texto.split(/\n[ \t]*-{4,}[ \t]*(?:\n|$)/)
    .map(b => b.trim())
    .filter(b => b.length > 2);

  return bloques.map(bloque => {
    const lineas = bloque.split('\n').map(l => l.trim()).filter(Boolean);
    const r = {solicitud:'', devolucion:'', usuario:'', direccion:'', bcs:'', sci:'', observaciones:'', articulos:[], devuelve:[]};
    let modoDevuelve = false;

    for (const linea of lineas) {
      if (/^-{4,}$/.test(linea)) { modoDevuelve = false; continue; }
      const m = linea.match(/^([^:]{1,30}?)\s*:\s*(.*)$/);
      if (m) {
        modoDevuelve = false;
        const clave = m[1].trim().toLowerCase();
        const valor = m[2].trim();
        if (clave === 'os' || clave === 'solicitud')          { r.solicitud = r.solicitud || valor; }
        else if (clave === 'devolucion' || clave === 'devolución') { r.devolucion = valor; }
        else if (clave === 'usuario')                          { r.usuario = valor; }
        else if (clave === 'direccion' || clave === 'dirección') { r.direccion = valor; }
        else if (clave === 'bcs')                              { r.bcs = valor || clave.toUpperCase(); }
        else if (clave === 'sci' || clave === 'scti')          { r.sci = valor || linea; }
        else if (clave.includes('devuelve') || clave.includes('devuelv')) {
          modoDevuelve = true;
          if (valor) r.devuelve.push({codigo:'', descripcion:valor});
        } else if (clave.includes('detalle') || clave.includes('observ')) {
          r.observaciones = valor;
        }
        continue;
      }
      if (modoDevuelve && !/^E-/i.test(linea)) {
        r.devuelve.push({codigo:'', descripcion:linea});
        continue;
      }
      const artM = linea.match(/^(E-[A-Z0-9\-\.]+)\s+(.+)$/i);
      if (artM) {
        const desc = artM[2].replace(/\t.*$/, '').replace(/\s{3,}\d.*$/, '').trim();
        r.articulos.push({codigo: artM[1].trim(), descripcion: desc});
        modoDevuelve = false;
        continue;
      }
      if (/^BCS-?\d+/i.test(linea))  { r.bcs = linea.trim(); continue; }
      if (/^SCTI?-?\d+/i.test(linea)) { r.sci = linea.trim(); continue; }
      const solM = linea.match(/^[Ss]olicitud\s+(\d+)/);
      if (solM) { r.solicitud = r.solicitud || solM[1]; continue; }
      if (/^\d{5,}$/.test(linea)) { r.solicitud = r.solicitud || linea; continue; }
      if (!r.usuario && /^[A-ZÁÉÍÓÚÑ][a-záéíóúñ]+ [A-ZÁÉÍÓÚÑ]/.test(linea)) { r.usuario = linea; continue; }
      if (!r.observaciones && linea.length > 3 && linea.length < 80 && !/^\d+$/.test(linea)) {
        r.observaciones = linea;
      }
    }
    return r;
  }).filter(r => r.solicitud || r.usuario || r.bcs || r.articulos.length);
}

document.getElementById('importFile').addEventListener('change', function() {
  const file = this.files[0];
  if (!file) return;
  const reader = new FileReader();
  reader.onload = e => {
    registrosParsed = parsearTXT(e.target.result);
    document.getElementById('importCount').textContent = registrosParsed.length;
    document.getElementById('importPreview').style.display = 'block';
    document.getElementById('importLog').textContent = registrosParsed.map((r, i) =>
      `[${i+1}] Sol:${r.solicitud||'—'} | User:${r.usuario||'—'} | BCS:${r.bcs||'—'} | Arts:${r.articulos.length} | Dev:${r.devuelve.length}`
    ).join('\n');
    toast(registrosParsed.length + ' registros detectados', 'success');
  };
  reader.readAsText(file, 'UTF-8');
});

document.getElementById('btnToggleLog').addEventListener('click', () => {
  const log = document.getElementById('importLog');
  log.style.display = log.style.display === 'block' ? 'none' : 'block';
});

document.getElementById('btnImportar').addEventListener('click', async () => {
  if (!db)                      { toast('Firebase no conectado', 'error'); return; }
  if (!registrosParsed.length)  { toast('Sin registros para importar', 'error'); return; }
  if (!confirm(`¿Subir ${registrosParsed.length} registros a Firebase?`)) return;

  const btn = document.getElementById('btnImportar');
  const pw  = document.getElementById('progWrap');
  const pt  = document.getElementById('progText');
  const pb  = document.getElementById('progBar');
  btn.disabled = true;
  pw.style.display = 'block';

  let ok = 0, fail = 0;
  const total = registrosParsed.length;

  for (let i = 0; i < total; i++) {
    const r = registrosParsed[i];
    try {
      await addDoc(collection(db, coleccion), {
        solicitud:     r.solicitud    || '',
        devolucion:    r.devolucion   || '',
        usuario:       r.usuario      || '',
        direccion:     r.direccion    || '',
        bcs:           r.bcs          || '',
        sci:           r.sci          || '',
        observaciones: r.observaciones|| '',
        articulos:     r.articulos,
        devuelve:      r.devuelve,
        importado:     true,
        uid:           currentUser ? currentUser.uid : '',
        fecha:         serverTimestamp()
      });
      ok++;
    } catch(e) { fail++; }
    pt.textContent   = `${i+1}/${total}`;
    pb.style.width   = Math.round(((i+1)/total)*100) + '%';
  }

  btn.disabled = false;
  toast(`Listo: ${ok} subidos${fail ? ', '+fail+' errores' : ''}`, fail ? 'error' : 'success');
  if (ok) registrarLog('IMPORTAR', `Importados ${ok} registros desde TXT`);
  await cargarRegistros();
  registrosParsed = [];
  document.getElementById('importPreview').style.display = 'none';
  document.getElementById('importFile').value = '';
  pw.style.display = 'none';
  pb.style.width   = '0%';
});

// ─────────────────────────────────────────────────────────────────────────────
// EXPORTAR A EXCEL
// ─────────────────────────────────────────────────────────────────────────────
async function exportToExcel() {
  if (!db) { toast('Firebase no conectado', 'error'); return; }

  // Obtener registros según rol
  let registrosParaExportar = [];
  try {
    const q = query(collection(db, coleccion), orderBy('fecha', 'desc'));
    const snap = await getDocs(q);
    registrosParaExportar = snap.docs.map(d => Object.assign({id: d.id}, d.data()));
    if (currentRole === 'user') {
      registrosParaExportar = registrosParaExportar.filter(r => r.uid === currentUser.uid);
    }
  } catch(e) {
    console.error('Error al obtener registros:', e);
    toast('Error al obtener datos', 'error');
    return;
  }

  if (!registrosParaExportar.length) {
    toast('No hay registros para exportar', 'info');
    return;
  }

  // Transformar datos
  const data = registrosParaExportar.map(r => ({
    solicitudId: r.solicitud || '',
    devolucionId: r.devolucion || '',
    usuarioAfectado: r.usuario || '',
    direccion: r.direccion || '',
    bcs: r.bcs || '',
    scti: r.sci || '',
    observaciones: r.observaciones || '',
    createdAt: r.fecha ? r.fecha.toDate().toISOString() : '',
    updatedAt: r.fecha ? r.fecha.toDate().toISOString() : '', // Usar fecha como updatedAt
    equipamientoSolicitado: (r.articulos || []).map(a => `${a.codigo || ''} | ${a.descripcion || ''} | ${a.serial || ''}`).join('\n'),
    equipamientoDevuelto: (r.devuelve || []).map(d => `${d.id || d.codigo || ''} | ${d.detalle || d.descripcion || ''} | ${d.numeroSerie || ''}`).join('\n')
  }));

  // Generar Excel
  const worksheet = XLSX.utils.json_to_sheet(data);
  const workbook = XLSX.utils.book_new();
  XLSX.utils.book_append_sheet(workbook, worksheet, "Registros");
  const filename = currentRole === 'user' ? 'registros_personales.xlsx' : 'registros_globales.xlsx';
  XLSX.writeFile(workbook, filename);
  toast('Archivo Excel descargado', 'success');
}

document.getElementById('btnExportExcel').addEventListener('click', exportToExcel);

// ─────────────────────────────────────────────────────────────────────────────
// TEMA DARK/LIGHT
// ─────────────────────────────────────────────────────────────────────────────
const themeToggle = document.getElementById('themeToggle');

// Aplicar tema guardado al cargar
if (localStorage.getItem('theme') === 'light') {
  document.body.classList.add('light-mode');
  themeToggle.textContent = '☀️ Tema';
} else {
  themeToggle.textContent = '🌙 Tema';
}

themeToggle.addEventListener('click', () => {
  document.body.classList.toggle('light-mode');
  const isLight = document.body.classList.contains('light-mode');
  localStorage.setItem('theme', isLight ? 'light' : 'dark');
  themeToggle.textContent = isLight ? '☀️ Tema' : '🌙 Tema';
});

// ─────────────────────────────────────────────────────────────────────────────
// TIPO OPERACION — listeners de radios (diferidos, seguros ante DOM oculto)
// ─────────────────────────────────────────────────────────────────────────────
document.addEventListener('change', e => {
  if (e.target.name === 'tipoOperacion') {
    const cl = document.getElementById('tipoClear');
    if (cl) cl.style.display = 'inline';
  }
});

document.addEventListener('click', e => {
  if (e.target.id === 'tipoClear') {
    document.querySelectorAll('input[name="tipoOperacion"]').forEach(r => r.checked = false);
    e.target.style.display = 'none';
  }
});

// ─────────────────────────────────────────────────────────────────────────────
// ACTUALIZACIÓN AUTOMÁTICA DE COLORES DE PERMUTA (cada 60 s)
// ─────────────────────────────────────────────────────────────────────────────
setInterval(() => {
  actualizarEstados();
}, 60000);

// ─────────────────────────────────────────────────────────────────────────────
// INIT — punto de entrada
// ─────────────────────────────────────────────────────────────────────────────
(async () => {
  // Configurar tablas antes de todo
  renderArticulos();
  renderDevuelve();
  setupTablaEvents('artBody');
  setupTablaEvents('devBody');
  setupAutocomplete('artBody', 'art');
  setupAutocomplete('devBody', 'dev');
  setTipoOperacionSeleccionado('instalacion');

  // Cargar config guardada o usar default
  const cfgGuardada = cargarCfg();
  const cfgActiva   = cfgGuardada || DEFAULT_CFG;
  poblarCfgUI(cfgActiva);

  // Inicializar Firebase (una sola vez)
  await inicializarFirebase(cfgActiva);
})();