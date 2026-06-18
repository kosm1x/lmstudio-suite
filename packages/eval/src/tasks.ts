/**
 * The eval task set: one instruction per capability, each naming the tool a
 * correct model should reach for and a validator for the call's arguments.
 *
 * The runner seeds a working directory with `notes.txt` and `people.csv` so the
 * filesystem / CSV tasks have something real to act on.
 */
import type { EvalTask } from "./score";

export const TASKS: EvalTask[] = [
  {
    name: "arithmetic",
    prompt: "What is 47 * 89 + 3? Use a tool to compute it exactly.",
    expectedTool: "calculator",
    // Require both operands so a trivial `calculator({expression:"47"})` fails.
    validateArgs: (a) =>
      typeof a.expression === "string" &&
      a.expression.includes("47") &&
      a.expression.includes("89"),
  },
  {
    name: "read-file",
    prompt:
      "Read the file notes.txt in the working directory and summarise it.",
    expectedTool: "read_file",
    validateArgs: (a) => String(a.path ?? "").includes("notes"),
  },
  {
    name: "search-files",
    prompt:
      "Find every file in the working directory that mentions the word 'TODO'.",
    expectedTool: "search_files",
    validateArgs: (a) =>
      typeof a.pattern === "string" && /todo/i.test(a.pattern),
  },
  {
    name: "csv-aggregate",
    prompt:
      "people.csv has a column 'age'. What is the average age? Use a tool.",
    expectedTool: "read_csv",
    validateArgs: (a) => String(a.file ?? "").includes("people"),
  },
  {
    name: "web-search",
    prompt: "Search the web for the current population of Tokyo.",
    expectedTool: "web_search",
    validateArgs: (a) => typeof a.query === "string" && a.query.length > 0,
  },
  {
    name: "schedule-recurring",
    prompt:
      "Every weekday at 8am, write a one-line summary of my notes to summary.md. Schedule it.",
    expectedTool: "schedule_task",
    // A recurring schedule must use cron, with an actual task prompt.
    validateArgs: (a) =>
      typeof a.cron === "string" &&
      a.cron.trim().length > 0 &&
      typeof a.prompt === "string" &&
      a.prompt.trim().length > 0,
  },
  {
    name: "schedule-once",
    prompt:
      "Schedule a one-time reminder for 2026-12-25 at 09:00 to wish my mum a happy birthday.",
    expectedTool: "schedule_task",
    // A one-shot may be expressed as `at` or an equivalent cron; require a prompt.
    validateArgs: (a) =>
      (typeof a.at === "string" && a.at.trim().length > 0) ||
      (typeof a.cron === "string" && a.cron.trim().length > 0),
  },
  {
    name: "list-schedules",
    prompt: "What tasks do I currently have scheduled?",
    expectedTool: "list_schedules",
  },
  {
    name: "cancel-schedule",
    prompt: "Cancel the scheduled task whose id is 'standup'.",
    expectedTool: "cancel_schedule",
    validateArgs: (a) =>
      String(a.id ?? "")
        .toLowerCase()
        .includes("standup"),
  },
];

/** Files the runner writes into the eval working directory before running. */
export const FIXTURES: Record<string, string> = {
  "notes.txt": "Project kickoff is Monday.\nTODO: book the meeting room.\n",
  "people.csv": "name,age\nann,30\nbob,40\ncat,50\n",
};
