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

# ============================
# MODELOS
# ============================

class Persona(Base):
    __tablename__ = "personas"
    id = Column(Integer, primary_key=True)
    nombre = Column(String, unique=True, nullable=False)
    cargo = Column(String, nullable=False)
    telefono = Column(String(20))
    correo = Column(String)
    unidad_region = Column(String)
    created_at = Column(DateTime, default=datetime.utcnow)
    updated_at = Column(DateTime, default=datetime.utcnow)


class Invitacion(Base):
    __tablename__ = "invitaciones"
    id = Column(String, primary_key=True)  # UUID texto
    fecha = Column(Date, nullable=False)
    hora = Column(Time, nullable=False)
    evento = Column(String, nullable=False)
    convoca_cargo = Column(String, nullable=False)
    convoca = Column(String, nullable=False)
    partido_politico = Column(String, nullable=False)
    municipio = Column(String, nullable=False)
    lugar = Column(String, nullable=False)
    estatus = Column(String, default="Pendiente")
    asignado_a = Column(String)   # nombre texto (luego podemos FK)
    rol = Column(String)
    observaciones = Column(Text)
    fecha_asignacion = Column(DateTime, nullable=True)
    ultima_modificacion = Column(DateTime, default=datetime.utcnow)
    modificado_por = Column(String, default="webapp")


class Historial(Base):
    __tablename__ = "historial"
    id = Column(Integer, primary_key=True)
    ts = Column(DateTime, default=datetime.utcnow)
    usuario = Column(String)
    accion = Column(String)
    invitacion_id = Column(String)  # FK lógica
    campo = Column(String)
    valor_anterior = Column(Text)
    valor_nuevo = Column(Text)
    comentario = Column(Text)


class Notificacion(Base):
    __tablename__ = "notificaciones"
    id = Column(Integer, primary_key=True)
    ts = Column(DateTime, default=datetime.utcnow)
    invitacion_id = Column(String)
    evento = Column(String)
    convoca = Column(String)
    estatus = Column(String)
    asignado_a_nombre = Column(String)
    rol = Column(String)
    campo = Column(String)
    valor_anterior = Column(Text)
    valor_nuevo = Column(Text)
    comentario = Column(Text)
    enviado = Column(Boolean, default=False)
    enviado_ts = Column(DateTime, nullable=True)
