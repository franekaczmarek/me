// Lazy loader for vis-timeline (large; browser only). Shared so the module can
// start the download early, in parallel with the data requests.
type Vis = typeof import("vis-timeline/standalone/esm/vis-timeline-graph2d.min.mjs");

let loading: Promise<Vis> | null = null;

export function loadVis(): Promise<Vis> {
  loading ??= import("vis-timeline/standalone/esm/vis-timeline-graph2d.min.mjs");
  return loading;
}
