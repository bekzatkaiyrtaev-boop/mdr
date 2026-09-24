"""ОДНОРАЗОВЫЙ скрипт — запускается ОДИН РАЗ ЛОКАЛЬНО, на своём компьютере
(НЕ в GitHub Actions), чтобы получить refresh token для загрузки бэкапов на
свой личный Google Диск от собственного имени (см. .github/scripts/backup_to_drive.py
и .github/workflows/backup.yml — они используют полученный здесь токен).

Перед запуском:
  1. pip install google-auth-oauthlib
  2. В Google Cloud Console (console.cloud.google.com) создать OAuth client ID
     типа "Desktop app" (APIs & Services -> Credentials -> Create Credentials ->
     OAuth client ID). Перед этим может понадобиться настроить OAuth consent
     screen (User type: External, добавить себя в Test users ИЛИ опубликовать
     приложение — иначе refresh token истечёт через 7 дней).
  3. Скачать JSON-файл клиента (кнопка "Download JSON") и положить его рядом
     с этим скриптом под именем client_secret.json.

Запуск:
  python get_gdrive_refresh_token.py

Откроется браузер — войдите под своим Google-аккаунтом (bekzat.kaiyrtaev@gmail.com)
и разрешите доступ к Google Диску. После этого в консоли выведутся три значения —
их нужно сохранить как секреты репозитория на GitHub (Settings -> Secrets and
variables -> Actions): GDRIVE_CLIENT_ID, GDRIVE_CLIENT_SECRET, GDRIVE_REFRESH_TOKEN.

client_secret.json после этого можно удалить — он больше не нужен (сам refresh
token уже получен и не зависит от файла).
"""
from google_auth_oauthlib.flow import InstalledAppFlow

SCOPES = ["https://www.googleapis.com/auth/drive"]


def main():
    flow = InstalledAppFlow.from_client_secrets_file("client_secret.json", SCOPES)
    creds = flow.run_local_server(port=0)

    print("\n--- Сохраните эти три значения как секреты репозитория на GitHub ---")
    print("GDRIVE_CLIENT_ID:", creds.client_id)
    print("GDRIVE_CLIENT_SECRET:", creds.client_secret)
    print("GDRIVE_REFRESH_TOKEN:", creds.refresh_token)


if __name__ == "__main__":
    main()
