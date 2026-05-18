"""
Сервис справочников ua_data.

Тонкий фасад над IDictionaryRepository: единая точка входа для cross-domain
доступа к справочникам (процессы, тербанки, метрики, подразделения и т.д.).

Зачем фасад над голым репозиторием:
- Потребители из других доменов (ck_fin_res, ck_client_exp, acts) зависят
  от сервиса ua_data, а не от деталей реализации репозитория.
- Тестируется через мок IDictionaryRepository — таблицы и SQL не нужны.
- Точка расширения: если позже появится кэш/композиция/валидация, она
  ляжет сюда, а не размажется по всем потребителям.

Методы 1-в-1 повторяют IDictionaryRepository (YAGNI: новые группирующие
методы добавляются по фактической потребности).
"""

from app.domains.ua_data.interfaces import IDictionaryRepository


class DictionaryService:
    """Фасад над репозиторием справочников ua_data."""

    def __init__(self, repo: IDictionaryRepository) -> None:
        self._repo = repo

    async def get_processes(self) -> list[dict]:
        """Возвращает список актуальных процессов."""
        return await self._repo.get_processes()

    async def get_terbanks(self) -> list[dict]:
        """Возвращает список актуальных территориальных банков."""
        return await self._repo.get_terbanks()

    async def get_metric_codes(self) -> list[dict]:
        """Возвращает список актуальных метрик нарушений."""
        return await self._repo.get_metric_codes()

    async def get_departments(self) -> list[dict]:
        """Возвращает список актуальных подразделений."""
        return await self._repo.get_departments()

    async def get_channels(self) -> list[dict]:
        """Возвращает список актуальных каналов."""
        return await self._repo.get_channels()

    async def get_products(self) -> list[dict]:
        """Возвращает список актуальных продуктов."""
        return await self._repo.get_products()

    async def get_risk_types(self) -> list[dict]:
        """Возвращает список актуальных типов риска."""
        return await self._repo.get_risk_types()

    async def get_teams(self) -> list[dict]:
        """Возвращает список актуальных команд аудита."""
        return await self._repo.get_teams()
