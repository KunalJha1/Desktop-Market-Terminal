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
  ColonEquals = 'ColonEquals', // :=  (reassignment)
  FatArrow = 'FatArrow',       // =>  (function def)
  Dot = 'Dot',                 // .   (namespace access)
  // Delimiters
  LParen = 'LParen',
  RParen = 'RParen',
  LBracket = 'LBracket',
  RBracket = 'RBracket',
  Comma = 'Comma',
  Equals = 'Equals',
  Question = 'Question',
  Colon = 'Colon',
  // Keywords — original
  KW_Input = 'KW_Input',
  KW_Plot = 'KW_Plot',
  KW_HLine = 'KW_HLine',
  KW_Fill = 'KW_Fill',
  // Keywords — new
  KW_If = 'KW_If',
  KW_Else = 'KW_Else',
  KW_For = 'KW_For',
  KW_To = 'KW_To',
  KW_By = 'KW_By',
  KW_While = 'KW_While',
  KW_Var = 'KW_Var',
  KW_Return = 'KW_Return',
  KW_True = 'KW_True',
  KW_False = 'KW_False',
  KW_Indicator = 'KW_Indicator',
  KW_Strategy = 'KW_Strategy',
  KW_PlotShape = 'KW_PlotShape',
  KW_BgColor = 'KW_BgColor',
  KW_And = 'KW_And',   // "and" keyword (alias for &&)
  KW_Or = 'KW_Or',     // "or" keyword (alias for ||)
  KW_Not = 'KW_Not',   // "not" keyword (alias for !)
  // Structural
  Newline = 'Newline',
  LineIndent = 'LineIndent', // raw indent level emitted by lexer (spaces count)
  Indent = 'Indent',         // virtual token from indentation post-processor
  Dedent = 'Dedent',         // virtual token from indentation post-processor
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
  | BooleanLiteral
  | BinaryExpr
  | UnaryExpr
  | Ternary
  | Assignment
  | Reassignment
  | FunctionCall
  | NamespacedCall
  | IndexExpr
  | InputDecl
  | PlotCall
  | HLineCall
  | FillCall
  | PlotShapeCall
  | BgColorCall
  | IfStatement
  | ForStatement
  | WhileStatement
  | VarDecl
  | FunctionDef
  | ReturnStatement;

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

export interface BooleanLiteral {
  kind: 'BooleanLiteral';
  value: boolean;
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

/** Pine Script-style := reassignment. Semantically identical to Assignment in series mode. */
export interface Reassignment {
  kind: 'Reassignment';
  name: string;
  value: ASTNode;
  line: number;
}

export interface FunctionCall {
  kind: 'FunctionCall';
  name: string;
  args: ASTNode[];
  namedArgs: NamedArg[];
  line: number;
}

/** Namespaced function call: ta.sma(close, 14), math.abs(x), input.int(20, "Length") */
export interface NamespacedCall {
  kind: 'NamespacedCall';
  namespace: string;
  fn: string;
  args: ASTNode[];
  namedArgs: NamedArg[];
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

/** plotshape(series, style=..., location=..., color=..., text=...) */
export interface PlotShapeCall {
  kind: 'PlotShapeCall';
  series: ASTNode;
  namedArgs: NamedArg[];
  line: number;
}

/** bgcolor(color, transp=...) */
export interface BgColorCall {
  kind: 'BgColorCall';
  color: ASTNode;
  namedArgs: NamedArg[];
  line: number;
}

export interface IfStatement {
  kind: 'IfStatement';
  condition: ASTNode;
  thenBody: ASTNode[];
  /** null = no else. May contain [IfStatement] for else-if chains. */
  elseBody: ASTNode[] | null;
  line: number;
}

export interface ForStatement {
  kind: 'ForStatement';
  varName: string;
  from: ASTNode;
  to: ASTNode;
  step: ASTNode | null;
  body: ASTNode[];
  line: number;
}

export interface WhileStatement {
  kind: 'WhileStatement';
  condition: ASTNode;
  body: ASTNode[];
  line: number;
}

/** var name = expr  (mutable variable declaration) */
export interface VarDecl {
  kind: 'VarDecl';
  name: string;
  value: ASTNode;
  line: number;
}

/** name(param1, param2) =>\n    body */
export interface FunctionDef {
  kind: 'FunctionDef';
  name: string;
  params: string[];
  body: ASTNode[];
  line: number;
}

export interface ReturnStatement {
  kind: 'ReturnStatement';
  value: ASTNode;
  line: number;
}
