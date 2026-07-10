"""Паритет двух точек санитизации контента акта (#12).

`sanitize_act_data` (Pydantic-путь сохранения) и `sanitize_act_content_dict`
(dict-путь pre-snapshot при восстановлении версий) обязаны чистить ОДИН и тот
же набор HTML-полей. Раньше списки полей дублировались вручную — расхождение
пропустило бы XSS в историю версий. Теперь оба читают общие константы.
"""

from app.domains.acts.schemas.act_content import ActDataSchema
from app.domains.acts.utils.html_sanitizer import (
    _VIOLATION_HTML_FIELDS,
    _VIOLATION_OPTIONAL_HTML_FIELDS,
    sanitize_act_content_dict,
    sanitize_act_data,
)

_XSS = '<script>alert(1)</script><b>ok</b>'
_CLEAN = '<b>ok</b>'


def _violation_dict():
    """Нарушение со всеми HTML-полями, набитыми XSS."""
    v = {
        "id": "v1", "nodeId": "n1",
        "descriptionList": {"enabled": True, "items": [_XSS]},
        "additionalContent": {
            "enabled": True,
            "items": [{"id": "i1", "type": "freeText", "content": _XSS,
                       "caption": _XSS, "filename": _XSS}],
        },
    }
    for f in _VIOLATION_HTML_FIELDS:
        v[f] = _XSS
    for f in _VIOLATION_OPTIONAL_HTML_FIELDS:
        v[f] = {"enabled": True, "content": _XSS}
    return v


def _act_dict():
    return {
        "tree": {"id": "root", "label": "Акт", "content": _XSS,
                 "children": [{"id": "1", "label": "Раздел", "content": _XSS}]},
        "textBlocks": {"tb1": {"id": "tb1", "nodeId": "n1", "content": _XSS}},
        "violations": {"v1": _violation_dict()},
        "tables": {},
    }


def test_dict_path_strips_all_html_fields():
    """dict-путь чистит все HTML-поля (script вырезан, безопасный тег остался)."""
    content = _act_dict()
    sanitize_act_content_dict(content)

    v = content["violations"]["v1"]
    for f in _VIOLATION_HTML_FIELDS:
        assert "<script>" not in v[f] and "ok" in v[f]
    for f in _VIOLATION_OPTIONAL_HTML_FIELDS:
        assert "<script>" not in v[f]["content"]
    assert "<script>" not in v["additionalContent"]["items"][0]["content"]
    # caption/filename — plain: теги вырезаны целиком
    assert "<b>" not in v["additionalContent"]["items"][0]["caption"]
    assert "<script>" not in content["textBlocks"]["tb1"]["content"]
    assert "<script>" not in content["tree"]["content"]
    assert "<script>" not in content["tree"]["children"][0]["content"]


def test_both_paths_agree_on_html_fields():
    """Pydantic- и dict-путь дают идентичный результат по HTML-полям нарушения."""
    pyd = ActDataSchema.model_validate(_act_dict())
    sanitize_act_data(pyd)

    dct = _act_dict()
    sanitize_act_content_dict(dct)

    v_pyd = pyd.violations["v1"]
    v_dct = dct["violations"]["v1"]
    for f in _VIOLATION_HTML_FIELDS:
        assert getattr(v_pyd, f) == v_dct[f]
    for f in _VIOLATION_OPTIONAL_HTML_FIELDS:
        assert getattr(v_pyd, f).content == v_dct[f]["content"]
    assert pyd.textBlocks["tb1"].content == dct["textBlocks"]["tb1"]["content"]
