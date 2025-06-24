import fs from 'fs';
import path from 'path';

interface TradeDetail {
  pnl: number;
  exitTime: number;
}

interface BacktestResult {
  timeframe: string;
  trades: TradeDetail[];
}

export function generateMultiEquityHtmlReport(jsonFiles: string[]): void {
  const series: { name: string; data: { x: number; y: number }[] }[] = [];

  for (const file of jsonFiles) {
    const content = fs.readFileSync(file, 'utf-8');
    const res: BacktestResult = JSON.parse(content);

    const sortedTrades = res.trades.sort((a, b) => a.exitTime - b.exitTime);

    let equity = 50; // saldo inicial igual ao usado no backtest
    const data = sortedTrades.map((trade) => {
      equity += trade.pnl ?? 0;
      return { x: trade.exitTime, y: equity };
    });

    series.push({
      name: res.timeframe,
      data
    });
  }

  const html = `
<!DOCTYPE html>
<html>
<head>
  <meta charset="utf-8" />
  <title>Multi Equity Curve</title>
  <script src="https://cdn.jsdelivr.net/npm/apexcharts"></script>
</head>
<body>
  <h2>📈 Multi Equity Curve</h2>
  <div id="chart"></div>

  <script>
    const options = {
      chart: {
        type: 'line',
        height: 600,
        zoom: { enabled: true }
      },
      series: ${JSON.stringify(series)},
      xaxis: {
        type: 'datetime',
        title: { text: 'Time' }
      },
      yaxis: {
        title: { text: 'Equity' }
      },
      stroke: {
        width: 2
      },
      tooltip: {
        x: { format: 'yyyy-MM-dd HH:mm' }
      }
    };

    const chart = new ApexCharts(document.querySelector("#chart"), options);
    chart.render();
  </script>
</body>
</html>
`;

  const htmlPath = path.join(__dirname, '..', '..', 'data', 'html', 'multi-equity-report.html');
  fs.mkdirSync(path.dirname(htmlPath), { recursive: true });
  fs.writeFileSync(htmlPath, html);

  console.log(`✅ HTML salvo em: ${htmlPath}`);
}
