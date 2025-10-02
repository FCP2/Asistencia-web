# app.py — MISMAS RUTAS/PAYLOADS que versión Sheets, ahora con PostgreSQL (Render)
import os
import datetime as dt
from flask import Flask, render_template, request, jsonify, make_response
from sqlalchemy import select, update, delete, or_
from sqlalchemy.exc import SQLAlchemyError
from db import SessionLocal, Persona, Invitacion, Historial, Notificacion

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
        "Fecha": inv.fecha.isoformat() if inv.fecha else "",
        "Hora": inv.hora.strftime("%H:%M") if inv.hora else "",
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
    db = SessionLocal()
    try:
        personas = db.execute(select(Persona).where(Persona.nombre != "") \
                              .order_by(Persona.nombre.asc())).scalars().all()
        rows = [{
            "Nombre": p.nombre,
            "Cargo": p.cargo or "",
            "Teléfono": p.telefono or "",
            "Correo": p.correo or "",
            "Unidad/Región": p.unidad_region or ""
        } for p in personas]
        resp = make_response(jsonify(rows))
        resp.headers["Cache-Control"] = "public, max-age=10"
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
    inv_id   = data.get("id")
    asignado = (data.get("asignado") or "").strip()
    rol      = (data.get("rol") or "").strip()
    comentario = (data.get("comentario") or "").strip()
    if not inv_id or not asignado or not rol:
        return jsonify({"ok": False, "error": "Faltan campos"}), 400

    db = SessionLocal()
    try:
        inv = db.get(Invitacion, inv_id)
        if not inv:
            return jsonify({"ok": False, "error": "ID no encontrado"}), 404

        prev_estatus, prev_asignado, prev_rol = inv.estatus, inv.asignado_a, inv.rol

        inv.asignado_a = asignado
        inv.rol = rol
        inv.estatus = "Confirmado"
        inv.observaciones = comentario or inv.observaciones
        inv.fecha_asignacion = now_aware()
        inv.ultima_modificacion = now_aware()
        inv.modificado_por = "webapp"

        add_hist(db, "ASIGNAR", inv_id, "Asignado A", prev_asignado, asignado, comentario)
        if prev_estatus != "Confirmado":
            add_hist(db, "ASIGNAR", inv_id, "Estatus", prev_estatus, "Confirmado", comentario)
        if (prev_rol or "") != rol:
            add_hist(db, "ASIGNAR", inv_id, "Rol", prev_rol, rol, comentario)

        add_notif(db, inv, "Asignado A", prev_asignado, asignado, comentario)
        db.commit()
        return jsonify({"ok": True})
    except SQLAlchemyError as e:
        db.rollback()
        return jsonify({"ok": False, "error": str(e)})
    finally:
        db.close()

# --------- Sustituir ----------
@app.post("/api/reassign")
def api_reassign():
    data = request.get_json() or {}
    inv_id = data.get("id")
    nuevo  = (data.get("nuevo") or "").strip()
    rol    = (data.get("rol") or "").strip()
    comentario = (data.get("comentario") or "Sustitución por instrucción").strip()

    if not inv_id or not nuevo:
        return jsonify({"ok": False, "error": "Faltan campos"}), 400

    db = SessionLocal()
    try:
        inv = db.get(Invitacion, inv_id)
        if not inv:
            return jsonify({"ok": False, "error": "ID no encontrado"}), 404

        prev_asignado, prev_estatus, prev_rol = inv.asignado_a, inv.estatus, inv.rol

        inv.asignado_a = nuevo
        inv.rol = rol or prev_rol
        inv.estatus = "Sustituido"
        inv.ultima_modificacion = now_aware()
        inv.modificado_por = "webapp"
        inv.fecha_asignacion = inv.fecha_asignacion or now_aware()

        add_hist(db, "SUSTITUIR", inv_id, "Asignado A", prev_asignado, nuevo, comentario)
        if prev_estatus != "Sustituido":
            add_hist(db, "SUSTITUIR", inv_id, "Estatus", prev_estatus, "Sustituido", comentario)
        if (prev_rol or "") != (rol or prev_rol):
            add_hist(db, "SUSTITUIR", inv_id, "Rol", prev_rol, rol or prev_rol, comentario)

        add_notif(db, inv, "Asignado A", prev_asignado, nuevo, comentario)
        db.commit()
        return jsonify({"ok": True})
    except SQLAlchemyError as e:
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
        p = db.execute(select(Persona).where(Persona.nombre.ilike(nombre))).scalar_one_or_none()
        if p:
            # actualizar
            p.cargo = cargo
            p.telefono = tel
            p.correo = correo
            p.unidad_region = unidad
            p.updated_at = now_aware()
            db.commit()
            return jsonify({"ok": True, "nombre": nombre, "updated": True})
        else:
            # crear
            p = Persona(
                nombre=nombre, cargo=cargo, telefono=tel, correo=correo, unidad_region=unidad
            )
            db.add(p)
            db.commit()
            return jsonify({"ok": True, "nombre": nombre, "updated": False})
    except SQLAlchemyError as e:
        db.rollback()
        return jsonify({"ok": False, "error": str(e)})
    finally:
        db.close()

# =========================
#  Run
# =========================
@app.get("/health")
def health();
    return {"ok": True}
if __name__ == "__main__":
    # No hay warming de Sheets; BD ya está lista
    app.run(host="0.0.0.0", port=8000, debug=True)
