"""
Скрипт запуска приложения в JupyterHub DataLab.

Использование в ячейке Jupyter:
    %run scripts/launch_datalab.py
"""

import os
import re
import subprocess
from subprocess import Popen, PIPE
from getpass import getpass
from dotenv import load_dotenv

load_dotenv()

raw_user = os.environ.get("JUPYTERHUB_USER", "")
username = raw_user.split("_")[0]
realm = raw_user.split("_", 1)[1].replace("-", ".").upper() if "_" in raw_user else "OMEGA.SBRF.RU"
principal = f"{username}@{realm}"


def has_valid_ticket():
    """Проверяет наличие действующего (не истёкшего) Kerberos билета.

    Использует klist -s, который возвращает код 0 только при наличии
    валидного билета. Простая проверка realm в выводе klist не работает,
    потому что klist показывает и истёкшие билеты.
    """
    r = subprocess.run(["/usr/bin/klist", "-s"], capture_output=True)
    return r.returncode == 0


def kinit(password: bytes):
    """Выполняет kinit с переданным паролем."""
    proc = Popen(["/usr/bin/kinit", principal], stdin=PIPE, stdout=PIPE, stderr=PIPE)
    _, stderr = proc.communicate(input=password + b"\n")
    return stderr.decode().strip()


try:
    if has_valid_ticket():
        print("Kerberos-билет актуален.\n")
    else:
        print(f"Авторизация: {principal}")
        password = getpass("Пароль IPA: ").encode("utf-8")

        while True:
            err = kinit(password)
            if not err:
                print("Билет получен.\n")
                break
            if re.search(r"password incorrect", err, re.IGNORECASE):
                password = getpass("Неверный пароль. Повторите: ").encode("utf-8")
                continue
            raise RuntimeError(err)

    print(f"https://jupyterhub-datalab.apps.prom-datalab.ca.sbrf.ru/user/{raw_user}/proxy/{os.getenv('SERVER__PORT')}\n")
    subprocess.run(["python", "-m", "app.main"], check=True)
except subprocess.CalledProcessError as e:
    print(f"Ошибка: {e}")
