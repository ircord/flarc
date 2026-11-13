/** A small lexer for structural SQL comparisons, not an evaluator or SQL rewriter. */
function tokens(sql: string): string[] {
  const result: string[] = [];
  let offset = 0;
  while (offset < sql.length) {
    const rest = sql.slice(offset);
    const match = /^(?:\s+|--[^\n]*(?:\n|$)|\/\*[\s\S]*?\*\/)/.exec(rest);
    if (match) {
      offset += match[0].length;
      continue;
    }
    const quoted = /^(?:'(?:''|[^'])*'|"(?:""|[^"])*"|`(?:``|[^`])*`|\[[^\]]*\])/.exec(rest);
    if (quoted) {
      const value = quoted[0];
      result.push(
        value.startsWith("'")
          ? value
          : `id:${value.slice(1, -1).replaceAll('""', '"').replaceAll("``", "`").toLowerCase()}`,
      );
      offset += value.length;
      continue;
    }
    if (["'", '"', "`", "["].includes(rest[0]) || rest.startsWith("/*"))
      throw new Error("Unterminated SQL token");
    const word = /^[a-zA-Z_][a-zA-Z_0-9$]*/.exec(rest);
    if (word) {
      result.push(`id:${word[0].toLowerCase()}`);
      offset += word[0].length;
      continue;
    }
    result.push(rest[0]);
    offset++;
  }
  return result;
}

function normalize(input: string[], table: string): string {
  return JSON.stringify(
    input.filter(
      (token, i) =>
        !(token === `id:${table.toLowerCase()}` && input[i + 1] === ".") &&
        !(token === "." && input[i - 1] === `id:${table.toLowerCase()}`),
    ),
  );
}

export function normalizeExpression(sql: string, table: string): string {
  return normalize(tokens(sql), table);
}

export function checkExpressions(definition: string, table: string): string[] {
  const input = tokens(definition);
  const result: string[] = [];
  for (let i = 0; i < input.length - 1; i++) {
    if (input[i] !== "id:check" || input[i + 1] !== "(") continue;
    const start = i + 2;
    let depth = 1;
    i = start;
    for (; i < input.length && depth; i++) {
      if (input[i] === "(") depth++;
      else if (input[i] === ")") depth--;
    }
    if (depth) throw new Error("Unterminated SQL CHECK");
    result.push(normalize(input.slice(start, i - 1), table));
    i--;
  }
  return result.sort();
}
