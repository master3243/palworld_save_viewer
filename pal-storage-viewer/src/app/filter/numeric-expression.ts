import type { FieldLookup } from './filter-model';
import type { PalStorageRow } from '../save-parser.service';

export interface NumericExpression {
  evaluate(row: PalStorageRow): number | null;
  error?: string;
}

/** A deliberately small arithmetic language. No JavaScript, calls, or property access. */
export function numericExpression(source: string, lookup: FieldLookup): NumericExpression {
  type Eval = (row: PalStorageRow) => number | null;
  const tokens = source.match(/(?:\d+(?:\.\d*)?|\.\d+)(?:e[+-]?\d+)?|[a-z_]\w*|[^\s]/gi) ?? [];
  let pos = 0;
  try {
    if (tokens.length > 100) throw new Error('Formula is too long');
    const atom = (): Eval => {
      const token = tokens[pos++];
      if (!token) throw new Error('Expected a number or numeric field');
      if (token === '+' || token === '-') {
        const inner = atom();
        return row => { const value = inner(row); return value === null ? null : token === '-' ? -value : value; };
      }
      if (token === '(') {
        const inner = sum();
        if (tokens[pos++] !== ')') throw new Error('Missing closing parenthesis in formula');
        return inner;
      }
      if (/^(?:\d|\.)/.test(token) && Number.isFinite(Number(token))) return () => Number(token);
      const field = lookup.resolve(token);
      if (!field) throw new Error(`Unknown numeric field "${token}"`);
      if (field.kind !== 'number') throw new Error(`"${token}" is not a numeric field`);
      return row => {
        const raw = field.get(row);
        return raw === null || raw === undefined || raw === '' || !Number.isFinite(Number(raw)) ? null : Number(raw);
      };
    };
    const combine = (left: Eval, op: string, right: Eval): Eval => row => {
      const a = left(row), b = right(row);
      if (a === null || b === null || (op === '/' && b === 0)) return null;
      const result = op === '+' ? a + b : op === '-' ? a - b : op === '*' ? a * b : a / b;
      return Number.isFinite(result) ? result : null;
    };
    const product = (): Eval => {
      let left = atom();
      while (tokens[pos] === '*' || tokens[pos] === '/') left = combine(left, tokens[pos++], atom());
      return left;
    };
    const sum = (): Eval => {
      let left = product();
      while (tokens[pos] === '+' || tokens[pos] === '-') left = combine(left, tokens[pos++], product());
      return left;
    };
    const evaluate = sum();
    if (pos !== tokens.length) throw new Error(`Unexpected "${tokens[pos]}" in formula`);
    // Catch constant division by zero, while missing row fields remain an ordinary non-match.
    if (!tokens.some(token => /^[a-z_]/i.test(token)) && evaluate({}) === null) throw new Error('Formula must produce a finite number (check division by zero)');
    return { evaluate };
  } catch (error) {
    return { evaluate: () => null, error: error instanceof Error ? error.message : 'Invalid formula' };
  }
}
