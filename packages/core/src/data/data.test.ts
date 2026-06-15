import { describe, it, expect } from "vitest";
import { evalArithmetic } from "./calc";
import { parseCsv, toTable, aggregate } from "./csv";
import { parseJsonPath, queryJsonPath } from "./jsonpath";
import { checkReadOnlySql } from "./sql-readonly";

describe("evalArithmetic", () => {
  it("respects precedence, parens, and right-assoc power", () => {
    expect(evalArithmetic("1 + 2 * 3")).toBe(7);
    expect(evalArithmetic("(1 + 2) * 3")).toBe(9);
    expect(evalArithmetic("2 ^ 3 ^ 2")).toBe(512); // right-assoc: 2^(3^2)
    expect(evalArithmetic("-2 ^ 2")).toBe(-4); // ^ binds tighter than unary: -(2^2)
    expect(evalArithmetic("2 ^ -1")).toBe(0.5);
    expect(evalArithmetic("10 % 3")).toBe(1);
    expect(evalArithmetic(".5 + 1.5e1")).toBe(15.5);
  });

  it("throws on malformed input — never silently wrong", () => {
    expect(() => evalArithmetic("2 +")).toThrow();
    expect(() => evalArithmetic("2 ** 3")).toThrow();
    expect(() => evalArithmetic("alert(1)")).toThrow();
    expect(() => evalArithmetic("1/0")).toThrow(/finite/);
    expect(() => evalArithmetic("(1 + 2")).toThrow();
  });
});

describe("parseCsv / toTable / aggregate", () => {
  it("handles quoted fields with commas, quotes, and newlines", () => {
    const rows = parseCsv('a,b\n"x,y","he said ""hi"""\n1,2\n');
    expect(rows).toEqual([
      ["a", "b"],
      ["x,y", 'he said "hi"'],
      ["1", "2"],
    ]);
  });

  it("aggregates a numeric column and counts rows", () => {
    const t = toTable("name,age\nann,30\nbob,40\ncat,50");
    expect(aggregate(t, "count")).toBe(3);
    expect(aggregate(t, "sum", "age")).toBe(120);
    expect(aggregate(t, "avg", "age")).toBe(40);
    expect(aggregate(t, "min", "age")).toBe(30);
    expect(aggregate(t, "max", "age")).toBe(50);
    expect(() => aggregate(t, "sum", "nope")).toThrow(/no such column/);
  });
});

describe("jsonpath", () => {
  const doc = { users: [{ name: "ann", "weird.key": 1 }, { name: "bob" }] };
  it("parses dotted and bracketed paths", () => {
    expect(parseJsonPath(".users[0].name")).toEqual(["users", 0, "name"]);
    expect(parseJsonPath('users[1]["name"]')).toEqual(["users", 1, "name"]);
  });
  it("navigates objects and arrays, undefined when missing", () => {
    expect(queryJsonPath(doc, ".users[0].name")).toBe("ann");
    expect(queryJsonPath(doc, '.users[0]["weird.key"]')).toBe(1);
    expect(queryJsonPath(doc, ".users[-1].name")).toBe("bob"); // negative index
    expect(queryJsonPath(doc, ".")).toBe(doc); // root
    expect(queryJsonPath(doc, ".users[5].name")).toBeUndefined();
  });
});

describe("checkReadOnlySql", () => {
  it("allows SELECT and WITH", () => {
    expect(checkReadOnlySql("SELECT * FROM t").ok).toBe(true);
    expect(checkReadOnlySql("with c as (select 1) select * from c").ok).toBe(
      true,
    );
    expect(checkReadOnlySql("select * from t;").ok).toBe(true); // trailing ;
  });

  it("does not false-positive on keywords/semicolons inside strings or block comments", () => {
    // REPLACE is a scalar function here, not a write.
    expect(checkReadOnlySql("select replace(name,'a','b') from t").ok).toBe(
      true,
    );
    // 'DROP' and ';' live inside string literals — must not trip the scans.
    expect(
      checkReadOnlySql("select count(*) from t where name='DROP'").ok,
    ).toBe(true);
    expect(checkReadOnlySql("select 1 where x = 'a;b'").ok).toBe(true);
    // A write keyword inside a block comment is stripped, not flagged.
    expect(checkReadOnlySql("select * from t /* drop table x */").ok).toBe(
      true,
    );
  });
  it("rejects writes, multiple statements, comments hiding writes, and non-selects", () => {
    expect(checkReadOnlySql("DELETE FROM t").ok).toBe(false);
    expect(checkReadOnlySql("UPDATE t SET x=1").ok).toBe(false);
    expect(checkReadOnlySql("DROP TABLE t").ok).toBe(false);
    expect(checkReadOnlySql("PRAGMA writable_schema=1").ok).toBe(false);
    expect(checkReadOnlySql("select 1; drop table t").ok).toBe(false);
    expect(
      checkReadOnlySql("select 1 -- drop\n; insert into t values(1)").ok,
    ).toBe(false);
    expect(checkReadOnlySql("").ok).toBe(false);
  });
});
