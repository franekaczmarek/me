import { render, screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { describe, expect, it, vi } from "vitest";
import { supabaseMock } from "@/test/mocks";
import LoginPage from "./page";

vi.mock("@/lib/supabase", async () => ({ supabase: (await import("@/test/mocks")).supabaseMock }));

async function submit(email: string, password: string) {
  await userEvent.type(screen.getByLabelText("Email"), email);
  await userEvent.type(screen.getByLabelText("Password"), password);
  await userEvent.click(screen.getByRole("button", { name: "Log in" }));
}

describe("LoginPage", () => {
  it("signs in with the entered credentials", async () => {
    supabaseMock.auth.signInWithPassword.mockResolvedValue({ error: null });
    render(<LoginPage />);
    await submit("a@b.com", "secret123");
    expect(supabaseMock.auth.signInWithPassword).toHaveBeenCalledWith({ email: "a@b.com", password: "secret123" });
    expect(screen.getByRole("button", { name: "Log in" })).toBeEnabled();
  });

  it("shows the error returned by Supabase", async () => {
    supabaseMock.auth.signInWithPassword.mockResolvedValue({ error: { message: "Invalid login credentials" } });
    render(<LoginPage />);
    await submit("a@b.com", "wrong-pass");
    expect(await screen.findByText("Invalid login credentials")).toBeInTheDocument();
  });

  it("links to the signup page", () => {
    render(<LoginPage />);
    expect(screen.getByRole("link", { name: "Sign up" })).toHaveAttribute("href", "/signup");
  });
});
