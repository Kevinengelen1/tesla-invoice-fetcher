FROM python:3.12-slim

WORKDIR /app

COPY requirements.txt .
RUN pip install --no-cache-dir -r requirements.txt

COPY . .

# Ensure runtime directories exist (real data comes from volumes)
RUN mkdir -p /app/auth /app/invoices

EXPOSE 5000

# Single worker with multiple threads — required for the blocking OAuth auth flow
CMD ["gunicorn", "--bind", "0.0.0.0:5000", "--workers", "1", "--threads", "4", "--timeout", "120", "app:app"]
