"""Реестр доменных настроек."""

from pathlib import Path
from typing import TypeVar, overload

from pydantic import BaseModel
from pydantic_core import PydanticUndefined
from pydantic_settings import BaseSettings, SettingsConfigDict

_registry: dict[str, BaseModel] = {}

T = TypeVar("T", bound=BaseModel)


def _load_from_env(name: str, cls: type[BaseModel]) -> BaseModel:
    """
    Загружает настройки домена из .env с префиксом NAME__.

    Создаёт временный BaseSettings-класс с полями из cls,
    чтобы pydantic_settings подтянул переменные типа ACTS__LOCK__DURATION_MINUTES.
    """
    env_file = Path(__file__).resolve().parent.parent.parent / ".env"

    # Динамически создаём BaseSettings с теми же полями
    loader_cls = type(
        f"_{name}_Loader",
        (BaseSettings,),
        {
            "__annotations__": cls.__annotations__.copy(),
            "model_config": SettingsConfigDict(
                env_prefix=f"{name.upper()}__",
                env_nested_delimiter="__",
                env_file=str(env_file),
                case_sensitive=False,
                extra="ignore",
            ),
            # Копируем default values из cls
            **{
                field_name: field_info.default
                for field_name, field_info in cls.model_fields.items()
                if field_info.default is not None
                and field_info.default is not PydanticUndefined
            },
        },
    )

    try:
        loader_instance = loader_cls()
    except Exception as e:
        raise RuntimeError(
            f"Ошибка загрузки настроек домена '{name}' из .env: {e}"
        ) from e
    try:
        return cls.model_validate(loader_instance.model_dump())
    except Exception as e:
        raise RuntimeError(
            f"Валидация настроек домена '{name}' не пройдена: {e}"
        ) from e


def register(name: str, cls: type[BaseModel]) -> None:
    """Загружает и регистрирует настройки домена."""
    _registry[name] = _load_from_env(name, cls)


@overload
def get(name: str) -> BaseModel: ...


@overload
def get(name: str, cls: type[T]) -> T: ...


def get(name: str, cls: type[T] | None = None) -> BaseModel:
    """Возвращает настройки домена по имени. С cls — проверяет тип и возвращает T."""
    if name not in _registry:
        raise KeyError(f"Настройки домена '{name}' не зарегистрированы")
    instance = _registry[name]
    if cls is not None and not isinstance(instance, cls):
        raise TypeError(
            f"Настройки домена '{name}' имеют тип {type(instance).__name__}, "
            f"ожидался {cls.__name__}"
        )
    return instance


def reset() -> None:
    """Сбрасывает реестр (для тестов)."""
    _registry.clear()
