import { describe, expect, it } from "vitest";
import { toInput } from "./events";

describe("toInput", () => {
  it("keeps only the editable fields", () => {
    const input = toInput({
      id: "e1",
      timeline_event_id: "t1",
      title: "Doctor",
      notes: "",
      location: "",
      start_date: "2026-10-14",
      end_date: "2026-10-14",
      start_time: "15:30:00",
      end_time: "16:30:00",
      color: "#56a8f5",
      recurrence: "none",
      recurrence_until: null,
      add_to_timeline: true,
    });
    expect(input).not.toHaveProperty("id");
    expect(input).not.toHaveProperty("timeline_event_id");
    expect(input.add_to_timeline).toBe(true);
  });
});
