"use client";

import { useCallback, useEffect, useRef, useState } from "react";
import { Button, Message } from "@/components/ui";
import { todoApi } from "@/lib/todo/api";
import type { DaysFeed, Task, TaskInput } from "@/lib/todo/types";
import { DayCard } from "./DayCard";
import { DragProvider, DropZone, INBOX } from "./dnd";
import { PlanDialog } from "./PlanDialog";
import { QuickAdd } from "./QuickAdd";
import { RoutinesCard } from "./RoutinesCard";
import { SmartAdd } from "./SmartAdd";
import { StatsCard } from "./StatsCard";
import { TaskForm } from "./TaskForm";
import { TaskRow } from "./TaskRow";

type Panel = { mode: "edit"; task: Task } | { mode: "new"; date: string | null } | null;

export function TodoModule() {
  const [feed, setFeed] = useState<DaysFeed | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [actionError, setActionError] = useState<string | null>(null);
  const [panel, setPanel] = useState<Panel>(null);
  const [attempt, setAttempt] = useState(0);
  // Bumped after every change so the statistics reload too.
  const [version, setVersion] = useState(0);
  const [planning, setPlanning] = useState(false);
  const todayRef = useRef<HTMLElement>(null);
  const centred = useRef(false);

  const reload = useCallback(
    () =>
      todoApi.days().then((f) => {
        setFeed(f);
        setVersion((v) => v + 1);
      }),
    [],
  );

  useEffect(() => {
    reload().catch((e: Error) => setError(`Could not load your tasks: ${e.message}`));
  }, [reload, attempt]);

  // Bring today to the middle of the list once it's first shown.
  useEffect(() => {
    if (feed && !centred.current && todayRef.current) {
      centred.current = true;
      todayRef.current.scrollIntoView?.({ block: "center" });
    }
  }, [feed]);

  /** Runs a change, then reloads the feed (the server decides what is shown where). */
  async function act(action: () => Promise<unknown>) {
    setActionError(null);
    try {
      await action();
      await reload();
    } catch (e) {
      setActionError((e as Error).message);
    }
  }

  if (error) {
    return (
      <div className="flex flex-col items-start gap-3 p-6">
        <Message kind="error">{error}</Message>
        <Button
          type="button"
          onClick={() => {
            setError(null);
            setAttempt((n) => n + 1);
          }}
        >
          Try again
        </Button>
      </div>
    );
  }
  if (!feed) return <p className="p-6 text-sm text-zinc-500">Loading your tasks…</p>;

  const toggle = (task: Task) =>
    act(() => (task.status === "done" ? todoApi.reopenTask(task.id) : todoApi.completeTask(task.id)));
  const move = (task: Task, plannedDate: string | null) =>
    act(() => todoApi.updateTask(task.id, { planned_date: plannedDate }));
  const add = (title: string, plannedDate: string | null) =>
    act(() => todoApi.createTask({ title, planned_date: plannedDate }));
  const open = (task: Task) => setPanel({ mode: "edit", task });

  async function save(input: TaskInput) {
    if (panel?.mode === "edit") await todoApi.updateTask(panel.task.id, input);
    else await todoApi.createTask(input);
    await reload();
    setPanel(null);
  }

  return (
    <DragProvider onDrop={move}>
      <div className="flex flex-1 flex-col gap-4 bg-[#faf7f2] p-4 md:flex-row md:p-6 dark:bg-zinc-950">
        <div className="flex min-w-0 flex-1 flex-col gap-3">
          <div className="flex flex-wrap items-center gap-2">
            <button
              type="button"
              onClick={() => setPanel({ mode: "new", date: feed.today })}
              className="rounded-full bg-gradient-to-r from-[#ff7a6b] to-[#ffa36c] px-5 py-2 text-sm font-semibold text-white shadow-[0_6px_18px_rgba(255,122,107,0.35)] transition hover:-translate-y-0.5"
            >
              Add task
            </button>
            <button
              type="button"
              onClick={() => setPlanning(true)}
              className="rounded-full border border-stone-200 bg-white px-5 py-2 text-sm font-medium text-stone-700 shadow-sm transition hover:-translate-y-0.5 hover:shadow dark:border-zinc-700 dark:bg-zinc-900 dark:text-zinc-200"
            >
              ✨ Plan with Claude
            </button>
            {actionError && <Message kind="error">{actionError}</Message>}
          </div>
          <SmartAdd today={feed.today} onAdded={() => reload().catch(() => {})} />
          <div className="flex flex-col gap-4 md:max-h-[calc(100vh-11rem)] md:overflow-y-auto md:px-1 md:py-2" data-testid="day-list">
            {feed.days.map((day) => (
              <DayCard
                key={day.date}
                ref={day.is_today ? todayRef : undefined}
                day={day}
                today={feed.today}
                onToggle={toggle}
                onOpen={open}
                onMove={move}
                onAdd={add}
              />
            ))}
          </div>
        </div>

        <div className="flex w-full flex-col gap-4 md:w-96">
          {panel ? (
            <aside
              aria-label={panel.mode === "new" ? "New task" : "Edit task"}
              className="flex flex-col gap-4 rounded-3xl border border-stone-100 bg-white p-5 shadow-[0_8px_30px_rgba(120,100,80,0.08)] dark:border-zinc-800 dark:bg-zinc-900"
            >
              <p className="text-xs font-medium tracking-wide text-zinc-500 uppercase">
                {panel.mode === "new" ? "New task" : "Edit task"}
              </p>
              <TaskForm
                key={panel.mode === "edit" ? panel.task.id : `new-${panel.date}`}
                task={panel.mode === "edit" ? panel.task : undefined}
                defaultDate={panel.mode === "new" ? panel.date : undefined}
                submitLabel={panel.mode === "new" ? "Add task" : "Save changes"}
                onSave={save}
                onCancel={() => setPanel(null)}
                onDelete={
                  panel.mode === "edit"
                    ? async () => {
                        await todoApi.deleteTask(panel.task.id);
                        await reload();
                        setPanel(null);
                      }
                    : undefined
                }
              />
            </aside>
          ) : null}

          <StatsCard version={version} />

          <DropZone
            id={INBOX}
            aria-label="Inbox"
            className="rounded-3xl border border-stone-100 bg-white p-4 shadow-[0_8px_30px_rgba(120,100,80,0.06)] dark:border-zinc-800 dark:bg-zinc-900"
          >
            <header className="flex items-baseline justify-between px-3">
              <h2 className="text-lg font-semibold text-stone-800 dark:text-zinc-100">Inbox</h2>
              <span className="text-xs text-stone-500">{feed.inbox.length ? `${feed.inbox.length} without a day` : "Empty"}</span>
            </header>
            {feed.inbox.length > 0 && (
              <ul className="mt-2 flex flex-col">
                {feed.inbox.map((task) => (
                  <TaskRow key={task.id} task={task} today={feed.today} onToggle={toggle} onOpen={open} />
                ))}
              </ul>
            )}
            <QuickAdd label="Add a task to the inbox" onAdd={(title) => add(title, null)} />
          </DropZone>

          <RoutinesCard onChanged={() => reload().catch(() => {})} />
        </div>
      </div>
      {planning && (
        <PlanDialog today={feed.today} onClose={() => setPlanning(false)} onApplied={() => reload().catch(() => {})} />
      )}
    </DragProvider>
  );
}
