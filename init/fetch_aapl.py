"""Fetch AAPL daily pricing data using akshare."""
import akshare as ak

# Pull forward-adjusted daily OHLCV for AAPL
df = ak.stock_us_daily(symbol="AAPL", adjust="qfq")
print(f"Rows: {len(df)}")
print(f"Date range: {df['date'].min()} to {df['date'].max()}")
print(f"\nColumns: {list(df.columns)}")
print(f"\nLast 20 rows:\n{df.tail(20).to_string(index=False)}")
