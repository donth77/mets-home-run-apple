import { useEffect, useState, type ReactNode } from "react";
import { createCsv, downloadCsv, type CsvColumn } from "./csvExport";
import { eventsForFilter, type DeviceTimelineEvent, type TimelineFilter } from "./fakeDevice";

const eventResultLabels: Record<NonNullable<DeviceTimelineEvent["result"]>, string> = {
  completed: "Completed",
  "safe-hold": "No motion",
  connected: "Connected",
  recorded: "Recorded only",
};

const timelinePageSizes = [5, 10, 25] as const;

function getBrowserTimeZone() {
  return Intl.DateTimeFormat().resolvedOptions().timeZone || "UTC";
}

function getShortTimeZoneName(value: string | number | Date, timeZone: string) {
  return (
    new Intl.DateTimeFormat("en-US", { timeZone, timeZoneName: "short" })
      .formatToParts(new Date(value))
      .find((part) => part.type === "timeZoneName")?.value ?? timeZone
  );
}

interface CsvExportButtonProps<Row> {
  rows: readonly Row[];
  columns: readonly CsvColumn<Row>[];
  fileName: string;
  label?: string;
}

export function CsvExportButton<Row>({ rows, columns, fileName, label = "Export CSV" }: CsvExportButtonProps<Row>) {
  const datedFileName = `${fileName}-${new Date().toISOString().slice(0, 10)}.csv`;
  return (
    <button
      type="button"
      className="data-export-button"
      disabled={rows.length === 0}
      title={
        rows.length === 0
          ? "There are no rows to export"
          : `Export all ${rows.length} matching row${rows.length === 1 ? "" : "s"} as CSV`
      }
      onClick={() => downloadCsv(datedFileName, createCsv(rows, columns))}
    >
      <span aria-hidden="true">↓</span> {label}
    </button>
  );
}

export function useReducedMotion() {
  const [reducedMotion, setReducedMotion] = useState(
    () => window.matchMedia?.("(prefers-reduced-motion: reduce)").matches ?? false,
  );

  useEffect(() => {
    const query = window.matchMedia?.("(prefers-reduced-motion: reduce)");
    if (!query) return;
    const update = (event: MediaQueryListEvent) => setReducedMotion(event.matches);
    query.addEventListener("change", update);
    return () => query.removeEventListener("change", update);
  }, []);

  return reducedMotion;
}

function formatEventTime(value: string, timeZone: string) {
  const date = new Date(value);
  return {
    day: new Intl.DateTimeFormat("en-US", { month: "short", day: "numeric", timeZone }).format(date),
    time: new Intl.DateTimeFormat("en-US", { hour: "numeric", minute: "2-digit", timeZone }).format(date),
  };
}

export function WorkspaceHeading({
  eyebrow,
  title,
  titleId,
  description,
  children,
}: {
  eyebrow: string;
  title: string;
  titleId: string;
  description: string;
  children?: ReactNode;
}) {
  return (
    <header className="workspace-heading">
      <div>
        <span className="eyebrow">{eyebrow}</span>
        <h1 id={titleId}>{title}</h1>
        <p>{description}</p>
      </div>
      {children && <div className="workspace-heading__actions">{children}</div>}
    </header>
  );
}

export function Timeline({
  events,
  compact = false,
  filters = false,
  exportFileName = "apple-lab-events",
}: {
  events: readonly DeviceTimelineEvent[];
  compact?: boolean;
  filters?: boolean;
  exportFileName?: string;
}) {
  const [filter, setFilter] = useState<TimelineFilter>("all");
  const [page, setPage] = useState(1);
  const [pageSize, setPageSize] = useState<(typeof timelinePageSizes)[number]>(5);
  const browserTimeZone = getBrowserTimeZone();
  const filteredEvents = eventsForFilter(events, filter);
  const pageCount = Math.max(1, Math.ceil(filteredEvents.length / pageSize));
  const currentPage = Math.min(page, pageCount);
  const firstRowIndex = (currentPage - 1) * pageSize;
  const lastRowIndex = Math.min(firstRowIndex + pageSize, filteredEvents.length);
  const visibleEvents = compact ? filteredEvents : filteredEvents.slice(firstRowIndex, lastRowIndex);
  const timeZoneLabel = getShortTimeZoneName(events[0]?.occurredAt ?? Date.now(), browserTimeZone);
  const filterOptions: readonly { id: TimelineFilter; label: string }[] = [
    { id: "all", label: "All" },
    { id: "game", label: "Game" },
    { id: "apple", label: "Apple" },
    { id: "system", label: "System" },
  ];
  const timelineColumns: readonly CsvColumn<DeviceTimelineEvent>[] = [
    {
      header: "Occurred at (browser local)",
      value: (event) =>
        new Intl.DateTimeFormat("en-US", {
          year: "numeric",
          month: "2-digit",
          day: "2-digit",
          hour: "numeric",
          minute: "2-digit",
          second: "2-digit",
          timeZone: browserTimeZone,
          timeZoneName: "short",
        }).format(new Date(event.occurredAt)),
    },
    { header: "Browser time zone", value: () => browserTimeZone },
    { header: "Occurred at (UTC)", value: (event) => new Date(event.occurredAt).toISOString() },
    { header: "Category", value: (event) => event.category },
    { header: "Kind", value: (event) => event.kind },
    { header: "Title", value: (event) => event.title },
    { header: "Result", value: (event) => (event.result ? eventResultLabels[event.result] : "") },
    { header: "Detail", value: (event) => event.detail },
    { header: "Game context", value: (event) => event.gameContext },
    { header: "Event key", value: (event) => event.eventKey },
    { header: "Event ID", value: (event) => event.id },
  ];

  return (
    <div className={compact ? "timeline timeline--compact" : "timeline"}>
      <div className={filters ? "timeline-toolbar" : "timeline-toolbar timeline-toolbar--actions-only"}>
        {filters && (
          <fieldset className="timeline-filters">
            <legend className="visually-hidden">Filter device events</legend>
            {filterOptions.map((option) => (
              <button
                type="button"
                key={option.id}
                aria-pressed={filter === option.id}
                className={filter === option.id ? "is-active" : ""}
                onClick={() => {
                  setFilter(option.id);
                  setPage(1);
                }}
              >
                {option.label}
              </button>
            ))}
          </fieldset>
        )}
        <div className="timeline-data-actions">
          <span title={browserTimeZone}>{timeZoneLabel} browser time</span>
          <CsvExportButton rows={filteredEvents} columns={timelineColumns} fileName={`${exportFileName}-${filter}`} />
        </div>
      </div>
      <ol className="timeline-list">
        {visibleEvents.map((event) => {
          const date = formatEventTime(event.occurredAt, browserTimeZone);
          return (
            <li key={event.id} className="timeline-event" data-kind={event.kind}>
              <span className="timeline-event__marker" aria-hidden="true" />
              <time dateTime={event.occurredAt}>
                <strong>{date.time}</strong>
                <span>{date.day}</span>
              </time>
              <div className="timeline-event__content">
                <div>
                  <strong>{event.title}</strong>
                  {event.result && <span className="event-result">{eventResultLabels[event.result]}</span>}
                </div>
                <p>{event.detail}</p>
                {(event.gameContext || event.eventKey) && (
                  <small>
                    {event.gameContext}
                    {event.gameContext && event.eventKey && " · "}
                    {event.eventKey && <code>{event.eventKey}</code>}
                  </small>
                )}
              </div>
            </li>
          );
        })}
      </ol>
      {filteredEvents.length === 0 && <p className="empty-state timeline-empty-state">No events match this filter.</p>}
      {!compact && (
        <nav className="timeline-pagination" aria-label="Event history pagination">
          <span>
            {filteredEvents.length === 0
              ? "0 events"
              : `${firstRowIndex + 1}–${lastRowIndex} of ${filteredEvents.length}`}
          </span>
          <label>
            Rows
            <select
              aria-label="Rows per page"
              value={pageSize}
              onChange={(event) => {
                setPageSize(Number(event.target.value) as (typeof timelinePageSizes)[number]);
                setPage(1);
              }}
            >
              {timelinePageSizes.map((size) => (
                <option key={size} value={size}>
                  {size}
                </option>
              ))}
            </select>
          </label>
          <div>
            <button
              type="button"
              aria-label="Previous page"
              disabled={currentPage === 1}
              onClick={() => setPage(currentPage - 1)}
            >
              ←
            </button>
            <span aria-live="polite">
              Page {currentPage} of {pageCount}
            </span>
            <button
              type="button"
              aria-label="Next page"
              disabled={currentPage === pageCount}
              onClick={() => setPage(currentPage + 1)}
            >
              →
            </button>
          </div>
        </nav>
      )}
    </div>
  );
}

export function HealthItem({
  label,
  value,
  detail,
  tone = "normal",
}: {
  label: string;
  value: string;
  detail: string;
  tone?: "normal" | "good" | "warning";
}) {
  return (
    <div className="health-item" data-tone={tone}>
      <span>{label}</span>
      <strong>{value}</strong>
      <small>{detail}</small>
    </div>
  );
}
