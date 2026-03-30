"""Тесты для Pydantic-схем: act_metadata, act_content, act_invoice."""

from datetime import date

import pytest
from pydantic import ValidationError

from app.domains.acts.schemas.act_metadata import (
    ActCreate,
    ActDirective,
    ActUpdate,
    AuditTeamMember,
)
from app.domains.acts.schemas.act_content import (
    ActDataSchema,
    TableCellSchema,
    TableSchema,
    TextBlockFormattingSchema,
    TextBlockSchema,
)
from app.domains.acts.schemas.act_invoice import InvoiceSave, MetricItem


# ── Фикстуры ──


def _team_minimal():
    """Минимальная аудиторская группа (куратор + руководитель)."""
    return [
        AuditTeamMember(
            role="Куратор", full_name="Иванов Иван Иванович",
            position="Директор Департамента внутреннего аудита", username="10029384",
        ),
        AuditTeamMember(
            role="Руководитель", full_name="Петров Петр Петрович",
            position="Главный аудитор", username="87654321",
        ),
    ]


def _act_create_kwargs(**overrides):
    """Базовые kwargs для ActCreate с возможностью переопределения."""
    base = dict(
        km_number="КМ-01-23456",
        inspection_name="Проверка процесса потребительского кредитования",
        city="Москва",
        order_number="478-р",
        order_date=date(2026, 1, 15),
        audit_team=_team_minimal(),
        inspection_start_date=date(2026, 2, 1),
        inspection_end_date=date(2026, 3, 1),
    )
    base.update(overrides)
    return base


# ── AuditTeamMember ──


class TestAuditTeamMember:

    def test_valid_roles(self):
        for role in ("Куратор", "Руководитель", "Редактор", "Участник"):
            m = AuditTeamMember(
                role=role, full_name="Иванов Иван Иванович",
                position="Старший аудитор", username="10029384",
            )
            assert m.role == role

    def test_invalid_role(self):
        with pytest.raises(ValidationError):
            AuditTeamMember(
                role="Аналитик", full_name="Иванов Иван Иванович",
                position="Старший аудитор", username="10029384",
            )

    def test_empty_full_name(self):
        with pytest.raises(ValidationError):
            AuditTeamMember(
                role="Куратор", full_name="", position="Старший аудитор",
                username="10029384",
            )


# ── ActDirective ──


class TestActDirective:

    def test_valid_point_numbers(self):
        for point in ("5.1", "5.1.2", "5.1.2.3"):
            d = ActDirective(point_number=point, directive_number="П-001")
            assert d.point_number == point

    def test_not_section_5(self):
        with pytest.raises(ValidationError, match="разделе 5"):
            ActDirective(point_number="3.1", directive_number="П-001")

    def test_too_deep_nesting(self):
        with pytest.raises(ValidationError, match="вложенность"):
            ActDirective(point_number="5.1.2.3.4", directive_number="П-001")

    def test_non_numeric_parts(self):
        with pytest.raises(ValidationError, match="числами"):
            ActDirective(point_number="5.abc", directive_number="П-001")

    def test_trailing_dot_stripped(self):
        d = ActDirective(point_number="5.1.", directive_number="П-001")
        assert d.point_number == "5.1"


# ── ActCreate: КМ-номер ──


class TestActCreateKmNumber:

    def test_valid_km(self):
        act = ActCreate(**_act_create_kwargs())
        assert act.km_number == "КМ-01-23456"

    def test_wrong_format_latin(self):
        with pytest.raises(ValidationError, match="КМ-XX-XXXXX"):
            ActCreate(**_act_create_kwargs(km_number="KM-01-23456"))

    def test_wrong_digit_count(self):
        with pytest.raises(ValidationError):
            ActCreate(**_act_create_kwargs(km_number="КМ-01-2345"))

    def test_missing_prefix(self):
        with pytest.raises(ValidationError):
            ActCreate(**_act_create_kwargs(km_number="01-23456"))


# ── ActCreate: служебная записка ──


class TestActCreateServiceNote:

    def test_valid_service_note_with_date(self):
        act = ActCreate(**_act_create_kwargs(
            service_note="ЦМ-75-вн/9475",
            service_note_date=date(2026, 3, 1),
        ))
        assert act.service_note == "ЦМ-75-вн/9475"

    def test_empty_string_becomes_none(self):
        act = ActCreate(**_act_create_kwargs(service_note=""))
        assert act.service_note is None

    def test_invalid_format_no_year(self):
        with pytest.raises(ValidationError, match="Текст/XXXX"):
            ActCreate(**_act_create_kwargs(
                service_note="ЦМ-без-года",
                service_note_date=date(2026, 1, 1),
            ))

    def test_note_without_date_fails(self):
        with pytest.raises(ValidationError, match="дату"):
            ActCreate(**_act_create_kwargs(
                service_note="ЦМ-75-вн/9475",
                service_note_date=None,
            ))

    def test_date_without_note_fails(self):
        with pytest.raises(ValidationError, match="записку"):
            ActCreate(**_act_create_kwargs(
                service_note=None,
                service_note_date=date(2026, 1, 1),
            ))

    def test_slash_only_prefix_fails(self):
        with pytest.raises(ValidationError, match='текст до символа "/"'):
            ActCreate(**_act_create_kwargs(
                service_note=" /2024",
                service_note_date=date(2026, 1, 1),
            ))


# ── ActCreate: аудиторская группа ──


class TestActCreateAuditTeam:

    def test_no_curator_fails(self):
        team = [
            AuditTeamMember(
                role="Руководитель", full_name="Сидоров Алексей Викторович",
                position="Старший аудитор", username="10029384",
            ),
        ]
        with pytest.raises(ValidationError, match="куратор"):
            ActCreate(**_act_create_kwargs(audit_team=team))

    def test_no_leader_fails(self):
        team = [
            AuditTeamMember(
                role="Куратор", full_name="Сидоров Алексей Викторович",
                position="Старший аудитор", username="10029384",
            ),
        ]
        with pytest.raises(ValidationError, match="руководитель"):
            ActCreate(**_act_create_kwargs(audit_team=team))

    def test_empty_team_fails(self):
        with pytest.raises(ValidationError):
            ActCreate(**_act_create_kwargs(audit_team=[]))


# ── ActUpdate ──


class TestActUpdate:

    def test_all_none_is_valid(self):
        u = ActUpdate()
        assert u.km_number is None

    def test_km_none_passes(self):
        u = ActUpdate(km_number=None)
        assert u.km_number is None

    def test_invalid_km_fails(self):
        with pytest.raises(ValidationError):
            ActUpdate(km_number="bad")

    def test_valid_km_passes(self):
        u = ActUpdate(km_number="КМ-99-11111")
        assert u.km_number == "КМ-99-11111"

    def test_audit_team_none_passes(self):
        u = ActUpdate(audit_team=None)
        assert u.audit_team is None

    def test_audit_team_no_curator_fails(self):
        with pytest.raises(ValidationError, match="куратор"):
            ActUpdate(audit_team=[
                AuditTeamMember(
                    role="Руководитель", full_name="Сидоров Алексей Викторович",
                    position="Старший аудитор", username="10029384",
                ),
            ])


# ── TableSchema ──


class TestTableSchema:

    def test_valid_table(self):
        t = TableSchema(
            id="table_1711270400456_3x2m8p1",
            nodeId="node_1711270400123_7a4k9b2",
            grid=[[TableCellSchema(content="A")]],
            colWidths=[100],
        )
        assert len(t.grid) == 1

    def test_too_many_columns(self):
        row = [TableCellSchema() for _ in range(17)]
        with pytest.raises(ValidationError, match="16"):
            TableSchema(
                id="table_1711270400456_3x2m8p1",
                nodeId="node_1711270400123_7a4k9b2",
                grid=[row], colWidths=[100] * 17,
            )

    def test_too_many_rows(self):
        grid = [[TableCellSchema()] for _ in range(65)]
        with pytest.raises(ValidationError):
            TableSchema(
                id="table_1711270400456_3x2m8p1",
                nodeId="node_1711270400123_7a4k9b2",
                grid=grid, colWidths=[100],
            )

    def test_negative_col_width(self):
        with pytest.raises(ValidationError, match="положительными"):
            TableSchema(
                id="table_1711270400456_3x2m8p1",
                nodeId="node_1711270400123_7a4k9b2",
                grid=[[TableCellSchema()]],
                colWidths=[0],
            )

    def test_empty_grid_valid(self):
        t = TableSchema(
            id="table_1711270400456_3x2m8p1",
            nodeId="node_1711270400123_7a4k9b2",
        )
        assert t.grid == []

    def test_special_table_flags(self):
        t = TableSchema(
            id="table_1711270400456_3x2m8p1",
            nodeId="node_1711270400123_7a4k9b2",
            isMetricsTable=True, isRegularRiskTable=True,
        )
        assert t.isMetricsTable is True
        assert t.isRegularRiskTable is True


# ── TextBlockFormattingSchema ──


class TestTextBlockFormatting:

    def test_default_values(self):
        f = TextBlockFormattingSchema()
        assert f.fontSize == 14
        assert f.alignment == "left"

    def test_font_size_too_small(self):
        with pytest.raises(ValidationError):
            TextBlockFormattingSchema(fontSize=7)

    def test_font_size_too_large(self):
        with pytest.raises(ValidationError):
            TextBlockFormattingSchema(fontSize=73)

    def test_invalid_alignment(self):
        with pytest.raises(ValidationError):
            TextBlockFormattingSchema(alignment="top")

    def test_valid_alignment_values(self):
        for a in ("left", "center", "right", "justify"):
            f = TextBlockFormattingSchema(alignment=a)
            assert f.alignment == a


# ── ActDataSchema ──


class TestActDataSchema:

    def test_valid_save_types(self):
        for st in ("manual", "periodic", "auto"):
            d = ActDataSchema(tree={}, saveType=st)
            assert d.saveType == st

    def test_invalid_save_type(self):
        with pytest.raises(ValidationError):
            ActDataSchema(tree={}, saveType="unknown")

    def test_default_collections(self):
        d = ActDataSchema(tree={})
        assert d.tables == {}
        assert d.textBlocks == {}
        assert d.violations == {}
        assert d.invoiceNodeIds == []
        assert d.changelog == []


# ── MetricItem ──


class TestMetricItem:

    def test_valid_metric_types(self):
        for mt in ("КС", "ФР", "ОР", "РР", "МКР"):
            m = MetricItem(metric_type=mt)
            assert m.metric_type == mt

    def test_invalid_metric_type(self):
        with pytest.raises(ValidationError, match="Недопустимый тип"):
            MetricItem(metric_type="INVALID")


# ── InvoiceSave ──


class TestInvoiceSave:

    def _base_kwargs(self, **overrides):
        base = dict(
            act_id=1, node_id="node_1711270400100_abc1234", db_type="hive",
            schema_name="schema", table_name="table",
            metrics=[MetricItem(metric_type="КС")],
        )
        base.update(overrides)
        return base

    def test_valid_invoice(self):
        inv = InvoiceSave(**self._base_kwargs())
        assert inv.act_id == 1

    def test_duplicate_metric_types_fail(self):
        with pytest.raises(ValidationError, match="уникальными"):
            InvoiceSave(**self._base_kwargs(
                metrics=[
                    MetricItem(metric_type="КС"),
                    MetricItem(metric_type="КС"),
                ],
            ))

    def test_too_many_metrics_fail(self):
        with pytest.raises(ValidationError):
            InvoiceSave(**self._base_kwargs(
                metrics=[MetricItem(metric_type=t) for t in
                         ["КС", "ФР", "ОР", "РР", "МКР", "КС"]],
            ))

    def test_empty_metrics_fail(self):
        with pytest.raises(ValidationError):
            InvoiceSave(**self._base_kwargs(metrics=[]))

    def test_invalid_db_type_fail(self):
        with pytest.raises(ValidationError):
            InvoiceSave(**self._base_kwargs(db_type="mysql"))

    def test_all_5_metrics_valid(self):
        inv = InvoiceSave(**self._base_kwargs(
            metrics=[MetricItem(metric_type=t) for t in
                     ["КС", "ФР", "ОР", "РР", "МКР"]],
        ))
        assert len(inv.metrics) == 5
