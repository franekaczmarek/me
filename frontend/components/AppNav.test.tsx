import { render, screen } from "@testing-library/react";
import { describe, expect, it, vi } from "vitest";
import { navigationMock } from "@/test/mocks";
import { AppNav } from "./AppNav";

vi.mock("next/navigation", async () => (await import("@/test/mocks")).navigationMock);

describe("AppNav", () => {
  it("renders a tab for every module", () => {
    render(<AppNav />);
    expect(screen.getByRole("link", { name: "Timeline" })).toHaveAttribute("href", "/timeline");
    expect(screen.getByRole("link", { name: "To-do" })).toHaveAttribute("href", "/todo");
    expect(screen.getByRole("link", { name: "Calendar" })).toHaveAttribute("href", "/calendar");
    expect(screen.getByRole("link", { name: "Mail" })).toHaveAttribute("href", "/mail");
  });

  it("highlights the tab of the current module, including nested paths", () => {
    navigationMock.usePathname.mockReturnValue("/calendar/2026");
    render(<AppNav />);
    expect(screen.getByRole("link", { name: "Calendar" }).className).toContain("bg-zinc-900");
    expect(screen.getByRole("link", { name: "Timeline" }).className).not.toContain("bg-zinc-900");
  });
});
