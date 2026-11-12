from datetime import date, datetime, timedelta

from django.test import SimpleTestCase, TestCase
from django.utils import timezone

from .models import Task, Workspace
from .reporting import build_report, previous_period_range


def at(year, month, day):
    return timezone.make_aware(datetime(year, month, day, 12, 0))


class PreviousPeriodRangeTests(SimpleTestCase):
    def test_each_named_period_has_the_period_before_it(self):
        today = date(2026, 2, 15)
        self.assertEqual(previous_period_range('week', today), ('previous week', date(2026, 2, 2), date(2026, 2, 8)))
        self.assertEqual(previous_period_range('month', today), ('previous month', date(2026, 1, 1), date(2026, 1, 31)))
        self.assertEqual(previous_period_range('quarter', today), ('previous quarter', date(2025, 10, 1), date(2025, 12, 31)))
        self.assertEqual(previous_period_range('year', today), ('previous year', date(2025, 1, 1), date(2025, 12, 31)))

    def test_all_and_custom_have_nothing_to_compare_with(self):
        self.assertIsNone(previous_period_range('all', date(2026, 2, 15)))
        self.assertIsNone(previous_period_range('custom', date(2026, 2, 15)))


class ReportComparisonTests(TestCase):
    def setUp(self):
        self.workspace = Workspace.objects.create(name='Compare', slug='compare')

    def test_report_carries_the_previous_months_totals(self):
        today = date(2026, 2, 15)
        # This month: one finished.
        Task.objects.create(workspace=self.workspace, title='Now', status='done', completed_at=at(2026, 2, 10))
        # Last month: two finished and one still open that was due then.
        Task.objects.create(workspace=self.workspace, title='Jan A', status='done', completed_at=at(2026, 1, 10))
        Task.objects.create(workspace=self.workspace, title='Jan B', status='done', completed_at=at(2026, 1, 20))
        Task.objects.create(workspace=self.workspace, title='Jan open', status='todo', due_date=date(2026, 1, 25))
        # Cancelled work is not counted as applicable.
        Task.objects.create(workspace=self.workspace, title='Jan cancelled', status='cancelled', due_date=date(2026, 1, 12))

        report = build_report(self.workspace.id, period='month', today=today)

        self.assertEqual(report['totals']['completed_tasks'], 1)
        previous = report['previous']
        self.assertEqual(previous['label'], 'previous month')
        self.assertEqual((previous['start'], previous['end']), ('2026-01-01', '2026-01-31'))
        self.assertEqual(previous['completed_tasks'], 2)
        self.assertEqual(previous['completion_rate'], 67)  # 2 of 3 applicable

    def test_all_time_report_has_no_previous_block(self):
        Task.objects.create(workspace=self.workspace, title='Any', status='todo')
        self.assertIsNone(build_report(self.workspace.id, period='all', today=date(2026, 2, 15))['previous'])
