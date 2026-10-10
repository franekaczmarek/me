import { fireEvent, render, screen, waitFor, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { beforeEach, describe, expect, it, vi } from "vitest";
import type { TimelineItem } from "@/lib/timeline/items";
import type { Category, TimelineEvent } from "@/lib/timeline/types";
import { TimelineModule } from "./TimelineModule";

const mocks = vi.hoisted(() => ({
  timelineApi: {
    listEvents: vi.fn(),
    listCategories: vi.fn(),
    createEvent: vi.fn(),
    updateEvent: vi.fn(),
    deleteEvent: vi.fn(),
    createCategory: vi.fn(),
    updateCategory: vi.fn(),
    deleteCategory: vi.fn(),
  },
  profileApi: { get: vi.fn() },
  viewProps: vi.fn(),
}));
vi.mock("@/lib/timeline/api", () => ({ timelineApi: mocks.timelineApi, profileApi: mocks.profileApi }));
vi.mock("@/lib/supabase", async () => ({ supabase: (await import("@/test/mocks")).supabaseMock }));

// Stand-in for the vis-timeline view: one button per item, plus a "double-click" spot.
vi.mock("./TimelineView", () => ({
  TimelineView: (props: {
    items: TimelineItem[];
    onSelect: (id: string | null) => void;
    onAdd: (start: string) => void;
    home: unknown;
  }) => {
    mocks.viewProps(props);
    return (
      <div data-testid="timeline">
        {props.items.map((i) => (
          <button key={i.id} onClick={() => props.onSelect(i.id)}>
            {i.title}
          </button>
        ))}
        <button onClick={() => props.onAdd("2020-05-17")}>double-click 2020-05-17</button>
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

    await userEvent.click(screen.getByRole("button", { name: "Close panel" }));
    expect(screen.queryByRole("complementary", { name: "Event details" })).not.toBeInTheDocument();
  });

  it("adds an event and selects it", async () => {
    const created = { ...events[1], id: "e3", title: "Moved to Kraków", start: "2012", end: null };
    mocks.timelineApi.createEvent.mockResolvedValue(created);
    render(<TimelineModule />);
    await userEvent.click(await screen.findByRole("button", { name: "Add event" }));
    const panel = screen.getByRole("complementary", { name: "New event" });
    await userEvent.type(within(panel).getByLabelText("Title"), "Moved to Kraków");
    await userEvent.type(within(panel).getByLabelText("Date year"), "2012");
    await userEvent.click(within(panel).getByRole("button", { name: "Add event" }));

    expect(mocks.timelineApi.createEvent).toHaveBeenCalledWith({
      title: "Moved to Kraków",
      description: "",
      start: "2012",
      end: null,
      category_id: null,
    });
    expect(await screen.findByRole("complementary", { name: "Event details" })).toHaveTextContent("Moved to Kraków");
    expect(screen.getByRole("button", { name: "Moved to Kraków" })).toBeInTheDocument();
  });

  it("starts a new event on the double-clicked day", async () => {
    render(<TimelineModule />);
    await userEvent.click(await screen.findByRole("button", { name: "double-click 2020-05-17" }));
    const panel = screen.getByRole("complementary", { name: "New event" });
    expect(within(panel).getByLabelText("Date year")).toHaveValue("2020");
    expect(within(panel).getByLabelText("Date month")).toHaveValue("5");
    expect(within(panel).getByLabelText("Date day")).toHaveValue("17");
  });

  it("edits an event", async () => {
    mocks.timelineApi.updateEvent.mockResolvedValue({ ...events[0], title: "Secondary school" });
    render(<TimelineModule />);
    await userEvent.click(await screen.findByRole("button", { name: "High school" }));
    await userEvent.click(screen.getByRole("button", { name: "Edit" }));
    const panel = screen.getByRole("complementary", { name: "Edit event" });
    const title = within(panel).getByLabelText("Title");
    expect(title).toHaveValue("High school");
    await userEvent.clear(title);
    await userEvent.type(title, "Secondary school");
    await userEvent.click(within(panel).getByRole("button", { name: "Save changes" }));

    expect(mocks.timelineApi.updateEvent).toHaveBeenCalledWith("e1", {
      title: "Secondary school",
      description: "Class 3B",
      start: "2006",
      end: "2009-06",
      category_id: "c1",
    });
    expect(await screen.findByRole("complementary", { name: "Event details" })).toHaveTextContent("Secondary school");
  });

  it("cancelling an edit goes back to the details", async () => {
    render(<TimelineModule />);
    await userEvent.click(await screen.findByRole("button", { name: "High school" }));
    await userEvent.click(screen.getByRole("button", { name: "Edit" }));
    await userEvent.click(screen.getByRole("button", { name: "Cancel" }));
    expect(screen.getByRole("complementary", { name: "Event details" })).toBeInTheDocument();
    expect(mocks.timelineApi.updateEvent).not.toHaveBeenCalled();
  });

  it("deletes an event after confirmation", async () => {
    mocks.timelineApi.deleteEvent.mockResolvedValue(undefined);
    render(<TimelineModule />);
    await userEvent.click(await screen.findByRole("button", { name: "High school" }));
    await userEvent.click(screen.getByRole("button", { name: "Delete…" }));
    expect(screen.getByText("Delete this event and its photos?")).toBeInTheDocument();
    await userEvent.click(screen.getByRole("button", { name: "Delete" }));

    expect(mocks.timelineApi.deleteEvent).toHaveBeenCalledWith("e1");
    await waitFor(() => expect(screen.queryByRole("button", { name: "High school" })).not.toBeInTheDocument());
    expect(screen.queryByRole("complementary")).not.toBeInTheDocument();
  });

  it("keeps the event when deletion is cancelled or fails", async () => {
    mocks.timelineApi.deleteEvent.mockRejectedValue(new Error("Database unavailable"));
    render(<TimelineModule />);
    await userEvent.click(await screen.findByRole("button", { name: "High school" }));
    await userEvent.click(screen.getByRole("button", { name: "Delete…" }));
    await userEvent.click(screen.getByRole("button", { name: "Keep" }));
    expect(mocks.timelineApi.deleteEvent).not.toHaveBeenCalled();

    await userEvent.click(screen.getByRole("button", { name: "Delete…" }));
    await userEvent.click(screen.getByRole("button", { name: "Delete" }));
    expect(await screen.findByText("Database unavailable")).toBeInTheDocument();
    expect(screen.getByRole("button", { name: "High school" })).toBeInTheDocument();
  });

  it("manages categories and recolors their events", async () => {
    mocks.timelineApi.updateCategory.mockResolvedValue({ ...school, color: "#dc2626" });
    mocks.timelineApi.createCategory.mockResolvedValue({ id: "c2", name: "Family", color: "#16a34a" });
    render(<TimelineModule />);
    await userEvent.click(await screen.findByRole("button", { name: "Categories" }));
    const panel = screen.getByRole("complementary", { name: "Categories" });

    await userEvent.type(within(panel).getByLabelText("New category name"), "Family");
    await userEvent.click(within(panel).getByRole("button", { name: "Add" }));
    expect(await within(panel).findByLabelText("Family name")).toBeInTheDocument();

    fireEvent.input(within(panel).getByLabelText("School color"), { target: { value: "#dc2626" } });
    await userEvent.click(within(panel).getByRole("button", { name: "Save" }));
    expect(mocks.timelineApi.updateCategory).toHaveBeenCalledWith("c1", { name: "School", color: "#dc2626" });
    await waitFor(() => {
      const item = mocks.viewProps.mock.lastCall![0].items.find((i: TimelineItem) => i.id === "e1");
      expect(item.style).toContain("#dc2626");
    });
  });

  it("deleting a category keeps its events without a category", async () => {
    mocks.timelineApi.deleteCategory.mockResolvedValue(undefined);
    render(<TimelineModule />);
    await userEvent.click(await screen.findByRole("button", { name: "Categories" }));
    await userEvent.click(screen.getByRole("button", { name: "Delete School" }));
    await userEvent.click(screen.getByRole("button", { name: "Delete" }));
    expect(mocks.timelineApi.deleteCategory).toHaveBeenCalledWith("c1");

    await userEvent.click(screen.getByRole("button", { name: "High school" }));
    const details = screen.getByRole("complementary", { name: "Event details" });
    expect(details).not.toHaveTextContent("School");
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
