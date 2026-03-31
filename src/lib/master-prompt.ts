/**
 * Master prompt for LLM-assisted indicator/strategy authoring.
 * Copy this into any LLM to get a valid DailyIQ script back.
 */
export const MASTER_PROMPT = `You are writing a script for the DailyIQ Scripting Engine — a Pine Script-inspired DSL that runs inside a trading chart app. Your output MUST be raw script source code only. No markdown, no code fences, no explanations.

═══════════════════════════════════════════════
SCRIPT STRUCTURE
═══════════════════════════════════════════════

Declare the script type on the first line (required):

  indicator("My Indicator", overlay=false)
  // OR
  strategy("My Strategy", overlay=true)

Set overlay=true to render on the price pane (moving averages, signals, etc.)
Set overlay=false for oscillators in a sub-pane (RSI, MACD, score-based, etc.)

═══════════════════════════════════════════════
BUILT-IN SERIES (one value per bar)
═══════════════════════════════════════════════

  open    high    low    close    volume
  hl2     hlc3    ohlc4
  bar_index   (0-based integer)
  na          (NaN — use nz() to replace)
  true / false

History: series[N] = value N bars ago
  close[1]   // previous bar's close
  close[5]   // 5 bars ago

═══════════════════════════════════════════════
INPUT PARAMETERS
═══════════════════════════════════════════════

  input length = 14
  input.int("Length", 14)
  input.float("Multiplier", 1.5)
  input.bool("Show Signals", true)
  input.string("Type", "ema")

═══════════════════════════════════════════════
OPERATORS
═══════════════════════════════════════════════

  Arithmetic:  +  -  *  /  %
  Comparison:  >  <  >=  <=  ==  !=
  Logical:     &&  ||  !    (or: and  or  not)
  Ternary:     condition ? trueVal : falseVal

═══════════════════════════════════════════════
CONTROL FLOW (indentation is significant)
═══════════════════════════════════════════════

  if condition
      statements
  else
      statements

  for i = 0 to 9
      statements

  while condition
      statements

═══════════════════════════════════════════════
USER-DEFINED FUNCTIONS
═══════════════════════════════════════════════

  myFunc(a, b) =>
      result = a + b
      return result

  val = myFunc(close, open)

═══════════════════════════════════════════════
TA NAMESPACE  (ta.*)
═══════════════════════════════════════════════

Moving Averages:
  ta.sma(series, period)
  ta.ema(series, period)
  ta.rma(series, period)          // Wilder's RMA / SMMA

Momentum / Oscillators:
  ta.rsi(series, period)          // 0–100
  ta.stoch(high, low, close, k)
  ta.cci(high, low, close, period)
  ta.wpr(high, low, close, period) // Williams %R (-100 to 0)
  ta.mfi(high, low, close, volume, period)
  ta.obv(close, volume)

Trend / Volatility:
  ta.atr(high, low, close, period)
  ta.tr(high, low, close)
  ta.supertrend(high, low, close, period, mult) // returns [line, direction]
  ta.vwap(high, low, close, volume)

Bollinger Bands:
  ta.bb.basis(series, period)
  ta.bb.upper(series, period, mult)
  ta.bb.lower(series, period, mult)

Crossovers:
  crossover(a, b)    // true when a crosses above b
  crossunder(a, b)   // true when a crosses below b

Pivots:
  ta.pivothigh(series, leftBars, rightBars)
  ta.pivotlow(series, leftBars, rightBars)

Window functions:
  highest(series, period)
  lowest(series, period)
  stdev(series, period)
  sum(series, period)

═══════════════════════════════════════════════
MATH NAMESPACE  (math.* or flat)
═══════════════════════════════════════════════

  math.abs(x)   math.sqrt(x)   math.log(x)
  math.pow(x,y) math.round(x)  math.floor(x)  math.ceil(x)
  math.max(a,b) math.min(a,b)

NaN helpers:
  nz(series, replacement)   // replace NaN with replacement (default 0)
  na(series)                // 1.0 where NaN, else 0.0
  fixnan(series)            // carry-forward last valid value

═══════════════════════════════════════════════
VISUALIZATION
═══════════════════════════════════════════════

Lines / areas / histograms:
  plot(series, "Label")
  plot(series, "Label", color=#1A56DB, lineWidth=2)
  plot(series, "Label", style="histogram")
  // styles: "line" | "histogram" | "area" | "dots"

Horizontal lines:
  hline(70, color=#FF3D71)
  hline(30, color=#00C853, style=dashed)  // "solid" | "dashed"

Fills:
  p1 = plot(upper, "Upper")
  p2 = plot(lower, "Lower")
  fill(p1, p2, color=#1A56DB)

BUY / SELL SIGNALS (plotshape):
  plotshape(condition, style="triangleup",   location="belowbar", color=#00C853, text="BUY")
  plotshape(condition, style="triangledown", location="abovebar", color=#FF3D71, text="SELL")

  // All style options:
  //   "triangleup"   "triangledown"   "circle"   "cross"   "diamond"

  // All location options:
  //   "belowbar"  → below the candle (use for BUY signals)
  //   "abovebar"  → above the candle (use for SELL signals)
  //   "high"      → pinned to bar high
  //   "low"       → pinned to bar low
  //   "close"     → pinned to bar close

Background shading:
  bgcolor(#1A56DB)
  bgcolor(condition ? #00C853 : na)   // conditional

Colors:
  #RRGGBB    hex (e.g. #1A56DB)
  #RRGGBBAA  with alpha (e.g. #1A56DB40)
  color.new(#1A56DB, 80)  // 0=opaque, 100=transparent

═══════════════════════════════════════════════
DESIGN SYSTEM COLORS
═══════════════════════════════════════════════

  #00C853   Profit / BUY / bullish
  #FF3D71   Loss / SELL / bearish
  #F59E0B   Warning / caution / neutral signal
  #1A56DB   Primary line / interactive
  #8B5CF6   ML / AI features only
  #8B949E   Dim / muted label
  #E6EDF3   Primary text / bright line

═══════════════════════════════════════════════
DAILYIQ BUILT-IN SERIES (platform-specific)
═══════════════════════════════════════════════

DailyIQ exposes proprietary computed series that update alongside OHLCV bars.
These are available as named series directly in the script environment:

  diq_score         // DailyIQ Technical Score (0–100)
                    // Composite score from RSI, MACD, EMA, stochastic, Bollinger,
                    // trend angle, market structure, ATR, volume, and regime.
                    // Values: >70 = bullish zone, <30 = bearish zone, 50 = neutral
                    // Use: plot(diq_score, "Score", color=#1A56DB)
                    //      crossover(diq_score, 50) → BUY signal above neutral
                    //      crossunder(diq_score, 50) → SELL signal below neutral

  diq_sentiment     // DailyIQ Market Sentiment (0–100)
                    // Combines oscillator consensus + trend direction.
                    // Values: >60 = bullish, <40 = bearish

  diq_trend_angle   // Trend Angle in degrees (-90 to +90)
                    // EMA slope normalized by ATR. >15 = strong uptrend, <-15 = downtrend

  diq_bull_bear     // Bull Bear Power (-100 to +100)
                    // Normalized price position relative to EMA + volatility bands

  diq_structure     // Market Structure score (-100 to +100)
                    // Pivot break detection: positive = bullish breaks, negative = bearish

  diq_lin_reg       // Linear Regression score (-100 to +100)
                    // R² weighted trend strength

IMPORTANT: These series are pre-computed — do NOT pass them to ta.* functions
that expect raw OHLCV (e.g. do not use ta.rsi(diq_score, 14) as an oscillator
of an oscillator). You CAN apply ta.sma/ta.ema to smooth them.

Example — score-based strategy:
  strategy("DailyIQ Score Cross", overlay=true)
  score_smoothed = ta.sma(diq_score, 3)
  buy  = crossover(score_smoothed, 50)
  sell = crossunder(score_smoothed, 50)
  plotshape(buy,  style="triangleup",   location="belowbar", color=#00C853, text="BUY")
  plotshape(sell, style="triangledown", location="abovebar", color=#FF3D71, text="SELL")

Example — sentiment confirmation filter:
  strategy("Sentiment Filter", overlay=true)
  input fast = 9
  input slow = 21
  fast_ema = ta.ema(close, fast)
  slow_ema = ta.ema(close, slow)
  bull_cross = crossover(fast_ema, slow_ema)
  bear_cross = crossunder(fast_ema, slow_ema)
  // Only take signals when sentiment agrees
  buy  = bull_cross and diq_sentiment > 50
  sell = bear_cross and diq_sentiment < 50
  plotshape(buy,  style="triangleup",   location="belowbar", color=#00C853, text="BUY")
  plotshape(sell, style="triangledown", location="abovebar", color=#FF3D71, text="SELL")

═══════════════════════════════════════════════
COMPLETE EXAMPLE 1 — RSI with smoothing (sub-pane)
═══════════════════════════════════════════════

indicator("Smoothed RSI", overlay=false)
input length = 14
input smooth = 3

delta = close - close[1]
gain = max(delta, 0)
loss = max(-delta, 0)
avg_gain = ta.rma(gain, length)
avg_loss = ta.rma(loss, length)
rs = avg_gain / avg_loss
my_rsi = 100 - (100 / (1 + rs))
result = ta.sma(my_rsi, smooth)

plot(result, "Smoothed RSI", color=#1A56DB, lineWidth=2)
hline(70, color=#FF3D71, style=dashed)
hline(50, color=#8B949E, style=dashed)
hline(30, color=#00C853, style=dashed)

═══════════════════════════════════════════════
COMPLETE EXAMPLE 2 — EMA crossover BUY/SELL signals (overlay)
═══════════════════════════════════════════════

strategy("EMA Cross Signals", overlay=true)
input fast = 9
input slow = 21

fast_ema = ta.ema(close, fast)
slow_ema = ta.ema(close, slow)

buy_signal  = crossover(fast_ema, slow_ema)
sell_signal = crossunder(fast_ema, slow_ema)

plot(fast_ema, "Fast EMA", color=#1A56DB, lineWidth=1)
plot(slow_ema, "Slow EMA", color=#F59E0B, lineWidth=1)
plotshape(buy_signal,  style="triangleup",   location="belowbar", color=#00C853, text="BUY")
plotshape(sell_signal, style="triangledown", location="abovebar", color=#FF3D71, text="SELL")

═══════════════════════════════════════════════
COMPLETE EXAMPLE 3 — DailyIQ Score oscillator (sub-pane)
═══════════════════════════════════════════════

indicator("DailyIQ Score + Sentiment", overlay=false)
input smooth = 3

score_line = ta.sma(diq_score, smooth)
sent_line  = ta.sma(diq_sentiment, smooth)

plot(score_line, "DIQ Score",     color=#1A56DB, lineWidth=2)
plot(sent_line,  "Sentiment",     color=#8B5CF6, lineWidth=1)
hline(70, color=#00C853, style=dashed)
hline(50, color=#8B949E, style=dashed)
hline(30, color=#FF3D71, style=dashed)

═══════════════════════════════════════════════
RULES — READ CAREFULLY
═══════════════════════════════════════════════

1. Output ONLY the raw script. No markdown. No code fences. No explanation.
2. Every value is a series (array per bar). Use ta.* functions, not loops, for TA.
3. Use series[N] for lookback. Never loop to read history.
4. Indentation is Python-style and REQUIRED for if/for/while/function bodies.
5. Comments: //
6. Use the design system colors above for all plots.
7. overlay=true → draws on price chart (EMAs, signals). overlay=false → sub-pane (RSI, score).
8. For BUY signals: plotshape(..., location="belowbar"). For SELL: location="abovebar".
9. diq_score, diq_sentiment, etc. are pre-computed series — use them directly.

Now write the indicator or strategy as described below:`;
