import { render, screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { describe, expect, it, vi } from "vitest";
import { fakeSession, supabaseMock } from "@/test/mocks";
import SignupPage from "./page";

vi.mock("@/lib/supabase", async () => ({ supabase: (await import("@/test/mocks")).supabaseMock }));

async function submit(password: string, confirm: string) {
  await userEvent.type(screen.getByLabelText("Email"), "new@b.com");
  await userEvent.type(screen.getByLabelText("Password"), password);
  await userEvent.type(screen.getByLabelText("Confirm password"), confirm);
  await userEvent.click(screen.getByRole("button", { name: "Sign up" }));
}

describe("SignupPage", () => {
  it("rejects mismatched passwords without calling Supabase", async () => {
    render(<SignupPage />);
    await submit("password1", "password2");
    expect(await screen.findByText("Passwords do not match.")).toBeInTheDocument();
    expect(supabaseMock.auth.signUp).not.toHaveBeenCalled();
  });

  it("signs up and asks to confirm the email when no session is returned", async () => {
    supabaseMock.auth.signUp.mockResolvedValue({ data: { session: null }, error: null });
    render(<SignupPage />);
    await submit("password1", "password1");
    expect(supabaseMock.auth.signUp).toHaveBeenCalledWith(
      expect.objectContaining({ email: "new@b.com", password: "password1" }),
    );
    expect(await screen.findByText(/Check your email/)).toBeInTheDocument();
  });

  it("shows no confirmation message when signed in immediately", async () => {
    supabaseMock.auth.signUp.mockResolvedValue({ data: { session: fakeSession() }, error: null });
    render(<SignupPage />);
    await submit("password1", "password1");
    expect(screen.queryByText(/Check your email/)).not.toBeInTheDocument();
  });

  it("shows the error returned by Supabase", async () => {
    supabaseMock.auth.signUp.mockResolvedValue({ data: {}, error: { message: "User already registered" } });
    render(<SignupPage />);
    await submit("password1", "password1");
    expect(await screen.findByText("User already registered")).toBeInTheDocument();
  });
});
