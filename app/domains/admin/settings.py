"""
Настройки домена администрирования.

Загружаются через ADMIN__* префикс в .env файле.
"""

from pydantic import BaseModel, Field


class UserDirectorySettings(BaseModel):
    """Настройки справочника пользователей в GreenPlum."""
    schema_name: str = Field(
        default="s_grnplm_ld_audit_da_project_4",
        alias="schema",
    )
    table: str = "t_db_oarb_ua_user"
    branch_filter: str = "Отдел аудита розничного бизнеса"
    default_admin: str = "22494524"


class AdminSettings(BaseModel):
    """Корневая модель настроек домена администрирования."""
    user_directory: UserDirectorySettings = UserDirectorySettings()
