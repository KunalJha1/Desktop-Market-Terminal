import asyncio
from ib_insync import IB, Stock


async def main():
    ib = IB()
    await ib.connectAsync("127.0.0.1", 7497, clientId=99)

    contract = Stock("HOOD", "SMART", "USD")
    await ib.qualifyContractsAsync(contract)

    bars = await ib.reqHistoricalDataAsync(
        contract,
        endDateTime="",
        durationStr="1 D",
        barSizeSetting="1 min",
        whatToShow="TRADES",
        useRTH=False,
        formatDate=1,
    )

    print(f"Total bars: {len(bars)}")
    print(f"\nFirst bar: {bars[0].date}")
    print(f"Last bar:  {bars[-1].date}")

    print("\nAll bars after 14:00 MT (4 PM EST / after-hours):")
    ah = [b for b in bars if b.date.hour >= 14]
    for bar in ah:
        print(f"  {bar.date}  C:{bar.close}  V:{bar.volume}")

    ib.disconnect()


asyncio.run(main())
