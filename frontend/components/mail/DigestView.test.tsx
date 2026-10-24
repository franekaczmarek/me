import { render, screen, waitFor, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { beforeEach, describe, expect, it, vi } from "vitest";
import type { Digest } from "@/lib/mail/types";
import { DigestView } from "./DigestView";

const mailApi = vi.hoisted(() => ({ digest: vi.fn(), latestDigest: vi.fn(), applyDigest: vi.fn() }));
vi.mock("@/lib/mail/api", () => ({ mailApi }));
vi.mock("@/lib/todo/api", () => ({ localToday: () => "2026-10-24" }));

const PRIVATE = { id: "a1", email: "me@gmail.com", label: "Private", color: "#ff7a6b", created_at: "2026-10-24T10:00:00Z" };
const message = (id: string, subject: string, importance: "low" | "normal" | "high", category = "primary") => ({
  id,
  account_id: "a1",
  sender: "Ann <ann@example.com>",
  subject,
  received_at: "2026-10-24T08:00:00Z",
  category,
  labels: subject === "Invoice" ? ["Faktury"] : [],
  summary: `About ${subject}`,
  importance,
  marked_read: false,
});
const DIGEST: Digest = {
  id: "d1",
  summary: "An invoice to pay and a sale.",
  created_at: "2026-10-24T17:26:00Z",
  applied_at: null,
  messages: [message("m1", "Sale", "low", "promotions") as Digest["messages"][0], message("m2", "Invoice", "high") as Digest["messages"][0]],
  proposals: [
    {
      id: "p1",
      title: "Pay the invoice",
      planned_date: "2026-10-26",
      deadline: "2026-10-30",
      duration_min: 10,
      priority: "normal",
      reason: "Due Friday",
      mail_ids: ["m2"],
      status: "pending",
    },
  ],
};

beforeEach(() => {
  mailApi.latestDigest.mockResolvedValue(null);
  mailApi.digest.mockResolvedValue({ digest: DIGEST, warnings: [] });
  mailApi.applyDigest.mockResolvedValue({ created: 1, dismissed: 1, marked: 2, warnings: [] });
});

const NEWSLETTER = { ...DIGEST.proposals[0], id: "p2", title: "Read the newsletter", deadline: null, priority: "low" as const, mail_ids: ["m1"] };
const tasksCard = () => screen.getByRole("region", { name: "Tasks from your mail" });

/** The button, once the last digest has loaded (it stays disabled until then). */
async function summarizeButton() {
  const button = screen.getByRole("button", { name: "✨ Summarize new mail" });
  await waitFor(() => expect(button).toBeEnabled());
  return button;
}

describe("DigestView", () => {
  it("asks to connect an inbox first", async () => {
    render(<DigestView accounts={[]} />);
    expect(screen.getByText(/Connect a Gmail inbox/)).toBeInTheDocument();
    expect(screen.getByRole("button", { name: "✨ Summarize new mail" })).toBeDisabled();
  });

  it("shows the last digest: summary, tasks and emails by importance", async () => {
    mailApi.latestDigest.mockResolvedValueOnce(DIGEST);
    render(<DigestView accounts={[PRIVATE]} />);
    expect(await screen.findByText("An invoice to pay and a sale.")).toBeInTheDocument();
    expect(screen.getByText(/Summary of 2 emails/)).toBeInTheDocument();

    const task = within(screen.getByRole("region", { name: "Tasks from your mail" })).getByRole("listitem", { name: "Pay the invoice" });
    expect(within(task).getByLabelText("Day for Pay the invoice")).toHaveValue("2026-10-26");
    expect(within(task).getByRole("checkbox", { name: "Add Pay the invoice" })).toBeChecked();
    expect(task).toHaveTextContent("due Fri 30 Oct");
    expect(task).toHaveTextContent("~10m");
    expect(task).toHaveTextContent("From: Invoice");

    const emails = screen.getByRole("region", { name: "Emails" });
    expect(within(emails).getByRole("heading", { name: /Private/ })).toBeInTheDocument();
    expect(within(emails).getAllByRole("listitem").map((li) => li.getAttribute("aria-label"))).toEqual(["Invoice", "Sale"]);
    expect(within(emails).getByRole("listitem", { name: "Sale" })).toHaveTextContent("Promotions");
    expect(within(emails).getByRole("listitem", { name: "Invoice" })).not.toHaveTextContent("Primary");
    expect(within(emails).getByRole("listitem", { name: "Invoice" })).toHaveTextContent("Faktury");
  });

  it("runs a new digest and shows warnings", async () => {
    mailApi.digest.mockResolvedValueOnce({ digest: DIGEST, warnings: ["Couldn't reach Gmail for Work."] });
    render(<DigestView accounts={[PRIVATE]} />);
    await userEvent.click(await summarizeButton());
    expect(mailApi.digest).toHaveBeenCalled();
    expect(await screen.findByText("An invoice to pay and a sale.")).toBeInTheDocument();
    expect(screen.getByText("Couldn't reach Gmail for Work.")).toBeInTheDocument();
  });

  it("says when there is no new mail and keeps the previous digest", async () => {
    mailApi.latestDigest.mockResolvedValueOnce(DIGEST);
    mailApi.digest.mockResolvedValueOnce({ digest: null, warnings: [] });
    render(<DigestView accounts={[PRIVATE]} />);
    await screen.findByText("An invoice to pay and a sale.");
    await userEvent.click(await summarizeButton());
    expect(await screen.findByText("No new unread mail since the last summary.")).toBeInTheDocument();
    expect(screen.getByText("An invoice to pay and a sale.")).toBeInTheDocument();
  });

  it("shows errors with a way to try again", async () => {
    mailApi.digest.mockRejectedValueOnce(new Error("Claude is busy right now; try again in a minute."));
    render(<DigestView accounts={[PRIVATE]} />);
    await userEvent.click(await summarizeButton());
    expect(await screen.findByText(/Claude is busy/)).toBeInTheDocument();
    await userEvent.click(screen.getByRole("button", { name: "Try again" }));
    expect(mailApi.digest).toHaveBeenCalledTimes(2);
    expect(await screen.findByText("An invoice to pay and a sale.")).toBeInTheDocument();
  });

  it("reports a failed load and still lets the user summarize", async () => {
    mailApi.latestDigest.mockRejectedValueOnce(new Error("offline"));
    render(<DigestView accounts={[PRIVATE]} />);
    expect(await screen.findByText("Could not load your last summary: offline")).toBeInTheDocument();
    expect(screen.queryByRole("button", { name: "Try again" })).not.toBeInTheDocument();
    await userEvent.click(await summarizeButton());
    expect(await screen.findByText("An invoice to pay and a sale.")).toBeInTheDocument();
  });

  it("waits for the last digest before a new one can be made", async () => {
    let finishLoad: (d: Digest | null) => void = () => {};
    mailApi.latestDigest.mockReturnValueOnce(new Promise((resolve) => (finishLoad = resolve)));
    render(<DigestView accounts={[PRIVATE]} />);
    expect(screen.getByRole("button", { name: "✨ Summarize new mail" })).toBeDisabled();
    finishLoad(null);
    await userEvent.click(await summarizeButton());
    expect(await screen.findByText("An invoice to pay and a sale.")).toBeInTheDocument();
  });

  it("adds the ticked tasks as edited, dismisses the rest and marks the emails as read", async () => {
    const applied: Digest = {
      ...DIGEST,
      applied_at: "2026-10-24T18:00:00Z",
      proposals: [{ ...DIGEST.proposals[0], status: "accepted" }, { ...NEWSLETTER, status: "dismissed" }],
      messages: DIGEST.messages.map((m) => ({ ...m, marked_read: true })),
    };
    mailApi.latestDigest.mockResolvedValueOnce({ ...DIGEST, proposals: [DIGEST.proposals[0], NEWSLETTER] }).mockResolvedValueOnce(applied);
    render(<DigestView accounts={[PRIVATE]} />);
    const card = await screen.findByRole("region", { name: "Tasks from your mail" });
    const invoice = within(card).getByRole("listitem", { name: "Pay the invoice" });
    const title = within(invoice).getByLabelText("Task title");
    await userEvent.clear(title);
    await userEvent.type(title, "Pay invoice 10/2026");
    const day = within(invoice).getByLabelText("Day for Pay the invoice");
    await userEvent.clear(day);
    await userEvent.type(day, "2026-10-27");
    await userEvent.click(within(card).getByRole("checkbox", { name: "Add Read the newsletter" }));
    expect(within(card).getByRole("checkbox", { name: "Mark these 2 emails as read in Gmail" })).toBeChecked();

    await userEvent.click(within(card).getByRole("button", { name: "Add 1 task" }));
    expect(mailApi.applyDigest).toHaveBeenCalledWith(
      "d1",
      [{ proposal_id: "p1", title: "Pay invoice 10/2026", planned_date: "2026-10-27", deadline: "2026-10-30", duration_min: 10, priority: "normal" }],
      ["p2"],
      true,
    );
    expect(await screen.findByText("Added 1 task to your to-do list. Marked 2 emails as read.")).toBeInTheDocument();
    expect(within(tasksCard()).getByText("✓ Added")).toBeInTheDocument();
    expect(within(tasksCard()).getByText("Skipped")).toBeInTheDocument();
    expect(within(tasksCard()).queryByRole("button", { name: /Add|Mark|Done/ })).not.toBeInTheDocument();
  });

  it("can leave the emails unread and mark them later", async () => {
    mailApi.latestDigest
      .mockResolvedValueOnce(DIGEST)
      .mockResolvedValueOnce({ ...DIGEST, proposals: [{ ...DIGEST.proposals[0], status: "accepted" }] });
    mailApi.applyDigest.mockResolvedValueOnce({ created: 1, dismissed: 0, marked: 0, warnings: ["Couldn't reach Gmail for Work; its emails stay unread."] });
    render(<DigestView accounts={[PRIVATE]} />);
    const card = await screen.findByRole("region", { name: "Tasks from your mail" });
    await userEvent.click(within(card).getByRole("checkbox", { name: "Mark these 2 emails as read in Gmail" }));
    await userEvent.click(within(card).getByRole("button", { name: "Add 1 task" }));
    expect(mailApi.applyDigest).toHaveBeenLastCalledWith("d1", expect.any(Array), [], false);
    expect(await screen.findByText("Couldn't reach Gmail for Work; its emails stay unread.")).toBeInTheDocument();

    // Nothing left to add: the button only marks the emails as read.
    await userEvent.click(within(tasksCard()).getByRole("checkbox", { name: "Mark these 2 emails as read in Gmail" }));
    await userEvent.click(within(tasksCard()).getByRole("button", { name: "Mark as read" }));
    expect(mailApi.applyDigest).toHaveBeenLastCalledWith("d1", [], [], true);
  });

  it("checks titles and days before adding", async () => {
    mailApi.latestDigest.mockResolvedValueOnce(DIGEST);
    render(<DigestView accounts={[PRIVATE]} />);
    const card = await screen.findByRole("region", { name: "Tasks from your mail" });
    await userEvent.clear(within(card).getByLabelText("Task title"));
    await userEvent.click(within(card).getByRole("button", { name: "Add 1 task" }));
    expect(within(card).getByText("Give every ticked task a title.")).toBeInTheDocument();
    await userEvent.type(within(card).getByLabelText("Task title"), "Pay");
    const day = within(card).getByLabelText("Day for Pay the invoice");
    await userEvent.clear(day);
    await userEvent.type(day, "2026-10-01");
    await userEvent.click(within(card).getByRole("button", { name: "Add 1 task" }));
    expect(within(card).getByText("Tasks can't be planned in the past.")).toBeInTheDocument();
    expect(mailApi.applyDigest).not.toHaveBeenCalled();
  });

  it("shows a failed apply and lets the user retry", async () => {
    mailApi.latestDigest.mockResolvedValueOnce(DIGEST);
    mailApi.applyDigest.mockRejectedValueOnce(new Error("Some of these tasks were already handled."));
    render(<DigestView accounts={[PRIVATE]} />);
    const card = await screen.findByRole("region", { name: "Tasks from your mail" });
    await userEvent.click(within(card).getByRole("button", { name: "Add 1 task" }));
    expect(await within(card).findByText("Some of these tasks were already handled.")).toBeInTheDocument();
    expect(within(card).getByRole("button", { name: "Add 1 task" })).toBeEnabled();
  });
});
