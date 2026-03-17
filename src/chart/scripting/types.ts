// ─── Token Types ────────────────────────────────────────────────────────────

export enum TokenType {
  Number = 'Number',
  String = 'String',
  Identifier = 'Identifier',
  HexColor = 'HexColor',
  // Operators
  Plus = 'Plus',
  Minus = 'Minus',
  Star = 'Star',
  Slash = 'Slash',
  Percent = 'Percent',
  GT = 'GT',
  LT = 'LT',
  GTE = 'GTE',
  LTE = 'LTE',
  EqEq = 'EqEq',
  NotEq = 'NotEq',
  And = 'And',
  Or = 'Or',
  Not = 'Not',
  // Delimiters
  LParen = 'LParen',
  RParen = 'RParen',
  LBracket = 'LBracket',
  RBracket = 'RBracket',
  Comma = 'Comma',
  Equals = 'Equals',
  Question = 'Question',
  Colon = 'Colon',
  // Keywords
  KW_Input = 'KW_Input',
  KW_Plot = 'KW_Plot',
  KW_HLine = 'KW_HLine',
  KW_Fill = 'KW_Fill',
  // Structural
  Newline = 'Newline',
  EOF = 'EOF',
}

export interface Token {
  type: TokenType;
  value: string;
  line: number;
  col: number;
}

// ─── AST Node Types ─────────────────────────────────────────────────────────

export type ASTNode =
  | NumberLiteral
  | StringLiteral
  | Identifier
  | HexColorLiteral
  | BinaryExpr
  | UnaryExpr
  | Ternary
  | Assignment
  | FunctionCall
  | IndexExpr
  | InputDecl
  | PlotCall
  | HLineCall
  | FillCall;

export interface NumberLiteral {
  kind: 'NumberLiteral';
  value: number;
  line: number;
}

export interface StringLiteral {
  kind: 'StringLiteral';
  value: string;
  line: number;
}

export interface Identifier {
  kind: 'Identifier';
  name: string;
  line: number;
}

export interface HexColorLiteral {
  kind: 'HexColorLiteral';
  value: string; // e.g. "#1A56DB"
  line: number;
}

export interface BinaryExpr {
  kind: 'BinaryExpr';
  op: string;
  left: ASTNode;
  right: ASTNode;
  line: number;
}

export interface UnaryExpr {
  kind: 'UnaryExpr';
  op: string;
  operand: ASTNode;
  line: number;
}

export interface Ternary {
  kind: 'Ternary';
  condition: ASTNode;
  trueExpr: ASTNode;
  falseExpr: ASTNode;
  line: number;
}

export interface Assignment {
  kind: 'Assignment';
  name: string;
  value: ASTNode;
  line: number;
}

export interface FunctionCall {
  kind: 'FunctionCall';
  name: string;
  args: ASTNode[];
  line: number;
}

export interface IndexExpr {
  kind: 'IndexExpr';
  object: ASTNode;
  index: ASTNode;
  line: number;
}

export interface InputDecl {
  kind: 'InputDecl';
  name: string;
  defaultValue: ASTNode;
  line: number;
}

export interface NamedArg {
  name: string;
  value: ASTNode;
}

export interface PlotCall {
  kind: 'PlotCall';
  expr: ASTNode;
  label: ASTNode | null;
  namedArgs: NamedArg[];
  line: number;
}

export interface HLineCall {
  kind: 'HLineCall';
  value: ASTNode;
  namedArgs: NamedArg[];
  line: number;
}

export interface FillCall {
  kind: 'FillCall';
  plotA: ASTNode;
  plotB: ASTNode;
  namedArgs: NamedArg[];
  line: number;
}
