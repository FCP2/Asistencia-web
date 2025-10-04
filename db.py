# db.py
import os
from datetime import datetime
from sqlalchemy import (
    create_engine, Column, String, Integer, Date, Time, Text,
    Boolean, DateTime
)
from sqlalchemy.orm import sessionmaker, declarative_base

# ============================
# CONFIG
raw = os.getenv("DB_URL")  # En Render: postgresql://USER:PASS@HOST:5432/DB?sslmode=require
if not raw:
    raise RuntimeError("DB_URL no definida")

# Fuerza el driver psycopg3 en la URL de SQLAlchemy
# (Render te da 'postgresql://...'; lo convertimos a 'postgresql+psycopg://...')
if raw.startswith("postgresql://"):
    DB_URL = "postgresql+psycopg://" + raw.split("://", 1)[1]
else:
    DB_URL = raw

engine = create_engine(
    DB_URL,
    pool_pre_ping=True,
    pool_size=3,
    max_overflow=2,
    pool_recycle=1800,
    future=True,
)

SessionLocal = sessionmaker(bind=engine, autoflush=False, autocommit=False, future=True)
Base = declarative_base()


# -------------------------------------------------------------------
# MODELOS
# -------------------------------------------------------------------

class Persona(Base):
    __tablename__ = "personas"

    id            = Column(Integer, primary_key=True)
    nombre        = Column(String, nullable=False, index=True)
    cargo         = Column(String)
    telefono      = Column(String)
    correo        = Column(String)
    unidad_region = Column(String)
    activo        = Column(Boolean, default=True)

    # relación con invitaciones (1:N)
    invitaciones  = relationship("Invitacion", back_populates="persona", lazy="selectin")

    __table_args__ = (
        Index("idx_personas_nombre", "nombre"),
    )


class Invitacion(Base):
    __tablename__ = "invitaciones"

    id                   = Column(Integer, primary_key=True)

    # Datos del evento
    fecha                = Column(Date)        # para inputs/queries
    hora                 = Column(Time)        # HH:MM
    evento               = Column(String, nullable=False)
    convoca_cargo        = Column(String)      # Diputado(a), Presidente(a), etc.
    convoca              = Column(String)      # nombre de quien convoca
    partido_politico     = Column(String)
    municipio            = Column(Text)        # "Municipio/Dependencia"
    lugar                = Column(Text)

    # Estado/seguimiento
    estatus              = Column(String, default="Pendiente")   # Pendiente/Confirmado/Sustituido/Cancelado
    asignado_a           = Column(String)                         # redundante (nombre para tarjetas/reportes)
    rol                  = Column(String)
    observaciones        = Column(Text)

    fecha_asignacion     = Column(DateTime)
    ultima_modificacion  = Column(DateTime, default=datetime.utcnow)
    modificado_por       = Column(String)

    # Relación con Persona (NUEVO)
    persona_id           = Column(Integer, ForeignKey("personas.id", ondelete="SET NULL"), nullable=True)
    persona              = relationship("Persona", back_populates="invitaciones", lazy="joined")

    # Archivo adjunto (PDF/JPG/PNG)
    archivo_url          = Column(Text)        # URL pública o ruta persistente (S3/Supabase/…)
    archivo_nombre       = Column(Text)        # nombre original
    archivo_mime         = Column(Text)        # application/pdf, image/jpeg, etc.
    archivo_tamano       = Column(Integer)     # bytes
    archivo_ts           = Column(DateTime)    # cuándo se subió

    __table_args__ = (
        Index("idx_invitaciones_estatus", "estatus"),
        Index("idx_invitaciones_fecha", "fecha"),
        Index("idx_invitaciones_persona", "persona_id"),
    )


class Notificacion(Base):
    __tablename__ = "notificaciones"

    id                = Column(Integer, primary_key=True)
    ts                = Column(DateTime, default=datetime.utcnow)

    # vínculo lógico a Invitacion (guardado como texto por compatibilidad)
    invitacion_id     = Column(String, index=True)

    # Snapshot principal
    evento            = Column(String)
    convoca           = Column(String)
    estatus           = Column(String)
    asignado_a_nombre = Column(String)
    rol               = Column(String)
    campo             = Column(String)    # "Estatus", "Asignado A", "Rol", etc.
    valor_anterior    = Column(Text)
    valor_nuevo       = Column(Text)
    comentario        = Column(Text)

    # NUEVOS snapshot desde invitaciones
    fecha             = Column(Date)      # 👈 snapshot de la invitación
    hora              = Column(Time)      # 👈
    municipio         = Column(Text)      # 👈
    lugar             = Column(Text)      # 👈

    # Envío del bot
    enviado           = Column(Boolean, default=False)
    enviado_ts        = Column(DateTime, nullable=True)

    __table_args__ = (
        Index("idx_notif_enviado", "enviado"),
        Index("idx_notif_ts", "ts"),
        Index("idx_notif_inv_id", "invitacion_id"),
    )


# -------------------------------------------------------------------
# Sugerencias de índices/constraints adicionales (opcionales)
# -------------------------------------------------------------------
# 1) Anti “doble booking”: misma persona + misma fecha + misma hora para estados activos.
#    Esto es un índice único parcial en SQL (no se define aquí automáticamente).
#
#   CREATE UNIQUE INDEX IF NOT EXISTS uq_inv_persona_fecha_hora
#   ON invitaciones (persona_id, fecha, hora)
#   WHERE estatus IN ('Confirmado','Sustituido');
#
# 2) Si en algún momento manejas intervalos (inicio/fin), conviene EXCLUDE USING gist.
# -------------------------------------------------------------------

__all__ = [
    "engine", "SessionLocal", "Base",
    "Persona", "Invitacion", "Notificacion",
]
