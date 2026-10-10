import { render, screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { beforeEach, describe, expect, it, vi } from "vitest";
import type { TimelineItem } from "@/lib/timeline/items";
import type { Category, TimelineEvent } from "@/lib/timeline/types";
import { TimelineModule } from "./TimelineModule";

const mocks = vi.hoisted(() => ({
  timelineApi: { listEvents: vi.fn(), listCategories: vi.fn() },
  profileApi: { get: vi.fn() },
  viewProps: vi.fn(),
}));
vi.mock("@/lib/timeline/api", () => ({ timelineApi: mocks.timelineApi, profileApi: mocks.profileApi }));

// Stand-in for the vis-timeline view: one button per item.
vi.mock("./TimelineView", () => ({
  TimelineView: (props: { items: TimelineItem[]; onSelect: (id: string | null) => void; home: unknown }) => {
    mocks.viewProps(props);
    return (
      <div data-testid="timeline">
        {props.items.map((i) => (
          <button key={i.id} onClick={() => props.onSelect(i.id)}>
            {i.title}
          </button>
        ))}
      </div>
    );
  },
}));

const school: Category = { id: "c1", name: "School", color: "#2563eb" };
const events: TimelineEvent[] = [
  {
    id: "e1",
    title: "High school",
    description: "Class 3B",
    start: "2006",
    end: "2009-06",
    category_id: "c1",
    created_at: "",
    updated_at: "",
  },
  { id: "e2", title: "Born", description: "", start: "1990-03-04", end: null, category_id: null, created_at: "", updated_at: "" },
];

beforeEach(() => {
  mocks.timelineApi.listEvents.mockResolvedValue(events);
  mocks.timelineApi.listCategories.mockResolvedValue([school]);
  mocks.profileApi.get.mockResolvedValue({ display_name: null, birth_date: "1990-03-04" });
});

describe("TimelineModule", () => {
  it("loads events and shows them on the timeline", async () => {
    render(<TimelineModule />);
    expect(screen.getByText("Loading timeline…")).toBeInTheDocument();
    expect(await screen.findByRole("button", { name: "High school" })).toBeInTheDocument();
    expect(screen.getByRole("button", { name: "Born" })).toBeInTheDocument();
  });

  it("opens on the user's life when the birth date is known", async () => {
    render(<TimelineModule />);
    await screen.findByTestId("timeline");
    const { home } = mocks.viewProps.mock.lastCall![0];
    expect(home.start.getFullYear()).toBeLessThanOrEqual(1990);
    expect(screen.queryByText(/set your birth date/)).not.toBeInTheDocument();
  });

  it("suggests setting the birth date when it's missing", async () => {
    mocks.profileApi.get.mockResolvedValue({ display_name: null, birth_date: null });
    render(<TimelineModule />);
    expect(await screen.findByRole("link", { name: "Settings" })).toHaveAttribute("href", "/settings");
  });

  it("shows details of the selected event and closes them", async () => {
    render(<TimelineModule />);
    await userEvent.click(await screen.findByRole("button", { name: "High school" }));
    const details = screen.getByRole("complementary", { name: "Event details" });
    expect(details).toHaveTextContent("High school");
    expect(details).toHaveTextContent("2006 – June 2009");
    expect(details).toHaveTextContent("School");
    expect(details).toHaveTextContent("Class 3B");

    await userEvent.click(screen.getByRole("button", { name: "Close details" }));
    expect(screen.queryByRole("complementary", { name: "Event details" })).not.toBeInTheDocument();
  });

  it("shows an empty state", async () => {
    mocks.timelineApi.listEvents.mockResolvedValue([]);
    render(<TimelineModule />);
    expect(await screen.findByText(/No events yet/)).toBeInTheDocument();
  });

  it("shows an error when loading fails", async () => {
    mocks.timelineApi.listEvents.mockRejectedValue(new Error("Database unavailable"));
    render(<TimelineModule />);
    expect(await screen.findByText("Could not load the timeline: Database unavailable")).toBeInTheDocument();
  });
});
