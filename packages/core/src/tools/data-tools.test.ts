import { describe, it, expect, beforeEach, afterEach } from "vitest";
import { promises as fsp } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { createDataTools } from "./data-tools";

const ctx = {
  status: () => {},
  warn: () => {},
  signal: new AbortController().signal,
  callId: 0,
} as unknown as Parameters<
  NonNullable<ReturnType<typeof createDataTools>[number]["implementation"]>
>[1];

let root = "";
async function call(
  name: string,
  params: Record<string, unknown>,
): Promise<string> {
  const t = createDataTools({ root }).find((x) => x.name === name);
  if (!t) throw new Error(`tool ${name} not found`);
  return (await t.implementation(params, ctx)) as string;
}
const seed = (rel: string, content: string) =>
  fsp.writeFile(join(root, rel), content);

beforeEach(async () => {
  root = await fsp.mkdtemp(join(tmpdir(), "data-tools-"));
});
afterEach(async () => {
  if (root) await fsp.rm(root, { recursive: true, force: true });
});

describe("createDataTools", () => {
  it("exposes the data toolset", () => {
    expect(
      createDataTools({ root })
        .map((t) => t.name)
        .sort(),
    ).toEqual(["calculator", "parse_json", "query_sqlite", "read_csv"]);
  });
});

describe("calculator", () => {
  it("computes and reports errors", async () => {
    expect(await call("calculator", { expression: "(3+4)*2^3" })).toBe("56");
    expect(await call("calculator", { expression: "2 +" })).toMatch(/Error:/);
  });
});

describe("parse_json", () => {
  it("reads a path from an inline string and from a file", async () => {
    expect(
      await call("parse_json", {
        json: '{"a":{"b":[10,20]}}',
        path: ".a.b[1]",
      }),
    ).toBe("20");
    await seed("d.json", '{"items":[{"id":7}]}');
    expect(
      await call("parse_json", { file: "d.json", path: ".items[0].id" }),
    ).toBe("7");
    expect(await call("parse_json", { json: "{}", path: ".missing" })).toMatch(
      /No value at path/,
    );
    expect(await call("parse_json", { json: "{bad" })).toMatch(/invalid JSON/);
  });
});

describe("read_csv", () => {
  beforeEach(async () => {
    await seed("p.csv", "name,age\nann,30\nbob,40\ncat,40");
  });
  it("previews, projects columns, filters, and aggregates", async () => {
    expect(
      await call("read_csv", { file: "p.csv", columns: ["name"] }),
    ).toMatch(/name\nann\nbob\ncat/);
    expect(
      await call("read_csv", {
        file: "p.csv",
        filter_column: "age",
        filter_value: "40",
      }),
    ).toMatch(/bob.*\n.*cat/s);
    expect(
      await call("read_csv", {
        file: "p.csv",
        aggregate: "avg",
        aggregate_column: "age",
      }),
    ).toMatch(/avg\(age\) = 36\.66/);
    expect(
      await call("read_csv", { file: "p.csv", aggregate: "count" }),
    ).toMatch(/count = 3/);
  });
});

describe("read_csv caps", () => {
  it("caps rows shown and marks the remainder", async () => {
    const lines = ["v"];
    for (let i = 0; i < 150; i++) lines.push(String(i));
    await seed("big.csv", lines.join("\n"));
    const r = await call("read_csv", { file: "big.csv" });
    expect(r).toMatch(/50 more rows; 150 total/);
  });

  it("refuses a file over the size cap", async () => {
    // A header + a single oversized field tips it past 25MB.
    await seed("huge.csv", "v\n" + "x".repeat(25_000_001));
    expect(await call("read_csv", { file: "huge.csv" })).toMatch(/too large/);
  });
});

describe("query_sqlite", () => {
  const buildDb = async (rows: number) => {
    const { DatabaseSync } = await import("node:sqlite");
    const db = new DatabaseSync(join(root, "x.db"));
    db.exec("create table p(id integer, name text)");
    const ins = db.prepare("insert into p values(?,?)");
    for (let i = 1; i <= rows; i++) ins.run(i, `n${i}`);
    db.close();
  };

  it("runs a read-only query and refuses writes / missing files", async () => {
    await buildDb(2);
    const rows = await call("query_sqlite", {
      file: "x.db",
      query: "select name from p order by id",
    });
    expect(rows).toMatch(/"name": "n1"/);
    expect(rows).toMatch(/"name": "n2"/);
    expect(
      await call("query_sqlite", { file: "x.db", query: "delete from p" }),
    ).toMatch(/Error:/);
    expect(
      await call("query_sqlite", { file: "missing.db", query: "select 1" }),
    ).toMatch(/no such file/);
  });

  it("caps streamed rows at 100 (does not materialize the whole result)", async () => {
    await buildDb(150);
    const r = await call("query_sqlite", {
      file: "x.db",
      query: "select * from p",
    });
    expect(r).toMatch(/showing the first 100 rows/);
  });

  it("degrades gracefully when node:sqlite is unavailable", async () => {
    await seed("y.db", "not really a db");
    const t = createDataTools({
      root,
      openSqlite: () => {
        throw new Error("Cannot find module 'node:sqlite'");
      },
    }).find((x) => x.name === "query_sqlite")!;
    const r = (await t.implementation(
      { file: "y.db", query: "select 1" },
      ctx,
    )) as string;
    expect(r).toMatch(/is node:sqlite available/);
  });
});
