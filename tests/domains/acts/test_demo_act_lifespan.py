"""Хук acts.demo_act_seed вызывает ensure_demo_act при старте.

Не запускаем реальный FastAPI lifespan — проверяем регистрацию через _startup_hooks.
"""
from unittest.mock import AsyncMock, patch

import pytest

from app.core.domain_registry import reset_registry
from app.domains.acts._lifecycle import register_lifespan_hooks


@pytest.fixture(autouse=True)
def _reset():
    reset_registry()
    yield
    reset_registry()


def test_demo_act_seed_hook_is_registered():
    from app.core import domain_registry as dr

    register_lifespan_hooks()
    hook_names = [name for name, _ in dr.get_startup_hooks()]
    assert "acts.demo_act_seed" in hook_names


@pytest.mark.asyncio
async def test_demo_act_seed_hook_calls_ensure_demo_act():
    from app.core import domain_registry as dr

    register_lifespan_hooks()
    hooks = dict(dr.get_startup_hooks())
    seed_hook = hooks["acts.demo_act_seed"]

    fake_ensure = AsyncMock()
    with patch("scripts.seed_demo_act.ensure_demo_act", fake_ensure):
        await seed_hook(app=object())
    fake_ensure.assert_awaited_once()


@pytest.mark.asyncio
async def test_demo_act_seed_hook_swallows_exceptions():
    """Хук не должен бросать исключение наружу (стартап критичен)."""
    from app.core import domain_registry as dr

    register_lifespan_hooks()
    hooks = dict(dr.get_startup_hooks())
    seed_hook = hooks["acts.demo_act_seed"]

    boom = AsyncMock(side_effect=RuntimeError("boom"))
    with patch("scripts.seed_demo_act.ensure_demo_act", boom):
        # Не должно бросить
        await seed_hook(app=object())
