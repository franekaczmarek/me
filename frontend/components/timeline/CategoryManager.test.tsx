import { render, screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { describe, expect, it, vi } from "vitest";
import { ApiError } from "@/lib/api";
import type { Category } from "@/lib/timeline/types";
import { CategoryManager } from "./CategoryManager";

vi.mock("@/lib/api", () => ({
  ApiError: class extends Error {
    constructor(
      public status: number,
      message: string,
    ) {
      super(message);
    }
  },
}));

const school: Category = { id: "c1", name: "School", color: "#2563eb" };

function renderManager(categories: Category[] = [school]) {
  const actions = {
    onCreate: vi.fn().mockResolvedValue(undefined),
    onUpdate: vi.fn().mockResolvedValue(undefined),
    onDelete: vi.fn().mockResolvedValue(undefined),
  };
  render(<CategoryManager categories={categories} {...actions} />);
  return actions;
}

describe("CategoryManager", () => {
  it("lists categories with their colors", () => {
    renderManager();
    expect(screen.getByLabelText("School name")).toHaveValue("School");
    expect(screen.getByLabelText("School color")).toHaveValue("#2563eb");
  });

  it("shows an empty state", () => {
    renderManager([]);
    expect(screen.getByText("No categories yet.")).toBeInTheDocument();
  });

  it("creates a category and clears the form", async () => {
    const { onCreate } = renderManager();
    await userEvent.type(screen.getByLabelText("New category name"), "  Family ");
    await userEvent.click(screen.getByRole("button", { name: "Add" }));
    expect(onCreate).toHaveBeenCalledWith({ name: "Family", color: expect.stringMatching(/^#[0-9a-f]{6}$/) });
    expect(screen.getByLabelText("New category name")).toHaveValue("");
  });

  it("requires a name", async () => {
    const { onCreate } = renderManager();
    await userEvent.click(screen.getByRole("button", { name: "Add" }));
    expect(screen.getByText("Enter a name.")).toBeInTheDocument();
    expect(onCreate).not.toHaveBeenCalled();
  });

  it("explains a duplicate name", async () => {
    const { onCreate } = renderManager();
    onCreate.mockRejectedValue(new ApiError(409, "Already exists"));
    await userEvent.type(screen.getByLabelText("New category name"), "school");
    await userEvent.click(screen.getByRole("button", { name: "Add" }));
    expect(await screen.findByText("A category with this name already exists.")).toBeInTheDocument();
    expect(screen.getByLabelText("New category name")).toHaveValue("school");
  });

  it("offers Save only after a change and saves the rename", async () => {
    const { onUpdate } = renderManager();
    expect(screen.queryByRole("button", { name: "Save" })).not.toBeInTheDocument();
    const name = screen.getByLabelText("School name");
    await userEvent.clear(name);
    await userEvent.type(name, "University");
    await userEvent.click(screen.getByRole("button", { name: "Save" }));
    expect(onUpdate).toHaveBeenCalledWith("c1", { name: "University", color: "#2563eb" });
  });

  it("shows an error when saving fails", async () => {
    const { onUpdate } = renderManager();
    onUpdate.mockRejectedValue(new Error("Database unavailable"));
    await userEvent.type(screen.getByLabelText("School name"), "!");
    await userEvent.click(screen.getByRole("button", { name: "Save" }));
    expect(await screen.findByText("Database unavailable")).toBeInTheDocument();
  });

  it("deletes after confirmation", async () => {
    const { onDelete } = renderManager();
    await userEvent.click(screen.getByRole("button", { name: "Delete School" }));
    expect(screen.getByText(/stay on the timeline without a category/)).toBeInTheDocument();
    await userEvent.click(screen.getByRole("button", { name: "Keep" }));
    expect(onDelete).not.toHaveBeenCalled();
    await userEvent.click(screen.getByRole("button", { name: "Delete School" }));
    await userEvent.click(screen.getByRole("button", { name: "Delete" }));
    expect(onDelete).toHaveBeenCalledWith("c1");
  });
});
