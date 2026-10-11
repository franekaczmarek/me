import { render, screen, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { beforeEach, describe, expect, it, vi } from "vitest";
import type { EventDraft } from "@/lib/calendar/types";
import { SmartEventAdd } from "./SmartEventAdd";

const calendarApi = vi.hoisted(() => ({ parse: vi.fn(), createEvent: vi.fn() }));
vi.mock("@/lib/calendar/api", () => ({ calendarApi }));

const dentist: EventDraft = {
  title: "Dentysta",
  start_date: "2026-10-15",
  end_date: "2026-10-15",
  start_time: "15:30:00",
  end_time: "16:30:00",
  recurrence: "none",
  color: "#56a8f5",
  location: "",
  notes: "",
};
const birthday: EventDraft = { ...dentist, title: "Urodziny Kasi", start_date: "2027-03-03", end_date: "2027-03-03", start_time: null, end_time: null, recurrence: "yearly", color: "#f27fb2" };

function setup() {
  const onAdded = vi.fn();
  render(<SmartEventAdd today="2026-10-11" onAdded={onAdded} />);
  return onAdded;
}

async function read(text = "dentysta czwartek 15:30; urodziny Kasi 3 marca co roku") {
  await userEvent.type(screen.getByLabelText("Describe events"), text);
  await userEvent.click(screen.getByRole("button", { name: "Read" }));
}

beforeEach(() => {
  calendarApi.parse.mockResolvedValue({ events: [dentist, birthday], warnings: [] });
  calendarApi.createEvent.mockResolvedValue({});
});

describe("SmartEventAdd", () => {
  it("reads a note into events, lets you edit them and adds them", async () => {
    const onAdded = setup();
    await read();
    expect(calendarApi.parse).toHaveBeenCalledWith("dentysta czwartek 15:30; urodziny Kasi 3 marca co roku", "2026-10-11");
    expect(screen.getByText("Thu 15 Oct · 15:30 – 16:30")).toBeInTheDocument();
    expect(screen.getByText("Wed 3 Mar · every year")).toBeInTheDocument();
    const [title] = screen.getAllByLabelText("Event title");
    await userEvent.type(title, " (Dr Nowak)");
    await userEvent.click(screen.getByRole("button", { name: "Add 2 events" }));
    expect(calendarApi.createEvent).toHaveBeenNthCalledWith(1, { ...dentist, title: "Dentysta (Dr Nowak)", recurrence_until: null, add_to_timeline: false });
    expect(calendarApi.createEvent).toHaveBeenNthCalledWith(2, { ...birthday, recurrence_until: null, add_to_timeline: false });
    expect(onAdded).toHaveBeenCalled();
    expect(screen.getByLabelText("Describe events")).toHaveValue("");
  });

  it("removes a draft and cancels", async () => {
    setup();
    await read();
    await userEvent.click(screen.getByRole("button", { name: "Remove Dentysta" }));
    expect(screen.getByRole("button", { name: "Add 1 event" })).toBeInTheDocument();
    await userEvent.click(screen.getByRole("button", { name: "Cancel" }));
    expect(screen.queryByRole("listitem")).not.toBeInTheDocument();
    expect(calendarApi.createEvent).not.toHaveBeenCalled();
  });

  it("shows warnings, empty results and errors", async () => {
    calendarApi.parse.mockResolvedValueOnce({ events: [], warnings: ["Only the first 10 events were kept."] });
    setup();
    await read("hello");
    const section = screen.getByRole("region", { name: "Quick add events" });
    expect(within(section).getByText("No events found in that note.")).toBeInTheDocument();
    expect(within(section).getByText(/Only the first 10/)).toBeInTheDocument();

    calendarApi.parse.mockRejectedValueOnce(new Error("Can't reach Claude right now."));
    await userEvent.click(screen.getByRole("button", { name: "Read" }));
    expect(await screen.findByText("Can't reach Claude right now.")).toBeInTheDocument();
  });

  it("needs a title on every event", async () => {
    setup();
    await read();
    await userEvent.clear(screen.getAllByLabelText("Event title")[0]);
    expect(screen.getByRole("button", { name: "Add 2 events" })).toBeDisabled();
  });
});
