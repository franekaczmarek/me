import { render, screen, within } from "@testing-library/react";
import { describe, expect, it, vi } from "vitest";
import type { Stats } from "@/lib/todo/types";
import { StatsCard } from "./StatsCard";

const todoApi = vi.hoisted(() => ({ stats: vi.fn() }));
vi.mock("@/lib/todo/api", () => ({ todoApi }));

const stats: Stats = {
  days: 30,
  done: 8,
  on_time: 6,
  late: 2,
  overdue: 1,
  missed: 1,
  on_time_rate: 0.6,
  avg_postponed: 0.5,
  streak: 3,
  last_week: [
    { date: "2026-02-26", on_time: 0, late: 0, missed: 0 },
    { date: "2026-02-27", on_time: 2, late: 1, missed: 0 },
    { date: "2026-02-28", on_time: 0, late: 0, missed: 1 },
    { date: "2026-03-01", on_time: 1, late: 0, missed: 0 },
    { date: "2026-03-02", on_time: 1, late: 0, missed: 0 },
    { date: "2026-03-03", on_time: 1, late: 1, missed: 0 },
    { date: "2026-03-04", on_time: 1, late: 0, missed: 0 },
  ],
};

describe("StatsCard", () => {
  it("shows the on-time rate, counters, streak and last week", async () => {
    todoApi.stats.mockResolvedValue(stats);
    render(<StatsCard version={0} />);
    const card = screen.getByRole("region", { name: "Statistics" });
    expect(await within(card).findByText("60%")).toBeInTheDocument();
    expect(within(card).getByText("Late", { selector: "dt" }).nextElementSibling).toHaveTextContent("2");
    expect(within(card).getByText("Overdue", { selector: "dt" }).nextElementSibling).toHaveTextContent("1");
    expect(within(card).getByText("🔥 3-day streak")).toBeInTheDocument();
    expect(within(card).getByText("postponed 0.5× on average")).toBeInTheDocument();
    // Accessible table view of the chart.
    const table = within(card).getByRole("table");
    expect(within(table).getAllByRole("row")).toHaveLength(8);
    expect(within(table).getByText("Fri 27 Feb")).toBeInTheDocument();
    expect(card.querySelector('[title="Fri 27 Feb: 2 on time, 1 late, 0 missed"]')).not.toBeNull();
  });

  it("shows a dash when nothing was due", async () => {
    todoApi.stats.mockResolvedValue({ ...stats, on_time_rate: null, avg_postponed: null });
    render(<StatsCard version={0} />);
    expect(await screen.findByText("–")).toBeInTheDocument();
    expect(screen.queryByText(/postponed/)).not.toBeInTheDocument();
  });

  it("reloads when the version changes", async () => {
    todoApi.stats.mockResolvedValue(stats);
    const { rerender } = render(<StatsCard version={0} />);
    await screen.findByText("60%");
    todoApi.stats.mockResolvedValue({ ...stats, on_time_rate: 0.75 });
    rerender(<StatsCard version={1} />);
    expect(await screen.findByText("75%")).toBeInTheDocument();
  });

  it("shows an error", async () => {
    todoApi.stats.mockRejectedValue(new Error("down"));
    render(<StatsCard version={0} />);
    expect(await screen.findByText("Could not load statistics: down")).toBeInTheDocument();
  });
});
