"""Загрузка дампа БД на Google Drive и удаление бэкапов старше RETENTION_DAYS.

Вызывается из .github/workflows/backup.yml после pg_dump. Загружает файл от имени
обычного Google-аккаунта через OAuth (refresh token) — НЕ через сервисный аккаунт:
у сервисных аккаунтов нет собственной квоты на личном Диске ("Service Accounts do
not have storage quota"), а Shared Drives недоступны без платного Google Workspace.
Как получить refresh token — см. get_gdrive_refresh_token.py в корне репозитория
(запускается один раз локально, не в CI).
Нужные переменные окружения:
  GDRIVE_CLIENT_ID     — OAuth client ID (Google Cloud Console, тип "Desktop app")
  GDRIVE_CLIENT_SECRET — OAuth client secret
  GDRIVE_REFRESH_TOKEN — refresh token, полученный через get_gdrive_refresh_token.py
  GDRIVE_FOLDER_ID     — id папки "Сохранение" на Google Диске
  RETENTION_DAYS       — сколько дней хранить бэкапы (старые удаляются)
"""
import datetime
import os
import sys

from google.oauth2.credentials import Credentials
from googleapiclient.discovery import build
from googleapiclient.http import MediaFileUpload


def main():
    file_path = sys.argv[1]
    folder_id = os.environ["GDRIVE_FOLDER_ID"]
    retention_days = int(os.environ.get("RETENTION_DAYS", "60"))

    creds = Credentials(
        token=None,
        refresh_token=os.environ["GDRIVE_REFRESH_TOKEN"],
        client_id=os.environ["GDRIVE_CLIENT_ID"],
        client_secret=os.environ["GDRIVE_CLIENT_SECRET"],
        token_uri="https://oauth2.googleapis.com/token",
        scopes=["https://www.googleapis.com/auth/drive"],
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
