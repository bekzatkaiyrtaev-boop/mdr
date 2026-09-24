"""Загрузка дампа БД на Google Drive и удаление бэкапов старше RETENTION_DAYS.

Вызывается из .github/workflows/backup.yml после pg_dump.
Нужные переменные окружения:
  GDRIVE_SA_KEY    — содержимое JSON-ключа сервисного аккаунта (целиком)
  GDRIVE_FOLDER_ID — id папки "Сохранение" на Google Диске
  RETENTION_DAYS   — сколько дней хранить бэкапы (старые удаляются)
"""
import datetime
import json
import os
import sys

from google.oauth2 import service_account
from googleapiclient.discovery import build
from googleapiclient.http import MediaFileUpload


def main():
    file_path = sys.argv[1]
    folder_id = os.environ["GDRIVE_FOLDER_ID"]
    retention_days = int(os.environ.get("RETENTION_DAYS", "60"))
    sa_info = json.loads(os.environ["GDRIVE_SA_KEY"])

    creds = service_account.Credentials.from_service_account_info(
        sa_info, scopes=["https://www.googleapis.com/auth/drive"]
    )
    drive = build("drive", "v3", credentials=creds)

    file_metadata = {"name": os.path.basename(file_path), "parents": [folder_id]}
    media = MediaFileUpload(file_path, mimetype="application/sql", resumable=False)
    uploaded = drive.files().create(body=file_metadata, media_body=media, fields="id,name").execute()
    print(f"Загружен: {uploaded['name']} ({uploaded['id']})")

    cutoff = datetime.datetime.utcnow() - datetime.timedelta(days=retention_days)
    cutoff_str = cutoff.strftime("%Y-%m-%dT%H:%M:%S")
    query = f"'{folder_id}' in parents and trashed = false and createdTime < '{cutoff_str}'"
    old_files = drive.files().list(q=query, fields="files(id,name,createdTime)").execute().get("files", [])
    for f in old_files:
        drive.files().delete(fileId=f["id"]).execute()
        print(f"Удалён старый бэкап: {f['name']} ({f['createdTime']})")


if __name__ == "__main__":
    main()
