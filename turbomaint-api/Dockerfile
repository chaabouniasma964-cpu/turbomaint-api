# ---- Image de l'API TurboMaint (FastAPI + modèles NumPy + PostgreSQL) ----
FROM python:3.11-slim

WORKDIR /app

# Dépendances Python (couche mise en cache tant que requirements.txt ne change pas)
COPY requirements.txt .
RUN pip install --no-cache-dir -r requirements.txt

# Code + artefacts (modèles, base de connaissances)
COPY . .

EXPOSE 7860
# DATABASE_URL et GROQ_API_KEY sont fournis à l'exécution (docker-compose)
CMD ["uvicorn", "app:app", "--host", "0.0.0.0", "--port", "7860"]
