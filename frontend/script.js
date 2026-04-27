// ─────────────────────────────────────────────────────────────────────────────
// IMPORTS — cada módulo importado UNA sola vez
// ─────────────────────────────────────────────────────────────────────────────
import { initializeApp, getApps, getApp }
  from 'https://www.gstatic.com/firebasejs/10.12.0/firebase-app.js';

import {
  getFirestore, collection, addDoc, getDocs,
  deleteDoc, doc, getDoc, updateDoc, serverTimestamp, query, orderBy
} from 'https://www.gstatic.com/firebasejs/10.12.0/firebase-firestore.js';

import {
  getAuth, onAuthStateChanged, signInWithEmailAndPassword,
  signOut, setPersistence, browserLocalPersistence
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
let devuelveData  = [{id:'', detalle:'', numeroSerie:''}];
let registrosParsed = [];
let firebaseReady = false;
let editandoId = null; // ID del registro en edición (null = modo creación)
let inventarioDB = [];       // Cache local del inventario
let inventarioCargado = false;
const INVENTARIO_COL = 'inventario'; // colección Firebase con ID/Código y Descripcion

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
  try { return JSON.parse(localStorage.getItem(CFG_KEY)); } catch(e) { return null; }
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
    // onAuthStateChanged se encarga de mostrar la app automáticamente
  } catch(e) {
    errEl.textContent = 'Credenciales incorrectas';
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
      <td><textarea placeholder="Descripción del artículo..." rows="1" data-field="descripcion" data-idx="${i}" data-tabla="art" style="height:32px;overflow:hidden">${esc(row.descripcion)}</textarea></td>
      <td><input type="text" placeholder="Serial Number" value="${esc(row.serial)}" data-field="serial" data-idx="${i}" data-tabla="art" autocomplete="off"></td>
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
      <td><textarea placeholder="Detalle del equipo devuelto..." rows="1" data-field="detalle" data-idx="${i}" data-tabla="dev" style="height:32px;overflow:hidden">${esc(row.detalle)}</textarea></td>
      <td><input type="text" placeholder="Número Serie" value="${esc(row.numeroSerie)}" data-field="numeroSerie" data-idx="${i}" data-tabla="dev" autocomplete="off"></td>
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
  // Usa delegación sobre tbody para manejar inputs de código
  const tbody = document.getElementById(tbodyId);

  tbody.addEventListener('input', e => {
    const el = e.target;
    const expectedField = tableType === 'art' ? 'codigo' : 'id';
    if (el.dataset.field !== expectedField || el.dataset.tabla !== tableType) return;
    const idx = parseInt(el.dataset.idx);
    const timerKey = tableType + '-' + idx;
    clearTimeout(acTimers[timerKey]);
    acTimers[timerKey] = setTimeout(() => mostrarDropdown(el, idx, tableType), 120);
  });

  tbody.addEventListener('keydown', e => {
    const el = e.target;
    const expectedField = tableType === 'art' ? 'codigo' : 'id';
    if (el.dataset.field !== expectedField || el.dataset.tabla !== tableType) return;
    const idx  = parseInt(el.dataset.idx);
    const drop = document.getElementById('ac-drop-' + tableType + '-' + idx);
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
        aplicarSeleccion(idx, sel.dataset.codigo, sel.dataset.descripcion, tableType);
      } else {
        cerrarDropdown(idx, tableType);
      }
    } else if (e.key === 'Escape') {
      cerrarDropdown(idx, tableType);
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
  const drop = document.getElementById('ac-drop-' + tableType + '-' + idx);
  if (!drop) return;

  const texto = inputEl.value.trim();
  if (!texto) { cerrarDropdown(idx, tableType); return; }

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
      aplicarSeleccion(idx, item.dataset.codigo, item.dataset.descripcion, tableType);
    });
  });
}

function aplicarSeleccion(idx, codigo, descripcion, tableType) {
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
  cerrarDropdown(idx, tableType);
  // Focus al textarea de descripción de esa fila
  const row = document.querySelector(`#${tableType}Body tr[data-idx="${idx}"]`);
  if (row) {
    const ta = row.querySelector('textarea');
    if (ta) { ta.focus(); ta.select(); }
  }
}

function cerrarDropdown(idx, tableType) {
  const drop = document.getElementById('ac-drop-' + tableType + '-' + idx);
  if (drop) drop.classList.remove('open');
}

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
  ['fSolicitud','fDevolucion','fUsuario','fDireccion','fBcs','fSci','fObs'].forEach(id => {
    document.getElementById(id).value = '';
  });
  articulosData = [{codigo:'', descripcion:'', serial:''}];
  devuelveData  = [{id:'', detalle:'', numeroSerie:''}];
  editandoId = null;
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

  navigator.clipboard.writeText(texto)
    .then(() => toast('Resumen copiado'))
    .catch(() => toast('Error al copiar', 'error'));
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

  const data = {
    solicitud:     sol,
    devolucion:    document.getElementById('fDevolucion').value.trim(),
    usuario:       usr,
    direccion:     document.getElementById('fDireccion').value.trim(),
    bcs:           document.getElementById('fBcs').value.trim(),
    sci:           document.getElementById('fSci').value.trim(),
    observaciones: document.getElementById('fObs').value.trim(),
    articulos:     artsL,
    devuelve:      devL,
    uid:           currentUser ? currentUser.uid : '',
  };

  btn.disabled = true;
  msgEl.textContent = editandoId ? 'Actualizando...' : 'Guardando...';
  try {
    if (editandoId) {
      // MODO EDICIÓN — actualizar documento existente, conservar fecha original
      await updateDoc(doc(db, coleccion, editandoId), data);
      toast('Registro actualizado correctamente');
    } else {
      // MODO CREACIÓN — nuevo documento con timestamp actual
      await addDoc(collection(db, coleccion), { ...data, fecha: serverTimestamp() });
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
      return ['solicitud','devolucion','usuario','bcs','sci','observaciones','direccion']
        .some(k => (r[k]||'').toLowerCase().includes(q)) || artsStr.includes(q) || devStr.includes(q);
    }
    if (campo === 'codigo')   return artsStr.includes(q);
    if (campo === 'serial')   return artsStr.includes(q);
    if (campo === 'devuelve') return devStr.includes(q);
    return (r[campo]||'').toLowerCase().includes(q);
  });
  renderLista(registrosFiltrados);
}

function renderLista(lista) {
  const el = document.getElementById('regList');
  if (!lista.length) {
    el.innerHTML = `<div class="empty">${db ? 'Sin registros que mostrar' : 'Configura Firebase primero'}</div>`;
    return;
  }
  el.innerHTML = '<div class="reg-list">' + lista.map(r => {
    const arts    = r.articulos || [];
    const devs    = r.devuelve  || [];
    const hasDev  = devs.filter(d => d.id || d.detalle || d.codigo || d.descripcion).length;
    const hasObs  = !!r.observaciones;
    const pillsDev  = hasDev ? `<span class="pill pill-warn">dev ${hasDev}</span> ` : '';
    const pillsObs  = hasObs ? '<span class="pill pill-blue">obs</span> ' : '';
    const pillsArts = arts.length ? `<span class="pill pill-green">art ${arts.length}</span>` : '';

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

    return `<div class="reg-item" id="ri-${r.id}">
      <div class="reg-header" data-rid="${r.id}">
        <div class="reg-sol">${esc(r.solicitud||'—')}</div>
        <div class="reg-user">${esc(r.usuario||'—')} <span style="font-size:11px;color:var(--text-muted)">${pillsDev}${pillsObs}${pillsArts}</span></div>
        <div class="reg-bcs">${esc(r.bcs||'—')}</div>
        <div class="reg-sci">${esc(r.sci||'—')}</div>
        <div class="reg-chevron">&#9660;</div>
      </div>
      <div class="reg-body">
        <div class="det-grid">
          <div class="det-field"><label>N° Solicitud</label><div class="det-val mono">${esc(r.solicitud||'—')}</div></div>
          <div class="det-field"><label>N° Devolución</label><div class="det-val mono">${esc(r.devolucion||'—')}</div></div>
          <div class="det-field"><label>Usuario</label><div class="det-val">${esc(r.usuario||'—')}</div></div>
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
  if (action === 'editar')   editarRegistro(rid);
  if (action === 'eliminar') await eliminarRegistro(rid);
});

function copiarRegistro(id) {
  const r = registros.find(x => x.id === id);
  if (!r) return;

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

  navigator.clipboard.writeText(texto)
    .then(() => toast('Registro copiado al portapeles'))
    .catch(() => toast('Error al copiar', 'error'));
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
  document.getElementById('fSolicitud').value   = r.solicitud     || '';
  document.getElementById('fDevolucion').value  = r.devolucion    || '';
  document.getElementById('fUsuario').value     = r.usuario       || '';
  document.getElementById('fDireccion').value   = r.direccion     || '';
  document.getElementById('fBcs').value         = r.bcs           || '';
  document.getElementById('fSci').value         = r.sci           || '';
  document.getElementById('fObs').value         = r.observaciones || '';
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
  localStorage.setItem(CFG_KEY, JSON.stringify(cfg));
  const ok = await inicializarFirebase(cfg);
  if (ok) toast('Configuración guardada y conectado');
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
  await cargarRegistros();
  registrosParsed = [];
  document.getElementById('importPreview').style.display = 'none';
  document.getElementById('importFile').value = '';
  pw.style.display = 'none';
  pb.style.width   = '0%';
});

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

  // Cargar config guardada o usar default
  const cfgGuardada = cargarCfg();
  const cfgActiva   = cfgGuardada || DEFAULT_CFG;
  poblarCfgUI(cfgActiva);

  // Inicializar Firebase (una sola vez)
  await inicializarFirebase(cfgActiva);
})();