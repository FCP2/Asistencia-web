// main.js — versión reestructurada (no-cache + reload tras POST)
let catalogo = [];
let currentStatus = "";
let currentId = null;
let catalogIndex = {}; // índice por nombre -> objeto

const $  = sel => document.querySelector(sel);
const $$ = sel => Array.from(document.querySelectorAll(sel));

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

/* =========================
   FETCH helpers (no cache)
========================= */
async function fetchJSON(url, opts = {}) {
  const u = new URL(url, window.location.origin);
  // cache-buster para evitar respuestas en caché del navegador/CDN
  u.searchParams.set('_ts', Date.now());
  const res = await fetch(u, { cache: 'no-store', ...opts });
  if (!res.ok) throw new Error(await res.text());
  return await res.json();
}
const apiGet  = (url)              => fetchJSON(url);
const apiPost = (url, bodyObj={})  => fetchJSON(url, {
  method: 'POST',
  headers: { 'Content-Type': 'application/json' },
  body: JSON.stringify(bodyObj)
});

/* =========================
   Utilidades UI
========================= */
function toInputDate(v) {
  if (!v) return '';
  // acepta "YYYY-MM-DD" o "YYYY-MM-DDTHH:MM:SS"
  const s = String(v);
  if (s.includes('T')) return s.split('T')[0];
  if (/^\d{4}-\d{2}-\d{2}$/.test(s)) return s;
  // si te llega "dd/mm/yy" o "dd/mm/yyyy"
  const m = s.match(/^(\d{2})\/(\d{2})\/(\d{2,4})$/);
  if (m) {
    const yy = m[3].length === 2 ? `20${m[3]}` : m[3];
    return `${yy}-${m[2]}-${m[1]}`;
  }
  return '';
}

function toInputTime(v) {
  if (!v) return '';
  const s = String(v);
  // "HH:MM:SS" -> "HH:MM"
  if (/^\d{2}:\d{2}:\d{2}$/.test(s)) return s.slice(0,5);
  if (/^\d{2}:\d{2}$/.test(s)) return s;
  return '';
}
function getFecha(inv){ return inv.FechaFmt || inv.FechaISO || inv.Fecha || ''; }
function getHora(inv){  return inv.HoraFmt  || inv.HoraISO  || inv.Hora  || ''; }
function getUltMod(inv){ return inv.UltimaModFmt || inv["Última Modificación"] || ''; }
function getFechaAsig(inv){ return inv.FechaAsignacionFmt || inv["Fecha Asignación"] || ''; }

function resetCreateForm() {
  const ids = ['cFecha','cHora','cEvento','cConvoca','cPartido','cMuni','cLugar','cObs'];
  ids.forEach(id => { const el = document.getElementById(id); if (el) el.value = ''; });

  const selCargo = document.getElementById('cConvocaCargo');
  if (selCargo) selCargo.value = '';

  document.querySelectorAll('#modalCreate .is-invalid')
    .forEach(e => e.classList.remove('is-invalid'));
}
async function withBusy(btn, fn){
  btn.disabled = true;
  btn.classList.add('disabled');
  try { await fn(); }
  finally {
    btn.disabled = false;
    btn.classList.remove('disabled');
  }
}
async function reloadUI() {
  await load(currentStatus || "");
  if (typeof loadCounters === "function") await loadCounters();
}

/* =========================
   Render helpers
========================= */
function statusPill(s){
  const map = {Pendiente:"secondary", Confirmado:"success", Sustituido:"warning", Cancelado:"danger"};
  const cls = map[s] || "secondary";
  return `<span class="badge text-bg-${cls}">${s||"—"}</span>`;
}

function getFecha(inv){ return inv.FechaFmt || inv.FechaISO || ""; }
function getHora(inv){  return inv.HoraFmt  || inv.HoraISO  || ""; }

function card(inv){
  const est = statusPill(inv["Estatus"]);
  const asignado = inv["Asignado A"]
    ? `<span class="badge-soft">Asiste: ${inv["Asignado A"]}</span>`
    : `<span class="badge-soft">Sin asignar</span>`;

  const partido = inv["Partido Político"] || "";
  const clave   = colorPorPartido(partido);
  const color   = coloresPartidos[clave];
  const badgePartido = partido
    ? `<span class="badge rounded-pill me-1" style="background:${color};color:#fff;">${partido}</span>`
    : '';

  return `
  <div class="col-12 col-md-6 col-xl-4">
    <div class="card-inv p-3 h-100 d-flex flex-column">
      <div class="d-flex align-items-center gap-2 mb-1">
        <div class="mt-2">${badgePartido}</div>
        <div class="hdr flex-grow-1">${inv["Evento"]||"Sin título"}</div>
        ${est}
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

/* =========================
   Carga de datos
========================= */
  async function load(status=""){
    currentStatus = status;

    // KPIs: universo completo
    const all = await apiGet('/api/invitations');
    updateKpis(all);

    // Filtro para tarjetas si aplica
    const list = status ? all.filter(r => String(r.Estatus).trim() === status) : all;
    list.sort((a,b)=> (`${b.Fecha||''} ${b.Hora||''}`).localeCompare(`${a.Fecha||''} ${a.Hora||''}`));
    $('#cards').innerHTML = list.map(card).join('') || `<div class="text-muted">Sin registros.</div>`;
  }

async function loadCatalog() {
  catalogo = await apiGet('/api/catalog'); // [{ID, Nombre, Cargo, ...}]
  catalogIndex = {};
  const sel = $('#selPersona');
  if (sel) sel.innerHTML = '<option value="">Seleccione persona...</option>';

  catalogo.forEach(r => {
    const id = r.ID;
    const nombre = (r.Nombre || '').trim();
    if (!id || !nombre) return;
    catalogIndex[id] = r;
    if (sel) {
      const opt = document.createElement('option');
      opt.value = id;
      opt.textContent = nombre;
      sel.appendChild(opt);
    }
  });
}


function updateKpis(list){
  const p = list.filter(r=>r.Estatus==='Pendiente').length;
  const c = list.filter(r=>r.Estatus==='Confirmado').length;
  const s = list.filter(r=>r.Estatus==='Sustituido').length;
  const x = list.filter(r=>r.Estatus==='Cancelado').length;
  const set = (id,val)=>{ const el = document.getElementById(id); if(el) el.textContent = val; };
  set('kpiPend', p); set('kpiConf', c); set('kpiSubs', s); set('kpiCanc', x);
}

/* =========================
   Eventos (clicks)
========================= */
document.addEventListener('click', async (e)=>{
  const btn = e.target.closest('button');
  if (!btn) return;

  // filtros de estado
  if (btn.matches('[data-status]')){
    $$('.btn-group [data-status]').forEach(b=>b.classList.remove('active'));
    btn.classList.add('active');
    await load(btn.dataset.status || "");
    return;
  }

  // abrir modal gestión
  if (btn.dataset.action === 'assign'){
    currentId = btn.dataset.id;
    const modal = new bootstrap.Modal($('#modalAssign'));
    // limpia combo/cargo al abrir
    $('#selPersona').value = '';
    $('#inpRol').value = '';
    $('#inpComentario').value = '';

    try{
      const todos = await apiGet('/api/invitations');
      const inv = todos.find(x=>x.ID===currentId);
      $('#assignMeta').textContent = inv ? `${inv.Evento} — ${inv.Fecha||''} ${inv.Hora||''}` : '';
      if (inv && inv["Asignado A"]) {
        const n = inv["Asignado A"];
        $('#selPersona').value = n;
        $('#inpRol').value = catalogIndex[n]?.Cargo || $('#inpRol').value;
      }
    }catch{}
    modal.show();
    return;
  }

  // crear invitación
  if (btn.id === 'btnCrear'){
    const fecha   = ($('#cFecha').value || '').trim();
    const hora    = ($('#cHora').value || '').trim();
    const evento  = ($('#cEvento').value || '').trim();
    const convocaCargo = ($('#cConvocaCargo').value || '').trim();
    const convoca = ($('#cConvoca').value || '').trim();
    const partido = ($('#cPartido').value || '').trim();
    const muni    = ($('#cMuni').value || '').trim();
    const lugar   = ($('#cLugar').value || '').trim();
    const obs     = ($('#cObs').value || '').trim();

    if (!fecha || !hora || !evento || !convocaCargo || !convoca || !partido || !muni || !lugar) {
      alert('Por favor, completa todos los campos obligatorios antes de crear la invitación.');
      return;
    }

    const payload = {
      "Fecha": fecha, "Hora": hora, "Evento": evento,
      "Convoca Cargo": convocaCargo, "Convoca": convoca,
      "Partido Político": partido, "Municipio/Dependencia": muni,
      "Lugar": lugar, "Observaciones": obs
    };

    try {
      await apiPost('/api/create', payload);
      bootstrap.Modal.getInstance($('#modalCreate')).hide();
      await reloadUI();
    } catch(err){
      alert('Error creando invitación: ' + err.message);
    }
    return;
  }

  // asignar persona
  // Asignar
  if (btn.id === 'btnAsignar') {
    const personaId = ($('#selPersona').value || '').trim();
    const cargo     = ($('#inpRol').value || '').trim();
    const cmt       = ($('#inpComentario').value || '').trim();

    await withBusy(btn, async ()=>{
      if (!personaId) { alert('Debes seleccionar una persona.'); return; }
      // cargo es opcional (si lo omites, el backend toma el cargo de la persona)
      try {
        await apiPost('/api/assign', { id: currentId, persona_id: personaId, rol: cargo, comentario: cmt });
        bootstrap.Modal.getInstance($('#modalAssign')).hide();
        await reloadUI();
      } catch(err) {
        alert('Error en asignación: ' + err.message);
      }
    });
    return;
  }


  // Sustituir
  if (btn.id === 'btnSustituir'){
    const personaId = ($('#selPersona').value || '').trim();
    const rol       = ($('#inpRol').value || '').trim(); // opcional
    const cmt       = ($('#inpComentario').value || '').trim();

    if (!personaId) { alert('Debes seleccionar la nueva persona.'); return; }

    try{
      await apiPost('/api/reassign', { id: currentId, persona_id: personaId, rol: rol, comentario: cmt });
      bootstrap.Modal.getInstance($('#modalAssign')).hide();
      await reloadUI();
    }catch(err){
      alert('Error al sustituir: ' + err.message);
    }
    return;
  }

  // cancelar
  if (btn.id === 'btnCancelar'){
    const cmt = $('#inpComentario').value || 'Cancelado por indicación';
    try {
      await apiPost('/api/cancel', { id: currentId, comentario: cmt });
      bootstrap.Modal.getInstance($('#modalAssign')).hide();
      await reloadUI();
    } catch(err){
      alert('Error al cancelar: ' + err.message);
    }
    return;
  }

  // reactivar -> Pendiente
  if (btn.id === 'btnReactivar'){
    const cmt = $('#inpComentario').value || 'Reactivado';
    try {
      await apiPost('/api/status', { id: currentId, estatus:'Pendiente', comentario: cmt });
      bootstrap.Modal.getInstance($('#modalAssign')).hide();
      await reloadUI();
    } catch(err){
      alert('Error al reactivar: ' + err.message);
    }
    return;
  }

  // eliminar
  if (btn.id === 'btnEliminar'){
    if (!confirm('¿Eliminar esta invitación? Esta acción no se puede deshacer.')) return;
    const cmt = $('#inpComentario').value || 'Eliminación solicitada desde dashboard';
    try{
      await apiPost('/api/delete', { id: currentId, comentario: cmt });
      bootstrap.Modal.getInstance($('#modalAssign')).hide();
      await reloadUI();
    }catch(err){ alert('Error al eliminar: '+err.message); }
    return;
  }

  // detalles
// detalles
  if (btn.dataset.action === 'details'){
    const todos = await apiGet('/api/invitations');
    const inv = todos.find(x => x.ID === btn.dataset.id);
    if (!inv) { alert('No se encontró la invitación.'); return; }

    const fechaTxt = getFecha(inv);
    const horaTxt  = getHora(inv);
    const fAsign   = getFechaAsig(inv);
    const fUlt     = getUltMod(inv);

    const lines = [
      `<div><strong>Evento:</strong> ${inv.Evento || '—'}</div>`,
      `<div><strong>Quien Convoca (Cargo):</strong> ${inv["Convoca Cargo"] || '—'}</div>`,
      `<div><strong>Convoca:</strong> ${inv.Convoca || '—'}</div>`,
      `<div><strong>Partido Político:</strong> ${inv["Partido Político"] || '—'}</div>`,
      `<div><strong>Fecha/Hora:</strong> ${fechaTxt} ${horaTxt}</div>`,
      `<div><strong>Municipio/Dependencia:</strong> ${inv["Municipio/Dependencia"] || '—'}</div>`,
      `<div><strong>Lugar:</strong> ${inv.Lugar || '—'}</div>`,
      `<div><strong>Estatus:</strong> ${inv.Estatus || '—'}</div>`,
      `<div><strong>Asiste:</strong> ${inv["Asignado A"] || '—'} ${inv.Rol ? `(${inv.Rol})` : ''}</div>`,
      `<div><strong>Observaciones:</strong> ${inv.Observaciones || '—'}</div>`,
      fAsign ? `<div class="text-muted"><strong>Fecha de Asignación:</strong> ${fAsign}</div>` : '',
      `<div class="text-muted"><strong>Última Modificación:</strong> ${fUlt} ${inv["Modificado Por"] ? `— <strong>Modificado Por:</strong> ${inv["Modificado Por"]}` : ''}</div>`
    ].filter(Boolean);

    $('#detailsBody').innerHTML = lines.join('');
    new bootstrap.Modal($('#modalDetails')).show();
    return;
  }

// Abrir modal "Nueva persona"
if (btn.id === 'btnOpenNewPersona') {
  // limpiar campos
  $('#npNombre').value = '';
  $('#npCargo').value = '';
  $('#npTelefono').value = '';
  $('#npCorreo').value = '';
  $('#npUnidad').value = '';
  new bootstrap.Modal($('#modalNewPersona')).show();
  return;
}

// Guardar persona (usa tu endpoint /api/person/create que ya devuelve ID)
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
      Nombre: nombre, Cargo: cargo, Teléfono: tel, Correo: correo, 'Unidad/Región': unidad
    });
    if (!res.ok && !res.id) { alert(res.error || 'No se pudo guardar'); return; }

    // refresca catálogo y selecciona automáticamente a la persona creada
    await loadCatalog();
    if ($('#selPersona')) {
      $('#selPersona').value = String(res.id);
      $('#inpRol').value = cargo; // autocompleta cargo
    }

    // cierra modal y avisa
    bootstrap.Modal.getInstance($('#modalNewPersona')).hide();
    // opcional: await reloadUI();
  } catch (err) {
    alert('Error guardando persona: ' + err.message);
  }
  return;
}

  // cancelar creación de nueva persona
  if (btn.id === 'btnCancelarPersona') {
    $('#npNombre').value = '';
    $('#npCargo').value = '';
    $('#npTelefono').value = '';
    $('#npCorreo').value = '';
    $('#npUnidad').value = '';
    const collapseEl = document.querySelector('#newPerson');
    const clp = bootstrap.Collapse.getOrCreateInstance(collapseEl);
    clp.hide();
    return;
  }
  //editar invitacion
  if (btn.dataset.action === 'edit-inv') {
    currentId = btn.dataset.id;
    // carga la invitación
    const res = await fetchJSON(`/api/invitation/${currentId}`);
    if (!res.ok && !res.inv) { alert(res.error || 'No se pudo cargar'); return; }
    const inv = res.inv;

    // Rellena el modal de edición
    $('#eID').value = inv.ID;
    $('#eFecha').value = inv.FechaISO || '';
    $('#eHora').value  = inv.HoraISO  || ''
    $('#eEvento').value = inv.Evento || '';
    $('#eConvocaCargo').value = inv["Convoca Cargo"] || '';
    $('#eConvoca').value = inv.Convoca || '';
    $('#ePartido').value = inv["Partido Político"] || '';
    $('#eMuni').value = inv["Municipio/Dependencia"] || '';
    $('#eLugar').value = inv.Lugar || '';
    $('#eObs').value = inv.Observaciones || '';
     // 👇 aquí debes usar la conversión a ISO
    $("#eFecha").value = toInputDate(inv.FechaISO || inv.Fecha || "");
    $("#eHora").value  = toInputTime(inv.HoraISO  || inv.Hora  || "");

    new bootstrap.Modal($('#modalEditInv')).show();
    return;
  }
  if (btn.id === 'btnGuardarEditInv') {
    const payload = {
      ID: $('#eID').value,
      Fecha: $('#eFecha').value,
      Hora: $('#eHora').value,
      Evento: $('#eEvento').value,
      "Convoca Cargo": $('#eConvocaCargo').value,
      Convoca: $('#eConvoca').value,
      "Partido Político": $('#ePartido').value,
      "Municipio/Dependencia": $('#eMuni').value,
      Lugar: $('#eLugar').value,
      Observaciones: $('#eObs').value,
      Comentario: $('#eComentario').value || "Edición de invitación"
    };

    // Validación mínima (igual que crear)
    const oblig = ["Fecha","Hora","Evento","Convoca Cargo","Convoca","Partido Político","Municipio/Dependencia","Lugar"];
    for (const k of oblig) {
      if (!payload[k] || !payload[k].trim()) {
        alert(`Falta ${k}`);
        return;
      }
    }

    try {
      await apiPost('/api/invitation/update', payload);
      bootstrap.Modal.getInstance($('#modalEditInv')).hide();
      await reloadUI();
    } catch (err) {
      alert('Error actualizando: ' + err.message);
    }
    return;
  }
  //acciones editar persona
  if (btn.id === 'btnEditarPersona') {
    const pid = $('#selPersona').value;
    if (!pid) { alert('Selecciona una persona primero'); return; }

    const res = await fetchJSON(`/api/person/${pid}`);
    const p = res.persona;
    $('#epID').value = p.ID;
    $('#epNombre').value = p.Nombre;
    $('#epCargo').value = p.Cargo;
    $('#epTelefono').value = p['Teléfono'];
    $('#epCorreo').value = p.Correo;
    $('#epUnidad').value = p['Unidad/Región'];

    new bootstrap.Modal($('#modalEditPersona')).show();
  }

  if (btn.id === 'btnGuardarEditPersona') {
    const payload = {
      ID: $('#epID').value,
      Nombre: $('#epNombre').value,
      Cargo: $('#epCargo').value,
      'Teléfono': $('#epTelefono').value,
      Correo: $('#epCorreo').value,
      'Unidad/Región': $('#epUnidad').value
    };
    await apiPost('/api/person/update', payload);
    bootstrap.Modal.getInstance($('#modalEditPersona')).hide();
    await loadCatalog(); // refresca catálogo
  }
  if (btn.id === 'btnOpenDeletePersona') {
  // Rellenar el select con el catálogo actual (ID como value)
  const sel = $('#delPersonaSelect');
  sel.innerHTML = '<option value="">Seleccione persona...</option>';
  for (const p of catalogo) {
    const opt = document.createElement('option');
    opt.value = p.ID;             // 👈 value = ID
    opt.textContent = p.Nombre;   // 👈 texto visible
    sel.appendChild(opt);
  }
  new bootstrap.Modal($('#modalDeletePersona')).show();
  return;
}
if (btn.id === 'btnEliminarPersonaConfirm') {
  const pid = ($('#delPersonaSelect').value || '').trim();
  if (!pid) { alert('Selecciona una persona.'); return; }

  const persona = catalogIndex[pid]?.Nombre || 'esta persona';
  if (!confirm(`¿Eliminar definitivamente a ${persona}?`)) return;

  try {
    await apiPost('/api/person/delete', { ID: pid });

    // Cierra modal
    bootstrap.Modal.getInstance($('#modalDeletePersona')).hide();

    // Guarda el seleccionado actual antes de recargar
    const sel = $('#selPersona');
    const selectedBefore = sel ? sel.value : '';

    // Recarga catálogo (reconstruye #selPersona y catalogIndex)
    await loadCatalog();

    if (sel) {
      // Si la persona eliminada era la seleccionada, limpia ambos
      if (selectedBefore === pid) {
        sel.value = '';
        $('#inpRol').value = '';
      } else {
        // Si hay algo seleccionado, recalcula el cargo desde el nuevo catalogIndex
        if (sel.value && catalogIndex[sel.value]) {
          $('#inpRol').value = catalogIndex[sel.value].Cargo || '';
        } else {
          // No hay selección válida -> limpia
          sel.value = '';
          $('#inpRol').value = '';
        }
      }

      // Opcional: dispara change para que cualquier listener dependiente se ejecute
      sel.dispatchEvent(new Event('change'));
    }

    // Opcional: refrescar tarjetas si quieres
    // await reloadUI();

    alert('Persona eliminada.');
  } catch (err) {
    alert('Error al eliminar: ' + err.message);
  }
  return;
}
});

/* =========================
   DOM Ready
========================= */
document.addEventListener('DOMContentLoaded', async ()=>{
  await loadCatalog();
  await load("");

  // Autorelleno cargo al cambiar persona
  $('#selPersona')?.addEventListener('change', () => {
    const pid = $('#selPersona').value;     // ahora devuelve el ID
    const info = catalogIndex[pid];
    $('#inpRol').value = info?.Cargo || '';
  });

  // Reset modal Nueva Invitación
  const modalEl = document.getElementById('modalCreate');
  if (modalEl) {
    modalEl.addEventListener('show.bs.modal', () => {
      resetCreateForm();
      const f = document.getElementById('cFecha');
      if (f) f.valueAsDate = new Date(); // opcional: hoy por defecto
    });
    modalEl.addEventListener('hidden.bs.modal', () => resetCreateForm());
  }

  // (Opcional) Auto-refresh cada 15s:
  // setInterval(reloadUI, 15000);
});
