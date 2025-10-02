# init_db.py
from db import Base, engine

def init():
    print("⏳ Creando tablas en la base de datos...")
    Base.metadata.create_all(bind=engine)
    print("✅ Tablas creadas correctamente en Render PostgreSQL.")

if __name__ == "__main__":
    init()