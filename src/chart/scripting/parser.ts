import {
  Token,
  TokenType,
  ASTNode,
  NumberLiteral,
  StringLiteral,
  Identifier,
  HexColorLiteral,
  BooleanLiteral,
  BinaryExpr,
  UnaryExpr,
  Ternary,
  Assignment,
  Reassignment,
  FunctionCall,
  NamespacedCall,
  IndexExpr,
  InputDecl,
  PlotCall,
  HLineCall,
  FillCall,
  PlotShapeCall,
  BgColorCall,
  IfStatement,
  ForStatement,
  WhileStatement,
  VarDecl,
  FunctionDef,
  ReturnStatement,
  NamedArg,
} from './types';
import type { ScriptError } from '../types';

export class Parser {
  private tokens: Token[];
  private pos = 0;
  private errors: ScriptError[] = [];

  constructor(tokens: Token[]) {
    this.tokens = tokens;
  }

  parse(): { statements: ASTNode[]; errors: ScriptError[] } {
    const statements: ASTNode[] = [];
    this.skipNewlines();

    while (!this.isAtEnd()) {
      try {
        const stmt = this.parseStatement();
        if (stmt) statements.push(stmt);
      } catch (e: unknown) {
        const msg = e instanceof Error ? e.message : String(e);
        this.errors.push({ line: this.current().line, message: msg });
        this.skipToNewline();
      }
      this.skipNewlines();
    }

    return { statements, errors: this.errors };
  }

  // ─── Statement Parsing ──────────────────────────────────────────────────

  private parseStatement(): ASTNode | null {
    const tok = this.current();

    // ── Block-structural tokens that shouldn't appear at statement level ──
    if (tok.type === TokenType.Indent || tok.type === TokenType.Dedent) {
      this.advance();
      return null;
    }

    // ── Keyword statements ────────────────────────────────────────────────
    if (tok.type === TokenType.KW_If) return this.parseIfStatement();
    if (tok.type === TokenType.KW_For) return this.parseForStatement();
    if (tok.type === TokenType.KW_While) return this.parseWhileStatement();
    if (tok.type === TokenType.KW_Var) return this.parseVarDecl();
    if (tok.type === TokenType.KW_Return) return this.parseReturnStatement();
    if (tok.type === TokenType.KW_Input) return this.parseInputDecl();
    if (tok.type === TokenType.KW_Plot) return this.parsePlotCall();
    if (tok.type === TokenType.KW_HLine) return this.parseHLineCall();
    if (tok.type === TokenType.KW_Fill) return this.parseFillCall();
    if (tok.type === TokenType.KW_PlotShape) return this.parsePlotShapeCall();
    if (tok.type === TokenType.KW_BgColor) return this.parseBgColorCall();

    // ── indicator("Name", overlay=...) and strategy("Name", ...) ─────────
    if (
      tok.type === TokenType.KW_Indicator ||
      tok.type === TokenType.KW_Strategy
    ) {
      return this.parseIndicatorOrStrategyDecl();
    }

    // ── Function definition: name(params) =>\n  body ─────────────────────
    if (this.isFunctionDef()) return this.parseFunctionDef();

    // ── Reassignment: name := expr ────────────────────────────────────────
    if (
      tok.type === TokenType.Identifier &&
      this.peekType(1) === TokenType.ColonEquals
    ) {
      return this.parseReassignment();
    }

    // ── Assignment: name = expr (not ==) ─────────────────────────────────
    if (
      tok.type === TokenType.Identifier &&
      this.peekType(1) === TokenType.Equals &&
      this.peekType(2) !== TokenType.Equals
    ) {
      return this.parseAssignment();
    }

    // ── Expression statement (bare function call, etc.) ───────────────────
    return this.parseExpr();
  }

  // ─── Control Flow ───────────────────────────────────────────────────────

  private parseIfStatement(): IfStatement {
    const line = this.current().line;
    this.expect(TokenType.KW_If);
    const condition = this.parseExpr();
    this.skipNewlines();
    this.expect(TokenType.Indent);
    const thenBody = this.parseBlock();
    this.expect(TokenType.Dedent);

    let elseBody: ASTNode[] | null = null;

    if (this.check(TokenType.KW_Else)) {
      this.advance(); // consume "else"

      if (this.check(TokenType.KW_If)) {
        // else if → recursively parse another IfStatement as the else body
        elseBody = [this.parseIfStatement()];
      } else {
        this.skipNewlines();
        this.expect(TokenType.Indent);
        elseBody = this.parseBlock();
        this.expect(TokenType.Dedent);
      }
    }

    return { kind: 'IfStatement', condition, thenBody, elseBody, line };
  }

  private parseForStatement(): ForStatement {
    const line = this.current().line;
    this.expect(TokenType.KW_For);
    const varName = this.expect(TokenType.Identifier).value;
    this.expect(TokenType.Equals);
    const from = this.parseExpr();
    this.expect(TokenType.KW_To);
    const to = this.parseExpr();

    let step: ASTNode | null = null;
    if (this.check(TokenType.KW_By)) {
      this.advance();
      step = this.parseExpr();
    }

    this.skipNewlines();
    this.expect(TokenType.Indent);
    const body = this.parseBlock();
    this.expect(TokenType.Dedent);

    return { kind: 'ForStatement', varName, from, to, step, body, line };
  }

  private parseWhileStatement(): WhileStatement {
    const line = this.current().line;
    this.expect(TokenType.KW_While);
    const condition = this.parseExpr();
    this.skipNewlines();
    this.expect(TokenType.Indent);
    const body = this.parseBlock();
    this.expect(TokenType.Dedent);
    return { kind: 'WhileStatement', condition, body, line };
  }

  /** Parse a block of statements terminated by Dedent (or EOF). */
  private parseBlock(): ASTNode[] {
    const stmts: ASTNode[] = [];
    this.skipNewlines();

    while (!this.isAtEnd() && !this.check(TokenType.Dedent)) {
      try {
        const stmt = this.parseStatement();
        if (stmt) stmts.push(stmt);
      } catch (e: unknown) {
        const msg = e instanceof Error ? e.message : String(e);
        this.errors.push({ line: this.current().line, message: msg });
        this.skipToNewline();
      }
      this.skipNewlines();
    }

    return stmts;
  }

  // ─── Variable / Function Declarations ───────────────────────────────────

  private parseVarDecl(): VarDecl {
    const line = this.current().line;
    this.expect(TokenType.KW_Var);
    const name = this.expect(TokenType.Identifier).value;
    this.expect(TokenType.Equals);
    const value = this.parseExpr();
    return { kind: 'VarDecl', name, value, line };
  }

  private parseReturnStatement(): ReturnStatement {
    const line = this.current().line;
    this.expect(TokenType.KW_Return);
    const value = this.parseExpr();
    return { kind: 'ReturnStatement', value, line };
  }

  /**
   * Detect whether the current position begins a function definition:
   * name(params) => ...
   */
  private isFunctionDef(): boolean {
    if (this.current().type !== TokenType.Identifier) return false;
    if (this.peekType(1) !== TokenType.LParen) return false;

    // Scan ahead past the argument list to find the matching RParen
    let depth = 0;
    let j = 1;
    while (this.pos + j < this.tokens.length) {
      const t = this.peekType(j);
      if (t === TokenType.LParen) depth++;
      else if (t === TokenType.RParen) {
        depth--;
        if (depth === 0) {
          // Check what follows the RParen
          return this.peekType(j + 1) === TokenType.FatArrow;
        }
      } else if (t === TokenType.EOF || t === TokenType.Newline) {
        return false;
      }
      j++;
    }
    return false;
  }

  private parseFunctionDef(): FunctionDef {
    const line = this.current().line;
    const name = this.expect(TokenType.Identifier).value;
    this.expect(TokenType.LParen);

    const params: string[] = [];
    if (!this.check(TokenType.RParen)) {
      params.push(this.expect(TokenType.Identifier).value);
      while (this.check(TokenType.Comma)) {
        this.advance();
        params.push(this.expect(TokenType.Identifier).value);
      }
    }
    this.expect(TokenType.RParen);
    this.expect(TokenType.FatArrow);

    // Single-line: f(x) => expr
    if (!this.check(TokenType.Newline) && !this.check(TokenType.Indent)) {
      const expr = this.parseExpr();
      return { kind: 'FunctionDef', name, params, body: [expr], line };
    }

    // Multi-line: f(x) =>\n    body
    this.skipNewlines();
    this.expect(TokenType.Indent);
    const body = this.parseBlock();
    this.expect(TokenType.Dedent);
    return { kind: 'FunctionDef', name, params, body, line };
  }

  // ─── Assignment Statements ───────────────────────────────────────────────

  private parseInputDecl(): InputDecl {
    const line = this.current().line;
    this.expect(TokenType.KW_Input);
    const name = this.expect(TokenType.Identifier).value;
    this.expect(TokenType.Equals);
    const defaultValue = this.parseExpr();
    return { kind: 'InputDecl', name, defaultValue, line };
  }

  private parseAssignment(): Assignment {
    const line = this.current().line;
    const name = this.expect(TokenType.Identifier).value;
    this.expect(TokenType.Equals);
    const value = this.parseExpr();
    return { kind: 'Assignment', name, value, line };
  }

  private parseReassignment(): Reassignment {
    const line = this.current().line;
    const name = this.expect(TokenType.Identifier).value;
    this.expect(TokenType.ColonEquals);
    const value = this.parseExpr();
    return { kind: 'Reassignment', name, value, line };
  }

  // ─── Indicator / Strategy Declaration ───────────────────────────────────

  private parseIndicatorOrStrategyDecl(): FunctionCall {
    const line = this.current().line;
    const kw = this.current();
    this.advance(); // consume "indicator" or "strategy"
    const name = kw.type === TokenType.KW_Indicator ? 'indicator' : 'strategy';

    if (!this.check(TokenType.LParen)) {
      return { kind: 'FunctionCall', name, args: [], namedArgs: [], line };
    }

    this.expect(TokenType.LParen);
    const { args, namedArgs } = this.parseArgList();
    this.expect(TokenType.RParen);
    return { kind: 'FunctionCall', name, args, namedArgs, line };
  }

  // ─── Plot Statements ────────────────────────────────────────────────────

  private parsePlotCall(): PlotCall {
    const line = this.current().line;
    this.advance(); // consume "plot"
    this.expect(TokenType.LParen);
    const expr = this.parseExpr();
    let label: ASTNode | null = null;
    const namedArgs: NamedArg[] = [];

    while (this.check(TokenType.Comma)) {
      this.advance();
      if (this.isNamedArg()) {
        namedArgs.push(this.parseNamedArg());
      } else if (!label) {
        label = this.parseExpr();
      } else {
        namedArgs.push(this.parseNamedArg());
      }
    }

    this.expect(TokenType.RParen);
    return { kind: 'PlotCall', expr, label, namedArgs, line };
  }

  private parseHLineCall(): HLineCall {
    const line = this.current().line;
    this.advance();
    this.expect(TokenType.LParen);
    const value = this.parseExpr();
    const namedArgs: NamedArg[] = [];

    while (this.check(TokenType.Comma)) {
      this.advance();
      if (this.isNamedArg()) namedArgs.push(this.parseNamedArg());
    }

    this.expect(TokenType.RParen);
    return { kind: 'HLineCall', value, namedArgs, line };
  }

  private parseFillCall(): FillCall {
    const line = this.current().line;
    this.advance();
    this.expect(TokenType.LParen);
    const plotA = this.parseExpr();
    this.expect(TokenType.Comma);
    const plotB = this.parseExpr();
    const namedArgs: NamedArg[] = [];

    while (this.check(TokenType.Comma)) {
      this.advance();
      if (this.isNamedArg()) namedArgs.push(this.parseNamedArg());
    }

    this.expect(TokenType.RParen);
    return { kind: 'FillCall', plotA, plotB, namedArgs, line };
  }

  private parsePlotShapeCall(): PlotShapeCall {
    const line = this.current().line;
    this.advance(); // consume "plotshape"
    this.expect(TokenType.LParen);
    const series = this.parseExpr();
    const namedArgs: NamedArg[] = [];

    while (this.check(TokenType.Comma)) {
      this.advance();
      if (this.isNamedArg()) {
        namedArgs.push(this.parseNamedArg());
      } else {
        // Extra positional — treat as positional (ignore or store)
        this.parseExpr();
      }
    }

    this.expect(TokenType.RParen);
    return { kind: 'PlotShapeCall', series, namedArgs, line };
  }

  private parseBgColorCall(): BgColorCall {
    const line = this.current().line;
    this.advance(); // consume "bgcolor"
    this.expect(TokenType.LParen);
    const color = this.parseExpr();
    const namedArgs: NamedArg[] = [];

    while (this.check(TokenType.Comma)) {
      this.advance();
      if (this.isNamedArg()) namedArgs.push(this.parseNamedArg());
    }

    this.expect(TokenType.RParen);
    return { kind: 'BgColorCall', color, namedArgs, line };
  }

  // ─── Expression Parsing (Precedence Climbing) ──────────────────────────

  private parseExpr(): ASTNode {
    return this.parseTernary();
  }

  private parseTernary(): ASTNode {
    let node = this.parseOr();
    if (this.check(TokenType.Question)) {
      const line = this.current().line;
      this.advance();
      const trueExpr = this.parseExpr();
      this.expect(TokenType.Colon);
      const falseExpr = this.parseExpr();
      node = { kind: 'Ternary', condition: node, trueExpr, falseExpr, line } as Ternary;
    }
    return node;
  }

  private parseOr(): ASTNode {
    let left = this.parseAnd();
    while (this.check(TokenType.Or) || this.check(TokenType.KW_Or)) {
      const line = this.current().line;
      this.advance();
      const right = this.parseAnd();
      left = { kind: 'BinaryExpr', op: '||', left, right, line } as BinaryExpr;
    }
    return left;
  }

  private parseAnd(): ASTNode {
    let left = this.parseComparison();
    while (this.check(TokenType.And) || this.check(TokenType.KW_And)) {
      const line = this.current().line;
      this.advance();
      const right = this.parseComparison();
      left = { kind: 'BinaryExpr', op: '&&', left, right, line } as BinaryExpr;
    }
    return left;
  }

  private parseComparison(): ASTNode {
    let left = this.parseAddSub();
    while (
      this.check(TokenType.GT) ||
      this.check(TokenType.LT) ||
      this.check(TokenType.GTE) ||
      this.check(TokenType.LTE) ||
      this.check(TokenType.EqEq) ||
      this.check(TokenType.NotEq)
    ) {
      const op = this.current().value;
      const line = this.current().line;
      this.advance();
      const right = this.parseAddSub();
      left = { kind: 'BinaryExpr', op, left, right, line } as BinaryExpr;
    }
    return left;
  }

  private parseAddSub(): ASTNode {
    let left = this.parseMulDiv();
    while (this.check(TokenType.Plus) || this.check(TokenType.Minus)) {
      const op = this.current().value;
      const line = this.current().line;
      this.advance();
      const right = this.parseMulDiv();
      left = { kind: 'BinaryExpr', op, left, right, line } as BinaryExpr;
    }
    return left;
  }

  private parseMulDiv(): ASTNode {
    let left = this.parseUnary();
    while (
      this.check(TokenType.Star) ||
      this.check(TokenType.Slash) ||
      this.check(TokenType.Percent)
    ) {
      const op = this.current().value;
      const line = this.current().line;
      this.advance();
      const right = this.parseUnary();
      left = { kind: 'BinaryExpr', op, left, right, line } as BinaryExpr;
    }
    return left;
  }

  private parseUnary(): ASTNode {
    if (
      this.check(TokenType.Minus) ||
      this.check(TokenType.Not) ||
      this.check(TokenType.KW_Not)
    ) {
      const op = this.check(TokenType.KW_Not) ? '!' : this.current().value;
      const line = this.current().line;
      this.advance();
      const operand = this.parseUnary();
      return { kind: 'UnaryExpr', op, operand, line } as UnaryExpr;
    }
    return this.parsePostfix();
  }

  private parsePostfix(): ASTNode {
    let node = this.parsePrimary();

    // Index access: series[offset]
    while (this.check(TokenType.LBracket)) {
      const line = this.current().line;
      this.advance();
      const index = this.parseExpr();
      this.expect(TokenType.RBracket);
      node = { kind: 'IndexExpr', object: node, index, line } as IndexExpr;
    }

    return node;
  }

  private parsePrimary(): ASTNode {
    const tok = this.current();

    // Number
    if (tok.type === TokenType.Number) {
      this.advance();
      return { kind: 'NumberLiteral', value: parseFloat(tok.value), line: tok.line } as NumberLiteral;
    }

    // String
    if (tok.type === TokenType.String) {
      this.advance();
      return { kind: 'StringLiteral', value: tok.value, line: tok.line } as StringLiteral;
    }

    // Hex color
    if (tok.type === TokenType.HexColor) {
      this.advance();
      return { kind: 'HexColorLiteral', value: tok.value, line: tok.line } as HexColorLiteral;
    }

    // Boolean literals
    if (tok.type === TokenType.KW_True) {
      this.advance();
      return { kind: 'BooleanLiteral', value: true, line: tok.line } as BooleanLiteral;
    }
    if (tok.type === TokenType.KW_False) {
      this.advance();
      return { kind: 'BooleanLiteral', value: false, line: tok.line } as BooleanLiteral;
    }

    // Identifier — may be a function call or namespaced call
    if (tok.type === TokenType.Identifier) {
      this.advance();

      // Dot-access: namespace.fn(...)
      if (this.check(TokenType.Dot)) {
        this.advance(); // consume .
        const propName = this.expect(TokenType.Identifier).value;
        if (this.check(TokenType.LParen)) {
          return this.parseNamespacedCallArgs(tok.value, propName, tok.line);
        }
        // Property without call — return as an identifier (future: member access)
        return { kind: 'Identifier', name: `${tok.value}.${propName}`, line: tok.line } as Identifier;
      }

      // Function call
      if (this.check(TokenType.LParen)) {
        return this.parseFunctionCallArgs(tok.value, tok.line);
      }

      return { kind: 'Identifier', name: tok.value, line: tok.line } as Identifier;
    }

    // Parenthesized expression
    if (tok.type === TokenType.LParen) {
      this.advance();
      const expr = this.parseExpr();
      this.expect(TokenType.RParen);
      return expr;
    }

    throw new Error(`Unexpected token: ${tok.type} "${tok.value}" at line ${tok.line}`);
  }

  private parseFunctionCallArgs(name: string, line: number): FunctionCall {
    this.expect(TokenType.LParen);
    const { args, namedArgs } = this.parseArgList();
    this.expect(TokenType.RParen);
    return { kind: 'FunctionCall', name, args, namedArgs, line };
  }

  private parseNamespacedCallArgs(namespace: string, fn: string, line: number): NamespacedCall {
    this.expect(TokenType.LParen);
    const { args, namedArgs } = this.parseArgList();
    this.expect(TokenType.RParen);
    return { kind: 'NamespacedCall', namespace, fn, args, namedArgs, line };
  }

  /**
   * Parse a mixed positional + named argument list.
   * Named args: identifier=expr (single = not ==)
   */
  private parseArgList(): { args: ASTNode[]; namedArgs: NamedArg[] } {
    const args: ASTNode[] = [];
    const namedArgs: NamedArg[] = [];

    if (this.check(TokenType.RParen)) {
      return { args, namedArgs };
    }

    // First arg
    if (this.isNamedArg()) {
      namedArgs.push(this.parseNamedArg());
    } else {
      args.push(this.parseExpr());
    }

    while (this.check(TokenType.Comma)) {
      this.advance();
      if (this.check(TokenType.RParen)) break; // trailing comma
      if (this.isNamedArg()) {
        namedArgs.push(this.parseNamedArg());
      } else {
        args.push(this.parseExpr());
      }
    }

    return { args, namedArgs };
  }

  // ─── Named Arg ──────────────────────────────────────────────────────────

  private isNamedArg(): boolean {
    return (
      this.current().type === TokenType.Identifier &&
      this.peekType(1) === TokenType.Equals &&
      this.peekType(2) !== TokenType.Equals
    );
  }

  private parseNamedArg(): NamedArg {
    const name = this.expect(TokenType.Identifier).value;
    this.expect(TokenType.Equals);
    const value = this.parseExpr();
    return { name, value };
  }

  // ─── Utilities ──────────────────────────────────────────────────────────

  private current(): Token {
    return this.tokens[this.pos] ?? { type: TokenType.EOF, value: '', line: 0, col: 0 };
  }

  private check(type: TokenType): boolean {
    return this.current().type === type;
  }

  private peekType(offset: number): TokenType {
    const idx = this.pos + offset;
    return idx < this.tokens.length ? this.tokens[idx].type : TokenType.EOF;
  }

  private advance(): Token {
    const tok = this.current();
    this.pos++;
    return tok;
  }

  private expect(type: TokenType): Token {
    const tok = this.current();
    if (tok.type !== type) {
      throw new Error(`Expected ${type} but got ${tok.type} ("${tok.value}") at line ${tok.line}`);
    }
    this.pos++;
    return tok;
  }

  private isAtEnd(): boolean {
    return this.current().type === TokenType.EOF;
  }

  private skipNewlines(): void {
    while (
      this.current().type === TokenType.Newline ||
      this.current().type === TokenType.LineIndent
    ) {
      this.advance();
    }
  }

  private skipToNewline(): void {
    while (!this.isAtEnd() && this.current().type !== TokenType.Newline) {
      this.advance();
    }
  }
}
