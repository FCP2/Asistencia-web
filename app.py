# app.py — MISMAS RUTAS/PAYLOADS que versión Sheets, ahora con PostgreSQL (Render)
import os
import datetime as dt
from flask import Flask, render_template, request, jsonify, make_response
from sqlalchemy import select, update, delete, or_
from sqlalchemy.exc import SQLAlchemyError
from db import SessionLocal, Persona, Invitacion, Historial, Notificacion
from datetime import date, time as dtime
#formatear dia
def fmt_date(d: date | None) -> str:
    return d.strftime("%d/%m/%y") if d else ""

def fmt_time(t: dtime | None) -> str:
    return t.strftime("%H:%M") if t else ""
# =========================
#  Config / util
# =========================
TZ_OFFSET = -6  # America/Mexico_City (ajusta DST si aplica)

def now_aware():
    return dt.datetime.now(dt.timezone(dt.timedelta(hours=TZ_OFFSET)))

def now_str():
    return now_aware().strftime("%Y-%m-%d %H:%M:%S")

# Convierte obj Invitacion -> dict con mismas claves que tu UI espera
def inv_to_dict(inv: Invitacion):
    return {
        "ID": inv.id,
        "Fecha": inv.fecha.isoformat() if inv.fecha else None,   # crudo (ISO)
        "Hora": inv.hora.isoformat(timespec="minutes") if inv.hora else None,  # crudo
        "FechaFmt": fmt_date(inv.fecha),   # 👈 formateado dd/mm/yy
        "HoraFmt": fmt_time(inv.hora),     # 👈 formateado HH:MM
        "Evento": inv.evento or "",
        "Convoca Cargo": inv.convoca_cargo or "",
        "Convoca": inv.convoca or "",
        "Partido Político": inv.partido_politico or "",
        "Municipio/Dependencia": inv.municipio or "",
        "Lugar": inv.lugar or "",
        "Estatus": inv.estatus or "Pendiente",
        "Asignado A": inv.asignado_a or "",
        "Rol": inv.rol or "",
        "Observaciones": inv.observaciones or "",
        "Fecha Asignación": inv.fecha_asignacion.strftime("%Y-%m-%d %H:%M:%S") if inv.fecha_asignacion else "",
        "Última Modificación": inv.ultima_modificacion.strftime("%Y-%m-%d %H:%M:%S") if inv.ultima_modificacion else "",
        "Modificado Por": inv.modificado_por or "webapp",
    }

def add_hist(db, accion, inv_id, campo, old_val, new_val, comentario):
    db.add(Historial(
        ts=now_aware(), usuario="webapp", accion=accion,
        invitacion_id=inv_id, campo=campo,
        valor_anterior=old_val or "", valor_nuevo=new_val or "",
        comentario=comentario or ""
    ))

def snapshot_for_notif(inv: Invitacion):
    # “snapshot” como lo hacías desde Sheets -> Notificaciones
    return dict(
        invitacion_id = inv.id,
        evento = inv.evento or "",
        convoca = inv.convoca or "",
        estatus = inv.estatus or "",
        asignado_a_nombre = inv.asignado_a or "",
        rol = inv.rol or ""
    )

def add_notif(db, inv: Invitacion, campo, old_val, new_val, comentario):
    snap = snapshot_for_notif(inv)
    db.add(Notificacion(
        ts=now_aware(),
        invitacion_id=snap["invitacion_id"],
        evento=snap["evento"],
        convoca=snap["convoca"],
        estatus=snap["estatus"],
        asignado_a_nombre=snap["asignado_a_nombre"],
        rol=snap["rol"],
        campo=campo,
        valor_anterior=old_val or "",
        valor_nuevo=new_val or "",
        comentario=comentario or "",
        enviado=False
    ))
    
 # --------- Editar persona e invitacion ----------
def log_field_change(db, inv, campo, old_val, new_val, comentario="Edición de invitación"):
    if (old_val or "") != (new_val or ""):
        add_hist(db, "EDITAR", inv.id, campo, old_val, new_val, comentario)
        # Notificación snapshot (igual que lo haces en asignar/estatus)
        add_notif(db, inv, campo, old_val, new_val, comentario)

# =========================
#  Flask
# =========================
app = Flask(__name__)

@app.route("/")
def home():
    return render_template("index.html")

# --------- Catálogo (personas) ----------
@app.get("/api/catalog")
def api_catalog():
    """
    Devuelve el catálogo completo de personas para poblar el <select>.
    Formato:
    [
      {"ID": 1, "Nombre":"...", "Cargo":"...", "Teléfono":"...", "Correo":"...", "Unidad/Región":"..."},
      ...
    ]
    """
    db = SessionLocal()
    try:
        personas = (
            db.query(Persona)
              .filter(Persona.nombre != "")
              .order_by(Persona.nombre.asc())
              .all()
        )
        rows = [{
            "ID": p.id,
            "Nombre": p.nombre,
            "Cargo": p.cargo or "",
            "Teléfono": p.telefono or "",
            "Correo": p.correo or "",
            "Unidad/Región": p.unidad_region or ""
        } for p in personas]

        # sin caché para que el front siempre vea lo último
        resp = jsonify(rows)
        resp.headers["Cache-Control"] = "no-store, no-cache, must-revalidate, max-age=0"
        resp.headers["Pragma"] = "no-cache"
        resp.headers["Expires"] = "0"
        return resp
    finally:
        db.close()

# --------- Invitaciones (listado) ----------
@app.get("/api/invitations")
def api_invitations():
    status = (request.args.get("status") or "").strip()
    db = SessionLocal()
    try:
        q = select(Invitacion)
        if status:
            q = q.where(Invitacion.estatus == status)
        q = q.order_by(Invitacion.fecha.desc(), Invitacion.hora.desc())
        invs = db.execute(q).scalars().all()
        rows = [inv_to_dict(i) for i in invs]
        resp = make_response(jsonify(rows))
        resp.headers["Cache-Control"] = "public, max-age=10"
        return resp
    finally:
        db.close()

# --------- Crear invitación ----------
@app.post("/api/create")
def api_create():
    data = request.get_json() or {}
    required = ["Fecha","Hora","Evento","Convoca Cargo","Convoca","Partido Político","Municipio/Dependencia","Lugar"]
    if not all((data.get(k) or "").strip() for k in required):
        return jsonify({"ok": False, "error": "Todos los campos son obligatorios excepto Observaciones"}), 400

    from uuid import uuid4
    inv_id = str(uuid4())

    db = SessionLocal()
    try:
        inv = Invitacion(
            id=inv_id,
            fecha=dt.date.fromisoformat(data["Fecha"]),
            hora=dt.time.fromisoformat(data["Hora"]),
            evento=data["Evento"].strip(),
            convoca_cargo=data["Convoca Cargo"].strip(),
            convoca=data["Convoca"].strip(),
            partido_politico=data["Partido Político"].strip(),
            municipio=data["Municipio/Dependencia"].strip(),
            lugar=data["Lugar"].strip(),
            estatus="Pendiente",
            asignado_a="",
            rol="",
            observaciones=(data.get("Observaciones") or "").strip(),
            fecha_asignacion=None,
            ultima_modificacion=now_aware(),
            modificado_por="webapp",
        )
        db.add(inv)
        add_hist(db, "CREAR", inv_id, "Invitación", "", f"{inv.evento} @ {inv.fecha} {inv.hora}", "Nueva invitación")
        add_notif(db, inv, "Invitación", "", "Creada", "Nueva invitación")
        db.commit()
        return jsonify({"ok": True, "id": inv_id})
    except SQLAlchemyError as e:
        db.rollback()
        return jsonify({"ok": False, "error": str(e)})
    finally:
        db.close()

# --------- Asignar ----------
@app.post("/api/assign")
def api_assign():
    data = request.get_json() or {}
    inv_id     = data.get("id")
    persona_id = data.get("persona_id")
    rol_in     = (data.get("rol") or "").strip()  # opcional: si lo mandas, sobrescribe cargo
    comentario = (data.get("comentario") or "").strip()

    if not inv_id or not persona_id:
        return jsonify({"ok": False, "error": "Faltan campos: id, persona_id"}), 400

    db = SessionLocal()
    try:
        inv = db.get(Invitacion, inv_id)
        if not inv:
            return jsonify({"ok": False, "error": "ID no encontrado"}), 404

        p = db.get(Persona, int(persona_id))
        if not p:
            return jsonify({"ok": False, "error": "Persona no encontrada"}), 404

        prev_estatus, prev_asignado, prev_rol = inv.estatus, inv.asignado_a, inv.rol

        inv.asignado_a = p.nombre
        inv.rol = rol_in if rol_in else (p.cargo or "")
        inv.estatus = "Confirmado"
        if comentario:
            inv.observaciones = (inv.observaciones or "")
            if inv.observaciones:
                inv.observaciones += " | "
            inv.observaciones += comentario
        inv.fecha_asignacion = now_aware()
        inv.ultima_modificacion = now_aware()
        inv.modificado_por = "webapp"

        add_hist(db, "ASIGNAR", inv_id, "Asignado A", prev_asignado, inv.asignado_a, comentario)
        if prev_estatus != "Confirmado":
            add_hist(db, "ASIGNAR", inv_id, "Estatus", prev_estatus, "Confirmado", comentario)
        if (prev_rol or "") != inv.rol:
            add_hist(db, "ASIGNAR", inv_id, "Rol", prev_rol, inv.rol, comentario)

        add_notif(db, inv, "Asignado A", prev_asignado, inv.asignado_a, comentario)
        db.commit()
        return jsonify({"ok": True})
    except Exception as e:
        db.rollback()
        return jsonify({"ok": False, "error": str(e)})
    finally:
        db.close()

# --------- Sustituir ----------
@app.post("/api/reassign")
def api_reassign():
    data = request.get_json() or {}
    inv_id     = data.get("id")
    persona_id = data.get("persona_id")
    rol_in     = (data.get("rol") or "").strip()
    comentario = (data.get("comentario") or "Sustitución por instrucción").strip()

    if not inv_id or not persona_id:
        return jsonify({"ok": False, "error": "Faltan campos: id, persona_id"}), 400

    db = SessionLocal()
    try:
        inv = db.get(Invitacion, inv_id)
        if not inv:
            return jsonify({"ok": False, "error": "ID no encontrado"}), 404

        p = db.get(Persona, int(persona_id))
        if not p:
            return jsonify({"ok": False, "error": "Persona no encontrada"}), 404

        prev_asignado, prev_estatus, prev_rol = inv.asignado_a, inv.estatus, inv.rol

        inv.asignado_a = p.nombre
        inv.rol = rol_in if rol_in else (p.cargo or "")
        inv.estatus = "Sustituido"
        inv.ultima_modificacion = now_aware()
        inv.modificado_por = "webapp"
        inv.fecha_asignacion = inv.fecha_asignacion or now_aware()

        add_hist(db, "SUSTITUIR", inv_id, "Asignado A", prev_asignado, inv.asignado_a, comentario)
        if prev_estatus != "Sustituido":
            add_hist(db, "SUSTITUIR", inv_id, "Estatus", prev_estatus, "Sustituido", comentario)
        if (prev_rol or "") != inv.rol:
            add_hist(db, "SUSTITUIR", inv_id, "Rol", prev_rol, inv.rol, comentario)

        add_notif(db, inv, "Asignado A", prev_asignado, inv.asignado_a, comentario)
        db.commit()
        return jsonify({"ok": True})
    except Exception as e:
        db.rollback()
        return jsonify({"ok": False, "error": str(e)})
    finally:
        db.close()

# --------- Cancelar ----------
@app.post("/api/cancel")
def api_cancel():
    data = request.get_json() or {}
    inv_id = data.get("id")
    motivo = (data.get("comentario") or "Cancelado por indicación").strip()
    if not inv_id:
        return jsonify({"ok": False, "error": "Falta id"}), 400

    db = SessionLocal()
    try:
        inv = db.get(Invitacion, inv_id)
        if not inv:
            return jsonify({"ok": False, "error": "ID no encontrado"}), 404

        prev_estatus = inv.estatus
        prev_obs = inv.observaciones or ""
        inv.estatus = "Cancelado"
        inv.observaciones = (prev_obs + " | " if prev_obs else "") + f"Motivo cancelación: {motivo}"
        inv.ultima_modificacion = now_aware()
        inv.modificado_por = "webapp"

        add_hist(db, "CANCELAR", inv_id, "Estatus", prev_estatus, "Cancelado", f"Motivo cancelación: {motivo}")
        add_notif(db, inv, "Estatus", prev_estatus, "Cancelado", motivo)

        db.commit()
        return jsonify({"ok": True})
    except SQLAlchemyError as e:
        db.rollback()
        return jsonify({"ok": False, "error": str(e)})
    finally:
        db.close()

# --------- Cambiar estatus ----------
@app.post("/api/status")
def api_status():
    data = request.get_json() or {}
    inv_id = data.get("id")
    nuevo  = (data.get("estatus") or "").strip()  # Pendiente, Confirmado, Sustituido, Cancelado
    comentario = (data.get("comentario") or "Cambio de estatus").strip()
    if not (inv_id and nuevo):
        return jsonify({"ok": False, "error": "Faltan campos"}), 400

    db = SessionLocal()
    try:
        inv = db.get(Invitacion, inv_id)
        if not inv:
            return jsonify({"ok": False, "error": "ID no encontrado"}), 404

        prev_estatus = inv.estatus
        prev_obs = inv.observaciones or ""

        inv.estatus = nuevo
        inv.ultima_modificacion = now_aware()
        inv.modificado_por = "webapp"
        if comentario:
            inv.observaciones = (prev_obs + " | " if prev_obs else "") + comentario

        add_hist(db, "ESTATUS", inv_id, "Estatus", prev_estatus, nuevo, comentario)
        add_notif(db, inv, "Estatus", prev_estatus, nuevo, comentario)

        db.commit()
        return jsonify({"ok": True})
    except SQLAlchemyError as e:
        db.rollback()
        return jsonify({"ok": False, "error": str(e)})
    finally:
        db.close()

# --------- Eliminar ----------
@app.post("/api/delete")
def api_delete():
    data = request.get_json() or {}
    inv_id = data.get("id")
    comentario = (data.get("comentario") or "Eliminación solicitada").strip()
    if not inv_id:
        return jsonify({"ok": False, "error":"Falta id"}), 400

    db = SessionLocal()
    try:
        inv = db.get(Invitacion, inv_id)
        if not inv:
            return jsonify({"ok": False, "error":"ID no encontrado"}), 404

        summary = f"{inv.evento} @ {inv.fecha} {inv.hora} | {inv.convoca} | {inv.lugar}"

        add_hist(db, "ELIMINAR", inv_id, "Invitación", summary, "", comentario)
        # Guardamos notif “eliminada” como snapshot
        add_notif(db, inv, "Invitación", summary, "Eliminada", comentario)

        db.delete(inv)
        db.commit()
        return jsonify({"ok": True})
    except SQLAlchemyError as e:
        db.rollback()
        return jsonify({"ok": False, "error": str(e)})
    finally:
        db.close()

# --------- Crear / actualizar persona en Cat_Personal ----------
@app.post("/api/person/create")
def api_person_create():
    data = request.get_json() or {}
    nombre = (data.get("Nombre") or "").strip()
    cargo  = (data.get("Cargo") or "").strip()
    tel    = (data.get("Teléfono") or "").strip()
    correo = (data.get("Correo") or "").strip()
    unidad = (data.get("Unidad/Región") or "").strip()

    if not nombre:
        return jsonify({"ok": False, "error": "El campo 'Nombre' es obligatorio."}), 400
    if not cargo:
        return jsonify({"ok": False, "error": "El campo 'Cargo' es obligatorio."}), 400
    if tel and (not tel.isdigit() or len(tel) != 10):
        return jsonify({"ok": False, "error": "El 'Teléfono' debe ser numérico de 10 dígitos."}), 400

    db = SessionLocal()
    try:
        p = db.query(Persona).filter(Persona.nombre.ilike(nombre)).first()
        if p:
            # actualizar
            p.cargo = cargo
            p.telefono = tel
            p.correo = correo
            p.unidad_region = unidad
            p.updated_at = now_aware()
            db.commit()
            return jsonify({"ok": True, "updated": True, "id": p.id, "nombre": p.nombre})
        else:
            # crear
            p = Persona(
                nombre=nombre, cargo=cargo, telefono=tel, correo=correo, unidad_region=unidad
            )
            db.add(p)
            db.commit()
            db.refresh(p)  # para obtener p.id
            return jsonify({"ok": True, "updated": False, "id": p.id, "nombre": p.nombre})
    except SQLAlchemyError as e:
        db.rollback()
        return jsonify({"ok": False, "error": str(e)})
    finally:
        db.close()
# --------- Editar obtener ID invitacion ----------        
@app.get("/api/invitation/<inv_id>")
def api_invitation_get(inv_id):
    db = SessionLocal()
    try:
        inv = db.get(Invitacion, inv_id)
        if not inv:
            return jsonify({"ok": False, "error": "No encontrada"}), 404
        return jsonify({"ok": True, "inv": inv_to_dict(inv)})
    finally:
        db.close()
@app.post("/api/invitation/update")
def api_invitation_update():
    data = request.get_json() or {}
    inv_id = data.get("ID")
    if not inv_id:
        return jsonify({"ok": False, "error":"Falta ID"}), 400

    db = SessionLocal()
    try:
        inv = db.get(Invitacion, inv_id)
        if not inv:
            return jsonify({"ok": False, "error":"No encontrada"}), 404

        # guarda previos
        prev = inv_to_dict(inv)
        comentario = (data.get("Comentario") or "Edición de invitación").strip()

        # actualiza solo lo que llegue
        def set_if(field_key, setter):
            if field_key in data:
                setter(data[field_key])

        set_if("Evento",              lambda v: setattr(inv, "evento", (v or "").strip()))
        set_if("Convoca Cargo",       lambda v: setattr(inv, "convoca_cargo", (v or "").strip()))
        set_if("Convoca",             lambda v: setattr(inv, "convoca", (v or "").strip()))
        set_if("Partido Político",    lambda v: setattr(inv, "partido_politico", (v or "").strip()))
        set_if("Municipio/Dependencia", lambda v: setattr(inv, "municipio", (v or "").strip()))
        set_if("Lugar",               lambda v: setattr(inv, "lugar", (v or "").strip()))
        set_if("Observaciones",       lambda v: setattr(inv, "observaciones", (v or "").strip()))
        set_if("Fecha",               lambda v: setattr(inv, "fecha", dt.date.fromisoformat(v) if v else None))
        set_if("Hora",                lambda v: setattr(inv, "hora", dt.time.fromisoformat(v) if v else None))

        inv.ultima_modificacion = now_aware()
        inv.modificado_por = "ATIapp"

        # log por campo (solo si cambió)
        cur = inv_to_dict(inv)
        campos = [
            ("Evento","Evento"),
            ("Convoca Cargo","Convoca Cargo"),
            ("Convoca","Convoca"),
            ("Partido Político","Partido Político"),
            ("Municipio/Dependencia","Municipio/Dependencia"),
            ("Lugar","Lugar"),
            ("Observaciones","Observaciones"),
            ("Fecha","Fecha"),
            ("Hora","Hora")
        ]
        for k_sheet, k in campos:
            log_field_change(db, inv, k_sheet, prev.get(k_sheet), cur.get(k_sheet), comentario)

        db.commit()
        return jsonify({"ok": True})
    except Exception as e:
        db.rollback()
        return jsonify({"ok": False, "error": str(e)})
    finally:
        db.close()
        
# ================ obtener persona por id==========
@app.get("/api/person/<int:person_id>")
def api_person_get(person_id):
    db = SessionLocal()
    try:
        p = db.query(Persona).get(person_id)
        if not p:
            return jsonify({"ok": False, "error": "Persona no encontrada"}), 404
        return jsonify({
            "ok": True,
            "persona": {
                "ID": p.id,
                "Nombre": p.nombre,
                "Cargo": p.cargo or "",
                "Teléfono": p.telefono or "",
                "Correo": p.correo or "",
                "Unidad/Región": p.unidad_region or ""
            }
        })
    finally:
        db.close()
        
#========== editar persona
@app.post("/api/person/update")
def api_person_update():
    data = request.get_json() or {}
    pid = data.get("ID")
    if not pid:
        return jsonify({"ok": False, "error": "Falta ID"}), 400

    db = SessionLocal()
    try:
        p = db.query(Persona).get(pid)
        if not p:
            return jsonify({"ok": False, "error": "Persona no encontrada"}), 404

        cargo = (data.get("Cargo") or "").strip()
        tel   = (data.get("Teléfono") or "").strip()
        if not cargo:
            return jsonify({"ok": False, "error":"El campo 'Cargo' es obligatorio"}), 400
        if tel and (not tel.isdigit() or len(tel)!=10):
            return jsonify({"ok": False, "error":"Teléfono debe tener 10 dígitos"}), 400

        p.nombre = data.get("Nombre", p.nombre).strip()
        p.cargo = cargo
        p.telefono = tel
        p.correo = (data.get("Correo") or "").strip()
        p.unidad_region = (data.get("Unidad/Región") or "").strip()

        db.commit()
        return jsonify({"ok": True})
    except Exception as e:
        db.rollback()
        return jsonify({"ok": False, "error": str(e)})
    finally:
        db.close()
#====== eliminar persona
@app.post("/api/person/delete")
def api_person_delete():
    data = request.get_json() or {}
    pid = data.get("ID")
    if not pid:
        return jsonify({"ok": False, "error": "Falta ID"}), 400

    db = SessionLocal()
    try:
        p = db.get(Persona, int(pid))
        if not p:
            return jsonify({"ok": False, "error": "Persona no encontrada"}), 404

        # (Opcional) Reglas de negocio:
        # Si quisieras impedir borrar si está asignada en invitaciones activas,
        # aquí podrías consultar invitaciones y abortar si corresponde.

        db.delete(p)
        db.commit()
        return jsonify({"ok": True})
    except Exception as e:
        db.rollback()
        return jsonify({"ok": False, "error": str(e)})
    finally:
        db.close()
# =========================
#  Run
# =========================
@app.get("/health")
def health():
    return {"ok": True}
if __name__ == "__main__":
    # No hay warming de Sheets; BD ya está lista
    app.run(host="0.0.0.0", port=8000, debug=True)
