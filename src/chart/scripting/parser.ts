import {
  Token,
  TokenType,
  ASTNode,
  NumberLiteral,
  StringLiteral,
  Identifier,
  HexColorLiteral,
  BinaryExpr,
  UnaryExpr,
  Ternary,
  Assignment,
  FunctionCall,
  IndexExpr,
  InputDecl,
  PlotCall,
  HLineCall,
  FillCall,
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
        // Skip to next line to recover
        this.skipToNewline();
      }
      this.skipNewlines();
    }

    return { statements, errors: this.errors };
  }

  // ─── Statement Parsing ──────────────────────────────────────────────────

  private parseStatement(): ASTNode | null {
    const tok = this.current();

    if (tok.type === TokenType.KW_Input) {
      return this.parseInputDecl();
    }
    if (tok.type === TokenType.KW_Plot) {
      return this.parsePlotCall();
    }
    if (tok.type === TokenType.KW_HLine) {
      return this.parseHLineCall();
    }
    if (tok.type === TokenType.KW_Fill) {
      return this.parseFillCall();
    }

    // Assignment: identifier = expr
    if (
      tok.type === TokenType.Identifier &&
      this.peekType(1) === TokenType.Equals &&
      this.peekType(2) !== TokenType.Equals // not ==
    ) {
      return this.parseAssignment();
    }

    // Otherwise treat as expression statement (e.g. bare function call)
    return this.parseExpr();
  }

  private parseInputDecl(): InputDecl {
    const line = this.current().line;
    this.expect(TokenType.KW_Input); // consume "input"
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

  private parsePlotCall(): PlotCall {
    const line = this.current().line;
    this.advance(); // consume "plot"
    this.expect(TokenType.LParen);
    const expr = this.parseExpr();
    let label: ASTNode | null = null;
    const namedArgs: NamedArg[] = [];

    while (this.check(TokenType.Comma)) {
      this.advance(); // consume comma
      // Check for named arg: identifier=value
      if (this.isNamedArg()) {
        namedArgs.push(this.parseNamedArg());
      } else {
        // Positional: must be the label
        if (!label) {
          label = this.parseExpr();
        } else {
          // Extra positional, treat as named
          namedArgs.push(this.parseNamedArg());
        }
      }
    }

    this.expect(TokenType.RParen);
    return { kind: 'PlotCall', expr, label, namedArgs, line };
  }

  private parseHLineCall(): HLineCall {
    const line = this.current().line;
    this.advance(); // consume "hline"
    this.expect(TokenType.LParen);
    const value = this.parseExpr();
    const namedArgs: NamedArg[] = [];

    while (this.check(TokenType.Comma)) {
      this.advance(); // consume comma
      if (this.isNamedArg()) {
        namedArgs.push(this.parseNamedArg());
      }
    }

    this.expect(TokenType.RParen);
    return { kind: 'HLineCall', value, namedArgs, line };
  }

  private parseFillCall(): FillCall {
    const line = this.current().line;
    this.advance(); // consume "fill"
    this.expect(TokenType.LParen);
    const plotA = this.parseExpr();
    this.expect(TokenType.Comma);
    const plotB = this.parseExpr();
    const namedArgs: NamedArg[] = [];

    while (this.check(TokenType.Comma)) {
      this.advance(); // consume comma
      if (this.isNamedArg()) {
        namedArgs.push(this.parseNamedArg());
      }
    }

    this.expect(TokenType.RParen);
    return { kind: 'FillCall', plotA, plotB, namedArgs, line };
  }

  // ─── Expression Parsing (Precedence Climbing) ──────────────────────────

  private parseExpr(): ASTNode {
    return this.parseTernary();
  }

  private parseTernary(): ASTNode {
    let node = this.parseOr();
    if (this.check(TokenType.Question)) {
      const line = this.current().line;
      this.advance(); // consume ?
      const trueExpr = this.parseExpr();
      this.expect(TokenType.Colon);
      const falseExpr = this.parseExpr();
      node = { kind: 'Ternary', condition: node, trueExpr, falseExpr, line } as Ternary;
    }
    return node;
  }

  private parseOr(): ASTNode {
    let left = this.parseAnd();
    while (this.check(TokenType.Or)) {
      const line = this.current().line;
      this.advance();
      const right = this.parseAnd();
      left = { kind: 'BinaryExpr', op: '||', left, right, line } as BinaryExpr;
    }
    return left;
  }

  private parseAnd(): ASTNode {
    let left = this.parseComparison();
    while (this.check(TokenType.And)) {
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
    if (this.check(TokenType.Minus) || this.check(TokenType.Not)) {
      const op = this.current().value;
      const line = this.current().line;
      this.advance();
      const operand = this.parseUnary();
      return { kind: 'UnaryExpr', op, operand, line } as UnaryExpr;
    }
    return this.parsePostfix();
  }

  private parsePostfix(): ASTNode {
    let node = this.parsePrimary();

    // Handle index access: identifier[offset]
    while (this.check(TokenType.LBracket)) {
      const line = this.current().line;
      this.advance(); // consume [
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

    // Identifier — may be function call
    if (tok.type === TokenType.Identifier) {
      this.advance();
      // Function call
      if (this.check(TokenType.LParen)) {
        return this.parseFunctionCallArgs(tok.value, tok.line);
      }
      return { kind: 'Identifier', name: tok.value, line: tok.line } as Identifier;
    }

    // Parenthesized expression
    if (tok.type === TokenType.LParen) {
      this.advance(); // consume (
      const expr = this.parseExpr();
      this.expect(TokenType.RParen);
      return expr;
    }

    throw new Error(`Unexpected token: ${tok.type} "${tok.value}"`);
  }

  private parseFunctionCallArgs(name: string, line: number): FunctionCall {
    this.expect(TokenType.LParen);
    const args: ASTNode[] = [];

    if (!this.check(TokenType.RParen)) {
      args.push(this.parseExpr());
      while (this.check(TokenType.Comma)) {
        this.advance(); // consume comma
        args.push(this.parseExpr());
      }
    }

    this.expect(TokenType.RParen);
    return { kind: 'FunctionCall', name, args, line };
  }

  // ─── Named Arg Parsing ─────────────────────────────────────────────────

  /**
   * Check whether the current position looks like `identifier=value`
   * (where the `=` is a single `=`, not `==`).
   */
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
      throw new Error(`Expected ${type} but got ${tok.type} ("${tok.value}")`);
    }
    this.pos++;
    return tok;
  }

  private isAtEnd(): boolean {
    return this.current().type === TokenType.EOF;
  }

  private skipNewlines(): void {
    while (this.current().type === TokenType.Newline) {
      this.advance();
    }
  }

  private skipToNewline(): void {
    while (
      !this.isAtEnd() &&
      this.current().type !== TokenType.Newline
    ) {
      this.advance();
    }
  }
}
