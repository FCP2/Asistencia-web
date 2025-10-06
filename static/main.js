// main.js — versión alineada con backend Postgres (persona_id + endpoints nuevos)

// ===== Estado global =====
let catalogo = [];          // personas [{ID, Nombre, Cargo, ...}]
let catalogIndex = {};      // índice por ID -> persona
let currentStatus = "";     // filtro activo
let currentId = null;       // invitación activa en modal gestionar
let currentRange = { from: "", to: "" };
let personaTS = null;
// ===== Utils =====
const $  = (sel) => document.querySelector(sel);
const $$ = (sel) => Array.from(document.querySelectorAll(sel));

const coloresPartidos = {
  'MORENA':'#a50021','PAN':'#0056a4','PRI':'#0e9347','PRD':'#ffcf00',
  'PT':'#d52b1e','PVEM':'#78be20','MC':'#f58025','INDEPENDIENTE':'#888','OTRO':'#666'
};
function colorPorPartido(valor) {
  if (!valor) return 'OTRO';
  const v = valor.toUpperCase().replace(/\s+/g,'');
  if (v.includes('MORENA')) return 'MORENA';
  if (v.includes('PAN'))    return 'PAN';
  if (v.includes('PRI'))    return 'PRI';
  if (v.includes('PRD'))    return 'PRD';
  if (v.includes('PT'))     return 'PT';
  if (v.includes('PVEM'))   return 'PVEM';
  if (v.includes('MC'))     return 'MC';
  return 'OTRO';
}

// ===== Fetch helpers (no cache) =====
async function fetchJSON(url, opts = {}) {
  const u = new URL(url, window.location.origin);
  u.searchParams.set('_ts', Date.now()); // cache-buster
  const res = await fetch(u, { cache: 'no-store', credentials: 'same-origin', ...opts });
  if (!res.ok) {
    let msg = `${res.status} ${res.statusText}`;
    try { const j = await res.json(); if (j && j.error) msg = j.error; } catch {}
    throw new Error(msg);
  }
  return res.json();
}
const apiGet  = (url) => fetchJSON(url);
const apiPost = (url, body={}) => fetchJSON(url, {
  method: 'POST',
  headers: { 'Content-Type': 'application/json' },
  body: JSON.stringify(body)
});

// ===== Formateo fecha/hora (UI) =====
function toInputDate(v) {
  if (!v) return '';
  const s = String(v);
  if (s.includes('T')) return s.split('T')[0];           // ISO full -> fecha
  if (/^\d{4}-\d{2}-\d{2}$/.test(s)) return s;           // YYYY-MM-DD
  const m = s.match(/^(\d{2})\/(\d{2})\/(\d{2,4})$/);    // dd/mm/yy
  if (m) { const yy = m[3].length === 2 ? `20${m[3]}` : m[3]; return `${yy}-${m[2]}-${m[1]}`; }
  return '';
}
function toInputTime(v) {
  if (!v) return '';
  const s = String(v);
  if (/^\d{2}:\d{2}:\d{2}$/.test(s)) return s.slice(0,5);
  if (/^\d{2}:\d{2}$/.test(s)) return s;
  return '';
}
function getFecha(inv){ return inv.FechaFmt || inv.Fecha || ''; }
function getHora(inv){  return inv.HoraFmt  || inv.Hora  || ''; }
function getUltMod(inv){ return inv.UltimaModFmt || inv["Última Modificación"] || ''; }
function getFechaAsig(inv){ return inv.FechaAsignacionFmt || inv["Fecha Asignación"] || ''; }

// ===== UI helpers =====
function resetCreateForm() {
  const ids = ['cFecha','cHora','cEvento','cConvoca','cPartido','cMuni','cLugar','cObs','cConvocaCargo'];
  ids.forEach(id => { const el = document.getElementById(id); if (el) el.value = ''; });
  $$('#modalCreate .is-invalid').forEach(e => e.classList.remove('is-invalid'));
}
async function withBusy(btn, fn){
  btn.disabled = true; btn.classList.add('disabled');
  try { await fn(); } finally { btn.disabled = false; btn.classList.remove('disabled'); }
}
async function reloadUI() {
  await load(currentStatus || "");
  // si tienes endpoint counters, puedes llamar aquí:
  // const counters = await apiGet('/api/counters'); ... (pero ya calculamos local)
}
//====filtros por fecha======
function getRangeParams() {
  const params = new URLSearchParams();
  if (currentStatus) params.set('status', currentStatus);
  if (currentRange.from) params.set('date_from', currentRange.from);
  if (currentRange.to)   params.set('date_to', currentRange.to);
  return params.toString() ? ('?' + params.toString()) : '';
}

async function load(status="") {
  currentStatus = status;
  const qs = getRangeParams();
  //matar proxy
  const buster = `_ts=${Date.now()}`;
  const sep = qs ? '&' : '?';
  const rows  = await apiGet('/api/invitations' + qs, { cache: 'no-store' });
  // pinta tarjetas
  const cont = document.getElementById('cards');
  cont.innerHTML = rows.map(card).join('');

  // KPIs (si tienes elementos #kpiPend, etc.)
  try {
    const stats = await apiGet('/api/stats' + qs);
    if (document.getElementById('kpiPend')) document.getElementById('kpiPend').textContent = stats.Pendiente ?? 0;
    if (document.getElementById('kpiConf')) document.getElementById('kpiConf').textContent = stats.Confirmado ?? 0;
    if (document.getElementById('kpiSubs')) document.getElementById('kpiSubs').textContent = stats.Sustituido ?? 0;
    if (document.getElementById('kpiCanc')) document.getElementById('kpiCanc').textContent = stats.Cancelado ?? 0;
  } catch(e) {}

  adjustMainPadding && adjustMainPadding();
}

// ===== Pills estado y tarjeta =====
function statusPill(s){
  const map = {Pendiente:"secondary", Confirmado:"success", Sustituido:"warning", Cancelado:"danger"};
  const cls = map[s] || "secondary";
  return `<span class="badge text-bg-${cls}">${s||"—"}</span>`;
}
function card(inv){
  const est = statusPill(inv["Estatus"]);

  // --- resaltado por proximidad ---
  let soonClass = '';
  let soonPill  = '';
  const dpe = inv["DiasParaEvento"]; // número (0 = hoy, 1 = mañana, etc.)
  const aplica = true; // si quieres limitar a Confirmado, cámbialo

  if (aplica && typeof dpe === 'number') {
    if (dpe === 0) {
      soonClass = 'card-today';
      soonPill  = `<span class="badge bg-danger-subtle text-danger-emphasis ms-2">Hoy</span>`;
    } else if (dpe > 0 && dpe <= 2) {
      soonClass = 'card-soon';
      soonPill  = `<span class="badge bg-warning-subtle text-warning-emphasis ms-2">Próximo</span>`;
    }
  }

  // Nombre actualizado: primero PersonaNombre, luego Asignado A, si no, vacío
  const nombreAsignado = inv["PersonaNombre"] || inv["Asignado A"] || "";
  const asignado = nombreAsignado
    ? `<span class="badge-soft">Asiste: ${nombreAsignado} ${inv.Rol ? `(${inv.Rol})` : ''}</span>`
    : `<span class="badge-soft">Sin asignar</span>`;

  const partido = inv["Partido Político"] || "";
  const clave   = colorPorPartido(partido);
  const color   = coloresPartidos[clave];
  const badgePartido = partido
    ? `<span class="badge rounded-pill me-1" style="background:${color};color:#fff;">${partido}</span>`
    : '';

  const fileUrl   = inv["ArchivoURL"] || inv["archivo_url"] || inv["archivoUrl"] || "";
  const fileName  = inv["ArchivoNombre"] || inv["archivo_nombre"] || "";
  const clipIcon  = (window.getComputedStyle(document.documentElement) && document.querySelector('.bi'))
                      ? `<i class="bi bi-paperclip ms-1 text-muted"></i>` : `📎`;
  const clip = fileUrl
    ? `<a href="${fileUrl}" target="_blank" rel="noopener" title="${fileName || 'Ver archivo'}" class="ms-1">${clipIcon}</a>`
    : "";

  return `
  <div class="col-12 col-md-6 col-xl-4 mb-4">
    <div class="card-inv p-3 h-100 d-flex flex-column ${soonClass}">
      <div class="d-flex align-items-center gap-2 mb-1">
        <div class="mt-2">${badgePartido}</div>
        <div class="hdr flex-grow-1">
          ${inv["Evento"]||"Sin título"} ${clip}
        </div>
        ${est}
        ${soonPill}
      </div>
      <div class="text-muted small">${getFecha(inv)} ${getHora(inv)} • ${inv["Convoca"]||""}</div>
      <div class="text-muted small">${inv["Municipio/Dependencia"]||""}</div>
      <div class="text-muted small">${inv["Lugar"]||""}</div>
      <div class="mt-2">${asignado}</div>
      <div class="mt-auto d-flex gap-2 pt-2">
        <button class="btn btn-sm btn-primary flex-grow-1" data-action="assign" data-id="${inv["ID"]}">Gestionar</button>
        <button class="btn btn-sm btn-warning" data-action="edit-inv" data-id="${inv["ID"]}">Editar</button>
        <button class="btn btn-sm btn-outline-secondary" data-action="details" data-id="${inv["ID"]}">Detalles</button>
      </div>
    </div>
  </div>`;
}
function msgConflicts(level, conflicts){
  const titulo = level === 'hard'
    ? 'Conflicto de horario'
    : (level === 'tight1h' ? 'Choque en ±1 hora' : 'Choque en ±2 horas');
  const lines = conflicts.map(c => `• ${c.FechaFmt} ${c.HoraFmt} — ${c.Evento} (${c.Estatus}) @ ${c.Lugar}`).join('\n');
  return `${titulo}:\n${lines}\n\n¿Deseas continuar de todas formas?`;
}
// ===== Carga catálogo (personas) =====
async function loadCatalog() {
  let data = [];
  try {
    data = await apiGet('/api/catalog', { cache: 'no-store' });
  } catch (e) {}
  if (!Array.isArray(data) || !data.length) {
    try { data = await apiGet('/api/persons', { cache: 'no-store' }); } catch (e) {}
  }

  catalogo = Array.isArray(data) ? data : [];
  catalogIndex = {};

  const sel = $('#selPersona');
  if (sel) {
    // opción vacía para permitir placeholder/escritura
    sel.innerHTML = '<option value=""></option>';
  }

  for (const p of catalogo) {
    catalogIndex[p.ID] = p;
    if (sel) {
      const opt = document.createElement('option');
      opt.value = String(p.ID);
      opt.textContent = p.Nombre || '';
      sel.appendChild(opt);
    }
  }

  // limpia cargo
  const rol = $('#inpRol'); if (rol) rol.value = '';
}

// ===== Carga invitaciones + KPIs =====


// ===== Eventos (click) =====
document.addEventListener('click', async (e)=>{
  const btn = e.target.closest('button');
  if (!btn) return;

  // Filtros
  if (btn.matches('[data-status]')){
    $$('.btn-group [data-status]').forEach(b=>b.classList.remove('active'));
    btn.classList.add('active');
    await load(btn.dataset.status || "");
    return;
  }

  // Abrir modal Gestionar
  if (btn.dataset.action === 'assign'){
  currentId = btn.dataset.id;

  // limpia campos visibles
  $('#inpRol').value = '';
  $('#inpComentario').value = '';

  // asegúrate de tener catálogo cargado
  if (!window.catalogo || !window.catalogo.length) {
    await loadCatalog();
  }

  // trae invitación para preselección
  let preselectPersonaId = null;
  try{
    const inv = await apiGet(`/api/invitation/${currentId}`, { cache: 'no-store' });
    $('#assignMeta').textContent = `${inv.Evento || ''} — ${getFecha(inv)} ${getHora(inv)}`;
    preselectPersonaId = inv.PersonaID || null;
  }catch{}

  const modalEl = $('#modalAssign');

  modalEl.addEventListener('shown.bs.modal', function onShown(){
    modalEl.removeEventListener('shown.bs.modal', onShown);

    // destruye instancia previa
    if (personaTS) { try { personaTS.destroy(); } catch {} personaTS = null; }

    // ⭐ NO limpies #selPersona aquí — ya tiene <option> del catálogo

    personaTS = new TomSelect('#selPersona', {
      searchField: ['text'],
      dropdownParent: modalEl.querySelector('.modal-content'), // dentro del modal
      openOnFocus: false,             // ⭐ NO abrir al enfocar
      allowEmptyOption: true,
      maxOptions: 1000
    });

    // al cambiar, actualiza cargo
    personaTS.on('change', (val) => {
      const p = window.catalogIndex?.[val] || null;
      $('#inpRol').value = p?.Cargo || '';
    });

    // ⭐ abrir/cerrar SOLO al escribir
    personaTS.on('type', (str) => {
      if (str && str.length >= 1) personaTS.open();
      else personaTS.close();
    });

    // ⭐ si enfoca sin escribir, mantenlo cerrado
    personaTS.on('focus', () => personaTS.close());

    // preselección si aplica
    if (preselectPersonaId != null) {
      personaTS.setValue(String(preselectPersonaId), true);
      const p = window.catalogIndex?.[preselectPersonaId];
      $('#inpRol').value = p?.Cargo || '';
    } else {
      personaTS.clear(true);
    }

    // ⭐ SOLO foco al input (sin abrir)
    setTimeout(() => {
      try {
        personaTS.control_input?.setAttribute('placeholder','Escribe para buscar…');
        personaTS.control_input?.focus();
        // NO personaTS.open();
      } catch {}
    }, 40);
  }, { once:true });

  new bootstrap.Modal(modalEl).show();
  return;
}

// Detalles
if (btn.dataset.action === 'details'){
  const inv = await apiGet(`/api/invitation/${btn.dataset.id}`);

  const lines = [
    `<div><strong>Evento:</strong> ${inv.Evento||'—'}</div>`,
    `<div><strong>Quien Convoca:</strong> ${inv["Convoca Cargo"]||'—'}</div>`,
    `<div><strong>Convoca:</strong> ${inv.Convoca||'—'}</div>`,
    `<div><strong>Partido Político:</strong> ${inv["Partido Político"]||'—'}</div>`,
    `<div><strong>Fecha/Hora:</strong> ${getFecha(inv)} ${getHora(inv)}</div>`,
    `<div><strong>Municipio/Dependencia:</strong> ${inv["Municipio/Dependencia"]||'—'}</div>`,
    `<div><strong>Lugar:</strong> ${inv.Lugar||'—'}</div>`,
    `<div><strong>Estatus:</strong> ${inv.Estatus||'—'}</div>`,
    `<div><strong>Asiste:</strong> ${inv["Asignado A"]||'—'} ${inv.Rol ? `(${inv.Rol})` : ''}</div>`,
    `<div><strong>Observaciones:</strong> ${inv.Observaciones||'—'}</div>`,
    inv["Fecha Asignación"] ? `<div class="text-muted"><strong>Fecha de Asignación:</strong> ${inv["Fecha Asignación"]}</div>` : '',
    `<div class="text-muted"><strong>Última Modificación:</strong> ${getUltMod(inv)} ${inv["Modificado Por"] ? `— <strong>Modificado Por:</strong> ${inv["Modificado Por"]}` : ''}</div>`
  ];

  // 🔗 Archivo (link + vista previa opcional)
  if (inv.ArchivoURL) {
    const nombre = inv.ArchivoNombre || 'Ver archivo';
    lines.push(
      `<div class="mt-2"><strong>Archivo:</strong> 
         <a href="${inv.ArchivoURL}" target="_blank" rel="noopener">${nombre}</a>
       </div>`
    );

    // Preview opcional
    const mime = (inv.ArchivoMime || '').toLowerCase();
    if (mime.startsWith('image/')) {
      lines.push(
        `<div class="mt-2"><img src="${inv.ArchivoURL}" alt="${nombre}" style="max-width:100%;border:1px solid #eee;border-radius:8px"></div>`
      );
    } else if (mime === 'application/pdf') {
      lines.push(
        `<div class="mt-2"><embed src="${inv.ArchivoURL}" type="application/pdf" width="100%" height="420px" style="border:1px solid #eee;border-radius:8px"/></div>`
      );
    }
  }

  $('#detailsBody').innerHTML = lines.filter(Boolean).join('');
  new bootstrap.Modal($('#modalDetails')).show();
  return;
}

if (btn.id === 'btnCrear'){
  const fd = new FormData();
  fd.append('fecha', ($('#cFecha').value || '').trim());
  fd.append('hora',  ($('#cHora').value || '').trim());
  fd.append('evento', ($('#cEvento').value || '').trim());
  fd.append('convoca_cargo', ($('#cConvocaCargo').value || '').trim());
  fd.append('convoca', ($('#cConvoca').value || '').trim());
  fd.append('partido_politico', ($('#cPartido').value || '').trim());
  fd.append('municipio', ($('#cMuni').value || '').trim());
  fd.append('lugar', ($('#cLugar').value || '').trim());
  fd.append('observaciones', ($('#cObs').value || '').trim());
  const file = $('#cArchivo').files[0];
  if (file) fd.append('archivo', file);

  // validación (excepto observaciones)
  const oblig = ['fecha','hora','evento','convoca_cargo','convoca','municipio','lugar'];
  const faltan = oblig.filter(k => !fd.get(k));
  if (faltan.length){ alert('Faltan: ' + faltan.join(', ')); return; }

  try{
    await fetch('/api/invitation/create', { method:'POST', body: fd });
    bootstrap.Modal.getInstance($('#modalCreate')).hide();
    await reloadUI();
  }catch(err){
    alert('Error al crear: ' + (err.message || 'desconocido'));
  }
  return;
}

// === Asignar ===
if (btn.id === 'btnAsignar') {
  const personaId = ($('#selPersona').value || '').trim();
  const rol = ($('#inpRol').value || '').trim();
  const cmt = ($('#inpComentario').value || '').trim();

  await withBusy(btn, async () => {
    if (!personaId) {
      alert('Selecciona una persona.');
      return;
    }

    try {
      const res = await apiPost('/api/assign', {
        id: currentId,
        persona_id: personaId,
        rol,
        comentario: cmt
      });

      // si todo bien
      bootstrap.Modal.getInstance($('#modalAssign')).hide();
      await reloadUI();

    } catch (err) {
      // Detecta conflicto 409
      if (err.response && err.response.status === 409 && err.response.data?.conflict) {
        const conf = err.response.data;
        const lvl = conf.level;
        const lista = conf.conflicts.map(
          c => `• ${c.Evento} (${c.FechaFmt} ${c.HoraFmt}) en ${c.Lugar}`
        ).join('\n');

        let msg = '';
        if (lvl === 'hard') msg = '⚠️ Conflicto total: la persona ya está confirmada en otra invitación al mismo horario.\n\n';
        else if (lvl === 'tight1h') msg = '⏰ Atención: la persona tiene otra invitación en menos de 1 hora.\n\n';
        else if (lvl === 'tight2h') msg = '⏰ Atención: la persona tiene otra invitación en menos de 2 horas.\n\n';
        msg += 'Coincidencias:\n' + lista + '\n\n¿Deseas asignar de todos modos?';

        if (confirm(msg)) {
          // forzar la asignación si el usuario confirma
          await apiPost('/api/assign', {
            id: currentId,
            persona_id: personaId,
            rol,
            comentario: cmt,
            force: true
          });
          bootstrap.Modal.getInstance($('#modalAssign')).hide();
          await reloadUI();
        } else {
          alert('Asignación cancelada.');
        }

      } else {
        console.error(err);
        alert('Error en asignación, ya se encuentra asignado ' + (err.message || 'desconocido'));
      }
    }
  });
  return;
}

  // Sustituir
  if (btn.id === 'btnSustituir'){
    const personaId = ($('#selPersona').value || '').trim();
    const rol       = ($('#inpRol').value || '').trim();     // opcional
    const cmt       = ($('#inpComentario').value || 'Sustitución por instrucción').trim();

    if (!personaId) { alert('Selecciona la nueva persona.'); return; }
    try{
      await apiPost('/api/reassign', { id: currentId, persona_id: personaId, rol, comentario: cmt });
      bootstrap.Modal.getInstance($('#modalAssign')).hide();
      await reloadUI();
    }catch(err){ alert('Error al sustituir, ya se encuentra asignado ' + err.message); }
    return;
  }

  // Cancelar
  if (btn.id === 'btnCancelar'){
    const cmt = $('#inpComentario').value || 'Cancelado por indicación';
    try{
      await apiPost('/api/cancel', { id: currentId, comentario: cmt });
      bootstrap.Modal.getInstance($('#modalAssign')).hide();
      await reloadUI();
    }catch(err){ alert('Error al cancelar: ' + err.message); }
    return;
  }

  // Reactivar -> Pendiente
  if (btn.id === 'btnReactivar'){
    const cmt = $('#inpComentario').value || 'Reactivado';
    try{
      await apiPost('/api/status', { id: currentId, estatus:'Pendiente', comentario: cmt });
      bootstrap.Modal.getInstance($('#modalAssign')).hide();
      await reloadUI();
    }catch(err){ alert('Error al reactivar: ' + err.message); }
    return;
  }

  // Eliminar invitación
  if (btn.id === 'btnEliminar'){
    if (!confirm('¿Eliminar esta invitación? Esta acción no se puede deshacer.')) return;
    try{
      await apiPost('/api/invitation/delete', { id: currentId });
      bootstrap.Modal.getInstance($('#modalAssign')).hide();
      await reloadUI();
    }catch(err){ alert('Error al eliminar: ' + err.message); }
    return;
  }

  // Abrir modal "Nueva persona"
  if (btn.id === 'btnOpenNewPersona') {
    $('#npNombre').value = '';
    $('#npCargo').value = '';
    $('#npTelefono').value = '';
    $('#npCorreo').value = '';
    $('#npUnidad').value = '';
    new bootstrap.Modal($('#modalNewPersona')).show();
    return;
  }

  // Guardar persona nueva
  if (btn.id === 'btnGuardarPersona') {
    const nombre = ($('#npNombre').value || '').trim();
    const cargo  = ($('#npCargo').value || '').trim();
    const tel    = ($('#npTelefono').value || '').trim();
    const correo = ($('#npCorreo').value || '').trim();
    const unidad = ($('#npUnidad').value || '').trim();

    if (!nombre) { alert('El Nombre es obligatorio.'); return; }
    if (!cargo)  { alert('El Cargo es obligatorio.'); return; }
    if (tel && !/^\d{10}$/.test(tel)) { alert('El teléfono debe tener 10 dígitos.'); return; }

    try {
      const res = await apiPost('/api/person/create', {
        Nombre: nombre, Cargo: cargo, 'Teléfono': tel, Correo: correo, 'Unidad/Región': unidad
      });
      await loadCatalog();
      if ($('#selPersona')) {
        $('#selPersona').value = String(res.id);
        $('#inpRol').value = cargo;
      }
      bootstrap.Modal.getInstance($('#modalNewPersona')).hide();
    } catch (err) { alert('Error guardando persona: ' + err.message); }
    return;
  }

  // Cancelar nueva persona (si usas collapse)
  if (btn.id === 'btnCancelarPersona') {
    $('#npNombre').value = '';
    $('#npCargo').value = '';
    $('#npTelefono').value = '';
    $('#npCorreo').value = '';
    $('#npUnidad').value = '';
    const collapseEl = document.querySelector('#newPerson');
    if (collapseEl) bootstrap.Collapse.getOrCreateInstance(collapseEl).hide();
    return;
  }

  // Editar invitación (abrir modal)
  if (btn.dataset.action === 'edit-inv') {
    currentId = btn.dataset.id;
    const inv = await apiGet(`/api/invitation/${currentId}`);

    $('#eID').value = inv.ID;
    $('#eFecha').value = toInputDate(inv.Fecha || '');
    $('#eHora').value  = toInputTime(inv.Hora  || '');
    $('#eEvento').value = inv.Evento || '';
    $('#eConvocaCargo').value = inv["Convoca Cargo"] || '';
    $('#eConvoca').value = inv.Convoca || '';
    $('#ePartido').value = inv["Partido Político"] || '';
    $('#eMuni').value = inv["Municipio/Dependencia"] || '';
    $('#eLugar').value = inv.Lugar || '';
    $('#eObs').value = inv.Observaciones || '';

    new bootstrap.Modal($('#modalEditInv')).show();
    return;
  }

if (btn.id === 'btnGuardarEditInv') {
  const fd = new FormData();
  fd.append('id', ($('#eID').value || '').trim());
  fd.append('fecha', ($('#eFecha').value || '').trim());
  fd.append('hora',  ($('#eHora').value || '').trim());
  fd.append('evento', ($('#eEvento').value || '').trim());
  fd.append('convoca_cargo', ($('#eConvocaCargo').value || '').trim());
  fd.append('convoca', ($('#eConvoca').value || '').trim());
  fd.append('partido_politico', ($('#ePartido').value || '').trim());
  fd.append('municipio', ($('#eMuni').value || '').trim());
  fd.append('lugar', ($('#eLugar').value || '').trim());
  fd.append('observaciones', ($('#eObs').value || '').trim());
  if ($('#eQuitarArchivo').checked) fd.append('eliminar_archivo', 'true');
  const newFile = $('#eArchivo').files[0];
  if (newFile) fd.append('archivo', newFile);

  // validación igual que en crear...
  const oblig = ['fecha','hora','evento','convoca_cargo','convoca','municipio','lugar'];
  for (const k of oblig) {
    if (!fd.get(k) || !String(fd.get(k)).trim()) { alert(`Falta ${k}`); return; }
  }

  try {
    await fetch('/api/invitation/update', { method:'POST', body: fd });
    bootstrap.Modal.getInstance($('#modalEditInv')).hide();
    await reloadUI();
  } catch (err) { alert('Error actualizando: ' + (err.message || 'desconocido')); }
  return;
}

  // Editar persona (abrir modal, SIN pedir al backend)
  if (btn.id === 'btnEditarPersona') {
    const pid = $('#selPersona').value;
    if (!pid) { alert('Selecciona una persona primero'); return; }
    const p = catalogIndex[pid];
    if (!p) { alert('Persona no encontrada en catálogo'); return; }

    $('#epID').value = p.ID;
    $('#epNombre').value = p.Nombre || '';
    $('#epCargo').value = p.Cargo || '';
    $('#epTelefono').value = p['Teléfono'] || '';
    $('#epCorreo').value = p.Correo || '';
    $('#epUnidad').value = p['Unidad/Región'] || '';

    new bootstrap.Modal($('#modalEditPersona')).show();
    return;
  }

  // Guardar edición de persona
  if (btn.id === 'btnGuardarEditPersona') {
    const payload = {
      ID: $('#epID').value,
      Nombre: $('#epNombre').value,
      Cargo: $('#epCargo').value,
      'Teléfono': $('#epTelefono').value,
      Correo: $('#epCorreo').value,
      'Unidad/Región': $('#epUnidad').value
    };
    try {
      await apiPost('/api/person/update', payload);
      bootstrap.Modal.getInstance($('#modalEditPersona')).hide();
      await loadCatalog(); // refresca combo
    } catch (err) { alert('Error actualizando persona: ' + err.message); }
    return;
  }

  // Abrir modal Eliminar persona
  if (btn.id === 'btnOpenDeletePersona') {
    const sel = $('#delPersonaSelect');
    if (sel) {
      sel.innerHTML = '<option value="">Seleccione persona...</option>';
      for (const p of catalogo) {
        const opt = document.createElement('option');
        opt.value = p.ID;
        opt.textContent = p.Nombre;
        sel.appendChild(opt);
      }
    }
    new bootstrap.Modal($('#modalDeletePersona')).show();
    return;
  }

  // Confirmar eliminar persona
  if (btn.id === 'btnEliminarPersonaConfirm') {
    const pid = ($('#delPersonaSelect').value || '').trim();
    if (!pid) { alert('Selecciona una persona.'); return; }

    const persona = (catalogIndex[pid] || {}).Nombre || 'esta persona';
    if (!confirm(`¿Eliminar definitivamente a ${persona}?`)) return;

    try {
      await apiPost('/api/person/delete', { ID: pid });
      bootstrap.Modal.getInstance($('#modalDeletePersona')).hide();

      // recordaba selección previa
      const sel = $('#selPersona');
      const before = sel ? sel.value : '';

      await loadCatalog(); // reconstruye catálogo y select

      if (sel) {
        if (before && !catalogIndex[before]) { // selección era la eliminada
          sel.value = '';
          $('#inpRol').value = '';
        } else if (sel.value && catalogIndex[sel.value]) {
          $('#inpRol').value = catalogIndex[sel.value].Cargo || '';
        } else {
          sel.value = '';
          $('#inpRol').value = '';
        }
        sel.dispatchEvent(new Event('change'));
      }
      await reloadUI();
      // opcional: await reloadUI();
      alert('Persona eliminada.');
    } catch (err) { alert('Error al eliminar: ' + err.message); }
    return;
  }

  if (btn.id === 'btnFiltrarFechas') {
    currentRange.from = (document.getElementById('fDesde').value || '').trim();
    currentRange.to   = (document.getElementById('fHasta').value || '').trim();
    await load(currentStatus);
    return;
  }

  if (btn.id === 'btnLimpiarFechas') {
    currentRange.from = "";
    currentRange.to   = "";
    document.getElementById('fDesde').value = "";
    document.getElementById('fHasta').value = "";
    await load(currentStatus);
    return;
  }
});

// ===== Inputs =====
$('#selPersona')?.addEventListener('change', () => {
  const pid = $('#selPersona').value;
  const info = catalogIndex[pid];
  $('#inpRol').value = info?.Cargo || '';
});

// ===== DOM Ready =====
document.addEventListener('DOMContentLoaded', async ()=>{
  try {
    await loadCatalog();
    await load("");
  } catch (err) {
    console.error(err);
    alert('No se pudo cargar la app: ' + err.message);
  }

  // Modal crear: preparar / limpiar
  const modalCreate = $('#modalCreate');
  if (modalCreate) {
    modalCreate.addEventListener('show.bs.modal', () => {
      resetCreateForm();
      const f = $('#cFecha');
      if (f) f.valueAsDate = new Date(); // opcional: hoy por defecto
    });
    modalCreate.addEventListener('hidden.bs.modal', resetCreateForm);
  }

  // (Opcional) Auto-refresh cada X segundos
  // setInterval(reloadUI, 15000);
});

document.getElementById('cArchivo').addEventListener('change', (e) => {
  const file = e.target.files[0];
  if (file) {
    document.getElementById('filePreview').textContent = `Seleccionado: ${file.name}`;
  } else {
    document.getElementById('filePreview').textContent = '';
  }
});

function adjustMainPadding() {
  const footer = document.getElementById('footerBar');
  const main = document.querySelector('main');
  if (!footer || !main) return;
  // deja un colchón adicional de 24 px
  main.style.paddingBottom = (footer.offsetHeight + 24) + 'px';
}

window.addEventListener('load', adjustMainPadding);
window.addEventListener('resize', adjustMainPadding);
// si cargas tarjetas por AJAX, vuelve a ajustar después de renderizarlas:
async function reloadUI() {
  await load(window.currentStatus || "");
  adjustMainPadding();
}

document.addEventListener('click', (ev) => {
  const btn = ev.target.closest('button');
  if (!btn) return;
  if (btn.id === 'btnExportXlsx') {
    window.location.href = '/api/report/confirmados.xlsx';
  }
});



