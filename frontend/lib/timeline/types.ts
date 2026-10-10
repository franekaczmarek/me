// Shapes returned by the backend timeline and profile API.

/** "2015" (year), "2015-06" (month) or "2015-06-17" (day). */
export type PartialDate = string;

export type Category = {
  id: string;
  name: string;
  color: string;
};

export type TimelineEvent = {
  id: string;
  title: string;
  description: string;
  start: PartialDate;
  /** Set for periods; null for single points. */
  end: PartialDate | null;
  category_id: string | null;
  created_at: string;
  updated_at: string;
};

export type EventInput = Pick<TimelineEvent, "title" | "description" | "start" | "end" | "category_id">;

export type Profile = {
  display_name: string | null;
  birth_date: string | null;
};
