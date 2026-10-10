import { render, screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { describe, expect, it, vi } from "vitest";
import type { Category } from "@/lib/timeline/types";
import { EventForm } from "./EventForm";

const categories: Category[] = [{ id: "c1", name: "School", color: "#2563eb" }];

function renderForm(props: Partial<React.ComponentProps<typeof EventForm>> = {}) {
  const onSave = vi.fn().mockResolvedValue(undefined);
  const onCancel = vi.fn();
  render(<EventForm categories={categories} submitLabel="Save" onSave={onSave} onCancel={onCancel} {...props} />);
  return { onSave, onCancel };
}

const save = () => userEvent.click(screen.getByRole("button", { name: "Save" }));

describe("EventForm", () => {
  it("saves a point event with a month-precision date", async () => {
    const { onSave } = renderForm();
    await userEvent.type(screen.getByLabelText("Title"), "  First job ");
    await userEvent.type(screen.getByLabelText("Date year"), "2014");
    await userEvent.selectOptions(screen.getByLabelText("Date month"), "September");
    await userEvent.type(screen.getByLabelText("Description"), "Junior dev");
    await save();
    expect(onSave).toHaveBeenCalledWith({
      title: "First job",
      description: "Junior dev",
      start: "2014-09",
      end: null,
      category_id: null,
    });
  });

  it("saves a period with a category", async () => {
    const { onSave } = renderForm();
    await userEvent.type(screen.getByLabelText("Title"), "High school");
    await userEvent.type(screen.getByLabelText("Date year"), "2006");
    await userEvent.click(screen.getByLabelText("Period (has an end date)"));
    await userEvent.type(screen.getByLabelText("End year"), "2009");
    await userEvent.selectOptions(screen.getByLabelText("End month"), "June");
    await userEvent.selectOptions(screen.getByLabelText("Category"), "School");
    await save();
    expect(onSave).toHaveBeenCalledWith(
      expect.objectContaining({ start: "2006", end: "2009-06", category_id: "c1" }),
    );
  });

  it("is prefilled from an existing event", () => {
    renderForm({
      initial: { title: "Wedding", description: "Best day", start: "2019-08-24", end: null, category_id: "c1" },
    });
    expect(screen.getByLabelText("Title")).toHaveValue("Wedding");
    expect(screen.getByLabelText("Date year")).toHaveValue("2019");
    expect(screen.getByLabelText("Date month")).toHaveValue("8");
    expect(screen.getByLabelText("Date day")).toHaveValue("24");
    expect(screen.getByLabelText("Category")).toHaveValue("c1");
    expect(screen.getByLabelText("Period (has an end date)")).not.toBeChecked();
  });

  it("enables the day only after a month is chosen, and clears it with the month", async () => {
    renderForm({ initial: { start: "2019-08-24" } });
    expect(screen.getByLabelText("Date day")).toBeEnabled();
    await userEvent.selectOptions(screen.getByLabelText("Date month"), "");
    expect(screen.getByLabelText("Date day")).toBeDisabled();
    expect(screen.getByLabelText("Date day")).toHaveValue("");
  });

  it.each([
    [{ title: "", year: "2015" }, "Enter a title."],
    [{ title: "x", year: "" }, "Date: Enter a year between 1 and 9999."],
  ])("validates %o", async ({ title, year }, message) => {
    const { onSave } = renderForm();
    if (title) await userEvent.type(screen.getByLabelText("Title"), title);
    if (year) await userEvent.type(screen.getByLabelText("Date year"), year);
    await save();
    expect(screen.getByText(message)).toBeInTheDocument();
    expect(onSave).not.toHaveBeenCalled();
  });

  it("rejects an impossible day", async () => {
    const { onSave } = renderForm({ initial: { title: "x", start: "2023-02" } });
    await userEvent.selectOptions(screen.getByLabelText("Date day"), "30");
    await save();
    expect(screen.getByText("Date: February 2023 has no day 30.")).toBeInTheDocument();
    expect(onSave).not.toHaveBeenCalled();
  });

  it("rejects an end before the start", async () => {
    const { onSave } = renderForm({ initial: { title: "x", start: "2018", end: "2015" } });
    await save();
    expect(screen.getByText("The end can't be before the start.")).toBeInTheDocument();
    expect(onSave).not.toHaveBeenCalled();
  });

  it("drops the end when the period box is unchecked", async () => {
    const { onSave } = renderForm({ initial: { title: "x", start: "2015", end: "2018" } });
    await userEvent.click(screen.getByLabelText("Period (has an end date)"));
    await save();
    expect(onSave).toHaveBeenCalledWith(expect.objectContaining({ end: null }));
  });

  it("shows the error from saving and lets the user retry", async () => {
    const onSave = vi.fn().mockRejectedValueOnce(new Error("Referenced item not found")).mockResolvedValue(undefined);
    renderForm({ onSave, initial: { title: "x", start: "2015" } });
    await save();
    expect(await screen.findByText("Referenced item not found")).toBeInTheDocument();
    await save();
    expect(onSave).toHaveBeenCalledTimes(2);
  });

  it("cancels", async () => {
    const { onCancel } = renderForm();
    await userEvent.click(screen.getByRole("button", { name: "Cancel" }));
    expect(onCancel).toHaveBeenCalled();
  });
});
