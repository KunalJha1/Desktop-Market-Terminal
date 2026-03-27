/**
 * DailyIQ Script — Indentation Post-processor
 *
 * Converts the raw token stream from the Lexer (which includes LineIndent tokens)
 * into a stream with virtual Indent / Dedent tokens, similar to Python's tokenizer.
 *
 * Algorithm:
 *   - Maintain an indent-level stack, starting with [0].
 *   - When a LineIndent(n) token is seen:
 *       - If n > top: emit Indent, push n.
 *       - If n < top: emit Dedent for each level popped until stack top === n.
 *       - If n === top: do nothing.
 *   - Remove all LineIndent tokens from the output (they are consumed by this pass).
 *   - At EOF, emit any remaining Dedents to close open blocks.
 */

import { Token, TokenType } from './types';

export function applyIndentation(tokens: Token[]): Token[] {
  const output: Token[] = [];
  const stack: number[] = [0]; // indent level stack
  let i = 0;

  const make = (type: TokenType, tok: Token): Token => ({
    type,
    value: type === TokenType.Indent ? 'INDENT' : 'DEDENT',
    line: tok.line,
    col: tok.col,
  });

  while (i < tokens.length) {
    const tok = tokens[i];

    if (tok.type === TokenType.LineIndent) {
      const level = parseInt(tok.value, 10);
      const top = stack[stack.length - 1];

      if (level > top) {
        // Deeper: emit Indent
        output.push(make(TokenType.Indent, tok));
        stack.push(level);
      } else if (level < top) {
        // Shallower: emit Dedent(s) until level matches
        while (stack.length > 1 && stack[stack.length - 1] > level) {
          stack.pop();
          output.push(make(TokenType.Dedent, tok));
        }
        // If level doesn't match any stack entry, treat as an error but don't crash —
        // the parser will catch unexpected tokens.
      }
      // Equal level: no indent/dedent emitted; just consume the LineIndent token.
      i++;
      continue;
    }

    if (tok.type === TokenType.EOF) {
      // Close all open blocks before EOF
      while (stack.length > 1) {
        stack.pop();
        output.push(make(TokenType.Dedent, tok));
      }
      output.push(tok);
      i++;
      break;
    }

    output.push(tok);
    i++;
  }

  return output;
}
