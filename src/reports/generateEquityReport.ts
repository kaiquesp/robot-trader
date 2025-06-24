// src/reports/generateEquityReport.ts
import fs from 'fs';
import path from 'path';

interface TradeDetail {
  entryTime: number;
  exitTime: number;
  pnl: number;
}

interface BacktestResult {
  trades: TradeDetail[];
}

function generateEquityCurve(trades: TradeDetail[]): { times: number[], equity: number[], drawdown: number[] } {
  const equity: number[] = [];
  const drawdown: number[] = [];
  const times: number[] = [];

  let balance = 100; // saldo inicial
  let peak = balance;

  trades.sort((a, b) => a.exitTime - b.exitTime);

  for (const trade of trades) {
    balance += trade.pnl;
    peak = Math.max(peak, balance);

    const dd = (peak - balance) / peak * 100;

    equity.push(balance);
    drawdown.push(dd);
    times.push(trade.exitTime);
  }

  return { times, equity, drawdown };
}

export function generateEquityHtmlReport(resultFile: string) {
  const filePath = path.resolve(resultFile);
  const json = fs.readFileSync(filePath, 'utf-8');
  const result: BacktestResult = JSON.parse(json);

  const { times, equity, drawdown } = generateEquityCurve(result.trades);

  const html = `
<html>
<head>
  <script src="https://cdn.jsdelivr.net/npm/chart.js"></script>
  <title>Equity Curve + Drawdown</title>
</head>
<body>
  <h2>Equity Curve & Drawdown</h2>
  <canvas id="equityChart" width="1200" height="600"></canvas>
  <script>
    const ctx = document.getElementById('equityChart').getContext('2d');
    new Chart(ctx, {
      type: 'line',
      data: {
        labels: ${JSON.stringify(times.map(t => new Date(t).toISOString().split('T')[0]))},
        datasets: [
          {
            label: 'Equity Curve',
            data: ${JSON.stringify(equity)},
            borderColor: 'green',
            yAxisID: 'y1',
            fill: false
          },
          {
            label: 'Drawdown (%)',
            data: ${JSON.stringify(drawdown)},
            borderColor: 'red',
            yAxisID: 'y2',
            fill: false
          }
        ]
      },
      options: {
        scales: {
          y1: {
            type: 'linear',
            position: 'left',
            title: { display: true, text: 'Equity' }
          },
          y2: {
            type: 'linear',
            position: 'right',
            title: { display: true, text: 'Drawdown (%)' },
            grid: { drawOnChartArea: false }
          }
        }
      }
    });
  </script>
</body>
</html>
`;

  const outPath = path.join(path.dirname(resultFile), 'equity-report.html');
  fs.writeFileSync(outPath, html);
  console.log(`✅ Equity report gerado: ${outPath}`);
}
