import { render, screen, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { beforeEach, describe, expect, it, vi } from "vitest";
import { AccountsCard } from "./AccountsCard";

const mailApi = vi.hoisted(() => ({
  accounts: vi.fn(),
  addAccount: vi.fn(),
  updateAccount: vi.fn(),
  deleteAccount: vi.fn(),
}));
vi.mock("@/lib/mail/api", () => ({ mailApi }));

const PRIVATE = { id: "a1", email: "me@gmail.com", label: "Private", color: "#ff7a6b", created_at: "2026-10-24T10:00:00Z" };

beforeEach(() => {
  mailApi.accounts.mockResolvedValue([PRIVATE]);
  mailApi.addAccount.mockResolvedValue(undefined);
  mailApi.updateAccount.mockResolvedValue(undefined);
  mailApi.deleteAccount.mockResolvedValue(undefined);
});

describe("AccountsCard", () => {
  it("lists inboxes and reports them", async () => {
    const onChange = vi.fn();
    render(<AccountsCard onChange={onChange} />);
    const row = await screen.findByRole("listitem", { name: "Private" });
    expect(within(row).getByText("me@gmail.com")).toBeInTheDocument();
    expect(onChange).toHaveBeenCalledWith([PRIVATE]);
    expect(screen.queryByRole("form", { name: "Add a Gmail inbox" })).not.toBeInTheDocument();
  });

  it("opens the form right away when nothing is connected and adds an inbox", async () => {
    mailApi.accounts.mockResolvedValueOnce([]);
    render(<AccountsCard />);
    const form = await screen.findByRole("form", { name: "Add a Gmail inbox" });
    expect(within(form).queryByRole("button", { name: "Cancel" })).not.toBeInTheDocument();
    expect(within(form).getByRole("link", { name: /apppasswords/ })).toHaveAttribute("href", "https://myaccount.google.com/apppasswords");

    await userEvent.type(within(form).getByLabelText("Gmail address"), " work@gmail.com ");
    await userEvent.type(within(form).getByLabelText("App password"), "abcd efgh ijkl mnop");
    await userEvent.type(within(form).getByLabelText("Name"), "Work");
    await userEvent.click(within(form).getByRole("radio", { name: "#4cc9a0" }));
    await userEvent.click(within(form).getByRole("button", { name: "Connect inbox" }));

    expect(mailApi.addAccount).toHaveBeenCalledWith({
      email: "work@gmail.com",
      app_password: "abcd efgh ijkl mnop",
      label: "Work",
      color: "#4cc9a0",
    });
    expect(await screen.findByRole("listitem", { name: "Private" })).toBeInTheDocument();
  });

  it("picks an unused colour and needs an address and password", async () => {
    render(<AccountsCard />);
    await userEvent.click(await screen.findByRole("button", { name: "+ Add Gmail" }));
    const form = screen.getByRole("form", { name: "Add a Gmail inbox" });
    expect(within(form).getByRole("radio", { name: "#ffa36c" })).toHaveAttribute("aria-checked", "true");
    await userEvent.click(within(form).getByRole("button", { name: "Connect inbox" }));
    expect(within(form).getByText("Enter the Gmail address and its app password.")).toBeInTheDocument();
    expect(mailApi.addAccount).not.toHaveBeenCalled();
    await userEvent.click(within(form).getByRole("button", { name: "Cancel" }));
    expect(screen.queryByRole("form", { name: "Add a Gmail inbox" })).not.toBeInTheDocument();
  });

  it("shows Gmail's rejection and keeps the form", async () => {
    mailApi.accounts.mockResolvedValueOnce([]);
    mailApi.addAccount.mockRejectedValueOnce(new Error("Gmail rejected the login. Check the address and the app password."));
    render(<AccountsCard />);
    const form = await screen.findByRole("form", { name: "Add a Gmail inbox" });
    await userEvent.type(within(form).getByLabelText("Gmail address"), "me@gmail.com");
    await userEvent.type(within(form).getByLabelText("App password"), "wrong");
    await userEvent.click(within(form).getByRole("button", { name: "Connect inbox" }));
    expect(await screen.findByText(/Gmail rejected the login/)).toBeInTheDocument();
    expect(screen.getByRole("form", { name: "Add a Gmail inbox" })).toBeInTheDocument();
  });

  it("changes the app password", async () => {
    render(<AccountsCard />);
    const row = await screen.findByRole("listitem", { name: "Private" });
    await userEvent.click(within(row).getByRole("button", { name: "New password" }));
    await userEvent.type(within(row).getByLabelText("New app password for me@gmail.com"), "newpass");
    await userEvent.click(within(row).getByRole("button", { name: "Save" }));
    expect(mailApi.updateAccount).toHaveBeenCalledWith("a1", { app_password: "newpass" });
    expect(within(row).queryByLabelText("New app password for me@gmail.com")).not.toBeInTheDocument();
  });

  it("removes an inbox after an inline confirmation", async () => {
    render(<AccountsCard />);
    const row = await screen.findByRole("listitem", { name: "Private" });
    await userEvent.click(within(row).getByRole("button", { name: "Remove Private" }));
    await userEvent.click(within(row).getByRole("button", { name: "Cancel" }));
    expect(mailApi.deleteAccount).not.toHaveBeenCalled();
    await userEvent.click(within(row).getByRole("button", { name: "Remove Private" }));
    await userEvent.click(within(row).getByRole("button", { name: "Remove" }));
    expect(mailApi.deleteAccount).toHaveBeenCalledWith("a1");
  });

  it("shows a load error", async () => {
    mailApi.accounts.mockRejectedValueOnce(new Error("offline"));
    render(<AccountsCard />);
    expect(await screen.findByText("Could not load your inboxes: offline")).toBeInTheDocument();
  });
});
