import { render, screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { beforeEach, describe, expect, it, vi } from "vitest";
import { ProfileForm } from "./ProfileForm";

const profileApi = vi.hoisted(() => ({ get: vi.fn(), update: vi.fn() }));
vi.mock("@/lib/timeline/api", () => ({ profileApi }));

beforeEach(() => {
  profileApi.get.mockResolvedValue({ display_name: "Franek", birth_date: "1990-03-04" });
});

describe("ProfileForm", () => {
  it("shows the saved profile", async () => {
    render(<ProfileForm />);
    expect(await screen.findByLabelText("Display name")).toHaveValue("Franek");
    expect(screen.getByLabelText("Birth date")).toHaveValue("1990-03-04");
  });

  it("saves changes", async () => {
    profileApi.update.mockResolvedValue({ display_name: "F", birth_date: "1991-01-02" });
    render(<ProfileForm />);
    const name = await screen.findByLabelText("Display name");
    await userEvent.clear(name);
    await userEvent.type(name, " F ");
    const birth = screen.getByLabelText("Birth date");
    await userEvent.clear(birth);
    await userEvent.type(birth, "1991-01-02");
    await userEvent.click(screen.getByRole("button", { name: "Save profile" }));
    expect(profileApi.update).toHaveBeenCalledWith({ display_name: "F", birth_date: "1991-01-02" });
    expect(await screen.findByText("Profile saved.")).toBeInTheDocument();
  });

  it("sends null for cleared fields", async () => {
    profileApi.update.mockResolvedValue({ display_name: null, birth_date: null });
    render(<ProfileForm />);
    await userEvent.clear(await screen.findByLabelText("Display name"));
    await userEvent.clear(screen.getByLabelText("Birth date"));
    await userEvent.click(screen.getByRole("button", { name: "Save profile" }));
    expect(profileApi.update).toHaveBeenCalledWith({ display_name: null, birth_date: null });
  });

  it("shows the API error", async () => {
    profileApi.update.mockRejectedValue(new Error("birth_date cannot be in the future"));
    render(<ProfileForm />);
    await userEvent.click(await screen.findByRole("button", { name: "Save profile" }));
    expect(await screen.findByText("birth_date cannot be in the future")).toBeInTheDocument();
  });

  it("shows an error when the profile can't be loaded", async () => {
    profileApi.get.mockRejectedValue(new Error("down"));
    render(<ProfileForm />);
    expect(await screen.findByText("Could not load the profile: down")).toBeInTheDocument();
    expect(screen.queryByRole("button", { name: "Save profile" })).not.toBeInTheDocument();
  });
});
