import { Token, TokenType } from './types';

const KEYWORDS: Record<string, TokenType> = {
  input: TokenType.KW_Input,
  plot: TokenType.KW_Plot,
  hline: TokenType.KW_HLine,
  fill: TokenType.KW_Fill,
};

export class Lexer {
  private src: string;
  private pos = 0;
  private line = 1;
  private col = 1;
  private tokens: Token[] = [];

  constructor(source: string) {
    this.src = source;
  }

  tokenize(): Token[] {
    while (this.pos < this.src.length) {
      this.skipSpacesAndTabs();
      if (this.pos >= this.src.length) break;

      const ch = this.src[this.pos];

      // Line comment
      if (ch === '/' && this.peek(1) === '/') {
        this.skipLineComment();
        continue;
      }

      // Newline
      if (ch === '\n') {
        this.pushToken(TokenType.Newline, '\\n');
        this.advance();
        this.line++;
        this.col = 1;
        continue;
      }

      // Carriage return (skip, newline will follow)
      if (ch === '\r') {
        this.advance();
        continue;
      }

      // Hex color literal: #RRGGBB or #RRGGBBAA
      if (ch === '#' && this.isHexDigit(this.peek(1))) {
        this.readHexColor();
        continue;
      }

      // Number
      if (this.isDigit(ch) || (ch === '.' && this.isDigit(this.peek(1)))) {
        this.readNumber();
        continue;
      }

      // String
      if (ch === '"' || ch === "'") {
        this.readString(ch);
        continue;
      }

      // Identifier or keyword
      if (this.isIdentStart(ch)) {
        this.readIdentifier();
        continue;
      }

      // Two-character operators
      const two = this.src.slice(this.pos, this.pos + 2);
      switch (two) {
        case '>=': this.pushToken(TokenType.GTE, '>='); this.advance(); this.advance(); continue;
        case '<=': this.pushToken(TokenType.LTE, '<='); this.advance(); this.advance(); continue;
        case '==': this.pushToken(TokenType.EqEq, '=='); this.advance(); this.advance(); continue;
        case '!=': this.pushToken(TokenType.NotEq, '!='); this.advance(); this.advance(); continue;
        case '&&': this.pushToken(TokenType.And, '&&'); this.advance(); this.advance(); continue;
        case '||': this.pushToken(TokenType.Or, '||'); this.advance(); this.advance(); continue;
      }

      // Single-character tokens
      switch (ch) {
        case '+': this.pushToken(TokenType.Plus, '+'); this.advance(); continue;
        case '-': this.pushToken(TokenType.Minus, '-'); this.advance(); continue;
        case '*': this.pushToken(TokenType.Star, '*'); this.advance(); continue;
        case '/': this.pushToken(TokenType.Slash, '/'); this.advance(); continue;
        case '%': this.pushToken(TokenType.Percent, '%'); this.advance(); continue;
        case '>': this.pushToken(TokenType.GT, '>'); this.advance(); continue;
        case '<': this.pushToken(TokenType.LT, '<'); this.advance(); continue;
        case '!': this.pushToken(TokenType.Not, '!'); this.advance(); continue;
        case '(': this.pushToken(TokenType.LParen, '('); this.advance(); continue;
        case ')': this.pushToken(TokenType.RParen, ')'); this.advance(); continue;
        case '[': this.pushToken(TokenType.LBracket, '['); this.advance(); continue;
        case ']': this.pushToken(TokenType.RBracket, ']'); this.advance(); continue;
        case ',': this.pushToken(TokenType.Comma, ','); this.advance(); continue;
        case '=': this.pushToken(TokenType.Equals, '='); this.advance(); continue;
        case '?': this.pushToken(TokenType.Question, '?'); this.advance(); continue;
        case ':': this.pushToken(TokenType.Colon, ':'); this.advance(); continue;
      }

      // Unknown character — skip with a warning (could collect errors)
      this.advance();
    }

    this.pushToken(TokenType.EOF, '');
    return this.tokens;
  }

  // ─── Helpers ────────────────────────────────────────────────────────────

  private peek(offset: number): string {
    const idx = this.pos + offset;
    return idx < this.src.length ? this.src[idx] : '';
  }

  private advance(): void {
    this.pos++;
    this.col++;
  }

  private pushToken(type: TokenType, value: string): void {
    this.tokens.push({ type, value, line: this.line, col: this.col });
  }

  private skipSpacesAndTabs(): void {
    while (this.pos < this.src.length) {
      const ch = this.src[this.pos];
      if (ch === ' ' || ch === '\t') {
        this.advance();
      } else {
        break;
      }
    }
  }

  private skipLineComment(): void {
    while (this.pos < this.src.length && this.src[this.pos] !== '\n') {
      this.advance();
    }
  }

  private readNumber(): void {
    const startCol = this.col;
    let num = '';
    let hasDot = false;
    while (this.pos < this.src.length) {
      const ch = this.src[this.pos];
      if (this.isDigit(ch)) {
        num += ch;
        this.advance();
      } else if (ch === '.' && !hasDot) {
        hasDot = true;
        num += ch;
        this.advance();
      } else {
        break;
      }
    }
    this.tokens.push({ type: TokenType.Number, value: num, line: this.line, col: startCol });
  }

  private readString(quote: string): void {
    const startCol = this.col;
    this.advance(); // skip opening quote
    let str = '';
    while (this.pos < this.src.length && this.src[this.pos] !== quote) {
      if (this.src[this.pos] === '\\') {
        this.advance();
        const esc = this.src[this.pos];
        if (esc === 'n') str += '\n';
        else if (esc === 't') str += '\t';
        else if (esc === '\\') str += '\\';
        else if (esc === quote) str += quote;
        else str += esc;
        this.advance();
      } else {
        str += this.src[this.pos];
        this.advance();
      }
    }
    if (this.pos < this.src.length) {
      this.advance(); // skip closing quote
    }
    this.tokens.push({ type: TokenType.String, value: str, line: this.line, col: startCol });
  }

  private readIdentifier(): void {
    const startCol = this.col;
    let ident = '';
    while (this.pos < this.src.length && this.isIdentPart(this.src[this.pos])) {
      ident += this.src[this.pos];
      this.advance();
    }
    const kw = KEYWORDS[ident];
    if (kw) {
      this.tokens.push({ type: kw, value: ident, line: this.line, col: startCol });
    } else {
      this.tokens.push({ type: TokenType.Identifier, value: ident, line: this.line, col: startCol });
    }
  }

  private readHexColor(): void {
    const startCol = this.col;
    let hex = '#';
    this.advance(); // skip #
    while (this.pos < this.src.length && this.isHexDigit(this.src[this.pos])) {
      hex += this.src[this.pos];
      this.advance();
    }
    this.tokens.push({ type: TokenType.HexColor, value: hex, line: this.line, col: startCol });
  }

  private isDigit(ch: string): boolean {
    return ch >= '0' && ch <= '9';
  }

  private isHexDigit(ch: string): boolean {
    return (ch >= '0' && ch <= '9') || (ch >= 'a' && ch <= 'f') || (ch >= 'A' && ch <= 'F');
  }

  private isIdentStart(ch: string): boolean {
    return (ch >= 'a' && ch <= 'z') || (ch >= 'A' && ch <= 'Z') || ch === '_';
  }

  private isIdentPart(ch: string): boolean {
    return this.isIdentStart(ch) || this.isDigit(ch);
  }
}
