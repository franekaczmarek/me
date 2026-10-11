import { fireEvent, render, screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { describe, expect, it, vi } from "vitest";
import { EventForm } from "./EventForm";

function setup(onSave = vi.fn().mockResolvedValue(undefined)) {
  render(<EventForm defaults={{ date: "2026-10-14" }} submitLabel="Add event" onSave={onSave} onCancel={vi.fn()} />);
  return onSave;
}
const submit = () => userEvent.click(screen.getByRole("button", { name: "Add event" }));

describe("EventForm", () => {
  it("saves an all-day event", async () => {
    const onSave = setup();
    await userEvent.type(screen.getByLabelText("Title"), "  Mom's birthday ");
    await userEvent.selectOptions(screen.getByLabelText("Repeat"), "yearly");
    await userEvent.click(screen.getByRole("button", { name: "Rose" }));
    await submit();
    expect(onSave).toHaveBeenCalledWith({
      title: "Mom's birthday",
      notes: "",
      location: "",
      start_date: "2026-10-14",
      end_date: "2026-10-14",
      start_time: null,
      end_time: null,
      color: "#f27fb2",
      recurrence: "yearly",
      recurrence_until: null,
      add_to_timeline: false,
    });
  });

  it("keeps the length when the start moves", async () => {
    setup();
    fireEvent.change(screen.getByLabelText("Ends"), { target: { value: "2026-10-16" } });
    fireEvent.change(screen.getByLabelText("Starts"), { target: { value: "2026-10-20" } });
    expect(screen.getByLabelText("Ends")).toHaveValue("2026-10-22");
  });

  it("validates", async () => {
    const onSave = setup();
    await submit();
    expect(screen.getByText("Enter a title.")).toBeInTheDocument();

    await userEvent.type(screen.getByLabelText("Title"), "Doctor");
    fireEvent.change(screen.getByLabelText("Ends"), { target: { value: "2026-10-13" } });
    await submit();
    expect(screen.getByText("The event can't end before it starts.")).toBeInTheDocument();

    fireEvent.change(screen.getByLabelText("Ends"), { target: { value: "2026-10-14" } });
    await userEvent.click(screen.getByLabelText("All day"));
    fireEvent.change(screen.getByLabelText("End time"), { target: { value: "08:00" } });
    await submit();
    expect(screen.getByText("The event must end after it starts.")).toBeInTheDocument();

    fireEvent.change(screen.getByLabelText("End time"), { target: { value: "10:00" } });
    await userEvent.selectOptions(screen.getByLabelText("Repeat"), "weekly");
    fireEvent.change(screen.getByLabelText("Repeat until (optional)"), { target: { value: "2026-10-01" } });
    await submit();
    expect(screen.getByText("Repeating can't stop before the first day.")).toBeInTheDocument();
    expect(onSave).not.toHaveBeenCalled();
  });

  it("shows save errors", async () => {
    setup(vi.fn().mockRejectedValue(new Error("Database error")));
    await userEvent.type(screen.getByLabelText("Title"), "Doctor");
    await submit();
    expect(await screen.findByText("Database error")).toBeInTheDocument();
  });

  it("adds one-off events to the life timeline", async () => {
    const onSave = setup();
    await userEvent.type(screen.getByLabelText("Title"), "Kasia's wedding");
    await userEvent.click(screen.getByLabelText(/Add to my life timeline/));
    await submit();
    expect(onSave).toHaveBeenCalledWith(expect.objectContaining({ add_to_timeline: true }));
  });

  it("keeps repeating events off the timeline", async () => {
    const onSave = setup();
    await userEvent.type(screen.getByLabelText("Title"), "Gym");
    await userEvent.click(screen.getByLabelText(/Add to my life timeline/));
    await userEvent.selectOptions(screen.getByLabelText("Repeat"), "weekly");
    expect(screen.getByLabelText(/Add to my life timeline/)).toBeDisabled();
    expect(screen.getByText("Only one-off events can go on the timeline.")).toBeInTheDocument();
    await submit();
    expect(onSave).toHaveBeenCalledWith(expect.objectContaining({ add_to_timeline: false, recurrence: "weekly" }));
  });

  it("links to the timeline entry of a saved event", () => {
    render(
      <EventForm
        event={{
          id: "e1",
          title: "Wedding",
          notes: "",
          location: "",
          start_date: "2026-06-20",
          end_date: "2026-06-20",
          start_time: null,
          end_time: null,
          color: "#9b87f5",
          recurrence: "none",
          recurrence_until: null,
          add_to_timeline: true,
          timeline_event_id: "t1",
        }}
        submitLabel="Save changes"
        onSave={vi.fn()}
        onCancel={vi.fn()}
      />,
    );
    expect(screen.getByRole("link", { name: "View on the timeline →" })).toHaveAttribute("href", "/timeline");
  });
});
