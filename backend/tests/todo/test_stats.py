from datetime import UTC, date, datetime, timedelta
from uuid import uuid4

from app.todo.schemas import Task
from app.todo.stats import compute_stats

TODAY = date(2026, 3, 4)


def at(day: date) -> datetime:
    return datetime(day.year, day.month, day.day, 18, tzinfo=UTC)


def task(planned: date | None, done: date | None = None, **fields) -> Task:
    data = {
        "id": uuid4(),
        "title": "T",
        "notes": "",
        "planned_date": planned,
        "deadline": None,
        "duration_min": None,
        "priority": "normal",
        "fixed_day": False,
        "status": "done" if done else "open",
        "completed_at": at(done) if done else None,
        "first_planned_date": planned,
        "postponed_count": 0,
        "routine_id": None,
        "occurrence_date": None,
        "position": 0,
        "created_at": at(TODAY - timedelta(60)),
    }
    return Task(**{**data, **fields})


def day(n: int) -> date:
    return TODAY + timedelta(n)


def test_on_time_late_overdue_and_missed() -> None:
    stats = compute_stats(
        [
            task(day(-1), done=day(-1)),  # on time
            task(day(-3), done=day(-2)),  # late: done after its day
            task(day(-5), done=day(-2), deadline=day(-2)),  # on time: deadline counts, not the day
            task(None, done=day(0)),  # inbox task: no due date, on time
            task(day(-2)),  # overdue
            task(day(1), deadline=day(-1)),  # overdue by deadline
            task(day(-1), status="missed"),  # missed routine
            task(day(2)),  # future, not counted
        ],
        TODAY,
    )
    assert (stats.done, stats.on_time, stats.late, stats.overdue, stats.missed) == (4, 3, 1, 2, 1)
    assert stats.on_time_rate == round(3 / 7, 3)


def test_nothing_due_has_no_rate() -> None:
    stats = compute_stats([task(day(3))], TODAY)
    assert stats.on_time_rate is None and stats.avg_postponed is None and stats.done == 0


def test_only_the_period_counts() -> None:
    stats = compute_stats([task(day(-40), done=day(-40)), task(day(-40), status="missed")], TODAY, days=30)
    assert (stats.done, stats.missed) == (0, 0)


def test_average_postponements_of_done_tasks() -> None:
    stats = compute_stats(
        [task(day(-1), done=day(-1), postponed_count=2), task(day(-1), done=day(-1), postponed_count=0)], TODAY
    )
    assert stats.avg_postponed == 1.0


def test_streak_counts_clean_days_and_skips_empty_ones() -> None:
    tasks = [
        task(day(-1), done=day(-1)),
        # day -2 empty (weekend): skipped
        task(day(-3), done=day(-3)),
        task(day(-4), done=day(-3)),  # late: ends the streak
        task(day(0)),  # today still open: doesn't break, doesn't count
    ]
    assert compute_stats(tasks, TODAY).streak == 2


def test_today_counts_once_everything_is_done() -> None:
    assert compute_stats([task(day(0), done=day(0)), task(day(-1), done=day(-1))], TODAY).streak == 2


def test_missed_routine_breaks_the_streak() -> None:
    assert compute_stats([task(day(-1), status="missed")], TODAY).streak == 0


def test_last_week_breakdown() -> None:
    stats = compute_stats([task(day(-1), done=day(-1)), task(day(-3), done=day(-1)), task(day(-6), status="missed")], TODAY)
    assert [d.date for d in stats.last_week] == [day(n) for n in range(-6, 1)]
    yesterday = stats.last_week[-2]
    assert (yesterday.on_time, yesterday.late) == (1, 1)
    assert stats.last_week[0].missed == 1
