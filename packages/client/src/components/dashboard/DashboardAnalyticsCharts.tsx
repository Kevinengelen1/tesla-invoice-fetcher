import { formatCurrency } from '../../lib/utils';

interface AnalyticsPoint {
  period: string;
  totalAmountCents: number;
  totalEnergyKwh: number;
  invoiceCount: number;
  superchargerAmountCents: number;
  subscriptionAmountCents: number;
  serviceAmountCents: number;
}

interface SeriesDefinition {
  key: keyof AnalyticsPoint;
  label: string;
  color: string;
}

const BAR_SERIES: SeriesDefinition[] = [
  { key: 'superchargerAmountCents', label: 'Supercharger', color: 'var(--color-primary)' },
  { key: 'subscriptionAmountCents', label: 'Subscription', color: 'var(--color-success)' },
  { key: 'serviceAmountCents', label: 'Service', color: 'var(--color-warning)' },
];

const LINE_SERIES: SeriesDefinition[] = [
  { key: 'totalEnergyKwh', label: 'Energy (kWh)', color: 'var(--color-primary)' },
  { key: 'invoiceCount', label: 'Invoices', color: 'var(--color-success)' },
];

const SVG_WIDTH = 720;
const SVG_HEIGHT = 280;
const CHART_PADDING = { top: 16, right: 56, bottom: 48, left: 56 };

function numericValue(value: unknown): number {
  return Number.isFinite(value) ? Number(value) : Number(value ?? 0);
}

function getMaxValue(points: AnalyticsPoint[], key: keyof AnalyticsPoint): number {
  return Math.max(0, ...points.map((point) => numericValue(point[key])));
}

function getLabelStep(count: number): number {
  if (count <= 6) return 1;
  if (count <= 10) return 2;
  if (count <= 16) return 3;
  return Math.ceil(count / 6);
}

function formatAxisCurrency(cents: number): string {
  const wholeUnits = cents / 100;
  if (Math.abs(wholeUnits) >= 1000) {
    return `$${Math.round(wholeUnits / 1000)}k`;
  }

  return formatCurrency(cents).replace(/\.00$/, '');
}

function buildLinePath(values: number[], maxValue: number): string {
  if (values.length === 0) {
    return '';
  }

  const innerWidth = SVG_WIDTH - CHART_PADDING.left - CHART_PADDING.right;
  const innerHeight = SVG_HEIGHT - CHART_PADDING.top - CHART_PADDING.bottom;
  const stepX = values.length === 1 ? 0 : innerWidth / (values.length - 1);

  return values
    .map((value, index) => {
      const x = CHART_PADDING.left + stepX * index;
      const y = CHART_PADDING.top + innerHeight - (maxValue === 0 ? 0 : (value / maxValue) * innerHeight);
      return `${index === 0 ? 'M' : 'L'} ${x} ${y}`;
    })
    .join(' ');
}

function EmptyChartState() {
  return (
    <div className="flex h-72 items-center justify-center rounded-lg border border-dashed border-border text-sm text-muted-foreground">
      No analytics data for the current filter.
    </div>
  );
}

function ChartLegend({ series }: { series: SeriesDefinition[] }) {
  return (
    <div className="mt-3 flex flex-wrap gap-3 text-xs text-muted-foreground">
      {series.map((item) => (
        <div key={item.label} className="flex items-center gap-2">
          <span className="h-2.5 w-2.5 rounded-full" style={{ backgroundColor: item.color }} aria-hidden="true" />
          <span>{item.label}</span>
        </div>
      ))}
    </div>
  );
}

function BarChartSvg({ points }: { points: AnalyticsPoint[] }) {
  const chartWidth = SVG_WIDTH - CHART_PADDING.left - CHART_PADDING.right;
  const chartHeight = SVG_HEIGHT - CHART_PADDING.top - CHART_PADDING.bottom;
  const groupWidth = points.length === 0 ? chartWidth : chartWidth / points.length;
  const barWidth = Math.min(24, Math.max(10, groupWidth / (BAR_SERIES.length + 1)));
  const groupOffset = (groupWidth - BAR_SERIES.length * barWidth) / 2;
  const maxAmount = Math.max(1, ...BAR_SERIES.map((series) => getMaxValue(points, series.key)));
  const yTicks = Array.from({ length: 5 }, (_, index) => (maxAmount / 4) * index);
  const labelStep = getLabelStep(points.length);

  return (
    <svg viewBox={`0 0 ${SVG_WIDTH} ${SVG_HEIGHT}`} className="h-full w-full">
      {yTicks.map((tick) => {
        const y = CHART_PADDING.top + chartHeight - (tick / maxAmount) * chartHeight;

        return (
          <g key={tick}>
            <line x1={CHART_PADDING.left} y1={y} x2={SVG_WIDTH - CHART_PADDING.right} y2={y} stroke="var(--color-border)" strokeDasharray="4 4" />
            <text x={CHART_PADDING.left - 8} y={y + 4} textAnchor="end" fontSize="12" fill="var(--color-muted-foreground)">
              {formatAxisCurrency(tick)}
            </text>
          </g>
        );
      })}

      <line
        x1={CHART_PADDING.left}
        y1={CHART_PADDING.top + chartHeight}
        x2={SVG_WIDTH - CHART_PADDING.right}
        y2={CHART_PADDING.top + chartHeight}
        stroke="var(--color-border)"
      />

      {points.map((point, pointIndex) => {
        const groupX = CHART_PADDING.left + pointIndex * groupWidth + groupOffset;

        return (
          <g key={point.period}>
            {BAR_SERIES.map((series, seriesIndex) => {
              const value = numericValue(point[series.key]);
              const barHeight = maxAmount === 0 ? 0 : (value / maxAmount) * chartHeight;
              const x = groupX + seriesIndex * barWidth;
              const y = CHART_PADDING.top + chartHeight - barHeight;

              return (
                <rect key={series.label} x={x} y={y} width={barWidth - 2} height={Math.max(barHeight, 0)} rx="4" fill={series.color}>
                  <title>{`${point.period}: ${series.label} ${formatCurrency(value)}`}</title>
                </rect>
              );
            })}

            {pointIndex % labelStep === 0 ? (
              <text
                x={CHART_PADDING.left + pointIndex * groupWidth + groupWidth / 2}
                y={SVG_HEIGHT - 16}
                textAnchor="middle"
                fontSize="12"
                fill="var(--color-muted-foreground)"
              >
                {point.period}
              </text>
            ) : null}
          </g>
        );
      })}
    </svg>
  );
}

function LineChartSvg({ points }: { points: AnalyticsPoint[] }) {
  const chartHeight = SVG_HEIGHT - CHART_PADDING.top - CHART_PADDING.bottom;
  const chartWidth = SVG_WIDTH - CHART_PADDING.left - CHART_PADDING.right;
  const labelStep = getLabelStep(points.length);
  const energyValues = points.map((point) => point.totalEnergyKwh);
  const invoiceValues = points.map((point) => point.invoiceCount);
  const maxEnergy = Math.max(1, ...energyValues);
  const maxInvoices = Math.max(1, ...invoiceValues);
  const energyPath = buildLinePath(energyValues, maxEnergy);
  const invoicePath = buildLinePath(invoiceValues, maxInvoices);
  const tickSteps = Array.from({ length: 5 }, (_, index) => index / 4);

  return (
    <svg viewBox={`0 0 ${SVG_WIDTH} ${SVG_HEIGHT}`} className="h-full w-full">
      {tickSteps.map((step) => {
        const y = CHART_PADDING.top + chartHeight - step * chartHeight;
        const leftValue = maxEnergy * step;
        const rightValue = maxInvoices * step;

        return (
          <g key={step}>
            <line x1={CHART_PADDING.left} y1={y} x2={SVG_WIDTH - CHART_PADDING.right} y2={y} stroke="var(--color-border)" strokeDasharray="4 4" />
            <text x={CHART_PADDING.left - 8} y={y + 4} textAnchor="end" fontSize="12" fill="var(--color-muted-foreground)">
              {leftValue.toFixed(0)}
            </text>
            <text x={SVG_WIDTH - CHART_PADDING.right + 8} y={y + 4} textAnchor="start" fontSize="12" fill="var(--color-muted-foreground)">
              {rightValue.toFixed(0)}
            </text>
          </g>
        );
      })}

      <line
        x1={CHART_PADDING.left}
        y1={CHART_PADDING.top + chartHeight}
        x2={SVG_WIDTH - CHART_PADDING.right}
        y2={CHART_PADDING.top + chartHeight}
        stroke="var(--color-border)"
      />

      <path d={energyPath} fill="none" stroke="var(--color-primary)" strokeWidth="3" strokeLinejoin="round" strokeLinecap="round" />
      <path d={invoicePath} fill="none" stroke="var(--color-success)" strokeWidth="3" strokeLinejoin="round" strokeLinecap="round" />

      {points.map((point, index) => {
        const x = CHART_PADDING.left + (points.length === 1 ? chartWidth / 2 : (chartWidth / (points.length - 1)) * index);
        const energyY = CHART_PADDING.top + chartHeight - (point.totalEnergyKwh / maxEnergy) * chartHeight;
        const invoiceY = CHART_PADDING.top + chartHeight - (point.invoiceCount / maxInvoices) * chartHeight;

        return (
          <g key={point.period}>
            <circle cx={x} cy={energyY} r="4" fill="var(--color-primary)">
              <title>{`${point.period}: Energy ${point.totalEnergyKwh.toFixed(1)} kWh`}</title>
            </circle>
            <circle cx={x} cy={invoiceY} r="4" fill="var(--color-success)">
              <title>{`${point.period}: Invoices ${point.invoiceCount}`}</title>
            </circle>
            {index % labelStep === 0 ? (
              <text x={x} y={SVG_HEIGHT - 16} textAnchor="middle" fontSize="12" fill="var(--color-muted-foreground)">
                {point.period}
              </text>
            ) : null}
          </g>
        );
      })}
    </svg>
  );
}

export function DashboardAnalyticsCharts({ points }: { points: AnalyticsPoint[] }) {
  return (
    <div className="grid gap-4 xl:grid-cols-2">
      <div className="rounded-lg border border-border p-4">
        <h3 className="text-sm font-medium">Cost by period</h3>
        <ChartLegend series={BAR_SERIES} />
        <div className="mt-4 h-72">{points.length === 0 ? <EmptyChartState /> : <BarChartSvg points={points} />}</div>
      </div>

      <div className="rounded-lg border border-border p-4">
        <h3 className="text-sm font-medium">Charging load and invoice volume</h3>
        <ChartLegend series={LINE_SERIES} />
        <div className="mt-4 h-72">{points.length === 0 ? <EmptyChartState /> : <LineChartSvg points={points} />}</div>
      </div>
    </div>
  );
}