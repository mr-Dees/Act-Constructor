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
principal = f"{raw_user}@DF.SBRF.RU"


def has_valid_ticket():
    """Проверяет, что в кеше есть действующий билет ИМЕННО для нужного принципала.

    Две независимые проверки, обе обязательны:
    1. `klist -s` → код 0 только при валидном (не истёкшем) TGT. klist без -s
       показывает и истёкшие билеты, поэтому одной проверки вывода мало.
    2. Ожидаемый principal присутствует в выводе `klist`. Без этого старый
       билет на другой realm (напр. OMEGA.SBRF.RU) проходит проверку №1,
       и приложение стартует с неправильным билетом: внешне «билет есть»,
       а доступа к Greenplum нет.
    """
    if subprocess.run(["/usr/bin/klist", "-s"], capture_output=True).returncode != 0:
        return False
    r = subprocess.run(["/usr/bin/klist"], capture_output=True, text=True)
    return principal in r.stdout


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
