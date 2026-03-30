"""
Настройки домена актов.

Содержит все доменные настройки, которые загружаются через
ACTS__* префикс в .env файле.
"""

from pydantic import BaseModel, Field, field_validator


class LockSettings(BaseModel):
    """
    Параметры блокировок и контроля активности пользователя.

    Механизм работы:
    1. При открытии акта сервер ставит эксклюзивную блокировку на duration_minutes.
    2. Фронтенд каждые inactivity_check_interval_seconds проверяет,
       двигал ли пользователь мышь / нажимал клавиши / скроллил.
    3. Если пользователь активен и с последнего продления прошло ≥ min_extension_interval_minutes,
       фронтенд автоматически продлевает блокировку на сервере.
    4. Если пользователь бездействует ≥ inactivity_timeout_minutes,
       появляется диалог «Продолжить работу?» с обратным отсчётом.
    5. Если пользователь не отвечает за inactivity_dialog_timeout_seconds —
       контент автосохраняется, блокировка снимается, происходит редирект на список актов.
    """
    duration_minutes: int = Field(default=15, gt=0)
    inactivity_timeout_minutes: float = Field(default=5.0, gt=0)
    inactivity_check_interval_seconds: int = Field(default=60, gt=0)
    min_extension_interval_minutes: float = Field(default=5.0, gt=0)
    inactivity_dialog_timeout_seconds: int = Field(default=30, gt=0)


class FormattingSettings(BaseModel):
    """Параметры форматирования документов."""
    # DOCX
    max_image_size_mb: float = 10.0
    docx_image_width: float = 4.0
    docx_caption_font_size: int = 10
    docx_max_heading_level: int = 9
    # Text
    text_header_width: int = 80
    text_indent_size: int = 2
    # Markdown
    markdown_max_heading_level: int = 6
    # HTML parsing
    html_parse_timeout: int = Field(default=30, gt=0)
    max_html_depth: int = 100
    html_parse_chunk_size: int = Field(default=1000, gt=0)
    # Retry
    max_retries: int = Field(default=3, gt=0)
    retry_delay: float = Field(default=0.5, ge=0)


class ResourceSettings(BaseModel):
    """Параметры управления ресурсами."""
    max_concurrent_file_operations: int = Field(default=100, gt=0)
    save_operation_timeout: int = Field(default=300, gt=0)
    save_act_timeout: int = 300
    max_tree_depth: int = 50


class InvoiceSettings(BaseModel):
    """Настройки фактур."""
    hive_schema: str = Field(default="team_sva_oarb_3")
    gp_schema: str = Field(default="s_grnplm_ld_audit_da_sandbox_oarb")
    hive_registry_schema: str = Field(default="s_grnplm_ld_audit_project_4")
    hive_registry_table: str = Field(default="t_db_oarb_ua_hadoop_tables")
    hive_registry_col_table: str = Field(default="table_name")
    metric_dict_table: str = Field(default="t_db_oarb_ua_violation_metric_dict")
    process_dict_table: str = Field(default="t_db_oarb_ua_process_dict")
    process_dict_col_code: str = Field(default="process_code")
    process_dict_col_name: str = Field(default="process_name")
    subsidiary_dict_table: str = Field(default="t_db_oarb_ua_subsidiary_dict")
    subsidiary_dict_col_name: str = Field(default="name")

    @field_validator(
        'hive_schema', 'gp_schema', 'hive_registry_schema',
        'hive_registry_table', 'hive_registry_col_table', 'metric_dict_table',
        'process_dict_table', 'process_dict_col_code', 'process_dict_col_name',
        'subsidiary_dict_table', 'subsidiary_dict_col_name',
    )
    @classmethod
    def validate_sql_identifiers(cls, v: str) -> str:
        """Проверяет что значение является безопасным SQL-идентификатором."""
        from app.db.utils.sql_utils import validate_sql_identifier
        if not validate_sql_identifier(v):
            raise ValueError(f"Небезопасный SQL-идентификатор в настройках: {v!r}")
        return v


class AuditLogSettings(BaseModel):
    """Параметры аудит-лога и версионирования."""
    retention_days: int = Field(default=365, gt=0)
    max_content_versions: int = Field(default=50, gt=0)
    max_diff_elements: int = Field(default=20, gt=0)
    max_diff_cells_per_table: int = Field(default=50, gt=0)


class ActsSettings(BaseModel):
    """Корневая модель настроек домена актов."""
    lock: LockSettings = LockSettings()
    formatting: FormattingSettings = FormattingSettings()
    resource: ResourceSettings = ResourceSettings()
    invoice: InvoiceSettings = InvoiceSettings()
    audit_log: AuditLogSettings = AuditLogSettings()
