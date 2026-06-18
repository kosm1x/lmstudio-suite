/** Tiny argv parser for the agent CLI (kept separate so it is unit-testable). */
import { resolve } from "node:path";

export interface CliArgs {
  prompt: string;
  model?: string;
  cwd: string;
  maxRounds: number;
  shell: boolean;
  /** Knowledge-base directory for the map-memory tools (absolute). */
  kb?: string;
  /** Directory for the writable memory tools remember/recall/forget (absolute). */
  memory?: string;
  /** Expose the data tools (calculator / json / csv / sqlite). */
  data: boolean;
  /** Default IANA timezone for the time tools + injected date/time line. */
  tz?: string;
  /** Gate mutating tools behind an interactive y/N prompt. */
  approve: boolean;
  /** Append a JSONL trace of every tool call to this file. */
  trace?: string;
  help: boolean;
}

export function parseArgs(argv: string[]): CliArgs {
  const args: CliArgs = {
    prompt: "",
    cwd: process.cwd(),
    maxRounds: 8,
    shell: false,
    data: false,
    approve: false,
    help: false,
  };
  const positional: string[] = [];

  for (let i = 0; i < argv.length; i++) {
    const token = argv[i];
    if (token === undefined) continue;
    switch (token) {
      case "--model":
      case "-m":
        args.model = argv[++i];
        break;
      case "--cwd":
        args.cwd = resolve(argv[++i] ?? ".");
        break;
      case "--kb":
        args.kb = resolve(argv[++i] ?? ".");
        break;
      case "--memory":
        args.memory = resolve(argv[++i] ?? ".");
        break;
      case "--max-rounds":
        args.maxRounds = Math.max(1, Number(argv[++i] ?? "8") || 8);
        break;
      case "--shell":
        args.shell = true;
        break;
      case "--data":
        args.data = true;
        break;
      case "--tz":
        args.tz = argv[++i];
        break;
      case "--approve":
        args.approve = true;
        break;
      case "--trace":
        args.trace = resolve(argv[++i] ?? "trace.jsonl");
        break;
      case "--help":
      case "-h":
        args.help = true;
        break;
      default:
        positional.push(token);
    }
  }

  args.prompt = positional.join(" ").trim();
  return args;
}

export const HELP_TEXT = `lmstudio-agent — a local agent powered by LM Studio + the lmstudio-suite tools

Usage:
  npm start -w @lmstudio-suite/agent-cli -- [options] "<your task>"
  npx tsx src/cli.ts [options] "<your task>"

Options:
  -m, --model <id>     Model identifier (default: the currently loaded model)
      --cwd <dir>      Working directory for file/shell tools (default: cwd)
      --max-rounds <n> Max agent prediction rounds (default: 8)
      --shell          Enable the run_shell tool (off by default)
      --kb <dir>       Knowledge-base dir to expose as map-memory tools
      --memory <dir>   Dir for writable memory tools (remember / recall / forget)
      --data           Enable the data tools (calculator / json / csv / sqlite)
      --tz <zone>      Default IANA timezone for the time tools (default: this machine's)
      --approve        Ask y/N before each mutating tool (write/delete/shell/http…)
      --trace <file>   Append a JSONL trace of every tool call to <file>
  -h, --help           Show this help

Environment (web search):
  SEARCH_PROVIDER  duckduckgo (default) | tavily | brave | searxng
  SEARCH_API_KEY   API key for tavily/brave
  SEARXNG_URL      Base URL for a self-hosted SearXNG instance

The agent always has: web_search, fetch_url, http_request, download_file, crawl,
the filesystem tools (read/write/edit/search/glob/list/stat/move/mkdir/delete), and
the time tools (now, time_until, add_duration, diff_dates, convert_timezone). The
current date/time is also prepended to your task so the model never guesses it.
With --shell it also gets run_shell (commands run with your privileges).
With --kb it also gets map_overview, search_map, read_node, follow_links over
that knowledge base.`;
