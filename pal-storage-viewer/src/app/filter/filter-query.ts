import {
  ANY_FIELD,
  FieldLookup,
  FilterGroup,
  FilterNode,
  FilterRule,
  Operator,
  SortCriterion,
  createGroup,
  createRule,
  operatorDef,
  isRuleActive
} from './filter-model';
import { MOVE_FIELDS, type MoveScope } from './move-filters';
import { numericExpression } from './numeric-expression';

/**
 * Text syntax, GitHub-search style. Examples:
 *
 *   anubis                     any text contains "anubis"
 *   level>=40 atk>=90          two rules, implicitly AND
 *   skills:Legend|Musclehead   passives has any of
 *   skills:Legend&Musclehead   passives has all of
 *   -skills:Brittle            passives has none of
 *   is:alpha -is:lucky         boolean flags
 *   gender=male                exact match
 *   nick^Sun                   starts with
 *   pal~"^Jet"                 regex
 *   iv:200..300                between
 *   skills:*                   is set / not empty
 *   (hp>=90 OR atk>=90) NOT gender=male
 */

interface Segment {
  text: string;
  quoted: boolean;
  /** Separator before this value: ',' and '&' mean all of them, '|' means any. */
  sep: ',' | '&' | '|' | null;
}

type Token =
  | { type: 'lparen' }
  | { type: 'rparen' }
  | { type: 'keyword'; word: 'AND' | 'OR' | 'NOT' }
  | { type: 'term'; negated: boolean; field: string | null; symbol: string | null; segments: Segment[] };

const OPERATOR_CHARS = ':=!<>~^';
const VALUE_STOP = ' \t\n\r(),&|"';

export function tokenize(input: string, lookup?: FieldLookup): Token[] {
  const tokens: Token[] = [];
  const n = input.length;
  let i = 0;

  const readQuoted = (): string => {
    // Assumes input[i] === '"'.
    i += 1;
    let out = '';
    while (i < n && input[i] !== '"') {
      if (input[i] === '\\' && i + 1 < n) {
        out += input[i + 1];
        i += 2;
        continue;
      }
      out += input[i];
      i += 1;
    }
    if (i < n) i += 1; // closing quote
    return out;
  };

  const readSegments = (numeric = false): Segment[] => {
    const segments: Segment[] = [];
    let sep: ',' | '&' | '|' | null = null;
    for (;;) {
      let text = '';
      let quoted = false;
      if (i < n && input[i] === '"') {
        text = readQuoted();
        quoted = true;
      } else {
        let depth = 0;
        while (i < n) {
          if (numeric && input[i] === '(') { depth++; }
          else if (numeric && input[i] === ')' && depth) { depth--; }
          else if (numeric && /\s/.test(input[i])) {
            const rest = input.slice(i).trimStart();
            if (!depth && !/[+*/-]$/.test(text.trim()) && (!/^[+*/-]/.test(rest) || /^-[a-z_]\w*\s*[:=!<>~^]/i.test(rest))) break;
          } else if (VALUE_STOP.includes(input[i])) break;
          text += input[i];
          i += 1;
        }
      }
      segments.push({ text, quoted, sep });
      if (i < n && (input[i] === ',' || input[i] === '&' || input[i] === '|')) {
        sep = input[i] as ',' | '&' | '|';
        i += 1;
        continue;
      }
      break;
    }
    return segments;
  };

  while (i < n) {
    const char = input[i];
    if (/\s/.test(char)) {
      i += 1;
      continue;
    }
    if (char === '(') { tokens.push({ type: 'lparen' }); i += 1; continue; }
    if (char === ')') { tokens.push({ type: 'rparen' }); i += 1; continue; }

    let negated = false;
    if (char === '-' && i + 1 < n && !/\s/.test(input[i + 1])) {
      negated = true;
      i += 1;
      if (input[i] === '(') {
        tokens.push({ type: 'keyword', word: 'NOT' });
        continue;
      }
    }

    if (input[i] === '"') {
      const text = readQuoted();
      tokens.push({ type: 'term', negated, field: null, symbol: null, segments: [{ text, quoted: true, sep: null }] });
      continue;
    }

    let head = '';
    while (i < n && !/\s/.test(input[i]) && !'()"'.includes(input[i]) && !OPERATOR_CHARS.includes(input[i])) {
      head += input[i];
      i += 1;
    }

    const afterHead = i;
    while (i < n && /\s/.test(input[i])) i++;
    if (i < n && OPERATOR_CHARS.includes(input[i]) && head !== '') {
      let symbol = input[i];
      i += 1;
      if ((symbol === '!' || symbol === '<' || symbol === '>') && input[i] === '=') {
        symbol += '=';
        i += 1;
      }
      if (symbol === '!') symbol = '!=';
      while (i < n && /\s/.test(input[i])) i++;
      const numeric = lookup?.resolve(head)?.kind === 'number' || ['power', 'cooldown', 'ct', 'move_power', 'move_cooldown', 'move_level'].includes(head);
      tokens.push({ type: 'term', negated, field: head, symbol, segments: readSegments(numeric) });
      continue;
    }
    i = afterHead;

    if (head === '') {
      // Something like ">5" with no field: keep it as plain text.
      while (i < n && !/\s/.test(input[i]) && !'()'.includes(input[i])) {
        head += input[i];
        i += 1;
      }
    }

    const upper = head.toUpperCase();
    if (!negated && (upper === 'AND' || upper === 'OR' || upper === 'NOT')) {
      tokens.push({ type: 'keyword', word: upper });
      continue;
    }
    tokens.push({ type: 'term', negated, field: null, symbol: null, segments: [{ text: head, quoted: false, sep: null }] });
  }

  return tokens;
}

export interface ParseResult {
  root: FilterGroup;
  unknownFields: string[];
  /** Invalid input is reported so the UI can retain its last valid results. */
  errors: string[];
  sorts: SortCriterion[];
}

export function parseQuery(input: string, lookup: FieldLookup): ParseResult {
  if (input.length > 8192) return { root: createGroup(), sorts: [], unknownFields: [], errors: ['Query is too long'] };
  const tokens = tokenize(input, lookup);
  let nesting = 0;
  for (const token of tokens) {
    if (token.type === 'lparen' && ++nesting > 20) return { root: createGroup(), sorts: [], unknownFields: [], errors: ['Too many nested groups'] };
    if (token.type === 'rparen') nesting--;
  }
  const unknown = new Set<string>();
  const errors: string[] = [];
  const sorts: SortCriterion[] = [];
  const moveLookup = new FieldLookup(MOVE_FIELDS);
  let currentLookup = lookup;
  let depth = 0;
  let position = 0;

  const peek = (): Token | undefined => tokens[position];
  const next = (): Token | undefined => tokens[position++];

  const negateNode = (node: FilterNode): FilterNode => {
    if (node.type === 'group') {
      node.negate = !node.negate;
      return node;
    }
    node.op = operatorDef(node.op).negated;
    return node;
  };

  const termToRules = (term: Extract<Token, { type: 'term' }>): FilterRule[] => {
    const values = term.segments.map((segment) => segment.text.trim()).filter((value) => value !== '');
    const star = term.segments.length === 1 && !term.segments[0].quoted && term.segments[0].text === '*';

    if (term.field === null) {
      return [createRule(currentLookup === moveLookup ? 'move_name' : ANY_FIELD, term.negated ? 'not_contains' : 'contains', values)];
    }

    const fieldName = term.field.toLowerCase();
    if (fieldName === 'sort') {
      if (term.symbol !== ':') errors.push('Use sort:field or sort:-field');
      if (depth || term.negated) errors.push('Sort belongs outside filter groups');
      if (!values.length) errors.push('Sort needs a field');
      for (const value of values) {
        const field = lookup.resolve(value.replace(/^[-+]/, ''));
        if (!field || field.key === ANY_FIELD) errors.push(`Unknown sort field "${value}"`);
        else if (sorts.some(sort => sort.field === field.key)) errors.push(`"${field.label}" is sorted more than once`);
        else sorts.push({ field: field.key, direction: value.startsWith('-') ? 'desc' : 'asc' });
      }
      return [];
    }
    if (fieldName === 'is' || fieldName === 'has') {
      return values.map((value) => {
        const lower = value.toLowerCase();
        if (lower === 'male' || lower === 'female') {
          return createRule('gender', term.negated ? 'is_not' : 'is', [lower === 'male' ? 'Male' : 'Female']);
        }
        const field = currentLookup.resolve(value);
        if (!field) {
          unknown.add(value);
          errors.push(`Unknown field "${value}"`);
          return createRule(value, 'is_true');
        }
        const op: Operator = field.kind === 'boolean' ? 'is_true' : 'not_empty';
        return createRule(field.key, term.negated ? operatorDef(op).negated : op);
      });
    }

    const field = currentLookup.resolve(term.field);
    if (!field) {
      unknown.add(term.field);
      errors.push(`Unknown field "${term.field}"`);
      return [createRule(term.field, 'contains', values)];
    }
    if (!star && values.length === 0) {
      errors.push(`"${term.field}" needs a value`);
    }

    const symbol = term.symbol ?? ':';
    let op: Operator;
    let ruleValues = values;

    if (star) {
      op = 'not_empty';
      ruleValues = [];
    } else if (field.kind === 'boolean') {
      const first = (values[0] ?? '').toLowerCase();
      if (!['yes', 'true', '1', 'on', 'y', 'no', 'false', '0', 'off', 'n'].includes(first)) errors.push(`"${term.field}" expects yes or no`);
      const falsy = ['no', 'false', '0', 'off', 'n'].includes(first);
      op = falsy ? 'is_false' : 'is_true';
      if (symbol === '!=') op = operatorDef(op).negated;
      ruleValues = [];
    } else if (field.kind === 'number') {
      const range = values.length === 1 ? /^(-?[\d.]*)\.\.(-?[\d.]*)$/.exec(values[0]) : null;
      if (range && (symbol === ':' || symbol === '=')) {
        op = 'between';
        ruleValues = [range[1], range[2]];
      } else {
        for (const value of values) {
          const error = numericExpression(value, currentLookup).error;
          if (error) errors.push(`${field.label}: ${error}`);
        }
        if (symbol === '^' || symbol === '~') errors.push(`"${symbol}" does not work on numbers ("${term.field}")`);
        switch (symbol) {
          case '!=': op = 'neq'; break;
          case '>': op = 'gt'; break;
          case '>=': op = 'gte'; break;
          case '<': op = 'lt'; break;
          case '<=': op = 'lte'; break;
          default: op = 'eq';
        }
      }
    } else if (field.kind === 'list') {
      // a,b and a&b need every value; a|b accepts any of them.
      const any = term.segments.some((segment) => segment.sep === '|');
      op = symbol === '!=' ? (any ? 'has_none' : 'not_has_all') : any ? 'has_any' : 'has_all';
      if (symbol === '>' || symbol === '>=' || symbol === '<' || symbol === '<=') errors.push(`"${symbol}" does not work on "${term.field}"; use ${term.field}:a,b (all) or ${term.field}:a|b (any)`);
    } else {
      if (symbol === '>' || symbol === '>=' || symbol === '<' || symbol === '<=') errors.push(`"${symbol}" does not work on text ("${term.field}")`);
      switch (symbol) {
        case '=': op = 'is'; break;
        case '!=': op = 'is_not'; break;
        case '^': op = 'starts'; break;
        case '~': op = 'regex'; break;
        default: op = 'contains';
      }
    }

    if (term.negated) op = operatorDef(op).negated;
    if (operatorDef(op).arity === 'one' && ruleValues.length > 1) errors.push(`"${term.field}" expects one value for this comparison`);
    return [createRule(field.key, op, ruleValues)];
  };

  const parseUnary = (): FilterNode[] => {
    const token = next();
    if (!token) return [];
    if (token.type === 'keyword') {
      if (token.word === 'NOT') {
        const nodes = parseUnary();
        if (nodes.length === 1) return [negateNode(nodes[0])];
        if (nodes.length > 1) return [createGroup('and', nodes, true)];
        errors.push('Add a condition after NOT');
        return [];
      }
      errors.push(`Add a condition before ${token.word}`);
      return [];
    }
    if (token.type === 'lparen') {
      depth++;
      const inner = parseOr();
      if (peek()?.type === 'rparen') next(); else errors.push('Missing closing parenthesis');
      depth--;
      return inner ? [inner] : [];
    }
    if (token.type === 'rparen') return [];
    const scope = /^(equipped|known|unlearned)_moves?$/.exec(token.field ?? '');
    if (scope && peek()?.type === 'lparen') {
      if (currentLookup === moveLookup) errors.push('Move groups cannot contain another move group');
      next(); depth++;
      const previous = currentLookup;
      currentLookup = moveLookup;
      const inner = parseOr();
      currentLookup = previous;
      if (peek()?.type === 'rparen') next(); else errors.push('Missing closing parenthesis for moves');
      depth--;
      const group = inner?.type === 'group' && !inner.scope && !inner.negate ? inner : createGroup('and', inner ? [inner] : []);
      group.scope = scope[1] as MoveScope;
      group.match = token.symbol === '=' ? 'all' : token.symbol === '!=' ? 'none' : 'any';
      group.negate = token.negated;
      if (!inner) errors.push('Add a condition inside the move group');
      return [group];
    }
    return termToRules(token);
  };

  const parseAnd = (): FilterNode | null => {
    const nodes: FilterNode[] = [];
    for (;;) {
      const token = peek();
      if (!token || token.type === 'rparen' || (token.type === 'keyword' && token.word === 'OR')) break;
      if (token.type === 'keyword' && token.word === 'AND') {
        next();
        if (!nodes.length || !peek() || peek()?.type === 'rparen' || (peek()?.type === 'keyword' && (peek() as { word: string }).word !== 'NOT')) errors.push('AND needs a condition on each side');
        continue;
      }
      nodes.push(...parseUnary());
    }
    if (nodes.length === 0) return null;
    if (nodes.length === 1) return nodes[0];
    return createGroup('and', nodes);
  };

  const parseOr = (): FilterNode | null => {
    const branches: FilterNode[] = [];
    const first = parseAnd();
    if (first) branches.push(first);
    while (peek()?.type === 'keyword' && (peek() as { word: string }).word === 'OR') {
      next();
      const branch = parseAnd();
      if (!branches.length || !branch) errors.push('OR needs a condition on each side');
      if (branch) branches.push(branch);
    }
    if (branches.length === 0) return null;
    if (branches.length === 1) return branches[0];
    return createGroup('or', branches);
  };

  const top: FilterNode[] = [];
  while (position < tokens.length) {
    const node = parseOr();
    if (node) top.push(node);
    if (peek()?.type === 'rparen') { next(); errors.push('Unexpected closing parenthesis'); }
  }

  let root: FilterGroup;
  if (top.length === 1 && top[0].type === 'group' && !top[0].negate && !top[0].scope) {
    root = top[0];
  } else {
    root = createGroup('and', top);
  }
  let quoted = false;
  for (let i = 0; i < input.length; i++) { if (input[i] === '\\' && quoted) i++; else if (input[i] === '"') quoted = !quoted; }
  if (quoted) errors.push('Missing closing quote');
  const last = tokens[tokens.length - 1];
  if (last?.type === 'keyword') errors.push(`Add a condition after ${last.word}`);
  return { root, sorts, unknownFields: Array.from(unknown), errors: Array.from(new Set(errors)) };
}

const KEYWORDS = /^(and|or|not)$/i;

export function quoteValue(value: string): string {
  const needsQuote = value === ''
    || /[\s"(),&|:=!<>~^]/.test(value)
    || value.startsWith('-')
    || value === '*'
    || KEYWORDS.test(value);
  return needsQuote ? `"${value.replace(/\\/g, '\\\\').replace(/"/g, '\\"')}"` : value;
}

export function serializeQuery(root: FilterGroup, lookup: FieldLookup, sorts: SortCriterion[] = []): string {
  return [serializeGroup(root, lookup, true), sorts.length ? `sort:${sorts.map(sort => `${sort.direction === 'desc' ? '-' : ''}${sort.field}`).join(',')}` : ''].filter(Boolean).join(' ');
}

function serializeGroup(group: FilterGroup, lookup: FieldLookup, isRoot: boolean): string {
  if (group.scope) lookup = new FieldLookup(MOVE_FIELDS);
  const parts = group.children
    .map((child) => child.type === 'rule' ? serializeRule(child, lookup) : serializeGroup(child, lookup, false))
    .filter((part) => part !== '');
  const joined = group.combinator === 'and' ? parts.join(' ') : parts.join(' OR ');
  if (parts.length === 0) return '';
  if (group.scope) return `${group.negate ? '-' : ''}${group.scope}_move${group.match === 'all' ? '=' : group.match === 'none' ? '!=' : ':'}(${joined})`;
  if (isRoot && !group.negate) return joined;
  return `${group.negate ? '-' : ''}(${joined})`;
}

export function serializeRule(rule: FilterRule, lookup: FieldLookup): string {
  if (!isRuleActive(rule)) return '';
  const field = lookup.byKey.get(rule.field);
  const name = field ? field.key : rule.field;
  const values = rule.values.map((value) => value.trim());
  const list = (sep: ',' | '|') => values.map(quoteValue).join(sep);
  const single = quoteValue(values[0] ?? '');

  switch (rule.op) {
    case 'contains':
      if (rule.field === ANY_FIELD && values.length === 1) return single;
      return `${name}:${list(',')}`;
    case 'not_contains':
      if (rule.field === ANY_FIELD && values.length === 1) return `-${single}`;
      return `-${name}:${list(',')}`;
    case 'is': return `${name}=${list(',')}`;
    case 'is_not': return `${name}!=${list(',')}`;
    case 'starts': return `${name}^${list(',')}`;
    case 'not_starts': return `-${name}^${list(',')}`;
    case 'regex': return `${name}~${single}`;
    case 'not_regex': return `-${name}~${single}`;
    case 'eq': return `${name}:${list(',')}`;
    case 'neq': return `${name}!=${list(',')}`;
    case 'gt': return `${name}>${single}`;
    case 'gte': return `${name}>=${single}`;
    case 'lt': return `${name}<${single}`;
    case 'lte': return `${name}<=${single}`;
    case 'between': return `${name}:${values[0] ?? ''}..${values[1] ?? ''}`;
    case 'not_between': return `-${name}:${values[0] ?? ''}..${values[1] ?? ''}`;
    case 'has_any': return `${name}:${list('|')}`;
    case 'has_all': return `${name}:${list(',')}`;
    case 'has_none': return `-${name}:${list('|')}`;
    case 'not_has_all': return `-${name}:${list(',')}`;
    case 'is_true': return field?.kind === 'boolean' ? `is:${name}` : `${name}:*`;
    case 'is_false': return field?.kind === 'boolean' ? `-is:${name}` : `-${name}:*`;
    case 'not_empty': return `${name}:*`;
    case 'empty': return `-${name}:*`;
    default: return '';
  }
}

/* ------------------------------------------------------------------------ */
/* Caret-aware completion context for the search box                        */
/* ------------------------------------------------------------------------ */

export interface CompletionContext {
  /** Index in the input where the current term starts (after any leading "-"). */
  termStart: number;
  /** Index where the current value segment starts (== termStart in field mode). */
  segmentStart: number;
  caret: number;
  mode: 'field' | 'value';
  field: string | null;
  symbol: string | null;
  /** Text typed so far for the current field name or value segment. */
  prefix: string;
  inQuotes: boolean;
}

export function completionContext(input: string, caret: number): CompletionContext | null {
  const before = input.slice(0, caret);

  // Walk back to the start of the current term, honoring quotes.
  let inQuotes = false;
  let termStart = 0;
  for (let index = 0; index < before.length; index += 1) {
    const char = before[index];
    if (char === '"') inQuotes = !inQuotes;
    if (!inQuotes && (/\s/.test(char) || char === '(' || char === ')')) termStart = index + 1;
  }
  let term = before.slice(termStart);
  if (term.startsWith('-')) {
    termStart += 1;
    term = term.slice(1);
  }

  const match = /^([A-Za-z_][\w]*)(:|=|!=|>=|<=|>|<|~|\^)(.*)$/s.exec(term);
  if (!match) {
    if (/[^\w]/.test(term.replace(/^"/, ''))) return null;
    return { termStart, segmentStart: termStart, caret, mode: 'field', field: null, symbol: null, prefix: term, inQuotes: false };
  }

  const valueText = match[3];
  let segmentStart = termStart + match[1].length + match[2].length;
  let quotes = false;
  for (let index = 0; index < valueText.length; index += 1) {
    const char = valueText[index];
    if (char === '"') quotes = !quotes;
    if (!quotes && (char === ',' || char === '&' || char === '|')) segmentStart = termStart + match[1].length + match[2].length + index + 1;
  }
  let prefix = input.slice(segmentStart, caret);
  const quoted = prefix.startsWith('"');
  if (quoted) prefix = prefix.slice(1).replace(/"$/, '');
  return {
    termStart,
    segmentStart,
    caret,
    mode: 'value',
    field: match[1],
    symbol: match[2],
    prefix,
    inQuotes: quoted
  };
}
