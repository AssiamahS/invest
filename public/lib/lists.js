// Preset scan universes. "watchlist" is resolved at runtime (MCP/local server:
// ~/.invest/watchlist.json, browser: localStorage).
export const LISTS = {
  megacaps: ["AAPL", "MSFT", "NVDA", "AMZN", "GOOGL", "META", "TSLA", "AVGO", "BRK-B", "JPM", "LLY", "V", "MA", "NFLX", "COST", "WMT", "ORCL", "AMD", "PLTR", "UBER"],
  semis: ["NVDA", "AMD", "AVGO", "TSM", "MU", "INTC", "QCOM", "ARM", "MRVL", "LRCX", "AMAT", "KLAC", "TXN", "ON", "SNDK", "STX", "WDC", "TTMI", "SMCI", "ASML"],
  growth: ["MELI", "SHOP", "SOFI", "ZETA", "CELH", "HOOD", "CRWD", "NET", "DDOG", "SNOW", "COIN", "RBLX", "DUOL", "APP", "AXON", "BE", "NDAQ", "RKLB", "IONQ", "HIMS"],
  etfs: ["SPY", "QQQ", "IWM", "DIA", "XLK", "XLF", "XLE", "XLV", "SMH", "ARKK", "TLT", "GLD", "SLV", "USO", "IBIT"],
};
