import { render, screen, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { beforeEach, describe, expect, it, vi } from "vitest";
import type { Media } from "@/lib/timeline/types";
import { EventPhotos } from "./EventPhotos";

const timelineApi = vi.hoisted(() => ({
  listMedia: vi.fn(),
  uploadMedia: vi.fn(),
  updateMedia: vi.fn(),
  deleteMedia: vi.fn(),
}));
vi.mock("@/lib/timeline/api", () => ({ timelineApi }));

const photo = (id: string, caption = ""): Media => ({
  id,
  event_id: "e1",
  caption,
  position: 0,
  width: 1600,
  height: 1200,
  url: `https://storage.test/${id}-display.webp?token=x`,
  thumb_url: `https://storage.test/${id}-thumb.webp?token=x`,
  created_at: "",
});
const file = (name: string) => new File(["x"], name, { type: "image/jpeg" });

beforeEach(() => {
  timelineApi.listMedia.mockResolvedValue([photo("p1", "Prom")]);
});

describe("EventPhotos", () => {
  it("shows the event's thumbnails", async () => {
    render(<EventPhotos eventId="e1" />);
    const img = await screen.findByRole("img", { name: "Prom" });
    expect(img).toHaveAttribute("src", "https://storage.test/p1-thumb.webp?token=x");
    expect(timelineApi.listMedia).toHaveBeenCalledWith("e1");
  });

  it("shows an empty state", async () => {
    timelineApi.listMedia.mockResolvedValue([]);
    render(<EventPhotos eventId="e1" />);
    expect(await screen.findByText("No photos yet.")).toBeInTheDocument();
  });

  it("shows a loading error", async () => {
    timelineApi.listMedia.mockRejectedValue(new Error("down"));
    render(<EventPhotos eventId="e1" />);
    expect(await screen.findByText("Could not load photos: down")).toBeInTheDocument();
  });

  it("uploads several photos one by one", async () => {
    timelineApi.listMedia.mockResolvedValue([]);
    timelineApi.uploadMedia.mockResolvedValueOnce(photo("p2")).mockResolvedValueOnce(photo("p3"));
    render(<EventPhotos eventId="e1" />);
    await screen.findByText("No photos yet.");
    await userEvent.upload(screen.getByLabelText("Add photos"), [file("a.jpg"), file("b.jpg")]);
    expect(await screen.findAllByRole("img", { name: "Event photo" })).toHaveLength(2);
    expect(timelineApi.uploadMedia).toHaveBeenCalledTimes(2);
    expect(timelineApi.uploadMedia.mock.calls[0][0]).toBe("e1");
    expect(timelineApi.uploadMedia.mock.calls[0][1].name).toBe("a.jpg");
  });

  it("keeps going when one upload fails and names the failed file", async () => {
    timelineApi.listMedia.mockResolvedValue([]);
    timelineApi.uploadMedia.mockRejectedValueOnce(new Error("Not a valid image")).mockResolvedValueOnce(photo("p3"));
    render(<EventPhotos eventId="e1" />);
    await screen.findByText("No photos yet.");
    await userEvent.upload(screen.getByLabelText("Add photos"), [file("bad.jpg"), file("good.jpg")]);
    expect(await screen.findByText(/bad\.jpg: Not a valid image/)).toBeInTheDocument();
    expect(screen.getAllByRole("img", { name: "Event photo" })).toHaveLength(1);
  });

  it("opens a photo large and edits its caption", async () => {
    timelineApi.updateMedia.mockResolvedValue(photo("p1", "Prom night"));
    render(<EventPhotos eventId="e1" />);
    await userEvent.click(await screen.findByRole("img", { name: "Prom" }));
    const dialog = screen.getByRole("dialog", { name: "Photo" });
    expect(within(dialog).getByRole("img")).toHaveAttribute("src", "https://storage.test/p1-display.webp?token=x");

    expect(within(dialog).queryByRole("button", { name: "Save caption" })).not.toBeInTheDocument();
    await userEvent.type(within(dialog).getByLabelText("Caption"), " night");
    await userEvent.click(within(dialog).getByRole("button", { name: "Save caption" }));
    expect(timelineApi.updateMedia).toHaveBeenCalledWith("p1", { caption: "Prom night" });
    // Both the thumbnail and the large view show the new caption.
    expect(await screen.findAllByRole("img", { name: "Prom night" })).toHaveLength(2);
  });

  it("deletes a photo after confirmation", async () => {
    timelineApi.deleteMedia.mockResolvedValue(undefined);
    render(<EventPhotos eventId="e1" />);
    await userEvent.click(await screen.findByRole("img", { name: "Prom" }));
    const dialog = screen.getByRole("dialog", { name: "Photo" });
    await userEvent.click(within(dialog).getByRole("button", { name: "Delete…" }));
    await userEvent.click(within(dialog).getByRole("button", { name: "Delete photo" }));
    expect(timelineApi.deleteMedia).toHaveBeenCalledWith("p1");
    expect(await screen.findByText("No photos yet.")).toBeInTheDocument();
    expect(screen.queryByRole("dialog")).not.toBeInTheDocument();
  });

  it("shows an error when deleting fails and keeps the photo", async () => {
    timelineApi.deleteMedia.mockRejectedValue(new Error("Database unavailable"));
    render(<EventPhotos eventId="e1" />);
    await userEvent.click(await screen.findByRole("img", { name: "Prom" }));
    await userEvent.click(screen.getByRole("button", { name: "Delete…" }));
    await userEvent.click(screen.getByRole("button", { name: "Delete photo" }));
    expect(await screen.findByText("Database unavailable")).toBeInTheDocument();
    expect(screen.getByRole("dialog", { name: "Photo" })).toBeInTheDocument();
  });

  it("closes the viewer with Escape, the Close button or a click outside", async () => {
    render(<EventPhotos eventId="e1" />);
    const thumb = await screen.findByRole("img", { name: "Prom" });

    await userEvent.click(thumb);
    await userEvent.keyboard("{Escape}");
    expect(screen.queryByRole("dialog")).not.toBeInTheDocument();

    await userEvent.click(thumb);
    await userEvent.click(screen.getByRole("button", { name: "Close" }));
    expect(screen.queryByRole("dialog")).not.toBeInTheDocument();

    await userEvent.click(thumb);
    await userEvent.click(screen.getByRole("dialog"));
    expect(screen.queryByRole("dialog")).not.toBeInTheDocument();
  });
});
