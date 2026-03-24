"""Quick test script for AAPL option chain via yahooquery."""

from yahooquery import Ticker

aapl = Ticker("aapl")
df = aapl.option_chain

if isinstance(df, str):
    print(f"Error: {df}")
    raise SystemExit(1)

print("=== Index names ===")
print(df.index.names)

print("\n=== All expirations ===")
expirations = df.index.get_level_values("expiration").unique()
print(expirations.tolist())

# Pick the nearest expiration
nearest_exp = expirations[0]
print(f"\n=== Calls for nearest expiration: {nearest_exp} ===")
calls = df.loc["aapl", nearest_exp, "calls"]
print(calls[["strike", "bid", "ask", "lastPrice", "volume", "openInterest", "impliedVolatility", "inTheMoney"]].to_string())

print("\n=== In-the-money calls (all expirations) ===")
itm = df.loc[df["inTheMoney"] == True].xs("aapl")
print(itm[["strike", "bid", "ask", "impliedVolatility", "openInterest"]].head(10).to_string())
